-- Orders: ref generation, status guard, event log, invariants.
begin;
\ir _helpers.inc

do $$
declare
  c uuid := pg_temp.new_user('sm-client@test.local');
  t uuid := pg_temp.new_user('sm-tech@test.local', 'technician');
  o uuid := pg_temp.new_order(c);
  o2 uuid := pg_temp.new_order(c);
  m uuid;
  r record;
begin
  select * into r from public.orders where id = o;
  perform pg_temp.ok(r.ref ~ '^THQ-\d{4}-\d{6}$', 'ref format THQ-YYYY-NNNNNN: ' || r.ref);
  perform pg_temp.ok((select ref from public.orders where id = o2) > r.ref, 'refs increase');
  perform pg_temp.ok(r.status = 'draft', 'new orders are drafts');

  -- Orders cannot be created in another status.
  perform pg_temp.throws(format(
    $q$insert into public.orders (client_id, product_id, purpose, status) values (%L, '0b1d0000-0000-4000-8000-000000000301', 'residence', 'paid')$q$, c),
    '23514', 'insert as paid is refused');

  -- Illegal jumps are refused, with or without an event name.
  perform pg_temp.throws(format('update public.orders set status = %L where id = %L', 'paid', o), '23514', 'draft -> paid refused');
  perform pg_temp.throws(format($q$select pg_temp.move(%L, 'deposit_paid', 'awaiting_payment')$q$, o), '23514',
    'valid pair with the wrong event refused');

  perform pg_temp.move(o, 'checkout', 'awaiting_payment');
  perform pg_temp.ok((select status from public.orders where id = o) = 'awaiting_payment', 'checkout applied');
  perform pg_temp.ok((select lock_version from public.orders where id = o) = 1, 'lock_version bumped');
  perform pg_temp.ok(exists (select 1 from public.events where order_id = o and type = 'order.checkout'
                              and payload ->> 'to' = 'awaiting_payment' and visibility = 'client'), 'event logged');
  perform pg_temp.ok(exists (select 1 from public.order_sla_clocks where order_id = o and stage = 'payment'
                              and completed_at is null and due_at > now()), 'payment clock opened');

  perform pg_temp.move(o, 'deposit_paid', 'paid');
  perform pg_temp.ok((select completed_at is not null from public.order_sla_clocks where order_id = o and stage = 'payment'),
    'payment clock closed');
  perform pg_temp.ok((select count(*) = 3 from public.order_sla_clocks where order_id = o and completed_at is null
                      and stage in ('assignment', 'scheduling', 'visit')), 'dispatch clocks opened');

  -- Hold / resume keeps track of the previous status.
  perform pg_temp.move(o, 'hold', 'on_hold');
  perform pg_temp.ok((select on_hold_from from public.orders where id = o) = 'paid', 'on_hold_from recorded');
  perform pg_temp.move(o, 'resume', 'paid');
  perform pg_temp.ok((select on_hold_from is null from public.orders where id = o), 'on_hold_from cleared');

  -- No double attribution: one live mission per order.
  perform pg_temp.move(o, 'start_dispatch', 'dispatching');
  insert into public.missions (order_id, technician_id, attempt_no, offer_expires_at)
  values (o, t, 1, now() + interval '20 minutes') returning id into m;
  perform pg_temp.throws(format(
    'insert into public.missions (order_id, technician_id, attempt_no) values (%L, %L, 2)', o, t),
    '23505', 'second live mission refused');

  -- Check-in far from the property requires a justification.
  perform pg_temp.throws(format('update public.missions set checkin_distance_m = 400 where id = %L', m),
    '23514', 'check-in at 400 m without justification refused');
  update public.missions set checkin_distance_m = 400, checkin_justification = 'Accès par l''arrière du derb' where id = m;

  -- Events are append-only.
  perform pg_temp.throws('update public.events set type = ''x''', '42501', 'events cannot be updated');
  perform pg_temp.throws('delete from public.events', '42501', 'events cannot be deleted');

  -- Published checklist templates are immutable.
  perform pg_temp.throws($q$update public.checklist_templates set schema = '{}' where key = 'thiqa-standard'$q$,
    '23514', 'published template is frozen');

  -- Reports: delivery requires validation and a PDF.
  insert into public.reports (order_id, template_version, scoring_version) values (o, 1, '1.0.0');
  perform pg_temp.throws(format($q$update public.reports set status = 'delivered' where order_id = %L$q$, o),
    '23514', 'draft report cannot jump to delivered');
  update public.reports set status = 'in_review' where order_id = o;
  perform pg_temp.throws(format($q$update public.reports set status = 'validated' where order_id = %L$q$, o),
    '23514', 'validation needs validated_by');
end $$;

rollback;
