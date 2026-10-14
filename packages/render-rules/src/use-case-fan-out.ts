/**
 * A use-case node with review on cannot run once per list item (decided
 * 2026-10-13). Each item's run would end at a Preview of its own, and a node
 * fed by a list has no Render final (no one run to name), so everything after
 * it would wait for a final that never comes. Both engines refuse it where
 * they fan a node out — from the actual fan-out, before any item's route
 * call: nothing is charged and no wrapper is made.
 */
import { isUseCaseNodeType } from "./use-case-graph"

/** Stable code of the refusal (the node state's `errorCode`). */
export const USE_CASE_REVIEW_LIST_DRIVEN = "use_case_review_list_driven"

/** The refusal's English text (the editor shows its own, localized). */
export const USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE =
  "Review before render isn't available when the node runs once per list item — turn it off to run the list."

/** Is fanning this node out over a list refused? Asked only where an engine fans the node out. */
export function usecaseFanOutRefused(node: { readonly type?: string | null; readonly data?: unknown }): boolean {
  if (!isUseCaseNodeType(node.type)) return false
  const data = node.data && typeof node.data === "object" ? (node.data as { reviewBeforeRender?: unknown }) : {}
  return data.reviewBeforeRender === true
}
