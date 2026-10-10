// Artisan "score Thiqa" /100 (§3), badges, automatic status rules and the
// dispatch ranking of quote requests. Pure: callers load the facts.

import type { PartnerStatus, Trade } from './enums';

export const ARTISAN_SCORE_WEIGHTS = {
  satisfaction: 35,
  reactivity: 20,
  pricing: 20,
  reliability: 15,
  documents: 10,
} as const;
export type ScoreComponent = keyof typeof ARTISAN_SCORE_WEIGHTS;

/** Component value used while there is not enough history. */
export const NEUTRAL = 60;
export const NEW_ARTISAN_SCORE = 60;
export const NEW_ARTISAN_DAYS = 30;
/** A quote is "in range" within ±15 % of the Thiqa estimate. */
export const PRICE_TOLERANCE = 0.15;
export const RECENT_RATINGS = 20;
export const MIN_RATINGS = 3;
export const SUSPEND_SCORE = 50;
export const SUSPEND_MIN_JOBS = 5;
export const SUSPEND_RATING = 3.5;
export const SUSPEND_DISPUTES = 2;
export const DISPUTE_PENALTY = 10;

export type PriceBand = 'below' | 'in' | 'above';

export function priceBand(amount: number, estimate: { min: number; max: number }): PriceBand {
  if (amount < estimate.min * (1 - PRICE_TOLERANCE)) return 'below';
  if (amount > estimate.max * (1 + PRICE_TOLERANCE)) return 'above';
  return 'in';
}

export interface ArtisanFacts {
  /** Client ratings 1–5, most recent first. */
  ratings: readonly number[];
  requestsReceived: number;
  answeredWithin24h: number;
  quotesSent: number;
  quotesInRange: number;
  jobsChosen: number;
  jobsCompleted: number;
  confirmedDisputes: number;
  identityVerified: boolean;
  legalStatusVerified: boolean;
  insuranceVerified: boolean;
}

export interface ArtisanScore {
  score: number;
  components: Record<ScoreComponent, number>;
}

const pct = (part: number, total: number) => (total > 0 ? (100 * part) / total : NEUTRAL);
const clamp = (n: number) => Math.min(100, Math.max(0, n));

export function computeArtisanScore(f: ArtisanFacts): ArtisanScore {
  const recent = f.ratings.slice(0, RECENT_RATINGS);
  const satisfaction =
    recent.length < MIN_RATINGS
      ? NEUTRAL
      : (20 * recent.reduce((a, b) => a + b, 0)) / recent.length;
  const reliability =
    f.jobsChosen > 0
      ? clamp(pct(f.jobsCompleted, f.jobsChosen) - DISPUTE_PENALTY * f.confirmedDisputes)
      : NEUTRAL;
  const components: Record<ScoreComponent, number> = {
    satisfaction: Math.round(satisfaction),
    reactivity: Math.round(pct(f.answeredWithin24h, f.requestsReceived)),
    pricing: Math.round(pct(f.quotesInRange, f.quotesSent)),
    reliability: Math.round(reliability),
    documents:
      10 *
      ((f.identityVerified ? 4 : 0) +
        (f.legalStatusVerified ? 3 : 0) +
        (f.insuranceVerified ? 3 : 0)),
  };
  const score = (Object.keys(ARTISAN_SCORE_WEIGHTS) as ScoreComponent[]).reduce(
    (sum, k) => sum + (ARTISAN_SCORE_WEIGHTS[k] * components[k]) / 100,
    0,
  );
  return { score: Math.round(score), components };
}

export type Badge =
  'verified' | 'insured' | 'fast' | 'fair_price' | 'jobs_10' | 'jobs_50' | 'jobs_100';

export function artisanBadges(f: ArtisanFacts): Badge[] {
  const badges: Badge[] = [];
  if (f.identityVerified && f.legalStatusVerified) badges.push('verified');
  if (f.insuranceVerified) badges.push('insured');
  if (f.requestsReceived >= 5 && pct(f.answeredWithin24h, f.requestsReceived) > 90)
    badges.push('fast');
  if (f.quotesSent >= 5 && pct(f.quotesInRange, f.quotesSent) > 80) badges.push('fair_price');
  const milestone = ([100, 50, 10] as const).find((n) => f.jobsCompleted >= n);
  if (milestone) badges.push(`jobs_${milestone}`);
  return badges;
}

export interface StatusDecision {
  status: PartnerStatus;
  reason: 'low_score' | 'low_rating' | 'disputes' | null;
}

/** Automatic suspension rules; never re-activates (that is an admin decision). */
export function evaluateArtisanStatus(current: PartnerStatus, f: ArtisanFacts): StatusDecision {
  if (current !== 'active') return { status: current, reason: null };
  if (f.confirmedDisputes >= SUSPEND_DISPUTES) return { status: 'suspended', reason: 'disputes' };
  if (f.jobsCompleted >= SUSPEND_MIN_JOBS) {
    const recent = f.ratings.slice(0, RECENT_RATINGS);
    const avg = recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
    if (avg < SUSPEND_RATING) return { status: 'suspended', reason: 'low_rating' };
    if (computeArtisanScore(f).score < SUSPEND_SCORE)
      return { status: 'suspended', reason: 'low_score' };
  }
  return { status: 'active', reason: null };
}

export interface ScoreHint {
  component: ScoreComponent;
  action: 'answer_fast' | 'five_star_job' | 'verify_identity' | 'verify_legal' | 'add_insurance';
  count: number;
  newScore: number;
}

/**
 * What would raise the score (shown to the artisan, never to clients):
 * the smallest number of on-time answers / 5-star jobs to gain ≥ 2 points,
 * and each missing document.
 */
export function scoreHints(f: ArtisanFacts, maxSteps = 20): ScoreHint[] {
  const base = computeArtisanScore(f).score;
  const hints: ScoreHint[] = [];
  const firstGain = (
    component: ScoreComponent,
    action: ScoreHint['action'],
    step: (n: number) => ArtisanFacts,
  ) => {
    for (let n = 1; n <= maxSteps; n++) {
      const s = computeArtisanScore(step(n)).score;
      if (s >= base + 2) {
        hints.push({ component, action, count: n, newScore: s });
        return;
      }
    }
  };
  firstGain('reactivity', 'answer_fast', (n) => ({
    ...f,
    requestsReceived: f.requestsReceived + n,
    answeredWithin24h: f.answeredWithin24h + n,
  }));
  firstGain('satisfaction', 'five_star_job', (n) => ({
    ...f,
    ratings: [...Array<number>(n).fill(5), ...f.ratings],
    jobsChosen: f.jobsChosen + n,
    jobsCompleted: f.jobsCompleted + n,
  }));
  const docs: Array<[keyof ArtisanFacts, ScoreHint['action']]> = [
    ['identityVerified', 'verify_identity'],
    ['legalStatusVerified', 'verify_legal'],
    ['insuranceVerified', 'add_insurance'],
  ];
  for (const [key, action] of docs) {
    if (!f[key]) {
      hints.push({
        component: 'documents',
        action,
        count: 1,
        newScore: computeArtisanScore({ ...f, [key]: true }).score,
      });
    }
  }
  return hints.sort((a, b) => b.newScore - a.newScore);
}

export interface ArtisanCandidate {
  id: string;
  status: PartnerStatus;
  trades: readonly Trade[];
  cityIds: readonly string[];
  score: number;
  responseRate: number;
  inRangeRate: number;
  activatedAt: Date;
}

export const DISPATCH_WEIGHTS = {
  score: 0.4,
  reactivity: 0.3,
  pricing: 0.2,
  seniority: 0.1,
} as const;
export const NEW_ARTISAN_BOOST = 0.05;
export const QUOTES_PER_REQUEST = 3;

/**
 * Picks who receives a quote request: active artisans of the trade in the
 * city, ranked by Thiqa score / reactivity / pricing accuracy / seniority,
 * with a light boost during an artisan's first 30 days.
 */
export function rankArtisans(
  candidates: readonly ArtisanCandidate[],
  request: { trade: Trade; cityId: string; now: Date; exclude?: readonly string[] },
  limit = QUOTES_PER_REQUEST,
): Array<{ id: string; rank: number }> {
  const dayMs = 86_400_000;
  return candidates
    .filter(
      (c) =>
        c.status === 'active' &&
        c.trades.includes(request.trade) &&
        c.cityIds.includes(request.cityId) &&
        !request.exclude?.includes(c.id),
    )
    .map((c) => {
      const days = (request.now.getTime() - c.activatedAt.getTime()) / dayMs;
      const rank =
        DISPATCH_WEIGHTS.score * (c.score / 100) +
        DISPATCH_WEIGHTS.reactivity * c.responseRate +
        DISPATCH_WEIGHTS.pricing * c.inRangeRate +
        DISPATCH_WEIGHTS.seniority * Math.min(1, Math.max(0, days) / 365) +
        (days < NEW_ARTISAN_DAYS ? NEW_ARTISAN_BOOST : 0);
      return { id: c.id, rank: Math.round(rank * 1000) / 1000 };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
}
