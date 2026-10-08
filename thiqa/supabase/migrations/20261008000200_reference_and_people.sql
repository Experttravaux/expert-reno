-- Reference data (cities, products, pricing, templates, catalogs) and people.

-- ---------------------------------------------------------------------------
-- Geography
-- ---------------------------------------------------------------------------
create table public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  bbox extensions.geometry(Polygon, 4326),
  active boolean not null default false,
  timezone text not null default 'Africa/Casablanca',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sectors (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities (id) on delete cascade,
  name text not null,
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  polygon extensions.geography(MultiPolygon, 4326) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (city_id, slug)
);
create index sectors_city_idx on public.sectors (city_id);
create index sectors_polygon_idx on public.sectors using gist (polygon);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version int not null check (version > 0),
  schema jsonb not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (key, version)
);

-- Published templates are immutable: a change ships as a new version.
create or replace function app.freeze_published_template() returns trigger
language plpgsql as $$
begin
  if old.published_at is not null and (new.schema is distinct from old.schema or new.version <> old.version) then
    raise exception 'checklist template %.v% is published and immutable', old.key, old.version
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger checklist_templates_freeze before update on public.checklist_templates
  for each row execute function app.freeze_published_template();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name_i18n jsonb not null check (app.is_i18n(name_i18n)),
  description_i18n jsonb not null default '{}'::jsonb,
  base_price_mad numeric(10, 2) not null check (base_price_mad > 0),
  duration_min int not null check (duration_min > 0),
  checklist_template_id uuid references public.checklist_templates (id),
  required_skills text[] not null default '{}',
  -- [{code, label_i18n, price_mad}] — mirrors ProductOption in packages/core/pricing.ts
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  active boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Multipliers of every matching rule stack (see computePrice in packages/core).
create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id) on delete cascade,
  city_id uuid references public.cities (id) on delete cascade,
  property_type public.property_type,
  surface_min numeric(8, 2),
  surface_max numeric(8, 2),
  multiplier numeric(5, 3) not null check (multiplier > 0),
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (surface_min is null or surface_max is null or surface_min < surface_max)
);
create index pricing_rules_product_idx on public.pricing_rules (product_id);

-- Unit prices for works estimates; city_id null = national baseline.
create table public.works_catalog (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references public.cities (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_]+$'),
  label_i18n jsonb not null check (app.is_i18n(label_i18n)),
  unit text not null check (unit in ('forfait', 'm2', 'ml', 'u')),
  min_mad numeric(12, 2) not null check (min_mad >= 0),
  max_mad numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_mad >= min_mad)
);
create unique index works_catalog_city_code_uniq
  on public.works_catalog (coalesce(city_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'client',
  full_name text,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email extensions.citext,
  lang public.lang not null default 'fr',
  country_code char(2),
  city_id uuid references public.cities (id),
  whatsapp_opt_in boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_idx on public.profiles (role);

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  contact_email extensions.citext,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  -- Only the prefix is stored in clear (for display); the key itself is hashed (sha256).
  prefix text not null,
  hashed_key text not null unique,
  scopes text[] not null default '{orders:write,orders:read,reports:read}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index api_keys_partner_idx on public.api_keys (partner_id);

create table public.technicians (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  status public.technician_status not null default 'pending',
  sectors uuid[] not null default '{}',
  skills text[] not null default '{}',
  rating_avg numeric(3, 2) not null default 0 check (rating_avg between 0 and 5),
  rating_count int not null default 0 check (rating_count >= 0),
  max_daily_missions int not null default 3 check (max_daily_missions between 1 and 10),
  -- {"weekly": {"mon": [["08:00","18:00"]], ...}, "off": ["2026-12-25"]}
  availability jsonb not null default '{}'::jsonb,
  kit_checklist jsonb not null default '{}'::jsonb,
  home_lat double precision,
  home_lng double precision,
  iban_last4 char(4),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index technicians_sectors_idx on public.technicians using gin (sectors);
create index technicians_active_idx on public.technicians (status) where status = 'active';

-- Loi 09-08 (CNDP): explicit, versioned consents.
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  purpose text not null check (purpose in ('terms', 'privacy', 'marketing', 'whatsapp')),
  version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  ip inet,
  unique (user_id, purpose, version)
);

-- ---------------------------------------------------------------------------
-- Technician pay
-- ---------------------------------------------------------------------------
create table public.payout_rules (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references public.cities (id),
  product_id uuid references public.products (id),
  fixed_mad numeric(10, 2) not null default 0,
  variable_pct numeric(5, 4) not null default 0 check (variable_pct between 0 and 1),
  -- e.g. {"rating_gte": 4.8, "bonus_mad": 50}
  bonus_rules jsonb not null default '[]'::jsonb,
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from)
);

create trigger cities_updated_at before update on public.cities for each row execute function app.set_updated_at();
create trigger sectors_updated_at before update on public.sectors for each row execute function app.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function app.set_updated_at();
create trigger pricing_rules_updated_at before update on public.pricing_rules for each row execute function app.set_updated_at();
create trigger works_catalog_updated_at before update on public.works_catalog for each row execute function app.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function app.set_updated_at();
create trigger partners_updated_at before update on public.partners for each row execute function app.set_updated_at();
create trigger technicians_updated_at before update on public.technicians for each row execute function app.set_updated_at();
