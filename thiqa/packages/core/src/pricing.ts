import type { PropertyType } from './domain';

export const DEPOSIT_RATE = 0.5;

/** Null criteria are wildcards. Mirrors the `pricing_rules` table. */
export interface PricingRule {
  cityId?: string | null;
  propertyType?: PropertyType | null;
  surfaceMin?: number | null;
  /** Exclusive upper bound. */
  surfaceMax?: number | null;
  multiplier: number;
}

export interface ProductOption {
  code: string;
  priceMad: number;
}

export interface PriceInput {
  basePriceMad: number;
  rules: readonly PricingRule[];
  cityId: string;
  propertyType: PropertyType;
  surfaceM2: number;
  availableOptions: readonly ProductOption[];
  selectedOptions: readonly string[];
}

export interface PriceQuote {
  baseMad: number;
  multiplier: number;
  appliedRules: PricingRule[];
  optionsMad: number;
  totalMad: number;
  depositMad: number;
  balanceMad: number;
}

const roundTo10 = (n: number) => Math.round(n / 10) * 10;

function ruleMatches(r: PricingRule, i: PriceInput): boolean {
  if (r.cityId != null && r.cityId !== i.cityId) return false;
  if (r.propertyType != null && r.propertyType !== i.propertyType) return false;
  if (r.surfaceMin != null && i.surfaceM2 < r.surfaceMin) return false;
  if (r.surfaceMax != null && i.surfaceM2 >= r.surfaceMax) return false;
  return true;
}

/**
 * Every matching rule applies and multipliers stack, so each dimension is
 * priced independently (e.g. "riad ×1.4" and "120–250 m² ×1.3").
 */
export function computePrice(input: PriceInput): PriceQuote {
  const appliedRules = input.rules.filter((r) => ruleMatches(r, input));
  const multiplier = Math.round(appliedRules.reduce((m, r) => m * r.multiplier, 1) * 1000) / 1000;
  const unknown = input.selectedOptions.filter(
    (code) => !input.availableOptions.some((o) => o.code === code),
  );
  if (unknown.length) throw new Error(`Unknown product options: ${unknown.join(', ')}`);
  const optionsMad = input.availableOptions
    .filter((o) => input.selectedOptions.includes(o.code))
    .reduce((sum, o) => sum + o.priceMad, 0);
  const baseMad = roundTo10(input.basePriceMad * multiplier);
  const totalMad = baseMad + optionsMad;
  const depositMad = roundTo10(totalMad * DEPOSIT_RATE);
  return {
    baseMad,
    multiplier,
    appliedRules,
    optionsMad,
    totalMad,
    depositMad,
    balanceMad: totalMad - depositMad,
  };
}
