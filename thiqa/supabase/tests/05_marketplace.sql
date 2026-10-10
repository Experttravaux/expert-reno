-- Marketplace, partner programme, solutions and placements: access rules.
begin;
\ir _helpers.inc

create temp table ids (k text primary key, v uuid);
grant select on ids to anon, authenticated;

do $$
declare
  c uuid := pg_temp.new_user('mk-client@test.local');
  t uuid := pg_temp.new_user('mk-tech@test.local', 'technician');
  a1 uuid := pg_temp.new_user('mk-elec@test.local');
  a2 uuid := pg_temp.new_user('mk-pending@test.local');
  a3 uuid := pg_temp.new_user('mk-plomb@test.local');
  o uuid := pg_temp.new_order(c);
  m uuid; i uuid; it uuid; p uuid;
  mrk uuid := '0b1d0000-0000-4000-8000-000000000001';
begin
  update public.profiles set phone = '+33600000001' where id = c;
  insert into public.missions (order_id, technician_id, attempt_no, status) values (o, t, 1, 'in_progress') returning id into m;
  insert into public.inspections (mission_id, template_id, template_version) values (m, '0b1d0000-0000-4000-8000-000000000201', 1) returning id into i;
  insert into public.inspection_items (inspection_id, block_code, item_code, severity, resolution, trade, observation_ai, works_estimate_mad_min, works_estimate_mad_max)
  values (i, 'ELE', 'ELE_DIFFERENTIEL', 'red', 'pro', 'electricien', 'Aucun différentiel 30 mA.', 600, 1500) returning id into it;

  insert into public.partner_accounts (profile_id, kind, status) values (a1, 'artisan', 'active') returning id into p;
  insert into public.artisans (profile_id, partner_account_id, display_name, status, trades, city_ids, identity_verified, charter_signed_at)
  values (a1, p, 'Elec Guéliz', 'active', '{electricien}', array[mrk], true, now());
  insert into public.partner_accounts (profile_id, kind) values (a2, 'artisan') returning id into p;
  insert into public.artisans (profile_id, partner_account_id, display_name, trades, city_ids) values (a2, p, 'Nouveau', '{electricien}', array[mrk]);
  insert into public.partner_accounts (profile_id, kind, status) values (a3, 'artisan', 'active') returning id into p;
  insert into public.artisans (profile_id, partner_account_id, display_name, status, trades, city_ids, identity_verified, charter_signed_at)
  values (a3, p, 'Plombier Médina', 'active', '{plombier}', array[mrk], true, now());

  perform pg_temp.throws(format($q$update public.artisans set status = 'active' where profile_id = %L$q$, a2), '23514',
    'an artisan cannot be active without identity check and charter');
  insert into ids values ('c', c), ('a1', a1), ('a2', a2), ('a3', a3), ('o', o), ('it', it);
end $$;

-- ---------- client creates a request from the report ----------
select pg_temp.login((select v from ids where k = 'c'));
insert into public.quote_requests (order_id, client_id, items, trade, city_id, sector_id)
values ((select v from ids where k = 'o'), (select v from ids where k = 'c'), array[(select v from ids where k = 'it')],
        'electricien', '0b1d0000-0000-4000-8000-000000000001', '0b1d0000-0000-4000-8000-000000000102');
select pg_temp.ok((select count(*) from public.quote_requests) = 1, 'client sees own request');
select pg_temp.throws(format($q$insert into public.quote_requests (client_id, trade, city_id, description) values (%L, 'plombier', '0b1d0000-0000-4000-8000-000000000001', 'x')$q$,
  (select v from ids where k = 'a1')), '42501', 'client cannot create a request for someone else');
select pg_temp.logout();
insert into ids select 'r', id from public.quote_requests;

-- ---------- dispatch (server) ----------
select pg_temp.throws(format('update public.quote_requests set sent_to = array[%L::uuid] where id = %L',
  (select v from ids where k = 'a2'), (select v from ids where k = 'r')), '23514', 'pending artisans receive nothing');
select pg_temp.throws(format('update public.quote_requests set sent_to = array[%L::uuid] where id = %L',
  (select v from ids where k = 'a3'), (select v from ids where k = 'r')), '23514', 'wrong trade refused');
select pg_temp.throws(format('update public.quote_requests set sent_to = array[%L::uuid, %L, %L, %L] where id = %L',
  (select v from ids where k = 'a1'), (select v from ids where k = 'a1'), (select v from ids where k = 'a1'), (select v from ids where k = 'a1'),
  (select v from ids where k = 'r')), '23514', 'never more than 3 recipients');
update public.quote_requests set sent_to = array[(select v from ids where k = 'a1')] where id = (select v from ids where k = 'r');

-- ---------- artisan side ----------
select pg_temp.login((select v from ids where k = 'a1'));
select pg_temp.ok((select count(*) from public.quote_requests) = 0, 'artisan never reads requests directly');
select pg_temp.ok((select count(*) from public.artisan_requests) = 1, 'artisan sees the request through the view');
select pg_temp.ok((select client_phone is null and client_name is null and sector = 'Médina' from public.artisan_requests), 'no contact or address before being chosen');
select pg_temp.ok((select items -> 0 ->> 'observation' from public.artisan_requests) = 'Aucun différentiel 30 mA.', 'the inspection point is the specification');
select pg_temp.ok((select count(*) from public.profiles) = 1, 'artisan cannot read the client profile');
insert into public.quotes (request_id, artisan_id, amount_mad, delay_days, detail)
values ((select v from ids where k = 'r'), (select v from ids where k = 'a1'), 1200, 3, 'Pose d''un interrupteur différentiel 30 mA type AC.');
select pg_temp.throws($q$update public.quotes set status = 'chosen'$q$, '42501', 'artisan cannot choose his own quote');
select pg_temp.throws($q$update public.artisans set score = 99$q$, '42501', 'artisan cannot set his score');
update public.artisans set radius_km = 15;
select pg_temp.logout();

select pg_temp.login((select v from ids where k = 'a3'));
select pg_temp.throws(format($q$insert into public.quotes (request_id, artisan_id, amount_mad, delay_days, detail) values (%L, %L, 900, 2, 'x')$q$,
  (select v from ids where k = 'r'), (select v from ids where k = 'a3')), '23514', 'only recipients can quote');
select pg_temp.ok((select count(*) from public.artisan_requests) = 0, 'other artisans see nothing');
select pg_temp.logout();

-- ---------- client chooses, contact is revealed ----------
select pg_temp.login((select v from ids where k = 'c'));
select pg_temp.ok((select count(*) from public.quotes) = 1, 'client sees the quotes of his request');
select pg_temp.logout();
update public.quotes set status = 'chosen', band = 'in';
select pg_temp.login((select v from ids where k = 'a1'));
select pg_temp.ok((select client_phone = '+33600000001' from public.artisan_requests), 'contact revealed once chosen');
select pg_temp.logout();

-- ---------- partner onboarding ----------
select pg_temp.login((select v from ids where k = 'c'));
insert into public.partner_accounts (profile_id, kind, data) values ((select v from ids where k = 'c'), 'referrer', '{"company": "Agence Test"}');
select pg_temp.throws(format($q$insert into public.partner_accounts (profile_id, kind, status) values (%L, 'brand', 'active')$q$,
  (select v from ids where k = 'c')), '42501', 'nobody activates himself');
select pg_temp.throws($q$update public.partner_accounts set referral_code = 'FREE2026'$q$, '42501', 'referral codes are issued by admins');
select pg_temp.logout();

-- ---------- public visitor ----------
update public.solutions set published = true where slug = 'pression-eau-faible';
insert into public.partners (name, slug, kind, contact_email) values ('Marque Test', 'marque-test', 'brand', 'sales@example.com');
insert into public.placements (partner_id, kind, solution_id)
select p.id, 'sheet_sponsor', s.id from public.partners p, public.solutions s where p.slug = 'marque-test' and s.slug = 'pression-eau-faible';
set local role anon;
select pg_temp.ok((select count(*) from public.solutions) = 1, 'anon sees published solutions only');
select pg_temp.ok((select count(*) from public.public_artisans) = 2, 'directory lists active artisans only');
select pg_temp.ok((select count(*) from public.artisans) = 0, 'raw artisan files are private');
select pg_temp.ok((select name from public.partners where slug = 'marque-test') = 'Marque Test', 'brand name is public');
select pg_temp.throws('select contact_email from public.partners', '42501', 'brand contacts are private');
select public.track_placement((select id from public.placements limit 1), 'click');
reset role;
select pg_temp.ok((select count(*) from public.placement_events where kind = 'click') = 1, 'anonymous click tracked');

-- ---------- golden rule: partnerships never touch scoring ----------
select pg_temp.ok(not exists (
  select 1 from pg_constraint k
  where k.contype = 'f'
    and ((k.conrelid::regclass::text in ('partners', 'partner_products', 'placements', 'placement_events', 'public.partners', 'public.partner_products', 'public.placements', 'public.placement_events')
          and k.confrelid::regclass::text in ('inspection_items', 'reports', 'public.inspection_items', 'public.reports'))
      or (k.conrelid::regclass::text in ('inspection_items', 'reports', 'public.inspection_items', 'public.reports')
          and k.confrelid::regclass::text in ('partners', 'partner_products', 'placements', 'public.partners', 'public.partner_products', 'public.placements')))
), 'no link between sponsored content and inspection results');

-- ---------- expiry ----------
select pg_temp.ok(app.marketplace_tick(now() + interval '3 days') = 0, 'a quoted request does not expire');
update public.quote_requests set status = 'sent';
select pg_temp.ok(app.marketplace_tick(now() + interval '3 days') = 1, 'unanswered requests expire after 48 h');

rollback;
