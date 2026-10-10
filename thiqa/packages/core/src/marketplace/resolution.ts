// "Comment le régler" (§1): every orange / red / blocking point gets one of
// three resolution paths. The template gives the default; the technician may
// change it and the reviewer has the last word.

import type { Severity } from '../domain';
import type { ChecklistItem } from '../checklist/schema';
import type { Resolution, Trade } from './enums';

export interface ResolutionPlan {
  resolution: Resolution;
  trade: Trade | null;
  /** 1 easy – 3 hard, only for `diy`. */
  diyLevel: number | null;
  diyMinutes: number | null;
}

/** Works that a careful owner can do without a professional. */
const DIY: Readonly<Record<string, { level: number; minutes: number }>> = {
  HUM_TRAITEMENT_LOCAL: { level: 1, minutes: 240 },
  HUM_VENTILATION: { level: 2, minutes: 120 },
  PLB_JOINTS: { level: 1, minutes: 60 },
  MEN_REGLAGE: { level: 1, minutes: 45 },
  FIN_PEINTURE: { level: 2, minutes: 960 },
  FIN_SECURITE_INCENDIE: { level: 1, minutes: 20 },
};

/** Catalog-code prefix → trade, most specific first. */
const TRADE_BY_PREFIX: ReadonlyArray<[string, Trade]> = [
  ['HUM_ETANCHEITE', 'etancheite'],
  ['HUM_INFILTRATION', 'etancheite'],
  ['HUM_EVAC', 'etancheite'],
  ['HUM_REMONTEES', 'macon'],
  ['HUM_', 'macon'],
  ['ELE_', 'electricien'],
  ['PLB_', 'plombier'],
  ['STR_', 'macon'],
  ['MEN_PORTE', 'serrurier'],
  ['MEN_', 'menuisier'],
  ['FIN_PEINTURE', 'peintre'],
  ['FIN_PLAFOND', 'peintre'],
  ['FIN_SOLS', 'carreleur'],
  ['FIN_SALLE_EAU', 'plombier'],
  ['FIN_CLIMATISATION', 'climaticien'],
  ['FIN_GAZ', 'plombier'],
];

export function tradeFor(catalogCode: string | undefined): Trade {
  if (!catalogCode) return 'autre';
  return TRADE_BY_PREFIX.find(([p]) => catalogCode.startsWith(p))?.[1] ?? 'autre';
}

/**
 * Default plan for an item at a given severity. Green points need nothing.
 * An explicit `resolution` on the template item wins over the heuristics.
 */
export function defaultResolution(
  item: Pick<ChecklistItem, 'code' | 'works_hint' | 'resolution' | 'trade'>,
  severity: Severity | null,
): ResolutionPlan | null {
  if (!severity || severity === 'green') return null;
  const code = item.works_hint?.catalog_code;
  const trade = item.trade ?? tradeFor(code);
  const diy = code ? DIY[code] : undefined;
  const explicit = item.resolution;
  if (explicit === 'legal' || (!explicit && item.code.startsWith('ADM_'))) {
    return { resolution: 'legal', trade: null, diyLevel: null, diyMinutes: null };
  }
  // A dangerous point is never left to the owner, whatever the template says.
  if ((explicit === 'diy' || (!explicit && diy)) && severity !== 'blocking') {
    return {
      resolution: 'diy',
      trade,
      diyLevel: diy?.level ?? 2,
      diyMinutes: diy?.minutes ?? null,
    };
  }
  return { resolution: 'pro', trade, diyLevel: null, diyMinutes: null };
}
