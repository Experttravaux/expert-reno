import type { Severity } from '../domain';
import type { BlockCode } from '../checklist/schema';
import type { ScoredItem } from './types';

export const TECHNICAL_WEIGHTS = { STR: 25, HUM: 20, ELE: 20, PLB: 15, MEN: 10, FIN: 10 } as const;
type TechnicalBlock = keyof typeof TECHNICAL_WEIGHTS;

/** Share of the block weight removed per item, by severity. */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  green: 0,
  orange: 0.1,
  red: 0.35,
  blocking: 1,
};

/** Any blocking point (technical blocks or administrative) caps the score. */
export const BLOCKING_CAP = 30;
const CAP_SOURCES: readonly BlockCode[] = ['ADM', 'STR', 'HUM', 'ELE', 'PLB', 'MEN', 'FIN'];

export interface BlockScore {
  weight: number;
  score: number;
  counts: Record<Severity, number>;
}

export interface TechnicalScore {
  score: number;
  capped: boolean;
  blocks: Record<TechnicalBlock, BlockScore>;
}

const isTechnical = (b: BlockCode): b is TechnicalBlock => b in TECHNICAL_WEIGHTS;

export function computeTechnicalScore(items: readonly ScoredItem[]): TechnicalScore {
  const blocks = {} as Record<TechnicalBlock, BlockScore>;
  for (const [code, weight] of Object.entries(TECHNICAL_WEIGHTS) as [TechnicalBlock, number][]) {
    blocks[code] = { weight, score: weight, counts: { green: 0, orange: 0, red: 0, blocking: 0 } };
  }
  let capped = false;
  for (const item of items) {
    if (!item.severity) continue;
    if (item.severity === 'blocking' && CAP_SOURCES.includes(item.block)) capped = true;
    if (isTechnical(item.block)) blocks[item.block].counts[item.severity] += 1;
  }
  let total = 0;
  for (const block of Object.values(blocks)) {
    const penalty = (Object.keys(block.counts) as Severity[]).reduce(
      (sum, sev) => sum + block.counts[sev] * SEVERITY_PENALTY[sev],
      0,
    );
    block.score = round1(block.weight * Math.max(0, 1 - penalty));
    total += block.score;
  }
  const score = Math.round(capped ? Math.min(total, BLOCKING_CAP) : total);
  return { score, capped, blocks };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
