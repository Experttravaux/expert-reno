import { describe, expect, it } from 'vitest';
import {
  NEUTRAL,
  artisanBadges,
  computeArtisanScore,
  defaultResolution,
  evaluateArtisanStatus,
  priceBand,
  rankArtisans,
  scoreHints,
  tradeFor,
  type ArtisanCandidate,
  type ArtisanFacts,
} from '../src/marketplace';
import { TEMPLATE_V1 } from '../src/checklist/template-v1';
import { templateSchema, type ChecklistItem } from '../src/checklist/schema';

const item = (code: string, catalog?: string, extra: Partial<ChecklistItem> = {}) =>
  ({
    code,
    works_hint: catalog ? { catalog_code: catalog, min_mad: 1, max_mad: 2 } : undefined,
    ...extra,
  }) as ChecklistItem;

describe('defaultResolution', () => {
  it('needs nothing for green or unanswered points', () => {
    expect(defaultResolution(item('PLB_FUITES', 'PLB_RECHERCHE_FUITE'), 'green')).toBeNull();
    expect(defaultResolution(item('PLB_FUITES', 'PLB_RECHERCHE_FUITE'), null)).toBeNull();
  });

  it('routes administrative points to the notary / seller', () => {
    expect(defaultResolution(item('ADM_HYPOTHEQUE'), 'red')).toEqual({
      resolution: 'legal',
      trade: null,
      diyLevel: null,
      diyMinutes: null,
    });
    expect(
      defaultResolution(item('STR_X', 'STR_ETUDE_BET', { resolution: 'legal' }), 'red')?.resolution,
    ).toBe('legal');
  });

  it('suggests DIY for simple works, never for blocking points', () => {
    expect(defaultResolution(item('HUM_TRACES', 'HUM_TRAITEMENT_LOCAL'), 'orange')).toEqual({
      resolution: 'diy',
      trade: 'macon',
      diyLevel: 1,
      diyMinutes: 240,
    });
    expect(
      defaultResolution(item('HUM_TRACES', 'HUM_TRAITEMENT_LOCAL'), 'blocking')?.resolution,
    ).toBe('pro');
    expect(defaultResolution(item('X_Y', undefined, { resolution: 'diy' }), 'orange')).toEqual({
      resolution: 'diy',
      trade: 'autre',
      diyLevel: 2,
      diyMinutes: null,
    });
  });

  it('defaults to a professional with the right trade', () => {
    expect(defaultResolution(item('ELE_DIFFERENTIEL', 'ELE_DIFFERENTIEL'), 'red')).toEqual({
      resolution: 'pro',
      trade: 'electricien',
      diyLevel: null,
      diyMinutes: null,
    });
    expect(
      defaultResolution(
        item('HUM_X', 'HUM_TRAITEMENT_LOCAL', { resolution: 'pro', trade: 'peintre' }),
        'orange',
      )?.trade,
    ).toBe('peintre');
  });

  it.each([
    [undefined, 'autre'],
    ['HUM_ETANCHEITE_TERRASSE', 'etancheite'],
    ['HUM_REMONTEES_CAPILLAIRES', 'macon'],
    ['MEN_PORTE_BLINDEE', 'serrurier'],
    ['MEN_FENETRE', 'menuisier'],
    ['FIN_SOLS', 'carreleur'],
    ['FIN_CLIMATISATION', 'climaticien'],
    ['LOC_SMARTDECO', 'autre'],
  ])('trade for %s is %s', (code, trade) => expect(tradeFor(code)).toBe(trade));

  it('every orange item of template v1 gets a plan and the template stays valid', () => {
    expect(templateSchema.safeParse(TEMPLATE_V1).success).toBe(true);
    for (const i of TEMPLATE_V1.items)
      expect(defaultResolution(i, 'orange'), i.code).not.toBeNull();
  });
});

const facts = (o: Partial<ArtisanFacts> = {}): ArtisanFacts => ({
  ratings: [],
  requestsReceived: 0,
  answeredWithin24h: 0,
  quotesSent: 0,
  quotesInRange: 0,
  jobsChosen: 0,
  jobsCompleted: 0,
  confirmedDisputes: 0,
  identityVerified: false,
  legalStatusVerified: false,
  insuranceVerified: false,
  ...o,
});

describe('artisan score', () => {
  it('starts neutral for a newcomer', () => {
    const s = computeArtisanScore(facts());
    expect(s.components).toEqual({
      satisfaction: NEUTRAL,
      reactivity: NEUTRAL,
      pricing: NEUTRAL,
      reliability: NEUTRAL,
      documents: 0,
    });
    expect(s.score).toBe(54);
    expect(
      computeArtisanScore(
        facts({ identityVerified: true, legalStatusVerified: true, insuranceVerified: true }),
      ).score,
    ).toBe(64);
  });

  it('weights the five components', () => {
    const s = computeArtisanScore(
      facts({
        ratings: [5, 4, 5, 4],
        requestsReceived: 10,
        answeredWithin24h: 9,
        quotesSent: 10,
        quotesInRange: 8,
        jobsChosen: 4,
        jobsCompleted: 4,
        identityVerified: true,
        legalStatusVerified: true,
      }),
    );
    expect(s.components).toEqual({
      satisfaction: 90,
      reactivity: 90,
      pricing: 80,
      reliability: 100,
      documents: 70,
    });
    expect(s.score).toBe(Math.round(0.35 * 90 + 0.2 * 90 + 0.2 * 80 + 0.15 * 100 + 0.1 * 70));
  });

  it('only counts the 20 most recent ratings and penalises disputes', () => {
    const s = computeArtisanScore(
      facts({
        ratings: [...Array(20).fill(5), ...Array(30).fill(1)],
        jobsChosen: 10,
        jobsCompleted: 10,
        confirmedDisputes: 3,
      }),
    );
    expect(s.components.satisfaction).toBe(100);
    expect(s.components.reliability).toBe(70);
    expect(
      computeArtisanScore(facts({ jobsChosen: 2, jobsCompleted: 0, confirmedDisputes: 5 }))
        .components.reliability,
    ).toBe(0);
  });

  it('classifies quotes against the Thiqa range (±15 %)', () => {
    const est = { min: 1000, max: 2000 };
    expect(priceBand(860, est)).toBe('in');
    expect(priceBand(840, est)).toBe('below');
    expect(priceBand(2300, est)).toBe('in');
    expect(priceBand(2310, est)).toBe('above');
  });

  it('awards badges', () => {
    expect(artisanBadges(facts())).toEqual([]);
    expect(
      artisanBadges(
        facts({
          identityVerified: true,
          legalStatusVerified: true,
          insuranceVerified: true,
          requestsReceived: 10,
          answeredWithin24h: 10,
          quotesSent: 5,
          quotesInRange: 5,
          jobsCompleted: 12,
        }),
      ),
    ).toEqual(['verified', 'insured', 'fast', 'fair_price', 'jobs_10']);
    expect(
      artisanBadges(facts({ jobsCompleted: 120, requestsReceived: 4, answeredWithin24h: 4 })),
    ).toEqual(['jobs_100']);
    expect(artisanBadges(facts({ jobsCompleted: 50 }))).toEqual(['jobs_50']);
  });
});

describe('automatic status', () => {
  const good = facts({
    ratings: [5, 5, 5, 5, 5],
    jobsChosen: 5,
    jobsCompleted: 5,
    requestsReceived: 5,
    answeredWithin24h: 5,
    quotesSent: 5,
    quotesInRange: 5,
  });
  it('keeps good artisans active and leaves non-active statuses alone', () => {
    expect(evaluateArtisanStatus('active', good)).toEqual({ status: 'active', reason: null });
    expect(evaluateArtisanStatus('pending', facts({ confirmedDisputes: 9 }))).toEqual({
      status: 'pending',
      reason: null,
    });
    expect(evaluateArtisanStatus('active', facts({ ratings: [1, 1], jobsCompleted: 2 }))).toEqual({
      status: 'active',
      reason: null,
    });
  });
  it('suspends on disputes, low rating or low score', () => {
    expect(evaluateArtisanStatus('active', facts({ confirmedDisputes: 2 })).reason).toBe(
      'disputes',
    );
    expect(evaluateArtisanStatus('active', { ...good, ratings: [3, 3, 3, 4, 3] }).reason).toBe(
      'low_rating',
    );
    expect(
      evaluateArtisanStatus('active', {
        ...good,
        ratings: [4, 4, 4, 4, 3],
        answeredWithin24h: 0,
        quotesInRange: 0,
        jobsChosen: 10,
      }).reason,
    ).toBe('low_score');
    expect(evaluateArtisanStatus('active', { ...good, ratings: [], jobsCompleted: 5 }).reason).toBe(
      'low_rating',
    );
  });
});

describe('score hints', () => {
  it('tells the artisan what would raise the score, best first', () => {
    const f = facts({
      ratings: [4, 4, 4],
      requestsReceived: 10,
      answeredWithin24h: 5,
      jobsChosen: 3,
      jobsCompleted: 3,
      identityVerified: true,
    });
    const hints = scoreHints(f);
    expect(hints.map((h) => h.action).sort()).toEqual([
      'add_insurance',
      'answer_fast',
      'five_star_job',
      'verify_legal',
    ]);
    const fast = hints.find((h) => h.action === 'answer_fast');
    expect(fast?.count).toBeGreaterThan(0);
    expect(fast?.newScore).toBeGreaterThanOrEqual(computeArtisanScore(f).score + 2);
    expect(hints[0]?.newScore).toBeGreaterThanOrEqual(hints[hints.length - 1]?.newScore ?? 0);
  });
  it('returns nothing when no step helps within the limit', () => {
    const top = facts({
      ratings: Array(20).fill(5),
      requestsReceived: 50,
      answeredWithin24h: 50,
      quotesSent: 10,
      quotesInRange: 10,
      jobsChosen: 10,
      jobsCompleted: 10,
      identityVerified: true,
      legalStatusVerified: true,
      insuranceVerified: true,
    });
    expect(scoreHints(top, 3)).toEqual([]);
  });
});

describe('rankArtisans', () => {
  const now = new Date('2026-10-10');
  const c = (id: string, o: Partial<ArtisanCandidate> = {}): ArtisanCandidate => ({
    id,
    status: 'active',
    trades: ['electricien'],
    cityIds: ['mrk'],
    score: 70,
    responseRate: 0.8,
    inRangeRate: 0.8,
    activatedAt: new Date('2025-01-01'),
    ...o,
  });
  it('filters and ranks the top 3', () => {
    const r = rankArtisans(
      [
        c('a'),
        c('b', { score: 90 }),
        c('c', { responseRate: 0.2 }),
        c('d', { score: 85 }),
        c('off', { status: 'suspended' }),
        c('plumber', { trades: ['plombier'] }),
        c('casa', { cityIds: ['casa'] }),
        c('seen'),
      ],
      { trade: 'electricien', cityId: 'mrk', now, exclude: ['seen'] },
    );
    expect(r.map((x) => x.id)).toEqual(['b', 'd', 'a']);
  });
  it('gives newcomers a light boost and tolerates future activation dates', () => {
    const r = rankArtisans(
      [
        c('old', { activatedAt: new Date('2026-08-01') }),
        c('new', { activatedAt: new Date('2026-10-01') }),
        c('future', { activatedAt: new Date('2027-01-01') }),
      ],
      { trade: 'electricien', cityId: 'mrk', now },
      3,
    );
    expect(r[0]?.id).toBe('new');
    expect(r.find((x) => x.id === 'future')).toBeDefined();
  });
});
