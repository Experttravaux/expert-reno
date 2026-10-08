import type { Severity } from '../domain';
import type { BlockCode } from '../checklist/schema';

/** One evaluated checklist occurrence (room-scoped items appear once per room). */
export interface ScoredItem {
  block: BlockCode;
  code: string;
  room?: string;
  /** null = not answered / not applicable: ignored by scoring. */
  severity: Severity | null;
  /** Explicit estimate set by technician / reviewer (MAD). */
  worksMin?: number | null;
  worksMax?: number | null;
  /** Default range from the template `works_hint`. */
  hint?: { catalog_code?: string | undefined; min_mad: number; max_mad: number } | undefined;
}
