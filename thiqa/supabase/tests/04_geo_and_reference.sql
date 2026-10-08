-- Sector assignment, reference data integrity, notification templates.
begin;
\ir _helpers.inc

do $$
declare
  p uuid;
  marrakech uuid := '0b1d0000-0000-4000-8000-000000000001';
begin
  insert into public.properties (address, lat, lng, city_id, property_type)
  values ('Riad Médina', 31.625, -7.985, marrakech, 'riad') returning id into p;
  perform pg_temp.ok((select s.slug from public.properties x join public.sectors s on s.id = x.sector_id where x.id = p) = 'medina',
    'Médina point lands in the Médina sector');

  update public.properties set lat = 31.64, lng = -8.02 where id = p;
  perform pg_temp.ok((select s.slug from public.properties x join public.sectors s on s.id = x.sector_id where x.id = p) = 'gueliz-hivernage',
    'moving the point re-assigns the sector');

  update public.properties set lat = 31.5, lng = -8.3 where id = p;
  perform pg_temp.ok((select sector_id is null from public.properties where id = p), 'outside every sector');

  perform pg_temp.ok((select count(*) from public.sectors where city_id = marrakech) = 3, '3 Marrakech sectors');
  perform pg_temp.ok((select count(*) from public.products where active) = 2, '2 active products');
  perform pg_temp.ok((select jsonb_array_length(schema -> 'items') from public.checklist_templates
                      where key = 'thiqa-standard' and version = 1) >= 120, 'template v1 has >= 120 items');
  perform pg_temp.ok((select count(*) from public.sla_policies) = 9, 'SLA policies seeded');

  -- Every notification key the database can emit has an active FR email template.
  perform pg_temp.ok(not exists (
    select k from (
      select 'sla_reminder_' || stage as k from public.sla_policies where cardinality(reminder_offsets) > 0
      union select 'sla_breach_' || stage from public.sla_policies where escalate_to is not null
      union values ('visit_reminder_d1'), ('visit_reminder_h2'), ('dispatch_exhausted'), ('order_cancelled_unpaid')
    ) needed
    where not exists (select 1 from public.notification_templates t where t.key = needed.k and t.channel = 'email' and t.active)
  ), 'notification templates cover SLA keys');

  -- RLS is enabled on every public table.
  perform pg_temp.ok(not exists (
    select 1 from pg_tables where schemaname = 'public' and not rowsecurity
  ), 'RLS enabled everywhere');
end $$;

rollback;
