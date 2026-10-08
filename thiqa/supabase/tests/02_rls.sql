-- Row Level Security & column privileges (§12).
begin;
\ir _helpers.inc

create temp table ids (k text primary key, v uuid);
grant select on ids to authenticated;

do $$
declare
  a uuid := pg_temp.new_user('rls-a@test.local');
  b uuid := pg_temp.new_user('rls-b@test.local');
  t uuid := pg_temp.new_user('rls-tech@test.local', 'technician');
  t2 uuid := pg_temp.new_user('rls-tech2@test.local', 'technician');
  rv uuid := pg_temp.new_user('rls-reviewer@test.local', 'reviewer');
  oa uuid := pg_temp.new_order(a);
  ob uuid := pg_temp.new_order(b);
  m uuid;
begin
  perform pg_temp.move(oa, 'checkout', 'awaiting_payment');
  perform pg_temp.move(oa, 'deposit_paid', 'paid');
  perform pg_temp.move(oa, 'start_dispatch', 'dispatching');
  insert into public.missions (order_id, technician_id, attempt_no) values (oa, t, 1) returning id into m;
  insert into public.reports (order_id, template_version, scoring_version) values (oa, 1, '1.0.0');
  insert into ids values ('a', a), ('b', b), ('t', t), ('t2', t2), ('rv', rv), ('oa', oa), ('ob', ob), ('m', m);
end $$;

-- ---------- anonymous visitor ----------
set local role anon;
select pg_temp.ok((select count(*) from public.products) = 2, 'anon sees the 2 active products only');
select pg_temp.ok((select count(*) from public.cities) = 1, 'anon sees active cities only');
select pg_temp.ok((select count(*) from public.orders) = 0, 'anon sees no orders');
select pg_temp.ok((select count(*) from public.checklist_templates) = 0, 'anon cannot read templates');
reset role;

-- ---------- client A ----------
select pg_temp.login((select v from ids where k = 'a'));
select pg_temp.ok((select count(*) from public.orders) = 1, 'client sees only own order');
select pg_temp.ok((select id from public.orders) = (select v from ids where k = 'oa'), 'it is order A');
select pg_temp.ok((select count(*) from public.properties) = 1, 'client sees only own property');
select pg_temp.ok((select count(*) from public.profiles) = 1, 'client sees only own profile');
select pg_temp.ok((select count(*) from public.missions) = 0, 'client does not see missions');
select pg_temp.ok((select count(*) from public.reports) = 0, 'client does not see undelivered report');
select pg_temp.ok((select count(*) from public.events where visibility = 'internal') = 0, 'client sees no internal events');
select pg_temp.ok((select count(*) from public.events) > 0, 'client sees own timeline');
select pg_temp.throws('update public.orders set price_mad = 1', '42501', 'client cannot set the price');
select pg_temp.throws($q$update public.profiles set role = 'admin'$q$, '42501', 'client cannot self-promote');
update public.profiles set full_name = 'Nouveau nom';
select pg_temp.ok((select full_name from public.profiles) = 'Nouveau nom', 'client can edit own profile');
select pg_temp.throws(format($q$insert into public.orders (client_id, product_id, purpose) values (%L, '0b1d0000-0000-4000-8000-000000000301', 'residence')$q$,
  (select v from ids where k = 'b')), '42501', 'client cannot create an order for someone else');
insert into public.orders (client_id, product_id, purpose) values ((select v from ids where k = 'a'), '0b1d0000-0000-4000-8000-000000000301', 'revente');
select pg_temp.ok((select count(*) from public.orders) = 2, 'client can create own draft');
select pg_temp.throws($q$update public.orders set status = 'paid' where status = 'draft'$q$, null, 'client cannot change status');
with u as (update public.orders set notes = 'x' where status <> 'draft' returning 1) select pg_temp.ok((select count(*) from u) = 0, 'client update on a paid order affects no row');
select pg_temp.logout();

-- ---------- client B ----------
select pg_temp.login((select v from ids where k = 'b'));
select pg_temp.ok((select count(*) from public.orders) = 1, 'client B sees only own order');
select pg_temp.ok((select count(*) from public.events where order_id = (select v from ids where k = 'oa')) = 0, 'no access to A timeline');
select pg_temp.logout();

-- ---------- technician holding an offer ----------
select pg_temp.login((select v from ids where k = 't'));
select pg_temp.ok((select count(*) from public.orders) = 0, 'technician never reads orders directly');
select pg_temp.ok((select count(*) from public.missions) = 1, 'technician sees own mission');
select pg_temp.ok((select count(*) from public.profiles) = 1, 'technician cannot read client profile');
select pg_temp.ok((select address is null and onsite_contact is null from public.technician_missions), 'offer hides exact address');
select pg_temp.ok((select lat = 31.63 from public.technician_missions), 'offer shows rounded location');
with u as (update public.missions set status = 'accepted' returning 1) select pg_temp.ok((select count(*) from u) = 0, 'technician has no direct write on missions');
select pg_temp.logout();

update public.missions set status = 'accepted', accepted_at = now() where id = (select v from ids where k = 'm');
select pg_temp.login((select v from ids where k = 't'));
select pg_temp.ok((select address = 'Derb Test, Médina' from public.technician_missions), 'address revealed once accepted');
select pg_temp.throws(format($q$insert into public.inspections (mission_id, template_id, template_version) values (%L, '0b1d0000-0000-4000-8000-000000000201', 1)$q$,
  (select v from ids where k = 'm')), '42501', 'no inspection before the visit starts');
select pg_temp.logout();

update public.missions set status = 'in_progress', started_at = now() where id = (select v from ids where k = 'm');
select pg_temp.login((select v from ids where k = 't'));
insert into public.inspections (mission_id, template_id, template_version) values
  ((select v from ids where k = 'm'), '0b1d0000-0000-4000-8000-000000000201', 1);
insert into public.inspection_items (inspection_id, block_code, item_code, value, severity_technician)
select id, 'PLB', 'PLB_PRESSION', '3.2', 'green' from public.inspections;
select pg_temp.ok((select count(*) from public.inspection_items) = 1, 'technician writes items during the visit');
select pg_temp.throws($q$update public.inspection_items set severity = 'red'$q$, '42501', 'technician cannot set the final severity');
select pg_temp.throws($q$update public.technicians set status = 'active', rating_avg = 5$q$, '42501', 'technician cannot rate or activate himself');
update public.technicians set availability = '{"weekly": {"mon": [["08:00", "18:00"]]}}';
select pg_temp.ok((select availability ? 'weekly' from public.technicians), 'technician edits own availability');
select pg_temp.logout();

-- ---------- another technician ----------
select pg_temp.login((select v from ids where k = 't2'));
select pg_temp.ok((select count(*) from public.missions) = 0, 'other technician sees nothing');
select pg_temp.ok((select count(*) from public.inspections) = 0, 'other technician sees no inspection');
select pg_temp.ok((select count(*) from public.technician_missions) = 0, 'other technician view is empty');
select pg_temp.logout();

-- ---------- reviewer: 2FA enforced ----------
select set_config('thiqa.require_staff_mfa', 'on', true);
select pg_temp.login((select v from ids where k = 'rv'), 'aal1');
select pg_temp.ok((select count(*) from public.orders) = 0, 'staff without 2FA sees nothing');
select pg_temp.logout();
select pg_temp.login((select v from ids where k = 'rv'), 'aal2');
select pg_temp.ok((select count(*) from public.orders) >= 3, 'staff with 2FA sees all orders');
select pg_temp.ok((select count(*) from public.reports) >= 1, 'reviewer sees reports');
update public.inspection_items set severity = 'orange';
select pg_temp.ok((select count(*) from public.inspection_items where severity = 'orange') = 1, 'reviewer sets final severity');
with u as (update public.cities set active = true returning 1) select pg_temp.ok((select count(*) from u) = 0, 'reviewer cannot edit cities');
select pg_temp.logout();

-- ---------- report delivered to the client ----------
update public.reports set status = 'in_review';
update public.reports set status = 'validated', validated_by = (select v from ids where k = 'rv'), validated_at = now();
update public.reports set status = 'delivered', pdf_path = 'reports/x.pdf', delivered_at = now();
select pg_temp.login((select v from ids where k = 'a'));
select pg_temp.ok((select count(*) from public.reports) = 1, 'client reads the delivered report');
select pg_temp.logout();
select pg_temp.login((select v from ids where k = 'b'));
select pg_temp.ok((select count(*) from public.reports) = 0, 'other client does not');
select pg_temp.logout();

rollback;
