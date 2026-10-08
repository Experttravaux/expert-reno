-- Shared helpers for SQL tests (included with \ir, lives in pg_temp so it vanishes with the session).
\set QUIET on
\set ON_ERROR_STOP on
-- Only errors matter: discard result sets.
\o /dev/null

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if;
end $$;

-- Impersonate a user the way PostgREST does: JWT claims + `authenticated` role.
create function pg_temp.login(p_user uuid, p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- Expect a statement to fail with a given SQLSTATE (or any error when null).
create function pg_temp.throws(stmt text, state text, msg text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'ASSERTION FAILED (no error): %', msg;
exception when others then
  if sqlerrm like 'ASSERTION FAILED (no error)%' then raise; end if;
  if state is not null and sqlstate <> state then
    raise exception 'ASSERTION FAILED: % — expected SQLSTATE %, got % (%)', msg, state, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.new_user(p_email text, p_role public.app_role default 'client') returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data) values (v, p_email, '{"full_name": "Test"}');
  update public.profiles set role = p_role where id = v;
  if p_role = 'technician' then
    insert into public.technicians (profile_id, status, sectors, skills)
    values (v, 'active', array['0b1d0000-0000-4000-8000-000000000102'::uuid], '{pre_achat}');
  end if;
  return v;
end $$;

-- A Médina apartment order for p_client, left in draft.
create function pg_temp.new_order(p_client uuid) returns uuid language plpgsql as $$
declare v_prop uuid; v_order uuid;
begin
  insert into public.properties (created_by, address, lat, lng, city_id, property_type, surface_m2)
  values (p_client, 'Derb Test, Médina', 31.625, -7.985, '0b1d0000-0000-4000-8000-000000000001', 'appartement', 80)
  returning id into v_prop;
  insert into public.orders (client_id, product_id, property_id, purpose, requested_slots)
  values (p_client, '0b1d0000-0000-4000-8000-000000000301', v_prop, 'residence', '[{"start":"2026-10-10T09:00:00Z"}]')
  returning id into v_order;
  return v_order;
end $$;

-- Apply a transition the way server code will: event name + status update.
create function pg_temp.move(p_order uuid, p_event text, p_to public.order_status) returns void
language plpgsql as $$
begin
  perform set_config('thiqa.event', p_event, true);
  update public.orders set status = p_to where id = p_order;
  perform set_config('thiqa.event', '', true);
end $$;
\set QUIET off
