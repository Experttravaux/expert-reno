-- Operations: notifications, SLA clocks & escalations, payouts, integrations.

-- ---------------------------------------------------------------------------
-- Notifications (rows are queued here; an Edge Function delivers them)
-- ---------------------------------------------------------------------------
create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z0-9_]+$'),
  channel public.notification_channel not null,
  lang public.lang not null default 'fr',
  version int not null default 1,
  subject text,
  body text not null,
  -- WhatsApp Cloud API approved template name, when channel = whatsapp.
  provider_template text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (key, channel, lang, version)
);
create unique index notification_templates_one_active
  on public.notification_templates (key, channel, lang) where active;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  -- Broadcast to every staff member having this role (dispatcher, reviewer, admin).
  audience_role public.app_role,
  order_id uuid references public.orders (id) on delete cascade,
  channel public.notification_channel not null,
  template_key text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  status public.notification_status not null default 'queued',
  attempts int not null default 0,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  check (user_id is not null or audience_role is not null)
);
create index notifications_queue_idx on public.notifications (created_at) where status = 'queued';
create index notifications_user_idx on public.notifications (user_id, created_at desc);

/*
 * Queue a notification to an order audience ('client', 'technician') or a staff
 * role ('dispatcher', 'reviewer', 'admin'). Users get email + WhatsApp when
 * opted in (SMS fallback is decided by the sender); staff roles get email.
 * Idempotent through p_dedupe.
 */
create or replace function app.notify(
  p_order uuid, p_audience text, p_template text,
  p_payload jsonb default '{}'::jsonb, p_dedupe text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_optin boolean;
  n int := 0;
  k int;
begin
  if p_audience in ('dispatcher', 'reviewer', 'admin') then
    insert into public.notifications (audience_role, order_id, channel, template_key, payload, dedupe_key)
    values (p_audience::public.app_role, p_order, 'email', p_template, p_payload, p_dedupe || ':email')
    on conflict (dedupe_key) do nothing;
    get diagnostics n = row_count;
    return n;
  end if;

  if p_audience = 'client' then
    select o.client_id into v_user from public.orders o where o.id = p_order;
  elsif p_audience = 'technician' then
    select m.technician_id into v_user from public.missions m
    where m.order_id = p_order and m.status in ('offered', 'accepted', 'scheduled', 'in_progress')
    limit 1;
  else
    raise exception 'unknown audience %', p_audience;
  end if;
  if v_user is null then
    return 0;
  end if;

  select whatsapp_opt_in into v_optin from public.profiles where id = v_user;
  insert into public.notifications (user_id, order_id, channel, template_key, payload, dedupe_key)
  values (v_user, p_order, 'email', p_template, p_payload, p_dedupe || ':email')
  on conflict (dedupe_key) do nothing;
  get diagnostics k = row_count;
  n := n + k;
  if coalesce(v_optin, false) then
    insert into public.notifications (user_id, order_id, channel, template_key, payload, dedupe_key)
    values (v_user, p_order, 'whatsapp', p_template, p_payload, p_dedupe || ':whatsapp')
    on conflict (dedupe_key) do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end if;
  return n;
end $$;
revoke execute on function app.notify from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- SLA (§6): policies, per-order clocks, breaches
-- ---------------------------------------------------------------------------
create table public.sla_policies (
  stage public.sla_stage primary key,
  target interval not null,
  -- The clock runs while the order is in one of these statuses.
  active_statuses public.order_status[] not null,
  -- false: opened by another trigger (e.g. submission opens at mission check-out).
  open_on_status boolean not null default true,
  reminder_offsets interval[] not null default '{}',
  reminder_audience text[] not null default '{}',
  escalate_to public.app_role,
  auto_cancel_after interval,
  active boolean not null default true
);

insert into public.sla_policies
  (stage, target, active_statuses, open_on_status, reminder_offsets, reminder_audience, escalate_to, auto_cancel_after)
values
  ('payment', '24 hours', '{awaiting_payment}', true, '{4 hours,20 hours}', '{client}', null, '72 hours'),
  ('assignment', '2 hours', '{paid,dispatching,reassigning}', true, '{}', '{}', 'dispatcher', null),
  ('acceptance', '20 minutes', '{assigned}', true, '{10 minutes}', '{technician}', null, null),
  ('scheduling', '48 hours', '{paid,dispatching,reassigning,assigned,accepted}', true, '{}', '{}', 'dispatcher', null),
  ('visit', '72 hours', '{paid,dispatching,reassigning,assigned,accepted,scheduled}', true, '{}', '{}', 'dispatcher', null),
  ('submission', '2 hours', '{in_progress}', false, '{1 hour}', '{technician}', 'dispatcher', null),
  ('ai_generation', '10 minutes', '{submitted,ai_processing}', true, '{}', '{}', 'admin', null),
  ('validation', '24 hours', '{in_review}', true, '{12 hours,20 hours}', '{reviewer}', null, null),
  ('balance', '7 days', '{delivered}', true, '{2 days,5 days}', '{client}', 'admin', null);

create table public.order_sla_clocks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  stage public.sla_stage not null,
  started_at timestamptz not null default now(),
  due_at timestamptz not null,
  completed_at timestamptz,
  breached_at timestamptz
);
create unique index order_sla_clocks_open_uniq on public.order_sla_clocks (order_id, stage) where completed_at is null;
create index order_sla_clocks_due_idx on public.order_sla_clocks (due_at) where completed_at is null;

create table public.sla_breaches (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  clock_id uuid unique references public.order_sla_clocks (id) on delete cascade,
  stage public.sla_stage not null,
  due_at timestamptz not null,
  breached_at timestamptz not null default now(),
  escalated_to public.app_role,
  resolved_at timestamptz
);
create index sla_breaches_open_idx on public.sla_breaches (breached_at) where resolved_at is null;

create or replace function app.sync_sla_clocks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.order_sla_clocks c
  set completed_at = now()
  from public.sla_policies p
  where c.order_id = new.id and c.completed_at is null and p.stage = c.stage
    and not (new.status = any (p.active_statuses));

  update public.sla_breaches b
  set resolved_at = now()
  from public.order_sla_clocks c
  where b.clock_id = c.id and c.order_id = new.id and b.resolved_at is null and c.completed_at is not null;

  insert into public.order_sla_clocks (order_id, stage, started_at, due_at)
  select new.id, p.stage, now(), now() + p.target
  from public.sla_policies p
  where p.active and p.open_on_status and new.status = any (p.active_statuses)
  on conflict (order_id, stage) where completed_at is null do nothing;
  return null;
end $$;
create trigger orders_sla_clocks after insert or update of status on public.orders
  for each row execute function app.sync_sla_clocks();

-- Submission clock starts at check-out (§6: 2 h after check-out).
create or replace function app.open_submission_clock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.order_sla_clocks (order_id, stage, started_at, due_at)
  select new.order_id, 'submission', new.checkout_at, new.checkout_at + p.target
  from public.sla_policies p
  where p.stage = 'submission' and p.active
  on conflict (order_id, stage) where completed_at is null do nothing;
  return null;
end $$;
create trigger missions_submission_clock after update of checkout_at on public.missions
  for each row when (old.checkout_at is null and new.checkout_at is not null)
  execute function app.open_submission_clock();

/*
 * Runs every 5 minutes (pg_cron). Idempotent: reminders and escalations are
 * deduplicated, transitions go through the order status guard.
 */
create or replace function app.sla_tick(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  aud text;
  off interval;
  v_expired int := 0;
  v_cancelled int := 0;
  v_reminders int := 0;
  v_breaches int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('thiqa.sla_tick')) then
    return jsonb_build_object('skipped', true);
  end if;

  -- 1. Expired technician offers → next technician or dispatcher (§6 dispatch step 3).
  for r in
    update public.missions m set status = 'expired'
    where m.status = 'offered' and m.offer_expires_at < p_now
    returning m.order_id, m.attempt_no
  loop
    perform set_config('thiqa.event', 'offer_expired', true);
    update public.orders o
    set status = case when r.attempt_no >= 3 then 'reassigning'::public.order_status else 'dispatching' end
    where o.id = r.order_id and o.status = 'assigned';
    if r.attempt_no >= 3 then
      perform app.notify(r.order_id, 'dispatcher', 'dispatch_exhausted', '{}'::jsonb, 'dispatch_exhausted:' || r.order_id);
    end if;
    v_expired := v_expired + 1;
  end loop;

  -- 2. Unpaid orders are cancelled after the policy delay.
  for r in
    select o.id
    from public.orders o
    join public.order_sla_clocks c on c.order_id = o.id and c.stage = 'payment' and c.completed_at is null
    join public.sla_policies p on p.stage = 'payment'
    where o.status = 'awaiting_payment' and p.auto_cancel_after is not null
      and c.started_at + p.auto_cancel_after <= p_now
  loop
    perform set_config('thiqa.event', 'payment_timeout', true);
    update public.orders set status = 'cancelled', cancelled_reason = 'payment_timeout' where id = r.id;
    perform app.notify(r.id, 'client', 'order_cancelled_unpaid', '{}'::jsonb, 'order_cancelled_unpaid:' || r.id);
    v_cancelled := v_cancelled + 1;
  end loop;
  perform set_config('thiqa.event', '', true);

  -- 3. Stage reminders.
  for r in
    select c.id, c.order_id, c.stage, c.started_at, p.reminder_offsets, p.reminder_audience
    from public.order_sla_clocks c
    join public.sla_policies p on p.stage = c.stage
    where c.completed_at is null and cardinality(p.reminder_offsets) > 0
  loop
    foreach off in array r.reminder_offsets loop
      continue when r.started_at + off > p_now;
      foreach aud in array r.reminder_audience loop
        v_reminders := v_reminders + app.notify(
          r.order_id, aud, 'sla_reminder_' || r.stage,
          jsonb_build_object('stage', r.stage, 'offset', off::text),
          format('sla:%s:%s:%s', r.id, off, aud));
      end loop;
    end loop;
  end loop;

  -- 4. Visit reminders D-1 and H-2 to client and technician.
  for r in
    select o.id, o.scheduled_at from public.orders o
    where o.status = 'scheduled' and o.scheduled_at > p_now and o.scheduled_at - interval '1 day' <= p_now
  loop
    foreach aud in array array['client', 'technician'] loop
      v_reminders := v_reminders + app.notify(r.id, aud, 'visit_reminder_d1',
        jsonb_build_object('scheduled_at', r.scheduled_at), format('visit:%s:%s:d1:%s', r.id, r.scheduled_at, aud));
      if r.scheduled_at - interval '2 hours' <= p_now then
        v_reminders := v_reminders + app.notify(r.id, aud, 'visit_reminder_h2',
          jsonb_build_object('scheduled_at', r.scheduled_at), format('visit:%s:%s:h2:%s', r.id, r.scheduled_at, aud));
      end if;
    end loop;
  end loop;

  -- 5. Breaches → sla_breaches + escalation.
  for r in
    update public.order_sla_clocks c set breached_at = p_now
    from public.sla_policies p
    where p.stage = c.stage and c.completed_at is null and c.breached_at is null and c.due_at < p_now
    returning c.id, c.order_id, c.stage, c.due_at, p.escalate_to
  loop
    insert into public.sla_breaches (order_id, clock_id, stage, due_at, breached_at, escalated_to)
    values (r.order_id, r.id, r.stage, r.due_at, p_now, r.escalate_to);
    if r.escalate_to is not null then
      perform app.notify(r.order_id, r.escalate_to::text, 'sla_breach_' || r.stage,
        jsonb_build_object('stage', r.stage, 'due_at', r.due_at), 'breach:' || r.id);
    end if;
    v_breaches := v_breaches + 1;
  end loop;

  return jsonb_build_object('expired_offers', v_expired, 'cancelled', v_cancelled,
                            'reminders', v_reminders, 'breaches', v_breaches);
end $$;
revoke execute on function app.sla_tick from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Technician payouts
-- ---------------------------------------------------------------------------
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.technicians (profile_id),
  period date not null check (extract(day from period) = 1),
  missions uuid[] not null default '{}',
  fixed_mad numeric(10, 2) not null default 0,
  variable_mad numeric(10, 2) not null default 0,
  bonus_mad numeric(10, 2) not null default 0,
  total_mad numeric(10, 2) generated always as (fixed_mad + variable_mad + bonus_mad) stored,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (technician_id, period)
);

-- ---------------------------------------------------------------------------
-- Integrations
-- ---------------------------------------------------------------------------
create table public.geocode_cache (
  query_hash text primary key,
  query text not null,
  lat double precision not null,
  lng double precision not null,
  display_name text,
  provider text not null default 'nominatim',
  raw jsonb,
  created_at timestamptz not null default now()
);

create table public.idempotency_keys (
  partner_id uuid not null references public.partners (id) on delete cascade,
  key text not null,
  request_hash text not null,
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (partner_id, key)
);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  url text not null check (url ~ '^https://'),
  -- Name of the signing secret in Supabase Vault (never stored in clear here).
  secret_name text not null,
  events text[] not null default '{order.status_changed,report.delivered}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.webhook_deliveries (
  id bigint generated always as identity primary key,
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index webhook_deliveries_pending_idx on public.webhook_deliveries (next_attempt_at) where status = 'pending';

create trigger payouts_updated_at before update on public.payouts for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Scheduling (pg_cron is available on Supabase; skipped where it is not)
-- ---------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('thiqa-sla-tick', '*/5 * * * *', 'select app.sla_tick()');
exception when others then
  raise notice 'pg_cron unavailable, SLA tick not scheduled: %', sqlerrm;
end $$;
