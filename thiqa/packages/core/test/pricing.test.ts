import { describe, expect, it } from 'vitest';
import { computePrice, type PriceInput } from '../src/pricing';

const base: PriceInput = {
  basePriceMad: 1500,
  rules: [
    { cityId: null, propertyType: null, surfaceMin: 120, surfaceMax: 250, multiplier: 1.3 },
    { cityId: null, propertyType: null, surfaceMin: 250, surfaceMax: null, multiplier: 1.7 },
    { cityId: 'mrk', propertyType: 'riad', surfaceMin: null, surfaceMax: null, multiplier: 1.4 },
    { cityId: 'casa', multiplier: 1.1 },
  ],
  cityId: 'mrk',
  propertyType: 'appartement',
  surfaceM2: 80,
  availableOptions: [
    { code: 'bruit_3_horaires', priceMad: 300 },
    { code: 'rapport_en', priceMad: 250 },
  ],
  selectedOptions: [],
};

describe('computePrice', () => {
  it('uses the base price when no rule matches', () => {
    expect(computePrice(base)).toEqual({
      baseMad: 1500,
      multiplier: 1,
      appliedRules: [],
      optionsMad: 0,
      totalMad: 1500,
      depositMad: 750,
      balanceMad: 750,
    });
  });

  it('applies surface bands (upper bound exclusive)', () => {
    expect(computePrice({ ...base, surfaceM2: 120 }).multiplier).toBe(1.3);
    expect(computePrice({ ...base, surfaceM2: 250 }).multiplier).toBe(1.7);
    expect(computePrice({ ...base, surfaceM2: 119 }).multiplier).toBe(1);
  });

  it('stacks multipliers of every matching rule', () => {
    expect(computePrice({ ...base, propertyType: 'riad', surfaceM2: 80 }).multiplier).toBe(1.4);
    const q = computePrice({ ...base, propertyType: 'riad', surfaceM2: 150 });
    expect(q.multiplier).toBe(1.82);
    expect(q.appliedRules).toHaveLength(2);
    expect(q.baseMad).toBe(2730);
    expect(computePrice({ ...base, cityId: 'casa' }).multiplier).toBe(1.1);
    expect(computePrice({ ...base, cityId: 'rabat', propertyType: 'riad' }).multiplier).toBe(1);
  });

  it('adds options and rounds to 10 MAD', () => {
    const q = computePrice({
      ...base,
      basePriceMad: 1234,
      selectedOptions: ['bruit_3_horaires', 'rapport_en'],
    });
    expect(q).toMatchObject({
      baseMad: 1230,
      optionsMad: 550,
      totalMad: 1780,
      depositMad: 890,
      balanceMad: 890,
    });
  });

  it('rejects unknown options', () => {
    expect(() => computePrice({ ...base, selectedOptions: ['vip'] })).toThrow(
      /Unknown product options: vip/,
    );
  });
});
