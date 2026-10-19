/**
 * Use-case nodes an engine refuses to run once per list item. Both engines
 * refuse them where they fan a node out — from the actual fan-out, before any
 * item's route call: nothing is charged and no wrapper is made.
 *
 *  - A node whose own result is a list (Trailer's formats, Clip Pack's clips;
 *    decided 2026-10-14): one run per recording is already a list, and a list
 *    of lists has nowhere to go. Run it once per recording instead.
 *  - A node with review on (decided 2026-10-13): each item's run would end at
 *    a Preview of its own, and a node fed by a list has no Render final (no
 *    one run to name), so everything after it would wait for a final that
 *    never comes.
 */
import { isUseCaseNodeType } from "./use-case-graph"
import { usecaseDescriptor, usecaseListsItsResult } from "./use-case-registry"

/** Stable code of the review-on refusal (the node state's `errorCode`). */
export const USE_CASE_REVIEW_LIST_DRIVEN = "use_case_review_list_driven"

/** The review-on refusal's English text (the editor shows its own, localized). */
export const USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE =
  "Review before render isn't available when the node runs once per list item — turn it off to run the list."

/** Stable code: a use-case node whose own result is a list, fed by a list. */
export const USE_CASE_LIST_DRIVEN = "use_case_list_driven"

/**
 * Its English text, naming the node type by its English label (decided
 * 2026-10-18; the editor shows its own, localized, with the localized label).
 */
export function usecaseListDrivenMessage(label: string): string {
  return `${label} takes one recording. Use a separate workflow run for each recording.`
}

type FanOutNode = { readonly type?: string | null; readonly data?: unknown }

function reviewOn(node: FanOutNode): boolean {
  const data = node.data && typeof node.data === "object" ? (node.data as { reviewBeforeRender?: unknown }) : {}
  return data.reviewBeforeRender === true
}

/** Is fanning this node out over a list refused? Asked only where an engine fans the node out. */
export function usecaseFanOutRefused(node: FanOutNode): boolean {
  return usecaseFanOutRefusalOf(node) !== null
}

/** The refusal (stable code + English text) for fanning this node out over a list, or null. */
export function usecaseFanOutRefusalOf(node: FanOutNode): { readonly code: string; readonly message: string } | null {
  if (!isUseCaseNodeType(node.type)) return null
  if (usecaseListsItsResult(node.type)) return { code: USE_CASE_LIST_DRIVEN, message: usecaseListDrivenMessage(usecaseDescriptor(node.type).label) }
  if (reviewOn(node)) return { code: USE_CASE_REVIEW_LIST_DRIVEN, message: USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE }
  return null
}
