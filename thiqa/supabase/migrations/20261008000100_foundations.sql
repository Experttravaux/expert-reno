-- Thiqa — foundations: extensions, private schema, enums, generic helpers.
-- Enum values mirror packages/core/src/domain.ts (sync test in packages/db).

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- Private helpers used by RLS and triggers. Not exposed through PostgREST.
create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('client', 'technician', 'reviewer', 'dispatcher', 'admin', 'partner');
create type public.severity as enum ('green', 'orange', 'red', 'blocking');
create type public.property_type as enum ('studio', 'appartement', 'maison', 'villa', 'riad', 'local');
create type public.order_purpose as enum ('residence', 'location_courte_duree', 'location_longue_duree', 'revente');
create type public.order_status as enum (
  'draft', 'awaiting_payment', 'paid', 'dispatching', 'assigned', 'accepted', 'scheduled',
  'in_progress', 'submitted', 'ai_processing', 'in_review', 'validated', 'delivered', 'closed',
  'cancelled', 'refunded', 'reassigning', 'on_hold'
);
create type public.order_source as enum ('web', 'smartbnb_api', 'admin');
create type public.mission_status as enum (
  'offered', 'accepted', 'declined', 'expired', 'scheduled', 'in_progress', 'submitted', 'cancelled'
);
create type public.technician_status as enum ('pending', 'active', 'suspended');
create type public.report_status as enum ('draft_ai', 'in_review', 'validated', 'delivered');
create type public.media_kind as enum ('photo', 'audio', 'video');
create type public.payment_provider as enum ('cmi', 'stripe');
create type public.payment_kind as enum ('deposit', 'balance', 'refund');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'cancelled');
create type public.notification_channel as enum ('email', 'whatsapp', 'sms', 'push', 'in_app');
create type public.notification_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped');
create type public.lang as enum ('fr', 'ar', 'en');
create type public.sla_stage as enum (
  'payment', 'assignment', 'acceptance', 'scheduling', 'visit', 'submission', 'ai_generation',
  'validation', 'balance'
);

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- i18n jsonb must at least carry a French value.
create or replace function app.is_i18n(v jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(v) = 'object' and coalesce(length(v ->> 'fr'), 0) > 0
$$;
