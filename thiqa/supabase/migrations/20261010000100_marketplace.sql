-- "Comment le régler", practical solutions, artisan marketplace, partner
-- programme (artisans, technicians, brands, referrers) and sponsored placements.
-- Enum values mirror packages/core/src/marketplace/enums.ts (sync-tested).

create type public.resolution as enum ('diy', 'pro', 'legal');
create type public.trade as enum (
  'electricien', 'plombier', 'etancheite', 'macon', 'menuisier', 'peintre', 'climaticien', 'carreleur',
  'serrurier', 'autre'
);
create type public.partner_kind as enum ('artisan', 'technician', 'brand', 'referrer');
create type public.partner_status as enum ('pending', 'active', 'rejected', 'suspended');
create type public.quote_request_status as enum ('sent', 'quoted', 'chosen', 'done', 'expired');
create type public.quote_status as enum ('sent', 'chosen', 'declined');
create type public.referral_status as enum ('pending', 'due', 'paid');
create type public.placement_kind as enum ('product', 'sheet_sponsor', 'report_insert');
create type public.solution_category as enum ('eau', 'electricite', 'humidite', 'clim', 'fenetres', 'peinture');

alter table public.events drop constraint events_aggregate_type_check;
alter table public.events add constraint events_aggregate_type_check check (aggregate_type in (
  'order', 'mission', 'report', 'payment', 'technician', 'inspection', 'quote_request', 'quote', 'partner'));

-- ---------------------------------------------------------------------------
-- Practical solutions (public library, also the SEO / social channel)
-- ---------------------------------------------------------------------------
create table public.solutions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  category public.solution_category not null,
  title_i18n jsonb not null check (app.is_i18n(title_i18n)),
  summary_i18n jsonb not null default '{}'::jsonb,
  video_url text,
  -- Exactly three steps: [{"text_i18n": {...}, "image_path": "..."}]
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) = 3),
  -- [{"name_i18n": {...}, "price_mad": 45}]
  materials jsonb not null default '[]'::jsonb check (jsonb_typeof(materials) = 'array'),
  level smallint not null check (level between 1 and 3),
  minutes int not null check (minutes > 0),
  stop_signals_i18n jsonb not null check (jsonb_typeof(stop_signals_i18n) = 'array'),
  trade_fallback public.trade not null,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index solutions_category_idx on public.solutions (category) where published;

-- Resolution path per inspection point (§1). The technician proposes, the reviewer decides.
alter table public.inspection_items
  add column resolution public.resolution,
  add column diy_level smallint check (diy_level between 1 and 3),
  add column diy_minutes int check (diy_minutes > 0),
  add column solution_id uuid references public.solutions (id) on delete set null,
  add column trade public.trade,
  add constraint inspection_items_diy_fields check (resolution = 'diy' or (diy_level is null and diy_minutes is null));

-- ---------------------------------------------------------------------------
-- Partner programme: one account per (person, kind); a person may hold several.
-- ---------------------------------------------------------------------------
create table public.partner_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind public.partner_kind not null,
  status public.partner_status not null default 'pending',
  -- Onboarding answers (company, role, cities, volume, products…), saved at each step.
  data jsonb not null default '{}'::jsonb,
  onboarding_step smallint not null default 1,
  referral_code text unique check (referral_code ~ '^[A-Z0-9]{6,12}$'),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, kind),
  check (status <> 'rejected' or rejection_reason is not null)
);
create index partner_accounts_queue_idx on public.partner_accounts (kind, created_at) where status = 'pending';

-- Brands reuse `partners` (already used for API partners such as Smart BNB).
alter table public.partners
  add column kind text not null default 'api' check (kind in ('api', 'brand')),
  add column logo_path text,
  add column category text,
  add column contract_from date,
  add column contract_to date,
  add column partner_account_id uuid references public.partner_accounts (id) on delete set null,
  add constraint partners_contract_dates check (contract_to is null or contract_from is null or contract_to >= contract_from);

-- ---------------------------------------------------------------------------
-- Artisans
-- ---------------------------------------------------------------------------
create table public.artisans (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  partner_account_id uuid not null unique references public.partner_accounts (id) on delete cascade,
  display_name text not null,
  status public.partner_status not null default 'pending',
  trades public.trade[] not null check (cardinality(trades) between 1 and 10),
  -- {"electricien": 12, "plombier": 4}
  years_experience jsonb not null default '{}'::jsonb,
  city_ids uuid[] not null default '{}',
  sector_ids uuid[] not null default '{}',
  radius_km smallint check (radius_km between 1 and 200),
  legal_status text check (legal_status in ('patente', 'auto_entrepreneur', 'societe')),
  ice text check (ice is null or ice ~ '^[0-9]{15}$'),
  rc text,
  -- Storage paths of ID, legal proofs, insurance and portfolio photos.
  docs jsonb not null default '{}'::jsonb,
  identity_verified boolean not null default false,
  legal_verified boolean not null default false,
  insurance_verified boolean not null default false,
  charter_signed_at timestamptz,
  -- Computed by packages/core computeArtisanScore, stored on every event.
  score smallint not null default 60 check (score between 0 and 100),
  badges text[] not null default '{}',
  rating_avg numeric(3, 2) not null default 0,
  rating_count int not null default 0,
  response_rate numeric(4, 3) not null default 0 check (response_rate between 0 and 1),
  in_range_rate numeric(4, 3) not null default 0 check (in_range_rate between 0 and 1),
  jobs_completed int not null default 0,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or (charter_signed_at is not null and identity_verified))
);
create index artisans_trades_idx on public.artisans using gin (trades) where status = 'active';
create index artisans_cities_idx on public.artisans using gin (city_ids) where status = 'active';

create table public.artisan_score_history (
  id bigint generated always as identity primary key,
  artisan_id uuid not null references public.artisans (profile_id) on delete cascade,
  score smallint not null,
  components jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index artisan_score_history_idx on public.artisan_score_history (artisan_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Quotes: the inspection point is the specification (§3)
-- ---------------------------------------------------------------------------
create table public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  -- Null for a request made from the public directory (free description + photos).
  order_id uuid references public.orders (id) on delete set null,
  client_id uuid not null references public.profiles (id) on delete cascade,
  items uuid[] not null default '{}',
  trade public.trade not null,
  city_id uuid not null references public.cities (id),
  -- The exact address is never stored here: artisans only see the sector.
  sector_id uuid references public.sectors (id),
  description text,
  photos text[] not null default '{}',
  status public.quote_request_status not null default 'sent',
  sent_to uuid[] not null default '{}' check (cardinality(sent_to) <= 3),
  expires_at timestamptz not null default now() + interval '48 hours',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (order_id is not null or description is not null)
);
create index quote_requests_client_idx on public.quote_requests (client_id, created_at desc);
create index quote_requests_sent_to_idx on public.quote_requests using gin (sent_to);

-- Only active artisans of the right trade may receive a request.
create or replace function app.check_quote_recipients() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from unnest(new.sent_to) r(id)
    where not exists (select 1 from public.artisans a
                      where a.profile_id = r.id and a.status = 'active' and new.trade = any (a.trades))
  ) then
    raise exception 'quote request sent to an inactive or unqualified artisan' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger quote_requests_recipients before insert or update of sent_to, trade on public.quote_requests
  for each row execute function app.check_quote_recipients();

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.quote_requests (id) on delete cascade,
  artisan_id uuid not null references public.artisans (profile_id),
  amount_mad numeric(12, 2) not null check (amount_mad > 0),
  delay_days smallint not null check (delay_days between 0 and 365),
  detail text not null check (length(detail) <= 600),
  pdf_path text,
  -- Position against the Thiqa range (packages/core priceBand), set server-side.
  band text check (band in ('below', 'in', 'above')),
  status public.quote_status not null default 'sent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, artisan_id)
);
create unique index quotes_one_chosen on public.quotes (request_id) where status = 'chosen';

-- An artisan can only quote a request addressed to them, before it is closed.
create or replace function app.check_quote_allowed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.quote_requests q
                 where q.id = new.request_id and new.artisan_id = any (q.sent_to)
                   and q.status in ('sent', 'quoted') and q.expires_at > now()) then
    raise exception 'quote not allowed for this request' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger quotes_allowed before insert on public.quotes
  for each row execute function app.check_quote_allowed();

-- Request status follows its quotes.
create or replace function app.sync_request_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.quote_requests set status = 'quoted' where id = new.request_id and status = 'sent';
  elsif new.status = 'chosen' and old.status is distinct from 'chosen' then
    update public.quote_requests set status = 'chosen' where id = new.request_id and status in ('sent', 'quoted');
    update public.quotes set status = 'declined' where request_id = new.request_id and id <> new.id and status = 'sent';
  end if;
  return null;
end $$;
create trigger quotes_sync_request after insert or update of status on public.quotes
  for each row execute function app.sync_request_status();

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.quotes (id) on delete cascade,
  done_at timestamptz,
  rating smallint check (rating between 1 and 5),
  comment text,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (rating is null or done_at is not null)
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  opened_by uuid not null references public.profiles (id),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'confirmed', 'rejected')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'open') = (resolved_at is null))
);

-- Rating aggregates (the score itself is computed in packages/core).
create or replace function app.refresh_artisan_stats() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_artisan uuid;
begin
  select q.artisan_id into v_artisan from public.quotes q where q.id = new.quote_id;
  update public.artisans a set
    rating_avg = coalesce(s.avg, 0), rating_count = s.cnt, jobs_completed = s.done
  from (
    select round(avg(j.rating)::numeric, 2) as avg, count(j.rating) as cnt, count(j.done_at) as done
    from public.jobs j join public.quotes q on q.id = j.quote_id where q.artisan_id = v_artisan
  ) s
  where a.profile_id = v_artisan;
  return null;
end $$;
create trigger jobs_refresh_stats after insert or update of rating, done_at on public.jobs
  for each row execute function app.refresh_artisan_stats();

-- ---------------------------------------------------------------------------
-- Business rules (parameters, never hard-coded)
-- ---------------------------------------------------------------------------
create table public.marketplace_rules (
  id uuid primary key default gen_random_uuid(),
  model text not null check (model in ('commission', 'subscription')),
  commission_pct numeric(5, 4) check (commission_pct between 0 and 0.5),
  subscription_mad numeric(10, 2) check (subscription_mad >= 0),
  response_hours smallint not null default 48,
  active boolean not null default false,
  valid_from date not null default current_date,
  created_at timestamptz not null default now(),
  check ((model = 'commission') = (commission_pct is not null)),
  check ((model = 'subscription') = (subscription_mad is not null))
);
create unique index marketplace_rules_one_active on public.marketplace_rules ((true)) where active;

create table public.referral_rules (
  id uuid primary key default gen_random_uuid(),
  referrer_role text not null default 'any' check (referrer_role in ('any', 'agent', 'notaire', 'promoteur', 'gestionnaire', 'chasseur')),
  commission_mad numeric(10, 2) check (commission_mad >= 0),
  commission_pct numeric(5, 4) check (commission_pct between 0 and 0.5),
  active boolean not null default true,
  valid_from date not null default current_date,
  created_at timestamptz not null default now(),
  check (commission_mad is not null or commission_pct is not null)
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.partner_accounts (id),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  commission_mad numeric(10, 2) not null default 0,
  status public.referral_status not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null))
);
create index referrals_referrer_idx on public.referrals (referrer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Sponsored content (§3 bis). Golden rule: nothing here references
-- inspection_items or reports scoring columns, so a partnership can never
-- influence severity, estimates or resolution (sync test checks the FKs).
-- ---------------------------------------------------------------------------
create table public.partner_products (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  name text not null,
  price_mad numeric(10, 2) check (price_mad >= 0),
  url text check (url is null or url ~ '^https://'),
  where_to_buy text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.placements (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  kind public.placement_kind not null,
  -- product / sheet_sponsor → a solution; report_insert → all reports (target null) or a city.
  solution_id uuid references public.solutions (id) on delete cascade,
  city_id uuid references public.cities (id),
  product_id uuid references public.partner_products (id) on delete cascade,
  -- Material line the product replaces in the sheet ("Ce qu'il vous faut").
  material_index smallint,
  promo_code text,
  cpc_mad numeric(8, 2),
  flat_monthly_mad numeric(10, 2),
  active boolean not null default true,
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  check (kind <> 'product' or (solution_id is not null and product_id is not null)),
  check (kind <> 'sheet_sponsor' or solution_id is not null),
  check (kind <> 'report_insert' or solution_id is null)
);
-- One sponsor per sheet, one report insert per city (null = everywhere).
create unique index placements_one_sponsor on public.placements (solution_id) where kind = 'sheet_sponsor' and active;
create unique index placements_one_insert on public.placements (coalesce(city_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where kind = 'report_insert' and active;

create table public.placement_events (
  id bigint generated always as identity primary key,
  placement_id uuid not null references public.placements (id) on delete cascade,
  kind text not null check (kind in ('view', 'click')),
  order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now()
);
create index placement_events_idx on public.placement_events (placement_id, created_at);

-- Public tracking endpoint (anonymous visitors of solution sheets).
create or replace function public.track_placement(p_placement uuid, p_kind text, p_order uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into public.placement_events (placement_id, kind, order_id)
  select p.id, p_kind, case when app.is_order_client(p_order) then p_order end
  from public.placements p where p.id = p_placement and p.active and p_kind in ('view', 'click');
$$;
grant execute on function public.track_placement to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Event log & housekeeping
-- ---------------------------------------------------------------------------
-- One trigger function per table (shared functions confuse `supabase db lint`).
create or replace function app.log_quote_request_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.log_event('quote_request', new.id, new.order_id, 'quote_request.' || new.status,
    jsonb_build_object('trade', new.trade, 'sent_to', new.sent_to), 'client');
  return null;
end $$;
create or replace function app.log_quote_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.log_event('quote', new.id, (select order_id from public.quote_requests where id = new.request_id),
    'quote.' || new.status, jsonb_build_object('amount_mad', new.amount_mad, 'band', new.band));
  return null;
end $$;
create or replace function app.log_partner_account_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.log_event('partner', new.id, null, 'partner.' || new.kind || '.' || new.status, '{}'::jsonb);
  return null;
end $$;
create trigger quote_requests_log after insert or update of status on public.quote_requests
  for each row execute function app.log_quote_request_status();
create trigger quotes_log after insert or update of status on public.quotes
  for each row execute function app.log_quote_status();
create trigger partner_accounts_log after insert or update of status on public.partner_accounts
  for each row execute function app.log_partner_account_status();

-- Requests nobody answered in time expire; server code re-dispatches them.
create or replace function app.marketplace_tick(p_now timestamptz default now()) returns int
language sql security definer set search_path = public as $$
  with x as (
    update public.quote_requests set status = 'expired'
    where status = 'sent' and expires_at < p_now
    returning 1
  ) select count(*)::int from x;
$$;
revoke execute on function app.marketplace_tick from public, anon, authenticated;
do $$
begin
  perform cron.schedule('thiqa-marketplace-tick', '*/15 * * * *', 'select app.marketplace_tick()');
exception when others then
  raise notice 'pg_cron unavailable, marketplace tick not scheduled: %', sqlerrm;
end $$;

create trigger solutions_updated_at before update on public.solutions for each row execute function app.set_updated_at();
create trigger partner_accounts_updated_at before update on public.partner_accounts for each row execute function app.set_updated_at();
create trigger artisans_updated_at before update on public.artisans for each row execute function app.set_updated_at();
create trigger quote_requests_updated_at before update on public.quote_requests for each row execute function app.set_updated_at();
create trigger quotes_updated_at before update on public.quotes for each row execute function app.set_updated_at();
create trigger jobs_updated_at before update on public.jobs for each row execute function app.set_updated_at();
create trigger partner_products_updated_at before update on public.partner_products for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security & column privileges
-- ---------------------------------------------------------------------------
alter table public.solutions enable row level security;
alter table public.partner_accounts enable row level security;
alter table public.artisans enable row level security;
alter table public.artisan_score_history enable row level security;
alter table public.quote_requests enable row level security;
alter table public.quotes enable row level security;
alter table public.jobs enable row level security;
alter table public.disputes enable row level security;
alter table public.marketplace_rules enable row level security;
alter table public.referral_rules enable row level security;
alter table public.referrals enable row level security;
alter table public.partner_products enable row level security;
alter table public.placements enable row level security;
alter table public.placement_events enable row level security;

revoke insert, update, delete on public.solutions, public.partner_accounts, public.artisans,
  public.artisan_score_history, public.quote_requests, public.quotes, public.jobs, public.disputes,
  public.marketplace_rules, public.referral_rules, public.referrals, public.partner_products,
  public.placements, public.placement_events from anon, authenticated;

-- Technician proposes the resolution path during the visit; the reviewer edits it later.
grant insert (resolution, trade, diy_level, diy_minutes) on public.inspection_items to authenticated;
grant update (resolution, trade, diy_level, diy_minutes) on public.inspection_items to authenticated;

-- Brands are shown on public sheets: expose only public columns of partners.
revoke select on public.partners from anon;
grant select (id, name, slug, kind, logo_path, category) on public.partners to anon;
create policy partners_public_brands on public.partners for select using (kind = 'brand' and active);

create policy solutions_read on public.solutions for select using (published or app.is_staff());
create policy solutions_admin on public.solutions for all using (app.is_admin()) with check (app.is_admin());
grant insert, update, delete on public.solutions to authenticated;

-- Partner accounts: self-service onboarding, admin review.
grant insert (profile_id, kind, data, onboarding_step) on public.partner_accounts to authenticated;
grant update (data, onboarding_step) on public.partner_accounts to authenticated;
grant update (status, reviewed_by, reviewed_at, rejection_reason, referral_code) on public.partner_accounts to authenticated;
create policy partner_accounts_self_read on public.partner_accounts for select using (profile_id = auth.uid() or app.is_admin());
create policy partner_accounts_self_insert on public.partner_accounts for insert
  with check (profile_id = auth.uid() and status = 'pending');
create policy partner_accounts_self_update on public.partner_accounts for update
  using (profile_id = auth.uid() and status = 'pending') with check (profile_id = auth.uid() and status = 'pending');
create policy partner_accounts_admin on public.partner_accounts for update using (app.is_admin()) with check (app.is_admin());

-- Artisans: own profile; verification, score and status are reserved to admins.
grant insert (profile_id, partner_account_id, display_name, trades, years_experience, city_ids, sector_ids,
              radius_km, legal_status, ice, rc, docs, charter_signed_at) on public.artisans to authenticated;
grant update (display_name, trades, years_experience, city_ids, sector_ids, radius_km, legal_status, ice, rc,
              docs, charter_signed_at) on public.artisans to authenticated;
grant update (status, identity_verified, legal_verified, insurance_verified, activated_at) on public.artisans to authenticated;
create policy artisans_self_read on public.artisans for select using (profile_id = auth.uid() or app.is_staff());
create policy artisans_self_insert on public.artisans for insert with check (
  profile_id = auth.uid() and status = 'pending'
  and exists (select 1 from public.partner_accounts p where p.id = partner_account_id and p.profile_id = auth.uid() and p.kind = 'artisan'));
create policy artisans_self_update on public.artisans for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy artisans_admin on public.artisans for update using (app.is_admin()) with check (app.is_admin());
create trigger artisans_protect before update on public.artisans
  for each row execute function app.protect_columns(
    'admin', 'status', 'identity_verified', 'legal_verified', 'insurance_verified', 'activated_at', 'score',
    'badges', 'rating_avg', 'rating_count', 'response_rate', 'in_range_rate', 'jobs_completed', 'profile_id');
create trigger partner_accounts_protect before update on public.partner_accounts
  for each row execute function app.protect_columns(
    'admin', 'status', 'reviewed_by', 'reviewed_at', 'rejection_reason', 'referral_code', 'kind', 'profile_id');

create policy artisan_score_history_read on public.artisan_score_history for select
  using (artisan_id = auth.uid() or app.is_admin());

-- Quote requests: the client owns them; artisans read them through artisan_requests.
grant insert (order_id, client_id, items, trade, city_id, sector_id, description, photos) on public.quote_requests to authenticated;
create policy quote_requests_client_read on public.quote_requests for select using (client_id = auth.uid() or app.is_staff());
create policy quote_requests_client_insert on public.quote_requests for insert with check (
  client_id = auth.uid() and status = 'sent' and cardinality(sent_to) = 0
  and (order_id is null or app.is_order_client(order_id)));

grant insert (request_id, artisan_id, amount_mad, delay_days, detail) on public.quotes to authenticated;
grant update (amount_mad, delay_days, detail) on public.quotes to authenticated;
create policy quotes_read on public.quotes for select using (
  artisan_id = auth.uid() or app.is_staff()
  or exists (select 1 from public.quote_requests q where q.id = request_id and q.client_id = auth.uid()));
create policy quotes_artisan_insert on public.quotes for insert with check (artisan_id = auth.uid() and status = 'sent');
create policy quotes_artisan_update on public.quotes for update
  using (artisan_id = auth.uid() and status = 'sent') with check (artisan_id = auth.uid() and status = 'sent');

grant update (rating, comment, photo_path) on public.jobs to authenticated;
create policy jobs_read on public.jobs for select using (
  app.is_staff() or exists (select 1 from public.quotes q join public.quote_requests r on r.id = q.request_id
                            where q.id = quote_id and (q.artisan_id = auth.uid() or r.client_id = auth.uid())));
create policy jobs_client_rate on public.jobs for update using (
  done_at is not null and exists (select 1 from public.quotes q join public.quote_requests r on r.id = q.request_id
                                  where q.id = quote_id and r.client_id = auth.uid()))
  with check (done_at is not null);

grant insert (job_id, opened_by, reason) on public.disputes to authenticated;
grant update (status, resolved_at) on public.disputes to authenticated;
create policy disputes_read on public.disputes for select using (opened_by = auth.uid() or app.is_admin());
create policy disputes_open on public.disputes for insert with check (
  opened_by = auth.uid() and status = 'open'
  and exists (select 1 from public.jobs j join public.quotes q on q.id = j.quote_id join public.quote_requests r on r.id = q.request_id
              where j.id = job_id and (q.artisan_id = auth.uid() or r.client_id = auth.uid())));
create policy disputes_admin on public.disputes for update using (app.is_admin()) with check (app.is_admin());

create policy marketplace_rules_read on public.marketplace_rules for select using (active or app.is_admin());
create policy marketplace_rules_admin on public.marketplace_rules for all using (app.is_admin()) with check (app.is_admin());
grant insert, update on public.marketplace_rules to authenticated;
create policy referral_rules_read on public.referral_rules for select using (active or app.is_admin());
create policy referral_rules_admin on public.referral_rules for all using (app.is_admin()) with check (app.is_admin());
grant insert, update on public.referral_rules to authenticated;
create policy referrals_read on public.referrals for select using (
  app.is_admin() or exists (select 1 from public.partner_accounts p where p.id = referrer_id and p.profile_id = auth.uid()));

create policy partner_products_read on public.partner_products for select using (active or app.is_admin());
create policy partner_products_admin on public.partner_products for all using (app.is_admin()) with check (app.is_admin());
grant insert, update, delete on public.partner_products to authenticated;
create policy placements_read on public.placements for select using (
  (active and starts_on <= current_date and (ends_on is null or ends_on >= current_date)) or app.is_admin());
create policy placements_admin on public.placements for all using (app.is_admin()) with check (app.is_admin());
grant insert, update, delete on public.placements to authenticated;
create policy placement_events_admin on public.placement_events for select using (app.is_admin());

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
-- What an artisan sees of a request: the inspection point, never the client
-- or the address. Contact details appear only once their quote is chosen.
create view public.artisan_requests as
select
  r.id as request_id,
  r.trade,
  r.status as request_status,
  r.expires_at,
  r.description,
  r.photos,
  c.name as city,
  s.name as sector,
  q.id as quote_id,
  q.status as quote_status,
  q.amount_mad,
  (select coalesce(jsonb_agg(jsonb_build_object(
      'item_code', i.item_code, 'room', i.room, 'severity', i.severity, 'value', i.value,
      'observation', coalesce(i.observation_ai, i.observation_raw),
      'estimate_min', i.works_estimate_mad_min, 'estimate_max', i.works_estimate_mad_max,
      'photos', i.photos)), '[]'::jsonb)
   from public.inspection_items i where i.id = any (r.items)) as items,
  case when q.status = 'chosen' then p.full_name end as client_name,
  case when q.status = 'chosen' then p.phone end as client_phone
from public.quote_requests r
join public.cities c on c.id = r.city_id
left join public.sectors s on s.id = r.sector_id
left join public.quotes q on q.request_id = r.id and q.artisan_id = auth.uid()
left join public.profiles p on p.id = r.client_id
where auth.uid() = any (r.sent_to);
revoke all on public.artisan_requests from anon;
grant select on public.artisan_requests to authenticated;

-- Public directory (thiqa.ma/artisans/[ville]): active artisans, public fields only.
create view public.public_artisans as
select a.profile_id as id, a.display_name, a.trades, a.city_ids, a.sector_ids, a.score, a.badges,
       a.rating_avg, a.rating_count, a.jobs_completed, a.response_rate, a.insurance_verified,
       a.docs -> 'portfolio' as portfolio
from public.artisans a
where a.status = 'active';
grant select on public.public_artisans to anon, authenticated;
