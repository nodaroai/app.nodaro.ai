import { useCallback } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

/**
 * Per-field Edit ⇄ Final toggle state, backed by the node's
 * `data.__promptFinalView` array (the field keys currently in final mode).
 *
 * State model (spec: `specs/prompt-field-final-view.md` §State model):
 *  - Absent/empty list ⇒ every field in edit mode (the default).
 *  - Written via the normal `updateNodeData` path → persists with the workflow
 *    and survives reload.
 *  - Excluded from preset capture (`PRESET_EXCLUDED_KEYS` in `@nodaro/shared`).
 *
 * `isFieldFinal` / `toggleFinalView` are exported as pure helpers so the
 * add/remove/dedupe + empty-cleanup logic is unit-testable without a store.
 */

export type PromptFieldMode = "edit" | "final"

/** True iff `fieldKey` is currently in final-view mode for this node's data. */
export function isFieldFinal(
  data: { readonly __promptFinalView?: readonly string[] } | undefined,
  fieldKey: string,
): boolean {
  const list = data?.__promptFinalView
  return Array.isArray(list) && list.includes(fieldKey)
}

/**
 * Toggle `fieldKey`'s presence in the final-view list, returning a NEW list
 * (never mutates the input). Returns `undefined` when the result would be
 * empty so the caller drops the key from node data entirely rather than
 * persisting an empty `[]` (matches the codebase's clear-via-undefined idiom).
 */
export function toggleFinalView(
  list: readonly string[] | undefined,
  fieldKey: string,
): readonly string[] | undefined {
  const current = Array.isArray(list) ? list : []
  const next = current.includes(fieldKey)
    ? current.filter((k) => k !== fieldKey)
    : [...current, fieldKey]
  return next.length > 0 ? next : undefined
}

/**
 * Hook: the per-field mode plus a one-click toggle. Subscribes to the node's
 * `__promptFinalView` so the button re-renders when the mode flips (including
 * from the ⌘E modal, which shares the same node data).
 */
export function usePromptFieldMode(
  nodeId: string,
  fieldKey: string,
): { mode: PromptFieldMode; toggle: () => void } {
  const mode: PromptFieldMode = useWorkflowStore((s) => {
    const data = s.nodes.find((n) => n.id === nodeId)?.data as
      | { __promptFinalView?: readonly string[] }
      | undefined
    return isFieldFinal(data, fieldKey) ? "final" : "edit"
  })

  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const toggle = useCallback(() => {
    const current = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
      ?.data as { __promptFinalView?: readonly string[] } | undefined
    const next = toggleFinalView(current?.__promptFinalView, fieldKey)
    // Writing `undefined` clears the key on the merge (updateNodeData spreads
    // the patch over existing data) — the codebase's idiomatic key-removal.
    updateNodeData(nodeId, { __promptFinalView: next })
  }, [nodeId, fieldKey, updateNodeData])

  return { mode, toggle }
}
