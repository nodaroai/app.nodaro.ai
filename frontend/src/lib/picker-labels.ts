import { PICKER_TYPES } from "@nodaro/prompts"
import type { LocaleId } from "@nodaro/shared"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { localizeNodeLabel } from "@/lib/i18n/labels"

// Display labels for analyzable picker types, sourced from the canonical
// NODE_DEFINITIONS (the single place each node's label lives) rather than a
// parallel hardcoded map — so a newly-registered picker is labelled and
// hinted automatically with no drift.
const LABEL_BY_TYPE = new Map<string, string>(NODE_DEFINITIONS.map((d) => [d.type, d.label]))

/** Display label for an analyzable picker type in `locale` (falls back to the raw type). */
export function pickerTypeLabel(t: string, locale: LocaleId = "en"): string {
  const label = LABEL_BY_TYPE.get(t)
  return label === undefined ? t : localizeNodeLabel(label, locale)
}

/** "Person · Styling · Framing · Lens · Camera / Film Stock" in `locale` — derived
 *  from the registry's PICKER_TYPES, so the describe-to-picker "connect a picker"
 *  hints stay in sync as analyzable pickers are added. */
export function analyzablePickerHint(locale: LocaleId): string {
  return PICKER_TYPES.map((type) => pickerTypeLabel(type, locale)).join(" · ")
}
