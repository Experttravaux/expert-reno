import type { ScoredItem } from './types';
import { computeTechnicalScore } from './technical';

export * from './types';
export * from './technical';
export * from './habitability';
export * from './rental';
export * from './works';

/** Stored on every report so a score can always be reproduced. */
export const SCORING_VERSION = '1.0.0';

export type Recommendation = 'favorable' | 'sous_reserve' | 'defavorable';

/**
 * Rule-based baseline for the purchase recommendation; the AI synthesis
 * argues it and the reviewer has the final word.
 */
export function baselineRecommendation(items: readonly ScoredItem[]): Recommendation {
  if (items.some((i) => i.severity === 'blocking')) return 'defavorable';
  const technical = computeTechnicalScore(items).score;
  const reds = items.filter((i) => i.severity === 'red').length;
  if (technical >= 70 && reds === 0) return 'favorable';
  if (technical < 40) return 'defavorable';
  return 'sous_reserve';
}
