import { describe, expect, it } from 'vitest';
import { TEMPLATE_V1 } from '../src/checklist/template-v1';
import { BLOCK_CODES, templateSchema, type ChecklistItem } from '../src/checklist/schema';
import { WORKS_CATALOG, catalogEntry } from '../src/checklist/works-catalog';
import {
  combineSeverity,
  itemApplies,
  missingForSubmission,
  ruleSeverity,
} from '../src/checklist/severity';

describe('template v1', () => {
  it('is valid against the schema', () => {
    const parsed = templateSchema.safeParse(TEMPLATE_V1);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it('has at least 120 items across the 9 blocks', () => {
    expect(TEMPLATE_V1.items.length).toBeGreaterThanOrEqual(120);
    for (const block of BLOCK_CODES) {
      expect(
        TEMPLATE_V1.items.filter((i) => i.code.startsWith(`${block}_`)).length,
        block,
      ).toBeGreaterThanOrEqual(10);
    }
  });

  it('covers the mandatory measurements of the brief', () => {
    const codes = new Set(TEMPLATE_V1.items.map((i) => i.code));
    for (const c of [
      'STR_FISSURE_LARGEUR',
      'HUM_HUMIDIMETRE',
      'ELE_DIFFERENTIEL',
      'ELE_TERRE',
      'ELE_PRISES_DEFECTUEUSES',
      'PLB_PRESSION',
      'ENV_BRUIT_MATIN',
      'ENV_BRUIT_APRES_MIDI',
      'ENV_BRUIT_SOIR',
      'ENV_PARKING_TYPE',
      'LOC_REGLEMENT_COPRO',
    ]) {
      expect(codes.has(c), c).toBe(true);
    }
    const pressure = TEMPLATE_V1.items.find((i) => i.code === 'PLB_PRESSION');
    expect(pressure?.measure).toMatchObject({ unit: 'bar', min_ok: 2, max_ok: 4 });
  });

  it('references only known works catalog codes', () => {
    const known = new Set(WORKS_CATALOG.map((w) => w.code));
    for (const item of TEMPLATE_V1.items) {
      if (item.works_hint?.catalog_code)
        expect(known.has(item.works_hint.catalog_code), item.code).toBe(true);
    }
    expect(() => catalogEntry('NOPE')).toThrow(/Unknown works catalog code/);
  });

  it('schema rejects inconsistent items and duplicates', () => {
    const item = TEMPLATE_V1.items[0] as ChecklistItem;
    const bad = {
      ...TEMPLATE_V1,
      items: [item, item, { ...item, code: 'ADM_X', type: 'select', options: undefined }],
    };
    const issues = templateSchema
      .safeParse(bad)
      .error?.issues.map((i) => i.message)
      .join('\n');
    expect(issues).toMatch(/duplicate item code/);
    expect(issues).toMatch(/select needs options/);
    const noMeasure = { ...item, code: 'ADM_Y', type: 'measure', options: undefined };
    const noPhoto = { ...item, code: 'ADM_Z', type: 'photo', photo_min: 0, options: undefined };
    const issues2 = templateSchema
      .safeParse({ ...TEMPLATE_V1, items: [noMeasure, noPhoto] })
      .error?.issues.map((i) => i.message)
      .join('\n');
    expect(issues2).toMatch(/measure needs measure config/);
    expect(issues2).toMatch(/photo item needs photo_min/);
  });
});

describe('ruleSeverity', () => {
  const measure: Pick<ChecklistItem, 'severity_rules' | 'measure'> = {
    severity_rules: [
      { when: { op: 'gt', value: 6 }, severity: 'red' },
      { when: { op: 'lt', value: 1 }, severity: 'red' },
    ],
    measure: { unit: 'bar', min_ok: 2, max_ok: 4 },
  };

  it('returns null when unanswered', () => {
    expect(ruleSeverity(measure, null)).toBeNull();
    expect(ruleSeverity(measure, undefined)).toBeNull();
    expect(ruleSeverity(measure, '')).toBeNull();
  });

  it('applies explicit rules first, then the measure range', () => {
    expect(ruleSeverity(measure, 7)).toBe('red');
    expect(ruleSeverity(measure, 0.5)).toBe('red');
    expect(ruleSeverity(measure, 1.5)).toBe('orange');
    expect(ruleSeverity(measure, 5)).toBe('orange');
    expect(ruleSeverity(measure, 3)).toBe('green');
    expect(ruleSeverity({ severity_rules: [], measure: { unit: 'x' } }, 3)).toBe('green');
    expect(ruleSeverity({ severity_rules: [], measure: { unit: 'x' } }, 'abc')).toBe('green');
  });

  it.each([
    [{ op: 'eq', value: true }, true, 'red'],
    [{ op: 'eq', value: true }, false, 'green'],
    [{ op: 'neq', value: 'ok' }, 'ko', 'red'],
    [{ op: 'neq', value: 'ok' }, 'ok', 'green'],
    [{ op: 'in', value: ['a', 'b'] }, 'b', 'red'],
    [{ op: 'in', value: ['a', 'b'] }, 'c', 'green'],
    [{ op: 'lt', value: 2 }, 1, 'red'],
    [{ op: 'lte', value: 2 }, 2, 'red'],
    [{ op: 'lte', value: 2 }, 3, 'green'],
    [{ op: 'gt', value: 2 }, 2, 'green'],
    [{ op: 'gte', value: 2 }, 2, 'red'],
    [{ op: 'between', value: [1, 3] }, 2, 'red'],
    [{ op: 'between', value: [1, 3] }, 4, 'green'],
    [{ op: 'between', value: [1, 3] }, 0, 'green'],
    [{ op: 'outside', value: [1, 3] }, 0, 'red'],
    [{ op: 'outside', value: [1, 3] }, 4, 'red'],
    [{ op: 'outside', value: [1, 3] }, 2, 'green'],
    [{ op: 'gt', value: 2 }, 'text', 'green'],
  ] as const)('%o with %o → %s', (when, value, expected) => {
    expect(ruleSeverity({ severity_rules: [{ when, severity: 'red' }] } as never, value)).toBe(
      expected,
    );
  });
});

describe('combineSeverity', () => {
  it('lets the reviewer decide', () => {
    expect(combineSeverity({ rule: 'red', technician: 'blocking', reviewer: 'orange' })).toEqual({
      severity: 'orange',
      needsAttention: false,
    });
  });

  it('takes the worst of rule and technician, AI only flags', () => {
    expect(combineSeverity({ rule: 'orange', technician: 'red' })).toEqual({
      severity: 'red',
      needsAttention: false,
    });
    expect(combineSeverity({ rule: 'green', ai: 'red' })).toEqual({
      severity: 'green',
      needsAttention: true,
    });
    expect(combineSeverity({ rule: 'red', ai: 'orange' })).toEqual({
      severity: 'red',
      needsAttention: false,
    });
    expect(combineSeverity({ rule: null, technician: null, ai: null })).toEqual({
      severity: 'green',
      needsAttention: false,
    });
  });
});

describe('itemApplies & missingForSubmission', () => {
  const byCode = (code: string) => TEMPLATE_V1.items.find((i) => i.code === code) as ChecklistItem;

  it('filters by property type and purpose', () => {
    expect(itemApplies(byCode('FIN_ASCENSEUR'), 'appartement', 'residence')).toBe(true);
    expect(itemApplies(byCode('FIN_ASCENSEUR'), 'villa', 'residence')).toBe(false);
    expect(itemApplies(byCode('LOC_REGLEMENT_COPRO'), 'appartement', 'residence')).toBe(false);
    expect(itemApplies(byCode('LOC_REGLEMENT_COPRO'), 'appartement', 'location_courte_duree')).toBe(
      true,
    );
  });

  const tpl = {
    items: [
      byCode('PLB_PRESSION'), // required, property scope
      byCode('HUM_TRACES'), // required, room scope, 1 photo
      byCode('STR_FISSURE_LARGEUR'), // optional, 2 photos once answered
      byCode('ENV_BRUIT_SOIR'), // deferred
      byCode('STR_PHOTOS_ENSEMBLE'), // photo item
      byCode('FIN_ASCENSEUR'), // appartement only
    ],
  };
  const ctx = { propertyType: 'villa', purpose: 'residence', rooms: ['salon', 'ch1'] } as const;

  it('lists required answers and photos', () => {
    expect(missingForSubmission(tpl, {}, ctx)).toEqual([
      { code: 'PLB_PRESSION', reason: 'answer_required' },
      { code: 'HUM_TRACES', room: 'salon', reason: 'answer_required' },
      { code: 'HUM_TRACES', room: 'salon', reason: 'photos_required' },
      { code: 'HUM_TRACES', room: 'ch1', reason: 'answer_required' },
      { code: 'HUM_TRACES', room: 'ch1', reason: 'photos_required' },
      { code: 'STR_PHOTOS_ENSEMBLE', reason: 'photos_required' },
    ]);
  });

  it('is empty when everything is captured', () => {
    expect(
      missingForSubmission(
        tpl,
        {
          PLB_PRESSION: { value: 3 },
          'HUM_TRACES@salon': { value: false, photoCount: 1 },
          'HUM_TRACES@ch1': { value: true, photoCount: 2 },
          STR_PHOTOS_ENSEMBLE: { photoCount: 2 },
        },
        ctx,
      ),
    ).toEqual([]);
  });

  it('requires photos on optional items once answered', () => {
    expect(
      missingForSubmission(
        { items: [byCode('STR_FISSURE_LARGEUR')] },
        { STR_FISSURE_LARGEUR: { value: 1.2 } },
        ctx,
      ),
    ).toEqual([{ code: 'STR_FISSURE_LARGEUR', reason: 'photos_required' }]);
    expect(
      missingForSubmission(
        { items: [byCode('PLB_PRESSION')] },
        { PLB_PRESSION: { value: null } },
        ctx,
      ),
    ).toEqual([{ code: 'PLB_PRESSION', reason: 'answer_required' }]);
    expect(
      missingForSubmission(
        { items: [byCode('PLB_PRESSION')] },
        { PLB_PRESSION: { value: '' } },
        ctx,
      ),
    ).toHaveLength(1);
  });
});
