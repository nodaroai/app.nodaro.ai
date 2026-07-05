import { PICKER_TYPES } from "@nodaro/prompts"
import { NODE_DEFINITIONS } from "@/types/nodes"

// Display labels for analyzable picker types, sourced from the canonical
// NODE_DEFINITIONS (the single place each node's label lives) rather than a
// parallel hardcoded map — so a newly-registered picker is labelled and
// hinted automatically with no drift.
const LABEL_BY_TYPE = new Map<string, string>(NODE_DEFINITIONS.map((d) => [d.type, d.label]))

/** Display label for an analyzable picker type (falls back to the raw type). */
export function pickerTypeLabel(t: string): string {
  return LABEL_BY_TYPE.get(t) ?? t
}

/** "Person · Styling · Framing · Lens · Camera / Film Stock" — derived from the
 *  registry's PICKER_TYPES, so the describe-to-picker "connect a picker" hints
 *  stay in sync as analyzable pickers are added. */
export const ANALYZABLE_PICKER_HINT = PICKER_TYPES.map(pickerTypeLabel).join(" · ")
