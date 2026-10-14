/**
 * Node fields a run sets for itself alone (decided 2026-10-13): a use-case
 * node's continuation of one of its earlier runs (`useCaseContinue` — an app's
 * or the editor's Render final, an outer run's Continue). They arrive as that
 * run's input override and are never saved (`TRANSIENT_RUNTIME_KEYS`,
 * @nodaro/shared, strips them on every save path); one found on a loaded graph
 * is stale and must never turn a plain run into a continuation of an old run.
 */
import { RUN_ONLY_NODE_FIELDS } from "@nodaro/shared/nodes"

/** The fields (@nodaro/shared, the one list `withRunOverrides` drops too); the override of the run that sets them is the only source. */
export { RUN_ONLY_NODE_FIELDS }

/**
 * Drop the run-only fields from loaded (saved) node data, IN PLACE — a run's
 * own override sets them again afterwards. Applied to every graph a run
 * loads: its own (`applyInputOverridesToNodes`) and its sub-workflows'.
 */
export function dropSavedRunOnlyFields(nodes: ReadonlyArray<{ data?: Record<string, unknown> | null }>): void {
  for (const node of nodes) {
    const data = node.data
    if (!data || !RUN_ONLY_NODE_FIELDS.some((key) => key in data)) continue
    const kept = { ...data }
    for (const key of RUN_ONLY_NODE_FIELDS) delete kept[key]
    ;(node as { data: Record<string, unknown> }).data = kept
  }
}

