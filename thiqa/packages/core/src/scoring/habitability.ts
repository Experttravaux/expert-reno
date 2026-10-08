import type { Severity } from '../domain';
import type { AnswerValue } from '../checklist/severity';

export const HABITABILITY_WEIGHTS = {
  noise: 30,
  luminosity: 20,
  parking: 15,
  access: 15,
  environment: 20,
} as const;
type Component = keyof typeof HABITABILITY_WEIGHTS;

/** Evening noise weighs more: it is when residents and guests are home. */
export const NOISE_SLOT_WEIGHTS = { morning: 0.3, afternoon: 0.3, evening: 0.4 } as const;
/** dB(A) at or below QUIET scores full points; at or above LOUD scores zero. */
export const NOISE_QUIET_DB = 40;
export const NOISE_LOUD_DB = 70;

export const PARKING_FACTOR: Record<string, number> = {
  garage_prive: 1,
  residence: 1,
  place_privee: 0.9,
  rue_facile: 0.6,
  rue_difficile: 0.25,
  aucun: 0,
};
export const CAR_ACCESS_FACTOR: Record<string, number> = {
  porte: 1,
  proche: 0.9,
  pieton: 0.6,
  difficile: 0.3,
};
export const ENV_PENALTY: Record<Severity, number> = { green: 0, orange: 4, red: 10, blocking: 20 };

export interface HabitabilityInput {
  noise: {
    morning?: number | undefined;
    afternoon?: number | undefined;
    evening?: number | undefined;
  };
  /** Average natural light rating, 1–5. */
  luminosity?: number | undefined;
  parkingType?: string | undefined;
  parkingDistanceM?: number | undefined;
  /** Access / traffic rating, 1–5. */
  accessRating?: number | undefined;
  carAccess?: string | undefined;
  /** Severities of the other environment items (nuisances, safety, view…). */
  environmentSeverities: ReadonlyArray<Severity | null>;
}

export interface HabitabilityScore {
  /** null when no component could be evaluated. */
  score: number | null;
  weightedNoiseDb: number | null;
  components: Partial<Record<Component, number>>;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function weightedNoise(noise: HabitabilityInput['noise']): number | null {
  let sum = 0;
  let weights = 0;
  for (const slot of ['morning', 'afternoon', 'evening'] as const) {
    const v = noise[slot];
    if (v === undefined) continue;
    sum += v * NOISE_SLOT_WEIGHTS[slot];
    weights += NOISE_SLOT_WEIGHTS[slot];
  }
  return weights === 0 ? null : Math.round((sum / weights) * 10) / 10;
}

export function computeHabitabilityScore(input: HabitabilityInput): HabitabilityScore {
  const c: Partial<Record<Component, number>> = {};
  const W = HABITABILITY_WEIGHTS;

  const db = weightedNoise(input.noise);
  if (db !== null) {
    c.noise = W.noise * clamp01((NOISE_LOUD_DB - db) / (NOISE_LOUD_DB - NOISE_QUIET_DB));
  }
  if (input.luminosity !== undefined) {
    c.luminosity = W.luminosity * clamp01((input.luminosity - 1) / 4);
  }
  if (input.parkingType !== undefined) {
    let f = PARKING_FACTOR[input.parkingType] ?? 0;
    const d = input.parkingDistanceM;
    if (d !== undefined && d > 500) f *= 0.5;
    else if (d !== undefined && d > 200) f *= 0.75;
    c.parking = W.parking * f;
  }
  const accessParts: number[] = [];
  if (input.accessRating !== undefined) accessParts.push(clamp01((input.accessRating - 1) / 4));
  if (input.carAccess !== undefined) accessParts.push(CAR_ACCESS_FACTOR[input.carAccess] ?? 0);
  if (accessParts.length > 0) {
    c.access = (W.access * accessParts.reduce((a, b) => a + b, 0)) / accessParts.length;
  }
  const evaluated = input.environmentSeverities.filter((s): s is Severity => s !== null);
  if (evaluated.length > 0) {
    const penalty = evaluated.reduce((sum, s) => sum + ENV_PENALTY[s], 0);
    c.environment = Math.max(0, W.environment - penalty);
  }

  const keys = Object.keys(c) as Component[];
  if (keys.length === 0) return { score: null, weightedNoiseDb: db, components: c };
  const got = keys.reduce((sum, k) => sum + (c[k] as number), 0);
  const max = keys.reduce((sum, k) => sum + W[k], 0);
  return { score: Math.round((100 * got) / max), weightedNoiseDb: db, components: c };
}

/** Item codes feeding dedicated habitability components (not the generic environment penalty). */
const DEDICATED_ENV_CODES = new Set([
  'ENV_BRUIT_MATIN',
  'ENV_BRUIT_APRES_MIDI',
  'ENV_BRUIT_SOIR',
  'ENV_LUMINOSITE',
  'ENV_PARKING_TYPE',
  'ENV_PARKING_DISTANCE',
  'ENV_ACCES_NOTE',
  'ENV_ACCES_VOITURE',
]);

const num = (v: AnswerValue | undefined) => (typeof v === 'number' ? v : undefined);
const str = (v: AnswerValue | undefined) => (typeof v === 'string' ? v : undefined);

/**
 * Builds the habitability input from raw inspection answers
 * (keys: item code, or `${code}@${room}` for room-scoped items).
 */
export function extractHabitabilityInput(
  answers: Readonly<Record<string, AnswerValue>>,
  severities: Readonly<Record<string, Severity | null>>,
): HabitabilityInput {
  const light = Object.entries(answers)
    .filter(([k, v]) => k.split('@')[0] === 'ENV_LUMINOSITE' && typeof v === 'number')
    .map(([, v]) => v as number);
  return {
    noise: {
      morning: num(answers.ENV_BRUIT_MATIN),
      afternoon: num(answers.ENV_BRUIT_APRES_MIDI),
      evening: num(answers.ENV_BRUIT_SOIR),
    },
    luminosity: light.length ? light.reduce((a, b) => a + b, 0) / light.length : undefined,
    parkingType: str(answers.ENV_PARKING_TYPE),
    parkingDistanceM: num(answers.ENV_PARKING_DISTANCE),
    accessRating: num(answers.ENV_ACCES_NOTE),
    carAccess: str(answers.ENV_ACCES_VOITURE),
    environmentSeverities: Object.entries(severities)
      .filter(([k]) => {
        const code = k.split('@')[0] as string;
        return code.startsWith('ENV_') && !DEDICATED_ENV_CODES.has(code);
      })
      .map(([, s]) => s),
  };
}
