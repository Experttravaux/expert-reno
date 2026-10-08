-- Auth integration, role helpers, Row Level Security and column privileges.

-- ---------------------------------------------------------------------------
-- Profiles are created by the database, always as `client`. Roles are only
-- granted by an admin (never trusted from user metadata).
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone, lang)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    case when new.phone is not null and new.phone <> '' then '+' || ltrim(new.phone, '+') end,
    coalesce(nullif(new.raw_user_meta_data ->> 'lang', ''), 'fr')::public.lang
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- Role lookup used by every policy. Reads the table (not the JWT) so a role
-- change applies immediately; security definer avoids RLS recursion.
create or replace function app.user_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and deleted_at is null
$$;

-- Staff must use 2FA (aal2). Can be relaxed for local dev only:
--   alter database postgres set thiqa.require_staff_mfa = 'off';
create or replace function app.mfa_ok() returns boolean
language sql stable as $$
  select coalesce(current_setting('thiqa.require_staff_mfa', true), 'on') = 'off'
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function app.has_role(variadic roles public.app_role[]) returns boolean
language sql stable as $$
  select coalesce(app.user_role() = any (roles), false)
     and (app.user_role() not in ('reviewer', 'dispatcher', 'admin') or app.mfa_ok())
$$;

create or replace function app.is_staff() returns boolean
language sql stable as $$ select app.has_role('reviewer', 'dispatcher', 'admin') $$;

create or replace function app.is_admin() returns boolean
language sql stable as $$ select app.has_role('admin') $$;

-- Technician's access to an order goes through a live or past mission they hold.
create or replace function app.is_order_technician(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.missions m
    where m.order_id = p_order and m.technician_id = auth.uid()
      and m.status in ('accepted', 'scheduled', 'in_progress', 'submitted')
  )
$$;

create or replace function app.is_order_client(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o where o.id = p_order and o.client_id = auth.uid())
$$;

-- Technician may write an inspection only while the visit is running.
create or replace function app.can_edit_inspection(p_inspection uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.inspections i
    join public.missions m on m.id = i.mission_id
    where i.id = p_inspection and m.technician_id = auth.uid() and m.status = 'in_progress'
  )
$$;

-- Supabase custom access token hook: exposes the role to the front-end
-- (routing only — RLS always re-reads profiles). Enable in config.toml.
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_role public.app_role;
begin
  select role into v_role from public.profiles where id = (event ->> 'user_id')::uuid;
  claims := jsonb_set(claims, '{user_role}', to_jsonb(coalesce(v_role, 'client'::public.app_role)));
  return jsonb_set(event, '{claims}', claims);
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.custom_access_token_hook to supabase_auth_admin;
    grant select on public.profiles to supabase_auth_admin;
    execute 'create policy profiles_auth_hook on public.profiles for select to supabase_auth_admin using (true)';
  end if;
end $$;
revoke execute on function public.custom_access_token_hook from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Column privileges: writes from the API are limited to user-editable columns.
-- Everything else (status, price, role…) goes through server code (service_role).
-- ---------------------------------------------------------------------------
revoke insert, update, delete on all tables in schema public from anon, authenticated;

grant update (full_name, phone, lang, country_code, city_id, whatsapp_opt_in) on public.profiles to authenticated;
grant insert (address, address_details, lat, lng, city_id, property_type, surface_m2, floor, year_built,
              titre_foncier_ref, is_vefa, created_by) on public.properties to authenticated;
grant update (address, address_details, lat, lng, city_id, property_type, surface_m2, floor, year_built,
              titre_foncier_ref, is_vefa) on public.properties to authenticated;
grant insert (client_id, product_id, property_id, purpose, options, requested_slots, client_timezone,
              onsite_contact, report_langs, notes) on public.orders to authenticated;
grant update (product_id, property_id, purpose, options, requested_slots, client_timezone,
              onsite_contact, report_langs, notes) on public.orders to authenticated;
grant update (availability, kit_checklist, home_lat, home_lng) on public.technicians to authenticated;
grant insert (mission_id, template_id, template_version, rooms, answers, measures, started_at, device_meta)
  on public.inspections to authenticated;
grant update (rooms, answers, measures, started_at, completed_at, device_meta) on public.inspections to authenticated;
grant insert (inspection_id, block_code, item_code, room, value, severity_technician, observation_raw,
              works_estimate_mad_min, works_estimate_mad_max, photos) on public.inspection_items to authenticated;
grant update (value, severity_technician, observation_raw, works_estimate_mad_min, works_estimate_mad_max, photos)
  on public.inspection_items to authenticated;
grant delete on public.inspection_items to authenticated;
grant insert (inspection_id, item_code, room, storage_path, kind, width, height, bytes, exif, taken_at)
  on public.media to authenticated;
grant delete on public.media to authenticated;
grant insert (order_id, by_client, stars, nps, comment) on public.ratings to authenticated;
grant insert (order_id, author_id, body) on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;
grant insert (user_id, purpose, version, ip) on public.consents to authenticated;
grant update (revoked_at) on public.consents to authenticated;
-- Staff (back-office through the API, still filtered by RLS below).
grant insert, update, delete on public.cities, public.sectors, public.products, public.pricing_rules,
  public.works_catalog, public.checklist_templates, public.payout_rules, public.notification_templates,
  public.ai_prompts, public.sla_policies to authenticated;
grant update (role) on public.profiles to authenticated;
grant insert, update on public.technicians to authenticated;
grant update (status, onsite_contact, notes, scheduled_at, cancelled_reason) on public.orders to authenticated;
grant insert, update on public.missions to authenticated;
grant update on public.inspection_items to authenticated;
grant insert, update on public.reports to authenticated;
grant insert on public.report_revisions to authenticated;
grant update (resolved_at) on public.sla_breaches to authenticated;
grant insert, update on public.payouts, public.partners, public.api_keys, public.webhook_endpoints to authenticated;

-- Several roles share the `authenticated` grant, so some columns are further
-- reserved to staff roles by trigger. Args: allowed roles (csv), then columns.
-- Server code (service_role, no auth.uid()) is not restricted.
create or replace function app.protect_columns() returns trigger
language plpgsql as $$
declare
  allowed public.app_role[] := string_to_array(tg_argv[0], ',')::public.app_role[];
  col text;
begin
  if auth.uid() is null or app.has_role(variadic allowed) then
    return new;
  end if;
  foreach col in array tg_argv[1:] loop
    if (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col) then
      raise exception 'column %.% is reserved to %', tg_table_name, col, tg_argv[0]
        using errcode = 'insufficient_privilege';
    end if;
  end loop;
  return new;
end $$;

create trigger inspection_items_protect before update on public.inspection_items
  for each row execute function app.protect_columns(
    'reviewer,admin', 'severity', 'severity_rule', 'severity_ai', 'needs_attention', 'observation_ai',
    'inspection_id', 'item_code', 'block_code', 'room');
create trigger technicians_protect before update on public.technicians
  for each row execute function app.protect_columns(
    'dispatcher,admin', 'status', 'sectors', 'skills', 'rating_avg', 'rating_count', 'max_daily_missions',
    'iban_last4', 'activated_at', 'profile_id');

-- ---------------------------------------------------------------------------
-- Policies — reference data
-- ---------------------------------------------------------------------------
create policy cities_read on public.cities for select using (active or app.is_staff());
create policy cities_admin on public.cities for all using (app.is_admin()) with check (app.is_admin());

create policy sectors_read on public.sectors for select using (true);
create policy sectors_staff on public.sectors for all
  using (app.has_role('admin', 'dispatcher')) with check (app.has_role('admin', 'dispatcher'));

create policy products_read on public.products for select using (active or app.is_staff());
create policy products_admin on public.products for all using (app.is_admin()) with check (app.is_admin());

create policy pricing_rules_read on public.pricing_rules for select using (active or app.is_staff());
create policy pricing_rules_admin on public.pricing_rules for all using (app.is_admin()) with check (app.is_admin());

create policy works_catalog_read on public.works_catalog for select to authenticated using (true);
create policy works_catalog_admin on public.works_catalog for all using (app.is_admin()) with check (app.is_admin());

create policy templates_read on public.checklist_templates for select to authenticated
  using (published_at is not null or app.is_staff());
create policy templates_admin on public.checklist_templates for all using (app.is_admin()) with check (app.is_admin());

create policy payout_rules_admin on public.payout_rules for all using (app.is_admin()) with check (app.is_admin());
create policy notification_templates_admin on public.notification_templates for all
  using (app.is_admin()) with check (app.is_admin());
create policy ai_prompts_staff_read on public.ai_prompts for select using (app.has_role('admin', 'reviewer'));
create policy ai_prompts_admin on public.ai_prompts for all using (app.is_admin()) with check (app.is_admin());
create policy ai_calls_admin on public.ai_calls for select using (app.is_admin());
create policy sla_policies_read on public.sla_policies for select using (app.is_staff());
create policy sla_policies_admin on public.sla_policies for all using (app.is_admin()) with check (app.is_admin());
create policy order_transitions_read on public.order_transitions for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Policies — people
-- ---------------------------------------------------------------------------
create policy profiles_self_read on public.profiles for select using (id = auth.uid() or app.is_staff());
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = app.user_role());
create policy profiles_admin_update on public.profiles for update using (app.is_admin()) with check (app.is_admin());

create policy technicians_self_read on public.technicians for select
  using (profile_id = auth.uid() or app.is_staff());
create policy technicians_self_update on public.technicians for update
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy technicians_staff on public.technicians for all
  using (app.has_role('admin', 'dispatcher')) with check (app.has_role('admin', 'dispatcher'));

create policy consents_self on public.consents for select using (user_id = auth.uid() or app.is_admin());
create policy consents_self_insert on public.consents for insert with check (user_id = auth.uid());
create policy consents_self_revoke on public.consents for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy partners_admin on public.partners for all using (app.is_admin()) with check (app.is_admin());
create policy api_keys_admin on public.api_keys for all using (app.is_admin()) with check (app.is_admin());
create policy webhook_endpoints_admin on public.webhook_endpoints for all using (app.is_admin()) with check (app.is_admin());
create policy webhook_deliveries_admin on public.webhook_deliveries for select using (app.is_admin());
-- idempotency_keys, geocode_cache, order_ref_counters: service role only (no policy).

-- ---------------------------------------------------------------------------
-- Policies — orders & properties
-- ---------------------------------------------------------------------------
create policy properties_read on public.properties for select using (
  created_by = auth.uid()
  or app.is_staff()
  or exists (select 1 from public.orders o where o.property_id = properties.id
             and (o.client_id = auth.uid() or app.is_order_technician(o.id)))
);
create policy properties_insert on public.properties for insert with check (created_by = auth.uid());
create policy properties_update on public.properties for update
  using (created_by = auth.uid() and not exists (
    select 1 from public.orders o where o.property_id = properties.id and o.status <> 'draft'))
  with check (created_by = auth.uid());
create policy properties_staff on public.properties for update using (app.is_staff()) with check (app.is_staff());

-- Technicians do not read orders directly: they use technician_missions (no client PII, no price).
create policy orders_client_read on public.orders for select using (client_id = auth.uid() or app.is_staff());
create policy orders_client_insert on public.orders for insert with check (client_id = auth.uid() and status = 'draft');
create policy orders_client_update on public.orders for update
  using (client_id = auth.uid() and status = 'draft')
  with check (client_id = auth.uid() and status = 'draft');
create policy orders_staff_update on public.orders for update
  using (app.has_role('admin', 'dispatcher')) with check (app.has_role('admin', 'dispatcher'));

create policy missions_read on public.missions for select
  using (technician_id = auth.uid() or app.is_staff());
create policy missions_staff on public.missions for all
  using (app.has_role('admin', 'dispatcher')) with check (app.has_role('admin', 'dispatcher'));

create policy payments_read on public.payments for select using (app.is_order_client(order_id) or app.is_admin());

create policy ratings_read on public.ratings for select using (by_client = auth.uid() or app.is_staff());
create policy ratings_insert on public.ratings for insert with check (
  by_client = auth.uid()
  and exists (select 1 from public.orders o where o.id = order_id and o.client_id = auth.uid()
              and o.status in ('delivered', 'closed'))
);

create policy messages_read on public.messages for select using (
  app.is_order_client(order_id) or app.is_order_technician(order_id) or app.is_staff());
create policy messages_insert on public.messages for insert with check (
  author_id = auth.uid()
  and (app.is_order_client(order_id) or app.is_order_technician(order_id) or app.is_staff()));
create policy messages_mark_read on public.messages for update
  using (app.is_order_client(order_id) or app.is_order_technician(order_id) or app.is_staff())
  with check (app.is_order_client(order_id) or app.is_order_technician(order_id) or app.is_staff());

-- ---------------------------------------------------------------------------
-- Policies — field work & reports
-- ---------------------------------------------------------------------------
create policy inspections_read on public.inspections for select using (
  app.is_staff() or exists (select 1 from public.missions m where m.id = mission_id and m.technician_id = auth.uid()));
create policy inspections_tech_insert on public.inspections for insert with check (
  exists (select 1 from public.missions m where m.id = mission_id and m.technician_id = auth.uid()
          and m.status = 'in_progress'));
create policy inspections_tech_update on public.inspections for update
  using (app.can_edit_inspection(id)) with check (app.can_edit_inspection(id));

create policy inspection_items_read on public.inspection_items for select using (
  app.is_staff() or exists (select 1 from public.inspections i join public.missions m on m.id = i.mission_id
                            where i.id = inspection_id and m.technician_id = auth.uid()));
create policy inspection_items_tech_write on public.inspection_items for insert
  with check (app.can_edit_inspection(inspection_id));
create policy inspection_items_tech_update on public.inspection_items for update
  using (app.can_edit_inspection(inspection_id)) with check (app.can_edit_inspection(inspection_id));
create policy inspection_items_tech_delete on public.inspection_items for delete
  using (app.can_edit_inspection(inspection_id));
create policy inspection_items_reviewer on public.inspection_items for update
  using (app.has_role('reviewer', 'admin')) with check (app.has_role('reviewer', 'admin'));

create policy media_read on public.media for select using (
  app.is_staff() or exists (select 1 from public.inspections i join public.missions m on m.id = i.mission_id
                            where i.id = inspection_id and m.technician_id = auth.uid()));
create policy media_tech_insert on public.media for insert with check (app.can_edit_inspection(inspection_id));
create policy media_tech_delete on public.media for delete using (app.can_edit_inspection(inspection_id));

create policy reports_read on public.reports for select using (
  app.is_staff() or (status = 'delivered' and app.is_order_client(order_id)));
create policy reports_reviewer on public.reports for all
  using (app.has_role('reviewer', 'admin')) with check (app.has_role('reviewer', 'admin'));
create policy report_revisions_reviewer on public.report_revisions for all
  using (app.has_role('reviewer', 'admin')) with check (app.has_role('reviewer', 'admin'));

-- ---------------------------------------------------------------------------
-- Policies — ops
-- ---------------------------------------------------------------------------
create policy events_read on public.events for select using (
  app.is_staff() or (visibility = 'client' and order_id is not null and app.is_order_client(order_id)));

create policy notifications_read on public.notifications for select using (user_id = auth.uid() or app.is_admin());
create policy sla_clocks_read on public.order_sla_clocks for select using (app.is_staff());
create policy sla_breaches_read on public.sla_breaches for select using (app.is_staff());
create policy sla_breaches_resolve on public.sla_breaches for update
  using (app.has_role('admin', 'dispatcher')) with check (app.has_role('admin', 'dispatcher'));
create policy payouts_read on public.payouts for select using (technician_id = auth.uid() or app.is_admin());
create policy payouts_admin on public.payouts for all using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- Technician view: what a technician needs, nothing more (§12).
-- The exact address and on-site contact are revealed once the offer is accepted.
-- Runs with owner rights; the auth.uid() filter is the access control.
-- ---------------------------------------------------------------------------
create view public.technician_missions as
select
  m.id as mission_id,
  m.order_id,
  o.ref as order_ref,
  m.status,
  m.attempt_no,
  m.offer_expires_at,
  m.started_at,
  m.checkout_at,
  o.scheduled_at,
  o.requested_slots,
  o.purpose,
  p.slug as product_slug,
  p.duration_min,
  p.checklist_template_id,
  pr.property_type,
  pr.surface_m2,
  pr.floor,
  pr.city_id,
  pr.sector_id,
  case when m.status <> 'offered' then pr.address end as address,
  case when m.status <> 'offered' then pr.address_details end as address_details,
  case when m.status <> 'offered' then pr.lat else round(pr.lat::numeric, 2)::double precision end as lat,
  case when m.status <> 'offered' then pr.lng else round(pr.lng::numeric, 2)::double precision end as lng,
  case when m.status <> 'offered' then o.onsite_contact end as onsite_contact
from public.missions m
join public.orders o on o.id = m.order_id
join public.products p on p.id = o.product_id
left join public.properties pr on pr.id = o.property_id
where m.technician_id = auth.uid()
  and m.status in ('offered', 'accepted', 'scheduled', 'in_progress', 'submitted');

revoke all on public.technician_missions from anon;
grant select on public.technician_missions to authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets (private). Uploads/reads go through short-lived signed URLs
-- issued server-side; technicians may upload into their own mission folder.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values
      ('inspection-media', 'inspection-media', false, 15728640,
       array['image/webp', 'image/jpeg', 'image/png', 'audio/webm', 'audio/mp4', 'video/mp4']),
      ('reports', 'reports', false, 52428800, array['application/pdf'])
    on conflict (id) do nothing;

    -- Path convention: inspection-media/<mission_id>/<item_code>/<uuid>.webp
    execute $p$
      create policy "technicians upload own mission media" on storage.objects for insert to authenticated
      with check (
        bucket_id = 'inspection-media'
        and exists (select 1 from public.missions m
                    where m.id::text = (storage.foldername(name))[1]
                      and m.technician_id = auth.uid() and m.status = 'in_progress')
      )
    $p$;
    execute $p$
      create policy "technicians read own mission media" on storage.objects for select to authenticated
      using (
        bucket_id = 'inspection-media'
        and (app.is_staff() or exists (select 1 from public.missions m
                    where m.id::text = (storage.foldername(name))[1] and m.technician_id = auth.uid()))
      )
    $p$;
    execute $p$
      create policy "staff read reports" on storage.objects for select to authenticated
      using (bucket_id = 'reports' and app.is_staff())
    $p$;
  end if;
end $$;
