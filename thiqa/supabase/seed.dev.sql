-- LOCAL DEVELOPMENT ONLY — demo accounts (password: thiqa-dev-2026).
-- Never run against production.
begin;

-- Staff 2FA is enforced by RLS; relax it on the local database only.
do $$ begin
  execute format('alter database %I set thiqa.require_staff_mfa = %L', current_database(), 'off');
exception when insufficient_privilege then
  raise notice 'cannot relax staff MFA on this database (%): use TOTP for staff accounts', sqlerrm;
end $$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
                        email_change_token_new, email_change, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
       extensions.crypt('thiqa-dev-2026', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), '', '', '', '', now(), now()
from (values
  ('00000000-0000-4000-a000-000000000001', 'admin@thiqa.local', 'Youness (admin)'),
  ('00000000-0000-4000-a000-000000000002', 'reviewer@thiqa.local', 'Relecteur'),
  ('00000000-0000-4000-a000-000000000003', 'dispatch@thiqa.local', 'Dispatch'),
  ('00000000-0000-4000-a000-000000000004', 'tech1@thiqa.local', 'Technicien Guéliz'),
  ('00000000-0000-4000-a000-000000000005', 'tech2@thiqa.local', 'Technicien Médina'),
  ('00000000-0000-4000-a000-000000000006', 'client@thiqa.local', 'Client MRE')
) as u(id, email, name)
on conflict (id) do nothing;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now()
from auth.users u where u.email like '%@thiqa.local'
on conflict (provider_id, provider) do nothing;

update public.profiles p set role = r.role::public.app_role, city_id = '0b1d0000-0000-4000-8000-000000000001',
  phone = r.phone, whatsapp_opt_in = r.phone is not null
from (values
  ('00000000-0000-4000-a000-000000000001', 'admin', null),
  ('00000000-0000-4000-a000-000000000002', 'reviewer', null),
  ('00000000-0000-4000-a000-000000000003', 'dispatcher', null),
  ('00000000-0000-4000-a000-000000000004', 'technician', '+212600000004'),
  ('00000000-0000-4000-a000-000000000005', 'technician', '+212600000005'),
  ('00000000-0000-4000-a000-000000000006', 'client', '+33600000006')
) as r(id, role, phone)
where p.id = r.id::uuid;

insert into public.technicians (profile_id, status, sectors, skills, home_lat, home_lng, activated_at) values
  ('00000000-0000-4000-a000-000000000004', 'active', '{0b1d0000-0000-4000-8000-000000000101,0b1d0000-0000-4000-8000-000000000103}',
   '{pre_achat,locatif}', 31.635, -8.01, now() - interval '200 days'),
  ('00000000-0000-4000-a000-000000000005', 'active', '{0b1d0000-0000-4000-8000-000000000102}',
   '{pre_achat}', 31.628, -7.985, now() - interval '30 days')
on conflict (profile_id) do nothing;

insert into public.partners (id, name, slug, contact_email) values
  ('0b1d0000-0000-4000-8000-000000000401', 'Smart BNB', 'smartbnb', 'contact@smartbnb.ma')
on conflict (id) do nothing;

commit;
