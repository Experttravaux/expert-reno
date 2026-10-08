-- SLA tick: reminders, offer expiry, breaches, auto-cancel (§6).
begin;
\ir _helpers.inc

do $$
declare
  c uuid := pg_temp.new_user('sla-client@test.local');
  t1 uuid := pg_temp.new_user('sla-t1@test.local', 'technician');
  t2 uuid := pg_temp.new_user('sla-t2@test.local', 'technician');
  t3 uuid := pg_temp.new_user('sla-t3@test.local', 'technician');
  o uuid := pg_temp.new_order(c);
  o2 uuid := pg_temp.new_order(c);
  res jsonb;
begin
  update public.profiles set whatsapp_opt_in = true where id = c;

  -- Payment reminders at +4 h, deduplicated.
  perform pg_temp.move(o, 'checkout', 'awaiting_payment');
  res := app.sla_tick(now() + interval '5 hours');
  perform pg_temp.ok((res ->> 'reminders')::int = 2, 'J+4h reminder by email + WhatsApp: ' || res::text);
  res := app.sla_tick(now() + interval '5 hours');
  perform pg_temp.ok((res ->> 'reminders')::int = 0, 'reminders are not repeated');
  perform pg_temp.ok((select count(*) from public.notifications where order_id = o and template_key = 'sla_reminder_payment') = 2,
    'two payment reminder rows');

  -- 24 h breach, then auto-cancel at 72 h.
  res := app.sla_tick(now() + interval '25 hours');
  perform pg_temp.ok((res ->> 'breaches')::int = 1, 'payment breach recorded: ' || res::text);
  perform pg_temp.ok(exists (select 1 from public.sla_breaches where order_id = o and stage = 'payment'), 'breach row');
  res := app.sla_tick(now() + interval '73 hours');
  perform pg_temp.ok((select status from public.orders where id = o) = 'cancelled', 'auto-cancelled after 72 h');
  perform pg_temp.ok(exists (select 1 from public.events where order_id = o and type = 'order.payment_timeout'), 'cancel event');
  perform pg_temp.ok((select resolved_at is not null from public.sla_breaches where order_id = o), 'breach resolved on exit');

  -- Offer expiry: attempts 1 and 2 go back to dispatching, attempt 3 to reassigning.
  perform pg_temp.move(o2, 'checkout', 'awaiting_payment');
  perform pg_temp.move(o2, 'deposit_paid', 'paid');
  perform pg_temp.move(o2, 'start_dispatch', 'dispatching');
  insert into public.missions (order_id, technician_id, attempt_no, offer_expires_at) values (o2, t1, 1, now() + interval '20 minutes');
  perform pg_temp.move(o2, 'technician_assigned', 'assigned');

  res := app.sla_tick(now() + interval '11 minutes');
  perform pg_temp.ok(exists (select 1 from public.notifications where user_id = t1 and template_key = 'sla_reminder_acceptance'),
    '10-minute reminder to the technician');
  res := app.sla_tick(now() + interval '21 minutes');
  perform pg_temp.ok((res ->> 'expired_offers')::int = 1, 'offer expired');
  perform pg_temp.ok((select status from public.orders where id = o2) = 'dispatching', 'back to dispatching');

  insert into public.missions (order_id, technician_id, attempt_no, offer_expires_at) values (o2, t2, 2, now() - interval '1 minute');
  perform pg_temp.move(o2, 'technician_assigned', 'assigned');
  perform app.sla_tick(now());
  insert into public.missions (order_id, technician_id, attempt_no, offer_expires_at) values (o2, t3, 3, now() - interval '1 minute');
  perform pg_temp.move(o2, 'technician_assigned', 'assigned');
  perform app.sla_tick(now());
  perform pg_temp.ok((select status from public.orders where id = o2) = 'reassigning', 'third refusal -> reassigning');
  perform pg_temp.ok(exists (select 1 from public.notifications where order_id = o2 and audience_role = 'dispatcher'
                              and template_key = 'dispatch_exhausted'), 'dispatcher alerted');

  -- Assignment SLA (2 h) escalates to the dispatcher.
  res := app.sla_tick(now() + interval '3 hours');
  perform pg_temp.ok(exists (select 1 from public.sla_breaches where order_id = o2 and stage = 'assignment'
                              and escalated_to = 'dispatcher'), 'assignment breach escalated');

  -- Visit reminders D-1 and H-2.
  insert into public.missions (order_id, technician_id, attempt_no) values (o2, t1, 4);
  perform pg_temp.move(o2, 'technician_assigned', 'assigned');
  update public.missions set status = 'accepted' where order_id = o2 and attempt_no = 4;
  perform pg_temp.move(o2, 'technician_accepted', 'accepted');
  update public.orders set scheduled_at = now() + interval '90 minutes' where id = o2;
  perform pg_temp.move(o2, 'visit_scheduled', 'scheduled');
  perform app.sla_tick(now());
  perform pg_temp.ok((select count(*) from public.notifications where order_id = o2
                      and template_key in ('visit_reminder_d1', 'visit_reminder_h2')) >= 4,
    'D-1 and H-2 reminders to client and technician');

  -- Submission clock opens at check-out; reminder at 1 h.
  update public.missions set status = 'in_progress', started_at = now() where order_id = o2 and attempt_no = 4;
  update public.orders set scheduled_at = now() - interval '1 minute' where id = o2;
  perform pg_temp.move(o2, 'visit_started', 'in_progress');
  update public.missions set checkout_at = now() where order_id = o2 and attempt_no = 4;
  perform pg_temp.ok(exists (select 1 from public.order_sla_clocks where order_id = o2 and stage = 'submission'
                              and completed_at is null), 'submission clock opened at check-out');
  perform app.sla_tick(now() + interval '61 minutes');
  perform pg_temp.ok(exists (select 1 from public.notifications where user_id = t1 and template_key = 'sla_reminder_submission'),
    'submission reminder');
  perform pg_temp.move(o2, 'inspection_submitted', 'submitted');
  perform pg_temp.ok((select completed_at is not null from public.order_sla_clocks where order_id = o2 and stage = 'submission'),
    'submission clock closed');
end $$;

rollback;
