// Shared domain enums. Every list here is mirrored by a Postgres enum in
// supabase/migrations; packages/db has a test that keeps both in sync.

export const APP_ROLES = [
  'client',
  'technician',
  'reviewer',
  'dispatcher',
  'admin',
  'partner',
] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const STAFF_ROLES = [
  'reviewer',
  'dispatcher',
  'admin',
] as const satisfies readonly AppRole[];

export const SEVERITIES = ['green', 'orange', 'red', 'blocking'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const PROPERTY_TYPES = [
  'studio',
  'appartement',
  'maison',
  'villa',
  'riad',
  'local',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PURPOSES = [
  'residence',
  'location_courte_duree',
  'location_longue_duree',
  'revente',
] as const;
export type Purpose = (typeof PURPOSES)[number];

export const RENTAL_PURPOSES = [
  'location_courte_duree',
  'location_longue_duree',
] as const satisfies readonly Purpose[];

export const ORDER_STATUSES = [
  'draft',
  'awaiting_payment',
  'paid',
  'dispatching',
  'assigned',
  'accepted',
  'scheduled',
  'in_progress',
  'submitted',
  'ai_processing',
  'in_review',
  'validated',
  'delivered',
  'closed',
  'cancelled',
  'refunded',
  'reassigning',
  'on_hold',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ['web', 'smartbnb_api', 'admin'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const MISSION_STATUSES = [
  'offered',
  'accepted',
  'declined',
  'expired',
  'scheduled',
  'in_progress',
  'submitted',
  'cancelled',
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const TECHNICIAN_STATUSES = ['pending', 'active', 'suspended'] as const;
export const REPORT_STATUSES = ['draft_ai', 'in_review', 'validated', 'delivered'] as const;
export const MEDIA_KINDS = ['photo', 'audio', 'video'] as const;
export const PAYMENT_PROVIDERS = ['cmi', 'stripe'] as const;
export const PAYMENT_KINDS = ['deposit', 'balance', 'refund'] as const;
export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'cancelled'] as const;
export const NOTIFICATION_CHANNELS = ['email', 'whatsapp', 'sms', 'push', 'in_app'] as const;
export const NOTIFICATION_STATUSES = ['queued', 'sending', 'sent', 'failed', 'skipped'] as const;
export const LANGS = ['fr', 'ar', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export const SEVERITY_RANK: Record<Severity, number> = { green: 0, orange: 1, red: 2, blocking: 3 };

export function maxSeverity(...values: ReadonlyArray<Severity | null | undefined>): Severity {
  let best: Severity = 'green';
  for (const v of values) {
    if (v && SEVERITY_RANK[v] > SEVERITY_RANK[best]) best = v;
  }
  return best;
}
