import { describe, expect, it } from 'vitest';
import type { Severity } from '../src/domain';
import type { BlockCode } from '../src/checklist/schema';
import {
  SCORING_VERSION,
  baselineRecommendation,
  computeHabitabilityScore,
  computeRentalScore,
  computeTechnicalScore,
  computeWorksTotal,
  extractHabitabilityInput,
  habitabilityFactor,
  weightedNoise,
  type RentalInput,
  type ScoredItem,
} from '../src/scoring';

const it_ = (
  block: BlockCode,
  severity: Severity | null,
  extra: Partial<ScoredItem> = {},
): ScoredItem => ({
  block,
  code: `${block}_X`,
  severity,
  ...extra,
});

describe('technical score', () => {
  it('is 100 for a flawless property', () => {
    const s = computeTechnicalScore([it_('STR', 'green'), it_('ELE', null)]);
    expect(s).toMatchObject({ score: 100, capped: false });
    expect(s.blocks.STR).toEqual({
      weight: 25,
      score: 25,
      counts: { green: 1, orange: 0, red: 0, blocking: 0 },
    });
  });

  it('applies per-severity penalties within the block weight', () => {
    const s = computeTechnicalScore([it_('STR', 'orange'), it_('ELE', 'red'), it_('ADM', 'red')]);
    expect(s.blocks.STR.score).toBe(22.5);
    expect(s.blocks.ELE.score).toBe(13);
    expect(s.score).toBe(Math.round(22.5 + 20 + 13 + 15 + 10 + 10));
  });

  it('never makes a block negative', () => {
    const s = computeTechnicalScore(Array.from({ length: 5 }, () => it_('PLB', 'red')));
    expect(s.blocks.PLB.score).toBe(0);
  });

  it('caps at 30 on any technical or administrative blocking point', () => {
    expect(computeTechnicalScore([it_('ADM', 'blocking')])).toMatchObject({
      score: 30,
      capped: true,
    });
    expect(computeTechnicalScore([it_('STR', 'blocking')]).score).toBe(30);
    const low = computeTechnicalScore([
      it_('STR', 'blocking'),
      it_('HUM', 'blocking'),
      it_('ELE', 'blocking'),
      it_('PLB', 'blocking'),
    ]);
    expect(low.score).toBe(20);
  });

  it('ignores blocking points of environment / rental blocks', () => {
    expect(computeTechnicalScore([it_('LOC', 'blocking'), it_('ENV', 'blocking')])).toMatchObject({
      score: 100,
      capped: false,
    });
  });
});

describe('habitability score', () => {
  it('weights noise slots, evening heavier', () => {
    expect(weightedNoise({})).toBeNull();
    expect(weightedNoise({ evening: 50 })).toBe(50);
    expect(weightedNoise({ morning: 40, afternoon: 40, evening: 60 })).toBe(48);
  });

  it('returns null when nothing was measured', () => {
    expect(computeHabitabilityScore({ noise: {}, environmentSeverities: [null] })).toEqual({
      score: null,
      weightedNoiseDb: null,
      components: {},
    });
  });

  it('scores a quiet, bright, well-served property 100', () => {
    const s = computeHabitabilityScore({
      noise: { morning: 35, afternoon: 38, evening: 30 },
      luminosity: 5,
      parkingType: 'garage_prive',
      parkingDistanceM: 0,
      accessRating: 5,
      carAccess: 'porte',
      environmentSeverities: ['green', 'green'],
    });
    expect(s.score).toBe(100);
  });

  it('penalises noise, darkness, parking and nuisances', () => {
    const s = computeHabitabilityScore({
      noise: { evening: 75 },
      luminosity: 1,
      parkingType: 'aucun',
      environmentSeverities: ['red', 'blocking'],
    });
    expect(s.components).toEqual({ noise: 0, luminosity: 0, parking: 0, environment: 0 });
    expect(s.score).toBe(0);
  });

  it('renormalises over available components', () => {
    expect(
      computeHabitabilityScore({ noise: { morning: 55 }, environmentSeverities: [] }).score,
    ).toBe(50);
  });

  it.each([
    [undefined, 15],
    [150, 15],
    [300, 11.25],
    [800, 7.5],
  ])('parking distance %s → %s pts', (d, pts) => {
    const s = computeHabitabilityScore({
      noise: {},
      parkingType: 'garage_prive',
      parkingDistanceM: d,
      environmentSeverities: [],
    });
    expect(s.components.parking).toBe(pts);
  });

  it('handles unknown option values as worst case', () => {
    const s = computeHabitabilityScore({
      noise: {},
      parkingType: 'helipad',
      carAccess: 'teleport',
      environmentSeverities: [],
    });
    expect(s.components).toEqual({ parking: 0, access: 0 });
  });

  it('averages access rating and car access', () => {
    expect(
      computeHabitabilityScore({ noise: {}, accessRating: 3, environmentSeverities: [] }).components
        .access,
    ).toBe(7.5);
    expect(
      computeHabitabilityScore({ noise: {}, carAccess: 'pieton', environmentSeverities: [] })
        .components.access,
    ).toBe(9);
    expect(
      computeHabitabilityScore({
        noise: {},
        accessRating: 5,
        carAccess: 'difficile',
        environmentSeverities: [],
      }).components.access,
    ).toBe(9.75);
    expect(
      computeHabitabilityScore({ noise: {}, environmentSeverities: ['orange'] }).components
        .environment,
    ).toBe(16);
  });

  it('extracts inputs from raw answers', () => {
    const input = extractHabitabilityInput(
      {
        ENV_BRUIT_MATIN: 50,
        ENV_BRUIT_SOIR: 'n/a',
        'ENV_LUMINOSITE@salon': 4,
        'ENV_LUMINOSITE@ch1': 2,
        'ENV_LUMINOSITE@sdb': 'x',
        ENV_PARKING_TYPE: 'rue_facile',
        ENV_PARKING_DISTANCE: 50,
        ENV_ACCES_NOTE: 4,
        ENV_ACCES_VOITURE: 'proche',
      },
      {
        ENV_NUISANCE_CAFE: 'orange',
        ENV_BRUIT_MATIN: 'green',
        'ENV_LUMINOSITE@ch1': 'orange',
        HUM_TRACES: 'red',
        ENV_VUE: null,
      },
    );
    expect(input).toEqual({
      noise: { morning: 50, afternoon: undefined, evening: undefined },
      luminosity: 3,
      parkingType: 'rue_facile',
      parkingDistanceM: 50,
      accessRating: 4,
      carAccess: 'proche',
      environmentSeverities: ['orange', null],
    });
    expect(extractHabitabilityInput({}, {}).luminosity).toBeUndefined();
  });
});

describe('rental score', () => {
  const lcd: RentalInput = {
    purpose: 'location_courte_duree',
    purchasePriceMad: 1_000_000,
    worksMad: 35_000,
    annualChargesMad: 6_000,
    shortTerm: { nightlyMad: 800, occupancyPct: 60 },
    habitabilityScore: 50,
    rentalBlocking: false,
  };

  it('corrects with habitability (neutral at 50, clamped)', () => {
    expect(habitabilityFactor(null)).toBe(1);
    expect(habitabilityFactor(50)).toBe(1);
    expect(habitabilityFactor(100)).toBeCloseTo(1.15);
    expect(habitabilityFactor(150)).toBeCloseTo(1.15);
    expect(habitabilityFactor(-10)).toBeCloseTo(0.85);
  });

  it('computes short-term yields with defaults', () => {
    const r = computeRentalScore(lcd);
    expect(r.investmentMad).toBe(1_100_000);
    expect(r.adjustedOccupancyPct).toBe(60);
    expect(r.grossRevenueMad).toBe(175_200);
    expect(r.netRevenueMad).toBe(Math.round(175_200 * 0.8 - 6_000));
    expect(r.grossYield).toBe(0.1593);
    expect(r.netYield).toBe(0.122);
    expect(r).toMatchObject({ score: 100, capped: false });
  });

  it('caps occupancy at 95% and honours explicit fees', () => {
    const r = computeRentalScore({
      ...lcd,
      acquisitionFeesPct: 0,
      habitabilityScore: 100,
      shortTerm: {
        nightlyMad: 500,
        occupancyPct: 90,
        managementFeePct: 0.25,
        annualOpexMad: 20_000,
      },
    });
    expect(r.adjustedOccupancyPct).toBe(95);
    expect(r.netRevenueMad).toBe(Math.round(500 * 365 * 0.95 * 0.75 - 6_000 - 20_000));
  });

  it('computes long-term yields', () => {
    const base = { ...lcd, purpose: 'location_longue_duree' as const, habitabilityScore: null };
    const r = computeRentalScore({ ...base, longTerm: { monthlyRentMad: 6_000 } });
    expect(r.grossRevenueMad).toBe(68_400);
    expect(r.adjustedOccupancyPct).toBeNull();
    expect(r.score).toBe(Math.round((100 * ((68_400 - 6_000) / 1_100_000)) / 0.1));
    expect(
      computeRentalScore({ ...base, longTerm: { monthlyRentMad: 6_000, vacancyPct: 0 } })
        .grossRevenueMad,
    ).toBe(72_000);
  });

  it('caps the score on a rental blocking point', () => {
    expect(computeRentalScore({ ...lcd, rentalBlocking: true })).toMatchObject({
      score: 30,
      capped: true,
    });
    const poor = computeRentalScore({
      ...lcd,
      rentalBlocking: true,
      shortTerm: { nightlyMad: 100, occupancyPct: 30 },
    });
    expect(poor.capped).toBe(false);
    expect(poor.score).toBeLessThan(30);
  });

  it('is not applicable without rental purpose or estimates', () => {
    expect(computeRentalScore({ ...lcd, purpose: 'residence' }).score).toBeNull();
    const { shortTerm: _omit, ...noEstimate } = lcd;
    expect(computeRentalScore(noEstimate).score).toBeNull();
    expect(computeRentalScore({ ...lcd, purpose: 'location_longue_duree' }).score).toBeNull();
    const zero = computeRentalScore({ ...lcd, purchasePriceMad: 0, worksMad: 0 });
    expect(zero).toMatchObject({ grossYield: 0, netYield: 0, score: 0 });
  });
});

describe('works total', () => {
  const hint = (catalog_code: string | undefined, min: number, max: number) => ({
    catalog_code,
    min_mad: min,
    max_mad: max,
  });

  it('sums orange/red/blocking ranges only', () => {
    const w = computeWorksTotal([
      it_('ELE', 'green', { hint: hint('ELE_TERRE', 1500, 4000) }),
      it_('ELE', null, { hint: hint('ELE_TERRE', 1500, 4000) }),
      it_('ELE', 'red', { code: 'ELE_TERRE', hint: hint('ELE_TERRE', 1500, 4000) }),
      it_('PLB', 'orange', { code: 'PLB_FUITES', worksMin: 1234, worksMax: 5678 }),
      it_('STR', 'blocking', { code: 'STR_NOHINT' }),
    ]);
    expect(w.min).toBe(1500 + 1200);
    expect(w.max).toBe(4000 + 5700);
    expect(w.byBlock).toEqual({ ELE: { min: 1500, max: 4000 }, PLB: { min: 1200, max: 5700 } });
  });

  it('counts a shared catalog code once per room, keeping the worst', () => {
    const w = computeWorksTotal([
      it_('ELE', 'red', { code: 'ELE_DIFFERENTIEL', hint: hint('ELE_DIFFERENTIEL', 600, 1500) }),
      it_('ELE', 'orange', {
        code: 'ELE_DIFFERENTIEL_TEST',
        hint: hint('ELE_DIFFERENTIEL', 800, 1200),
      }),
      it_('ELE', 'blocking', {
        code: 'ELE_DIFFERENTIEL_TEST',
        hint: hint('ELE_DIFFERENTIEL', 100, 100),
      }),
      it_('HUM', 'orange', {
        code: 'HUM_TRACES',
        room: 'salon',
        hint: hint('HUM_TRAITEMENT_LOCAL', 2000, 8000),
      }),
      it_('HUM', 'orange', {
        code: 'HUM_TRACES',
        room: 'ch1',
        hint: hint('HUM_TRAITEMENT_LOCAL', 2000, 8000),
      }),
    ]);
    expect(w.lines).toHaveLength(3);
    expect(w.lines[0]).toMatchObject({
      codes: ['ELE_DIFFERENTIEL', 'ELE_DIFFERENTIEL_TEST', 'ELE_DIFFERENTIEL_TEST'],
      severity: 'blocking',
      min: 800,
      max: 1500,
    });
    expect(w.byBlock.HUM).toEqual({ min: 4000, max: 16000 });
  });

  it('applies the city price index to template hints only', () => {
    const items = [
      it_('FIN', 'orange', { code: 'FIN_SOLS', hint: hint('FIN_SOLS', 3000, 12000) }),
      it_('FIN', 'orange', { code: 'FIN_X', hint: hint(undefined, 1000, 2000) }),
      it_('PLB', 'red', { code: 'PLB_X', worksMin: 1000, worksMax: 1000 }),
      it_('PLB', 'red', {
        code: 'PLB_Y',
        worksMin: 500,
        worksMax: null,
        hint: hint('PLB_JOINTS', 300, 1200),
      }),
    ];
    const w = computeWorksTotal(items, { default: 1.2, byCatalogCode: { FIN_SOLS: 1.5 } });
    expect(w.lines.map((l) => [l.key, l.min, l.max])).toEqual([
      ['FIN_SOLS@', 4500, 18000],
      ['FIN_X@', 1200, 2400],
      ['PLB_X@', 1000, 1000],
      ['PLB_JOINTS@', 400, 1400],
    ]);
    expect(computeWorksTotal(items, { byCatalogCode: {} }).min).toBe(3000 + 1000 + 1000 + 300);
  });
});

describe('baseline recommendation', () => {
  it('maps scores to a recommendation', () => {
    expect(SCORING_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(baselineRecommendation([it_('ADM', 'blocking')])).toBe('defavorable');
    expect(baselineRecommendation([it_('FIN', 'orange')])).toBe('favorable');
    expect(baselineRecommendation([it_('FIN', 'red')])).toBe('sous_reserve');
    const reds = (['STR', 'HUM', 'ELE'] as const).flatMap((b) => [
      it_(b, 'red'),
      it_(b, 'red'),
      it_(b, 'red'),
    ]);
    expect(baselineRecommendation(reds)).toBe('defavorable');
  });
});
