/**
 * Why a restore is locked, in the reviewer's words: one label per check of
 * Apply EDL's render rule (`ApplyEdlIssueCode`), shown as "Can't restore:
 * {label}" in the span popover and in the toast a reason's restore raises
 * (M3 of the inspectors design). The rule's own messages follow it, in
 * English and left-to-right (TA2 item 1): they quote ids and field names.
 *
 * Typed against the code union, so a new check without a label fails tsc.
 */
import type { ApplyEdlIssueCode } from "@nodaro/render-rules"
import { labelOf, tx, type MessageKey, type TFunction } from "@/lib/i18n"

const LOCK_LABELS: Readonly<Record<ApplyEdlIssueCode, MessageKey>> = {
  structural: "edlReview.lock.structural",
  "output-cap": "edlReview.lock.outputCap",
  "unknown-role": "edlReview.lock.unknownRole",
  "missing-url": "edlReview.lock.missingUrl",
  "no-picture": "edlReview.lock.noPicture",
  layout: "edlReview.lock.layout",
  region: "edlReview.lock.region",
  "reads-before-source": "edlReview.lock.readsBeforeSource",
}

/** The label of the check that locks a restore — pass a component's `t`. */
export function restoreLockLabel(code: string, t: TFunction = tx): string {
  return labelOf(LOCK_LABELS, code, t)
}
