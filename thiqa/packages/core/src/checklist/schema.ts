// Declarative checklist template (§4). Rendered dynamically by the technician
// PWA, stored as jsonb in `checklist_templates.schema`.

import { z } from 'zod';
import { PROPERTY_TYPES, PURPOSES, SEVERITIES } from '../domain';
import { RESOLUTIONS, TRADES } from '../marketplace/enums';

export const BLOCK_CODES = ['ADM', 'STR', 'HUM', 'ELE', 'PLB', 'MEN', 'FIN', 'ENV', 'LOC'] as const;
export type BlockCode = (typeof BLOCK_CODES)[number];

export const ITEM_TYPES = ['boolean', 'select', 'number', 'measure', 'text', 'photo'] as const;

const i18n = z.object({
  fr: z.string().min(1),
  ar: z.string().optional(),
  en: z.string().optional(),
});

const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const conditionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('eq'), value: scalar }),
  z.object({ op: z.literal('neq'), value: scalar }),
  z.object({ op: z.literal('in'), value: z.array(scalar).min(1) }),
  z.object({ op: z.literal('lt'), value: z.number() }),
  z.object({ op: z.literal('lte'), value: z.number() }),
  z.object({ op: z.literal('gt'), value: z.number() }),
  z.object({ op: z.literal('gte'), value: z.number() }),
  z.object({ op: z.literal('between'), value: z.tuple([z.number(), z.number()]) }),
  z.object({ op: z.literal('outside'), value: z.tuple([z.number(), z.number()]) }),
]);
export type Condition = z.infer<typeof conditionSchema>;

/** Rules are evaluated in order; the first match wins; no match = green. */
export const severityRuleSchema = z.object({
  when: conditionSchema,
  severity: z.enum(SEVERITIES),
});
export type SeverityRule = z.infer<typeof severityRuleSchema>;

export const worksHintSchema = z
  .object({
    /** Key in `works_catalog`, resolved per city at report time. */
    catalog_code: z
      .string()
      .regex(/^[A-Z0-9_]+$/)
      .optional(),
    min_mad: z.number().nonnegative(),
    max_mad: z.number().nonnegative(),
  })
  .refine((w) => w.max_mad >= w.min_mad, { message: 'max_mad < min_mad' });

export const measureSchema = z
  .object({
    unit: z.string().min(1),
    /** Acceptable range; outside → severity rules (or orange by default). */
    min_ok: z.number().optional(),
    max_ok: z.number().optional(),
    /** Physically possible input range (PWA input validation). */
    input_min: z.number().optional(),
    input_max: z.number().optional(),
  })
  .refine((m) => m.min_ok === undefined || m.max_ok === undefined || m.min_ok <= m.max_ok, {
    message: 'min_ok > max_ok',
  });

export const itemSchema = z
  .object({
    code: z.string().regex(/^(ADM|STR|HUM|ELE|PLB|MEN|FIN|ENV|LOC)_[A-Z0-9_]+$/),
    label_i18n: i18n,
    help_i18n: i18n.optional(),
    type: z.enum(ITEM_TYPES),
    required: z.boolean(),
    photo_min: z.number().int().nonnegative(),
    /** `room`: repeated for each room declared during the visit. */
    scope: z.enum(['property', 'room']),
    /** Can be completed after check-out (e.g. evening noise reading). */
    deferred: z.boolean().optional(),
    options: z
      .array(z.object({ value: z.string().min(1), label_i18n: i18n }))
      .min(2)
      .optional(),
    measure: measureSchema.optional(),
    severity_rules: z.array(severityRuleSchema),
    works_hint: worksHintSchema.optional(),
    /** Default "how to fix" path; derived from works_hint when absent (see defaultResolution). */
    resolution: z.enum(RESOLUTIONS).optional(),
    trade: z.enum(TRADES).optional(),
    /** Practical-solution sheet explaining the problem (slug in `solutions`). */
    solution_slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    applies_to: z.object({
      property_types: z.array(z.enum(PROPERTY_TYPES)).optional(),
      purposes: z.array(z.enum(PURPOSES)).optional(),
    }),
  })
  .superRefine((item, ctx) => {
    if (item.type === 'select' && !item.options) {
      ctx.addIssue({ code: 'custom', message: `${item.code}: select needs options` });
    }
    if (item.type === 'measure' && !item.measure) {
      ctx.addIssue({ code: 'custom', message: `${item.code}: measure needs measure config` });
    }
    if (item.type === 'photo' && item.photo_min < 1) {
      ctx.addIssue({ code: 'custom', message: `${item.code}: photo item needs photo_min >= 1` });
    }
  });
export type ChecklistItem = z.infer<typeof itemSchema>;

export const blockSchema = z.object({
  code: z.enum(BLOCK_CODES),
  label_i18n: i18n,
  order: z.number().int(),
  applies_to: z.object({ purposes: z.array(z.enum(PURPOSES)).optional() }),
});

export const templateSchema = z
  .object({
    key: z.string().min(1),
    version: z.number().int().positive(),
    blocks: z.array(blockSchema).length(BLOCK_CODES.length),
    items: z.array(itemSchema).min(1),
  })
  .superRefine((tpl, ctx) => {
    const codes = new Set<string>();
    for (const item of tpl.items) {
      if (codes.has(item.code)) {
        ctx.addIssue({ code: 'custom', message: `duplicate item code ${item.code}` });
      }
      codes.add(item.code);
    }
  });
export type ChecklistTemplate = z.infer<typeof templateSchema>;
