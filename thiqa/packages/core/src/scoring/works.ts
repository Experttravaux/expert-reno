import type { Severity } from '../domain';
import type { BlockCode } from '../checklist/schema';
import type { ScoredItem } from './types';

const COSTED: ReadonlySet<Severity> = new Set(['orange', 'red', 'blocking']);

/** City price index relative to the Marrakech baseline catalog (1 = baseline). */
export interface PriceIndex {
  default?: number;
  byCatalogCode?: Readonly<Record<string, number>>;
}

export interface WorksLine {
  key: string;
  block: BlockCode;
  codes: string[];
  severity: Severity;
  min: number;
  max: number;
}

export interface WorksTotal {
  min: number;
  max: number;
  byBlock: Partial<Record<BlockCode, { min: number; max: number }>>;
  lines: WorksLine[];
}

const roundTo100 = (n: number) => Math.round(n / 100) * 100;

/**
 * Sums works ranges for orange/red/blocking items (§5).
 * Explicit estimates win over template hints (adjusted by the city index).
 * Items sharing a catalog code in the same room/property are counted once
 * (e.g. "no RCD" and "RCD test failed" both cost one RCD).
 */
export function computeWorksTotal(
  items: readonly ScoredItem[],
  index: PriceIndex = {},
): WorksTotal {
  const groups = new Map<string, WorksLine>();
  for (const item of items) {
    if (!item.severity || !COSTED.has(item.severity)) continue;
    let min: number;
    let max: number;
    if (item.worksMin != null && item.worksMax != null) {
      min = item.worksMin;
      max = item.worksMax;
    } else if (item.hint) {
      const code = item.hint.catalog_code;
      const f = (code && index.byCatalogCode?.[code]) || index.default || 1;
      min = item.hint.min_mad * f;
      max = item.hint.max_mad * f;
    } else {
      continue;
    }
    const key = `${item.hint?.catalog_code ?? item.code}@${item.room ?? ''}`;
    const existing = groups.get(key);
    if (existing) {
      existing.codes.push(item.code);
      existing.min = Math.max(existing.min, min);
      existing.max = Math.max(existing.max, max);
      if (rank(item.severity) > rank(existing.severity)) existing.severity = item.severity;
    } else {
      groups.set(key, {
        key,
        block: item.block,
        codes: [item.code],
        severity: item.severity,
        min,
        max,
      });
    }
  }
  const lines = [...groups.values()].map((l) => ({
    ...l,
    min: roundTo100(l.min),
    max: roundTo100(l.max),
  }));
  const byBlock: WorksTotal['byBlock'] = {};
  let min = 0;
  let max = 0;
  for (const l of lines) {
    const b = (byBlock[l.block] ??= { min: 0, max: 0 });
    b.min += l.min;
    b.max += l.max;
    min += l.min;
    max += l.max;
  }
  return { min, max, byBlock, lines };
}

const rank = (s: Severity) => ['green', 'orange', 'red', 'blocking'].indexOf(s);
