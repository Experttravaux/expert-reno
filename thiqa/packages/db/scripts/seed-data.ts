// Reference data for the seed. Prices and multipliers are launch hypotheses
// to be validated by the founder (see README "Décisions en attente").

import { TEMPLATE_V1, TRANSITIONS, WORKS_CATALOG } from '@thiqa/core';

export const IDS = {
  city: {
    marrakech: '0b1d0000-0000-4000-8000-000000000001',
    casablanca: '0b1d0000-0000-4000-8000-000000000002',
    rabat: '0b1d0000-0000-4000-8000-000000000003',
    tanger: '0b1d0000-0000-4000-8000-000000000004',
  },
  sector: {
    gueliz: '0b1d0000-0000-4000-8000-000000000101',
    medina: '0b1d0000-0000-4000-8000-000000000102',
    palmeraie: '0b1d0000-0000-4000-8000-000000000103',
  },
  template: { v1: '0b1d0000-0000-4000-8000-000000000201' },
  product: {
    preAchat: '0b1d0000-0000-4000-8000-000000000301',
    auditLocatif: '0b1d0000-0000-4000-8000-000000000302',
    vefa: '0b1d0000-0000-4000-8000-000000000303',
  },
} as const;

const box = (w: number, s: number, e: number, n: number) =>
  `${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}`;

export const CITIES = [
  {
    id: IDS.city.marrakech,
    name: 'Marrakech',
    slug: 'marrakech',
    active: true,
    bbox: `POLYGON((${box(-8.1, 31.55, -7.9, 31.72)}))`,
  },
  {
    id: IDS.city.casablanca,
    name: 'Casablanca',
    slug: 'casablanca',
    active: false,
    bbox: `POLYGON((${box(-7.75, 33.45, -7.45, 33.65)}))`,
  },
  {
    id: IDS.city.rabat,
    name: 'Rabat',
    slug: 'rabat',
    active: false,
    bbox: `POLYGON((${box(-6.95, 33.9, -6.75, 34.06)}))`,
  },
  {
    id: IDS.city.tanger,
    name: 'Tanger',
    slug: 'tanger',
    active: false,
    bbox: `POLYGON((${box(-5.95, 35.7, -5.7, 35.82)}))`,
  },
];

// Approximate outlines, to be redrawn by the dispatcher in the back-office.
export const SECTORS = [
  {
    id: IDS.sector.gueliz,
    city_id: IDS.city.marrakech,
    name: 'Guéliz – Hivernage',
    slug: 'gueliz-hivernage',
    wkt: `MULTIPOLYGON(((${box(-8.04, 31.615, -8.0005, 31.655)})))`,
  },
  {
    id: IDS.sector.medina,
    city_id: IDS.city.marrakech,
    name: 'Médina',
    slug: 'medina',
    wkt: `MULTIPOLYGON(((${box(-8.0, 31.61, -7.97, 31.645)})))`,
  },
  {
    id: IDS.sector.palmeraie,
    city_id: IDS.city.marrakech,
    name: 'Palmeraie',
    slug: 'palmeraie',
    wkt: `MULTIPOLYGON(((${box(-8.01, 31.66, -7.93, 31.72)})))`,
  },
];

const OPTIONS = [
  { code: 'bruit_3_horaires', label_i18n: { fr: 'Mesure du bruit à 3 horaires' }, price_mad: 300 },
  {
    code: 'visite_accompagnee',
    label_i18n: { fr: 'Visite accompagnée (visio ou présence)' },
    price_mad: 400,
  },
  { code: 'rapport_ar', label_i18n: { fr: 'Rapport en arabe' }, price_mad: 250 },
  { code: 'rapport_en', label_i18n: { fr: 'Rapport en anglais' }, price_mad: 250 },
];

export const PRODUCTS = [
  {
    id: IDS.product.preAchat,
    slug: 'controle-pre-achat',
    name_i18n: { fr: 'Contrôle pré-achat', en: 'Pre-purchase inspection', ar: 'فحص ما قبل الشراء' },
    description_i18n: {
      fr: 'Inspection technique complète avant achat : 9 blocs, scores, chiffrage des travaux.',
    },
    base_price_mad: 1500,
    duration_min: 120,
    required_skills: ['pre_achat'],
    options: OPTIONS,
    active: true,
    sort_order: 1,
  },
  {
    id: IDS.product.auditLocatif,
    slug: 'audit-locatif',
    name_i18n: { fr: 'Audit locatif', en: 'Rental audit', ar: 'تدقيق الإيجار' },
    description_i18n: {
      fr: 'Contrôle pré-achat + habitabilité + rentabilité locative (moteur Smart BNB).',
    },
    base_price_mad: 2500,
    duration_min: 180,
    required_skills: ['pre_achat', 'locatif'],
    options: OPTIONS.filter((o) => o.code !== 'bruit_3_horaires'),
    active: true,
    sort_order: 2,
  },
  {
    id: IDS.product.vefa,
    slug: 'controle-vefa',
    name_i18n: { fr: 'Contrôle VEFA (livraison neuf)' },
    description_i18n: { fr: 'Contrôle à la livraison d’un bien neuf vendu sur plan.' },
    base_price_mad: 1800,
    duration_min: 150,
    required_skills: ['vefa'],
    options: OPTIONS,
    active: false,
    sort_order: 3,
  },
];

export const PRICING_RULES = [
  {
    label: 'Petite surface < 50 m²',
    surface_min: null,
    surface_max: 50,
    property_type: null,
    multiplier: 0.85,
  },
  {
    label: '120–200 m²',
    surface_min: 120,
    surface_max: 200,
    property_type: null,
    multiplier: 1.25,
  },
  { label: '200–350 m²', surface_min: 200, surface_max: 350, property_type: null, multiplier: 1.5 },
  { label: '≥ 350 m²', surface_min: 350, surface_max: null, property_type: null, multiplier: 2 },
  { label: 'Villa', surface_min: null, surface_max: null, property_type: 'villa', multiplier: 1.2 },
  {
    label: 'Riad (bâti traditionnel)',
    surface_min: null,
    surface_max: null,
    property_type: 'riad',
    multiplier: 1.3,
  },
  {
    label: 'Local commercial',
    surface_min: null,
    surface_max: null,
    property_type: 'local',
    multiplier: 1.1,
  },
];

export const PAYOUT_RULES = [
  {
    product_id: IDS.product.preAchat,
    fixed_mad: 350,
    variable_pct: 0.1,
    bonus_rules: [{ rating_gte: 4.8, bonus_mad: 50 }],
  },
  {
    product_id: IDS.product.auditLocatif,
    fixed_mad: 500,
    variable_pct: 0.1,
    bonus_rules: [{ rating_gte: 4.8, bonus_mad: 75 }],
  },
];

export const TEMPLATE = {
  id: IDS.template.v1,
  key: TEMPLATE_V1.key,
  version: TEMPLATE_V1.version,
  schema: TEMPLATE_V1,
};
export const WORKS = WORKS_CATALOG;

const SLA_STAGES = [
  'payment',
  'assignment',
  'acceptance',
  'scheduling',
  'visit',
  'submission',
  'ai_generation',
  'validation',
  'balance',
];

const NOTIFICATION_COPY: Record<string, [subject: string, body: string]> = {
  order_created: [
    'Votre commande {{ref}} est enregistrée',
    'Bonjour {{name}}, votre commande {{ref}} est enregistrée. Réglez l’acompte pour lancer l’attribution d’un technicien : {{payment_url}}',
  ],
  deposit_received: [
    'Acompte reçu — {{ref}}',
    'Merci ! Nous recherchons le technicien le plus proche. Suivi en temps réel : {{tracking_url}}',
  ],
  order_cancelled_unpaid: [
    'Commande {{ref}} annulée',
    'Faute de paiement de l’acompte sous 72 h, la commande {{ref}} a été annulée.',
  ],
  order_cancelled: [
    'Commande {{ref}} annulée',
    'La commande {{ref}} a été annulée. En cas d’acompte versé, le remboursement est en cours.',
  ],
  mission_offer: [
    'Nouvelle mission {{ref}}',
    'Mission {{product}} à {{sector}}. Répondez dans les 20 minutes : {{offer_url}}',
  ],
  dispatch_exhausted: [
    'Attribution impossible — {{ref}}',
    'Trois techniciens n’ont pas accepté la mission {{ref}}. Attribution manuelle requise.',
  ],
  technician_assigned: [
    'Votre technicien est désigné — {{ref}}',
    '{{technician}} réalisera votre contrôle. Il vous propose un créneau très prochainement.',
  ],
  mission_unassigned: [
    'Mission libérée — {{ref}}',
    'La mission {{ref}} n’a plus de technicien. Réattribution en cours.',
  ],
  visit_scheduled: [
    'Visite confirmée — {{ref}}',
    'Visite prévue le {{date}} à {{time}} ({{timezone}}).',
  ],
  visit_rescheduled: [
    'Visite déplacée — {{ref}}',
    'Nouveau créneau : {{date}} à {{time}} ({{timezone}}).',
  ],
  visit_started: ['Visite en cours — {{ref}}', 'Le technicien est sur place.'],
  inspection_returned: [
    'Compléments demandés — {{ref}}',
    'Le relecteur demande des compléments : {{comment}}',
  ],
  report_to_review: [
    'Rapport à valider — {{ref}}',
    'Le pré-rapport IA de {{ref}} est prêt pour validation.',
  ],
  ai_failed: [
    'Échec génération IA — {{ref}}',
    'La génération du rapport {{ref}} a échoué 3 fois. Intervention requise.',
  ],
  report_delivered: [
    'Votre rapport est disponible — {{ref}}',
    'Votre rapport est prêt : {{report_url}}. Solde à régler : {{balance}} MAD.',
  ],
  rating_request: [
    'Votre avis compte — {{ref}}',
    'Comment s’est passé votre contrôle ? Notez votre expérience : {{rating_url}}',
  ],
  refund_completed: [
    'Remboursement effectué — {{ref}}',
    'Le remboursement de {{amount}} MAD a été effectué.',
  ],
  visit_reminder_d1: [
    'Rappel : visite demain — {{ref}}',
    'Rappel : visite demain à {{time}}, {{address}}.',
  ],
  visit_reminder_h2: [
    'Rappel : visite dans 2 h — {{ref}}',
    'Rappel : visite à {{time}}, {{address}}.',
  ],
};
for (const stage of SLA_STAGES) {
  NOTIFICATION_COPY[`sla_reminder_${stage}`] = [
    `Rappel — {{ref}}`,
    `Rappel ({{stage}}) pour la commande {{ref}}.`,
  ];
  NOTIFICATION_COPY[`sla_breach_${stage}`] = [
    `SLA dépassé ({{stage}}) — {{ref}}`,
    `Le délai « {{stage}} » de {{ref}} est dépassé depuis {{due_at}}.`,
  ];
}
NOTIFICATION_COPY.sla_reminder_payment = [
  'Finalisez votre commande {{ref}}',
  'Votre commande {{ref}} attend le règlement de l’acompte : {{payment_url}}',
];
NOTIFICATION_COPY.sla_reminder_balance = [
  'Solde à régler — {{ref}}',
  'Merci de régler le solde de {{balance}} MAD : {{payment_url}}',
];

export const NOTIFICATION_TEMPLATES = Object.entries(NOTIFICATION_COPY)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([key, [subject, body]]) => [
    { key, channel: 'email', subject, body },
    { key, channel: 'whatsapp', subject: null, body },
  ]);

/** Templates referenced by the state machine side effects. */
export function templatesUsedByStateMachine(): string[] {
  const keys = new Set<string>();
  for (const t of TRANSITIONS)
    for (const e of t.effects) if (e.kind === 'notify') keys.add(e.template);
  return [...keys].sort();
}
