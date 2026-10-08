-- Orders, state machine guard, missions (dispatch offers), payments, ratings, messages.

-- ---------------------------------------------------------------------------
-- Event log (light event sourcing): every state change lands here.
-- ---------------------------------------------------------------------------
create table public.events (
  id bigint generated always as identity primary key,
  aggregate_type text not null check (aggregate_type in ('order', 'mission', 'report', 'payment', 'technician', 'inspection')),
  aggregate_id uuid not null,
  -- Denormalised for RLS and timelines.
  order_id uuid,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  -- 'client' events are shown on the client timeline; 'internal' are staff-only.
  visibility text not null default 'internal' check (visibility in ('client', 'internal')),
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index events_aggregate_idx on public.events (aggregate_type, aggregate_id, created_at);
create index events_order_idx on public.events (order_id, created_at) where order_id is not null;

create or replace function app.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;
create trigger events_append_only before update or delete on public.events
  for each row execute function app.forbid_mutation();

create or replace function app.log_event(
  p_aggregate_type text, p_aggregate_id uuid, p_order_id uuid, p_type text,
  p_payload jsonb default '{}'::jsonb, p_visibility text default 'internal'
) returns void
language sql security definer set search_path = public as $$
  insert into public.events (aggregate_type, aggregate_id, order_id, type, payload, visibility, actor_id)
  values (p_aggregate_type, p_aggregate_id, p_order_id, p_type, p_payload, p_visibility, auth.uid());
$$;
revoke execute on function app.log_event from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Properties
-- ---------------------------------------------------------------------------
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles (id) on delete set null,
  address text not null,
  address_details text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  location extensions.geography(Point, 4326),
  city_id uuid not null references public.cities (id),
  sector_id uuid references public.sectors (id),
  property_type public.property_type not null,
  surface_m2 numeric(8, 2) check (surface_m2 > 0),
  floor int,
  year_built int check (year_built between 1000 and 2100),
  titre_foncier_ref text,
  is_vefa boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_location_idx on public.properties using gist (location);
create index properties_city_idx on public.properties (city_id);
create index properties_created_by_idx on public.properties (created_by);

-- Derive the point and the sector from lat/lng.
create or replace function app.locate_property() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.lat is null or new.lng is null then
    new.location := null;
    new.sector_id := null;
    return new;
  end if;
  new.location := st_setsrid(st_makepoint(new.lng, new.lat), 4326)::geography;
  select s.id into new.sector_id
  from public.sectors s
  where s.city_id = new.city_id and s.active and st_covers(s.polygon, new.location)
  order by st_area(s.polygon) asc
  limit 1;
  return new;
end $$;
create trigger properties_locate before insert or update of lat, lng, city_id on public.properties
  for each row execute function app.locate_property();

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table public.order_ref_counters (
  year int primary key,
  last_value int not null
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  client_id uuid references public.profiles (id) on delete set null,
  partner_id uuid references public.partners (id),
  partner_client_ref text,
  product_id uuid not null references public.products (id),
  property_id uuid references public.properties (id),
  status public.order_status not null default 'draft',
  status_changed_at timestamptz not null default now(),
  on_hold_from public.order_status,
  purpose public.order_purpose not null,
  options text[] not null default '{}',
  -- Price is computed server-side (packages/core computePrice) and frozen here.
  price_mad numeric(10, 2) check (price_mad > 0),
  deposit_mad numeric(10, 2),
  balance_mad numeric(10, 2),
  pricing_snapshot jsonb,
  deposit_paid_at timestamptz,
  balance_paid_at timestamptz,
  -- [{"start": "...", "end": "..."}] in UTC; client_timezone kept for display (MRE).
  requested_slots jsonb not null default '[]'::jsonb check (jsonb_typeof(requested_slots) = 'array'),
  client_timezone text,
  scheduled_at timestamptz,
  -- Person on site (seller/agent): {"name", "phone", "role"}.
  onsite_contact jsonb,
  report_langs public.lang[] not null default '{fr}',
  notes text,
  source public.order_source not null default 'web',
  cancelled_reason text,
  -- Optimistic lock for dispatch and concurrent transitions.
  lock_version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_id is not null or partner_id is not null),
  check (price_mad is null or (deposit_mad is not null and balance_mad is not null))
);
create index orders_client_idx on public.orders (client_id, created_at desc);
create index orders_partner_idx on public.orders (partner_id, created_at desc) where partner_id is not null;
create index orders_status_idx on public.orders (status, status_changed_at);
create unique index orders_partner_ref_uniq on public.orders (partner_id, partner_client_ref)
  where partner_client_ref is not null;

-- Human-readable ref THQ-YYYY-000123, counter reset every year.
create or replace function app.assign_order_ref() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from now() at time zone 'Africa/Casablanca');
  n int;
begin
  insert into public.order_ref_counters as c (year, last_value) values (y, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning last_value into n;
  new.ref := format('THQ-%s-%s', y, lpad(n::text, 6, '0'));
  return new;
end $$;
create trigger orders_assign_ref before insert on public.orders
  for each row when (new.ref is null) execute function app.assign_order_ref();

-- Allowed transitions, generated from packages/core TRANSITIONS (sync-tested).
create table public.order_transitions (
  from_status public.order_status not null,
  to_status public.order_status not null,
  event text not null,
  primary key (from_status, to_status, event)
);

insert into public.order_transitions (from_status, to_status, event) values
  -- BEGIN GENERATED TRANSITIONS
  ('draft', 'awaiting_payment', 'checkout'),
  ('draft', 'cancelled', 'cancel'),
  ('awaiting_payment', 'paid', 'deposit_paid'),
  ('awaiting_payment', 'cancelled', 'payment_timeout'),
  ('awaiting_payment', 'cancelled', 'cancel'),
  ('paid', 'dispatching', 'start_dispatch'),
  ('dispatching', 'assigned', 'technician_assigned'),
  ('reassigning', 'assigned', 'technician_assigned'),
  ('reassigning', 'dispatching', 'start_dispatch'),
  ('dispatching', 'reassigning', 'dispatch_exhausted'),
  ('assigned', 'accepted', 'technician_accepted'),
  ('assigned', 'dispatching', 'offer_declined'),
  ('assigned', 'reassigning', 'offer_declined'),
  ('assigned', 'dispatching', 'offer_expired'),
  ('assigned', 'reassigning', 'offer_expired'),
  ('accepted', 'reassigning', 'unassign'),
  ('scheduled', 'reassigning', 'unassign'),
  ('accepted', 'scheduled', 'visit_scheduled'),
  ('scheduled', 'scheduled', 'visit_rescheduled'),
  ('scheduled', 'in_progress', 'visit_started'),
  ('in_progress', 'submitted', 'inspection_submitted'),
  ('submitted', 'ai_processing', 'ai_started'),
  ('ai_processing', 'in_review', 'ai_completed'),
  ('ai_processing', 'submitted', 'ai_failed'),
  ('ai_processing', 'on_hold', 'ai_failed'),
  ('in_review', 'ai_processing', 'report_regenerate'),
  ('in_review', 'in_progress', 'returned_to_technician'),
  ('in_review', 'validated', 'report_validated'),
  ('validated', 'delivered', 'report_delivered'),
  ('delivered', 'closed', 'balance_paid'),
  ('delivered', 'closed', 'close'),
  ('paid', 'cancelled', 'cancel'),
  ('dispatching', 'cancelled', 'cancel'),
  ('reassigning', 'cancelled', 'cancel'),
  ('assigned', 'cancelled', 'cancel'),
  ('accepted', 'cancelled', 'cancel'),
  ('scheduled', 'cancelled', 'cancel'),
  ('on_hold', 'cancelled', 'cancel'),
  ('cancelled', 'refunded', 'refund_completed'),
  ('awaiting_payment', 'on_hold', 'hold'),
  ('paid', 'on_hold', 'hold'),
  ('dispatching', 'on_hold', 'hold'),
  ('assigned', 'on_hold', 'hold'),
  ('accepted', 'on_hold', 'hold'),
  ('scheduled', 'on_hold', 'hold'),
  ('in_progress', 'on_hold', 'hold'),
  ('submitted', 'on_hold', 'hold'),
  ('ai_processing', 'on_hold', 'hold'),
  ('in_review', 'on_hold', 'hold'),
  ('validated', 'on_hold', 'hold'),
  ('delivered', 'on_hold', 'hold'),
  ('reassigning', 'on_hold', 'hold'),
  ('on_hold', 'awaiting_payment', 'resume'),
  ('on_hold', 'paid', 'resume'),
  ('on_hold', 'dispatching', 'resume'),
  ('on_hold', 'assigned', 'resume'),
  ('on_hold', 'accepted', 'resume'),
  ('on_hold', 'scheduled', 'resume'),
  ('on_hold', 'in_progress', 'resume'),
  ('on_hold', 'submitted', 'resume'),
  ('on_hold', 'ai_processing', 'resume'),
  ('on_hold', 'in_review', 'resume'),
  ('on_hold', 'validated', 'resume'),
  ('on_hold', 'delivered', 'resume'),
  ('on_hold', 'reassigning', 'resume')
  -- END GENERATED TRANSITIONS
;

/*
 * Status guard. Application code computes transitions with packages/core and
 * names the event through the transaction-local setting `thiqa.event`:
 *   select set_config('thiqa.event', 'deposit_paid', true);
 * The trigger rejects any (from, to, event) not declared, keeps bookkeeping
 * columns consistent and writes the event log.
 */
create or replace function app.guard_order_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ev text := nullif(current_setting('thiqa.event', true), '');
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' and coalesce(ev, '') <> 'import' then
      raise exception 'orders must be created as draft (got %)', new.status using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status and ev is null then
    return new;
  end if;
  if not exists (
    select 1 from public.order_transitions t
    where t.from_status = old.status and t.to_status = new.status and (ev is null or t.event = ev)
  ) then
    raise exception 'illegal order transition % -> % (event %)', old.status, new.status, coalesce(ev, '?')
      using errcode = 'check_violation';
  end if;

  new.status_changed_at := now();
  new.lock_version := old.lock_version + 1;
  if new.status = 'on_hold' then
    new.on_hold_from := old.status;
  elsif old.status = 'on_hold' then
    new.on_hold_from := null;
  end if;
  return new;
end $$;
create trigger orders_guard_status before insert or update of status on public.orders
  for each row execute function app.guard_order_status();

create or replace function app.log_order_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.log_event(
    'order', new.id, new.id,
    'order.' || coalesce(nullif(current_setting('thiqa.event', true), ''), 'status_changed'),
    jsonb_build_object('from', case when tg_op = 'UPDATE' then old.status end, 'to', new.status),
    'client'
  );
  return null;
end $$;
create trigger orders_log_insert after insert on public.orders
  for each row execute function app.log_order_status();
create trigger orders_log_status after update of status on public.orders
  for each row when (old.status is distinct from new.status or coalesce(current_setting('thiqa.event', true), '') <> '')
  execute function app.log_order_status();

-- ---------------------------------------------------------------------------
-- Missions: one row per dispatch offer (attempt).
-- ---------------------------------------------------------------------------
create table public.missions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  technician_id uuid not null references public.technicians (profile_id),
  status public.mission_status not null default 'offered',
  attempt_no int not null check (attempt_no > 0),
  dispatch_score numeric(6, 3),
  offer_expires_at timestamptz,
  assigned_at timestamptz not null default now(),
  accepted_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  started_at timestamptz,
  checkout_at timestamptz,
  submitted_at timestamptz,
  checkin_lat double precision,
  checkin_lng double precision,
  checkin_distance_m numeric(10, 1),
  checkin_justification text,
  checkout_lat double precision,
  checkout_lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, attempt_no),
  -- §7: check-in farther than 150 m from the property requires a justification.
  check (checkin_distance_m is null or checkin_distance_m <= 150 or checkin_justification is not null)
);
-- No double attribution: at most one live mission per order.
create unique index missions_one_live_per_order on public.missions (order_id)
  where status in ('offered', 'accepted', 'scheduled', 'in_progress');
create index missions_technician_idx on public.missions (technician_id, status);
create index missions_offer_expiry_idx on public.missions (offer_expires_at) where status = 'offered';

create or replace function app.log_mission_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.log_event('mission', new.id, new.order_id, 'mission.' || new.status,
    jsonb_build_object('from', case when tg_op = 'UPDATE' then old.status end, 'to', new.status,
                       'technician_id', new.technician_id, 'attempt_no', new.attempt_no));
  return null;
end $$;
create trigger missions_log after insert or update of status on public.missions
  for each row execute function app.log_mission_status();

-- ---------------------------------------------------------------------------
-- Payments (webhooks are idempotent on provider_ref / idempotency_key)
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  provider public.payment_provider not null,
  kind public.payment_kind not null,
  amount_mad numeric(10, 2) not null check (amount_mad > 0),
  currency char(3) not null default 'MAD',
  amount_currency numeric(12, 2),
  status public.payment_status not null default 'pending',
  provider_ref text,
  idempotency_key text unique,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index payments_order_idx on public.payments (order_id);

create or replace function app.log_payment_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.log_event('payment', new.id, new.order_id, 'payment.' || new.kind || '.' || new.status,
    jsonb_build_object('amount_mad', new.amount_mad, 'provider', new.provider),
    case when new.status = 'succeeded' then 'client' else 'internal' end);
  return null;
end $$;
create trigger payments_log after insert or update of status on public.payments
  for each row execute function app.log_payment_status();

-- ---------------------------------------------------------------------------
-- Ratings & messages
-- ---------------------------------------------------------------------------
create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  by_client uuid not null references public.profiles (id),
  technician_id uuid references public.technicians (profile_id),
  stars smallint not null check (stars between 1 and 5),
  -- Net Promoter Score question (0–10), optional.
  nps smallint check (nps between 0 and 10),
  comment text,
  created_at timestamptz not null default now()
);

create or replace function app.refresh_technician_rating() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.technician_id is not null then
    update public.technicians t
    set rating_avg = s.avg, rating_count = s.cnt
    from (select round(avg(stars)::numeric, 2) as avg, count(*) as cnt
          from public.ratings where technician_id = new.technician_id) s
    where t.profile_id = new.technician_id;
  end if;
  return null;
end $$;
create trigger ratings_refresh after insert on public.ratings
  for each row execute function app.refresh_technician_rating();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  body text not null check (length(body) between 1 and 4000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_order_idx on public.messages (order_id, created_at);

create trigger properties_updated_at before update on public.properties for each row execute function app.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function app.set_updated_at();
create trigger missions_updated_at before update on public.missions for each row execute function app.set_updated_at();
create trigger payments_updated_at before update on public.payments for each row execute function app.set_updated_at();
