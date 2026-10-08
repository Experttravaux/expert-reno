import {
  SEVERITY_RANK,
  maxSeverity,
  type PropertyType,
  type Purpose,
  type Severity,
} from '../domain';
import type { ChecklistItem, ChecklistTemplate, Condition } from './schema';

export type AnswerValue = string | number | boolean;

function matches(cond: Condition, value: AnswerValue): boolean {
  switch (cond.op) {
    case 'eq':
      return value === cond.value;
    case 'neq':
      return value !== cond.value;
    case 'in':
      return cond.value.includes(value);
    default:
      break;
  }
  if (typeof value !== 'number') return false;
  switch (cond.op) {
    case 'lt':
      return value < cond.value;
    case 'lte':
      return value <= cond.value;
    case 'gt':
      return value > cond.value;
    case 'gte':
      return value >= cond.value;
    case 'between':
      return value >= cond.value[0] && value <= cond.value[1];
    case 'outside':
      return value < cond.value[0] || value > cond.value[1];
  }
}

/**
 * Severity implied by the template rules for a given answer.
 * Returns null when the item has no answer (not evaluated).
 */
export function ruleSeverity(
  item: Pick<ChecklistItem, 'severity_rules' | 'measure'>,
  value: AnswerValue | null | undefined,
): Severity | null {
  if (value === null || value === undefined || value === '') return null;
  for (const rule of item.severity_rules) {
    if (matches(rule.when, value)) return rule.severity;
  }
  // Measures without an explicit rule: outside the acceptable range → orange.
  if (item.measure && typeof value === 'number') {
    const { min_ok, max_ok } = item.measure;
    if ((min_ok !== undefined && value < min_ok) || (max_ok !== undefined && value > max_ok)) {
      return 'orange';
    }
  }
  return 'green';
}

export interface SeverityInputs {
  rule: Severity | null;
  technician?: Severity | null;
  ai?: Severity | null;
  reviewer?: Severity | null;
}

/**
 * Final severity (§8.1): the reviewer decides; otherwise the most severe of
 * template rule and technician. The AI never decides — it only flags items
 * where it suspects something worse.
 */
export function combineSeverity(input: SeverityInputs): {
  severity: Severity;
  needsAttention: boolean;
} {
  if (input.reviewer) return { severity: input.reviewer, needsAttention: false };
  const severity = maxSeverity(input.rule, input.technician);
  const needsAttention = !!input.ai && SEVERITY_RANK[input.ai] > SEVERITY_RANK[severity];
  return { severity, needsAttention };
}

export function itemApplies(
  item: Pick<ChecklistItem, 'applies_to'>,
  propertyType: PropertyType,
  purpose: Purpose,
): boolean {
  const { property_types, purposes } = item.applies_to;
  if (property_types && !property_types.includes(propertyType)) return false;
  if (purposes && !purposes.includes(purpose)) return false;
  return true;
}

export interface CapturedItem {
  value?: AnswerValue | null;
  photoCount?: number;
}

export interface MissingItem {
  code: string;
  room?: string;
  reason: 'answer_required' | 'photos_required';
}

/**
 * Lists what blocks submission (§7): required answers and minimum photos.
 * `captured` is keyed by item code (property scope) or `${code}@${room}` (room scope).
 * Deferred items (e.g. evening noise reading) do not block submission.
 * Photo items are "answered" by their photos only.
 */
export function missingForSubmission(
  template: Pick<ChecklistTemplate, 'items'>,
  captured: Readonly<Record<string, CapturedItem>>,
  ctx: { propertyType: PropertyType; purpose: Purpose; rooms: readonly string[] },
): MissingItem[] {
  const missing: MissingItem[] = [];
  for (const item of template.items) {
    if (item.deferred || !itemApplies(item, ctx.propertyType, ctx.purpose)) continue;
    const keys: Array<{ key: string; room?: string }> =
      item.scope === 'room'
        ? ctx.rooms.map((room) => ({ key: `${item.code}@${room}`, room }))
        : [{ key: item.code }];
    for (const { key, room } of keys) {
      const c = captured[key];
      const base = room === undefined ? { code: item.code } : { code: item.code, room };
      const answered = c?.value !== undefined && c.value !== null && c.value !== '';
      if (item.required && item.type !== 'photo' && !answered) {
        missing.push({ ...base, reason: 'answer_required' });
      }
      // Photos are imposed on required items, and on optional ones once answered.
      const needsPhotos = item.required || answered;
      if (needsPhotos && (c?.photoCount ?? 0) < item.photo_min) {
        missing.push({ ...base, reason: 'photos_required' });
      }
    }
  }
  return missing;
}
