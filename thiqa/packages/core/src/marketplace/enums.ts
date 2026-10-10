// Marketplace & solutions enums. Mirrored by Postgres enums
// (supabase/migrations/20261010000100_marketplace.sql), sync-tested in packages/db.

export const RESOLUTIONS = ['diy', 'pro', 'legal'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** Trades used both on inspection items and on artisan profiles. */
export const TRADES = [
  'electricien',
  'plombier',
  'etancheite',
  'macon',
  'menuisier',
  'peintre',
  'climaticien',
  'carreleur',
  'serrurier',
  'autre',
] as const;
export type Trade = (typeof TRADES)[number];

export const PARTNER_KINDS = ['artisan', 'technician', 'brand', 'referrer'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const PARTNER_STATUSES = ['pending', 'active', 'rejected', 'suspended'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const QUOTE_REQUEST_STATUSES = ['sent', 'quoted', 'chosen', 'done', 'expired'] as const;
export const QUOTE_STATUSES = ['sent', 'chosen', 'declined'] as const;
export const REFERRAL_STATUSES = ['pending', 'due', 'paid'] as const;
export const PLACEMENT_KINDS = ['product', 'sheet_sponsor', 'report_insert'] as const;
export const SOLUTION_CATEGORIES = [
  'eau',
  'electricite',
  'humidite',
  'clim',
  'fenetres',
  'peinture',
] as const;
export type SolutionCategory = (typeof SOLUTION_CATEGORIES)[number];
