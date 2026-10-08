import type { Purpose } from '../domain';

/**
 * Estimate source for nightly rate / occupancy — implemented in Phase 3 by the
 * Smart BNB simulator adapter; declared here so scoring stays pure.
 */
export interface RentalEstimateProvider {
  estimate(input: {
    citySlug: string;
    propertyType: string;
    standing: string;
    bedrooms: number;
    surfaceM2: number;
  }): Promise<{ nightlyMad: number; occupancyPct: number; source: string }>;
}

/** Registration + land registry + notary, typical for Morocco (hypothesis). */
export const DEFAULT_ACQUISITION_FEES_PCT = 0.065;
export const DEFAULT_LCD_MANAGEMENT_FEE_PCT = 0.2;
export const DEFAULT_LLD_VACANCY_PCT = 0.05;
/** Net yield giving a 100/100 rental score. */
export const TARGET_NET_YIELD = 0.1;
export const RENTAL_BLOCKING_CAP = 30;

export interface RentalInput {
  purpose: Purpose;
  purchasePriceMad: number;
  /** Midpoint of the works estimate. */
  worksMad: number;
  acquisitionFeesPct?: number;
  /** Copro charges ×12 + local taxes + insurance. */
  annualChargesMad: number;
  shortTerm?: {
    nightlyMad: number;
    /** 0–100 */
    occupancyPct: number;
    managementFeePct?: number;
    /** Utilities, internet, consumables, cleaning not re-billed. */
    annualOpexMad?: number;
  };
  longTerm?: { monthlyRentMad: number; vacancyPct?: number };
  habitabilityScore: number | null;
  /** A blocking point specific to renting (e.g. copro forbids short-term). */
  rentalBlocking: boolean;
}

export interface RentalScore {
  score: number | null;
  capped: boolean;
  investmentMad: number;
  grossRevenueMad: number;
  netRevenueMad: number;
  grossYield: number;
  netYield: number;
  /** Occupancy after the habitability correction (short-term only). */
  adjustedOccupancyPct: number | null;
}

/**
 * Habitability correction: 50/100 is neutral; 0 → ×0.85, 100 → ×1.15.
 * Unknown habitability is neutral.
 */
export function habitabilityFactor(score: number | null): number {
  if (score === null) return 1;
  return 0.85 + (0.3 * Math.min(100, Math.max(0, score))) / 100;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function computeRentalScore(input: RentalInput): RentalScore {
  const fees = input.acquisitionFeesPct ?? DEFAULT_ACQUISITION_FEES_PCT;
  const investment = input.purchasePriceMad * (1 + fees) + input.worksMad;
  const factor = habitabilityFactor(input.habitabilityScore);

  let gross = 0;
  let net = 0;
  let adjustedOccupancyPct: number | null = null;
  let applicable = false;

  if (input.purpose === 'location_courte_duree' && input.shortTerm) {
    const st = input.shortTerm;
    adjustedOccupancyPct = Math.min(95, st.occupancyPct * factor);
    gross = st.nightlyMad * 365 * (adjustedOccupancyPct / 100);
    const mgmt = st.managementFeePct ?? DEFAULT_LCD_MANAGEMENT_FEE_PCT;
    net = gross * (1 - mgmt) - input.annualChargesMad - (st.annualOpexMad ?? 0);
    applicable = true;
  } else if (input.purpose === 'location_longue_duree' && input.longTerm) {
    const lt = input.longTerm;
    const vacancy = lt.vacancyPct ?? DEFAULT_LLD_VACANCY_PCT;
    gross = lt.monthlyRentMad * factor * 12 * (1 - vacancy);
    net = gross - input.annualChargesMad;
    applicable = true;
  }

  const grossYield = investment > 0 ? round4(gross / investment) : 0;
  const netYield = investment > 0 ? round4(net / investment) : 0;
  let score: number | null = null;
  let capped = false;
  if (applicable) {
    score = Math.round(100 * Math.min(1, Math.max(0, netYield / TARGET_NET_YIELD)));
    if (input.rentalBlocking && score > RENTAL_BLOCKING_CAP) {
      score = RENTAL_BLOCKING_CAP;
      capped = true;
    }
  }
  return {
    score,
    capped,
    investmentMad: Math.round(investment),
    grossRevenueMad: Math.round(gross),
    netRevenueMad: Math.round(net),
    grossYield,
    netYield,
    adjustedOccupancyPct:
      adjustedOccupancyPct === null ? null : Math.round(adjustedOccupancyPct * 10) / 10,
  };
}
