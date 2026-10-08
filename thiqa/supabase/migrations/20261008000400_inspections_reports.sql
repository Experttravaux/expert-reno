-- Field inspections, media, AI-assisted reports and their audit trail.

create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null unique references public.missions (id) on delete cascade,
  template_id uuid not null references public.checklist_templates (id),
  template_version int not null,
  -- Rooms declared on site, e.g. ["salon", "ch1", "sdb1"]; room-scoped items repeat per room.
  rooms jsonb not null default '[]'::jsonb check (jsonb_typeof(rooms) = 'array'),
  -- Raw captured values keyed by item code or "CODE@room" (offline sync payload).
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  measures jsonb not null default '{}'::jsonb check (jsonb_typeof(measures) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  device_meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  block_code text not null check (block_code in ('ADM', 'STR', 'HUM', 'ELE', 'PLB', 'MEN', 'FIN', 'ENV', 'LOC')),
  item_code text not null,
  room text not null default '',
  value jsonb,
  -- Severity sources (§8.1): template rule, technician, AI suggestion; `severity` is final.
  severity_rule public.severity,
  severity_technician public.severity,
  severity_ai public.severity,
  severity public.severity,
  needs_attention boolean not null default false,
  observation_raw text,
  observation_ai text,
  works_estimate_mad_min numeric(12, 2),
  works_estimate_mad_max numeric(12, 2),
  photos uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inspection_id, item_code, room),
  check (works_estimate_mad_max is null or works_estimate_mad_min is null or works_estimate_mad_max >= works_estimate_mad_min)
);
create index inspection_items_severity_idx on public.inspection_items (inspection_id, severity);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections (id) on delete cascade,
  item_code text,
  room text,
  storage_path text not null unique,
  kind public.media_kind not null default 'photo',
  width int,
  height int,
  bytes int,
  exif jsonb,
  taken_at timestamptz,
  ai_analysis jsonb,
  -- Loi 09-08 retention: photos 2 years.
  retain_until date not null default (current_date + interval '2 years'),
  created_at timestamptz not null default now()
);
create index media_inspection_idx on public.media (inspection_id, item_code);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  version int not null default 1 check (version > 0),
  status public.report_status not null default 'draft_ai',
  template_version int not null,
  scoring_version text not null,
  -- {"photo_analysis": 3, "synthesis": 2, ...}
  prompt_versions jsonb not null default '{}'::jsonb,
  -- {"technical": 72, "habitability": 64, "rental": 55, "details": {...}}
  scores jsonb not null default '{}'::jsonb,
  recommendation text check (recommendation in ('favorable', 'sous_reserve', 'defavorable')),
  summary_i18n jsonb not null default '{}'::jsonb,
  top_points jsonb not null default '[]'::jsonb,
  negotiation_points jsonb not null default '[]'::jsonb,
  works_total_min numeric(12, 2),
  works_total_max numeric(12, 2),
  pdf_path text,
  validated_by uuid references public.profiles (id),
  validated_at timestamptz,
  delivered_at timestamptz,
  -- Loi 09-08 retention: reports 5 years.
  retain_until date not null default (current_date + interval '5 years'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, version),
  check (status not in ('validated', 'delivered') or (validated_by is not null and validated_at is not null)),
  check (status <> 'delivered' or (pdf_path is not null and delivered_at is not null))
);
create index reports_status_idx on public.reports (status, created_at);

create or replace function app.guard_report_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and not (
    (old.status, new.status) in (
      ('draft_ai'::public.report_status, 'in_review'::public.report_status),
      ('in_review', 'draft_ai'),
      ('in_review', 'validated'),
      ('validated', 'in_review'),
      ('validated', 'delivered')
    )
  ) then
    raise exception 'illegal report transition % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  if old.status = 'delivered' and (new.scores is distinct from old.scores or new.summary_i18n is distinct from old.summary_i18n) then
    raise exception 'a delivered report is immutable; create a new version' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger reports_guard_status before update on public.reports
  for each row execute function app.guard_report_status();

create or replace function app.log_report_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.log_event('report', new.id, new.order_id, 'report.' || new.status,
    jsonb_build_object('version', new.version),
    case when new.status = 'delivered' then 'client' else 'internal' end);
  return null;
end $$;
create trigger reports_log after insert or update of status on public.reports
  for each row execute function app.log_report_status();

-- Reviewer corrections, kept as diffs to improve prompts (§8.5).
create table public.report_revisions (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports (id) on delete cascade,
  inspection_item_id uuid references public.inspection_items (id) on delete set null,
  field text not null,
  before jsonb,
  after jsonb,
  prompt_key text,
  prompt_version int,
  edited_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index report_revisions_report_idx on public.report_revisions (report_id);

-- ---------------------------------------------------------------------------
-- AI prompts (versioned) and call log (cost / latency)
-- ---------------------------------------------------------------------------
create table public.ai_prompts (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z0-9_]+$'),
  version int not null check (version > 0),
  model text not null,
  temperature numeric(3, 2) not null default 0.2 check (temperature between 0 and 1),
  system text not null,
  template text not null,
  output_schema jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (key, version)
);
create unique index ai_prompts_one_active on public.ai_prompts (key) where active;

create table public.ai_calls (
  id bigint generated always as identity primary key,
  order_id uuid references public.orders (id) on delete set null,
  prompt_key text not null,
  prompt_version int not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10, 5),
  latency_ms int,
  status text not null check (status in ('ok', 'error', 'invalid_output')),
  error text,
  created_at timestamptz not null default now()
);
create index ai_calls_order_idx on public.ai_calls (order_id);
create index ai_calls_created_idx on public.ai_calls (created_at);

create trigger inspections_updated_at before update on public.inspections for each row execute function app.set_updated_at();
create trigger inspection_items_updated_at before update on public.inspection_items for each row execute function app.set_updated_at();
create trigger reports_updated_at before update on public.reports for each row execute function app.set_updated_at();
