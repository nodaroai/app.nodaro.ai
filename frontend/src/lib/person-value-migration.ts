import { migratePersonValue } from "@nodaro/prompts"
import type { WorkflowNode } from "@/types/nodes"

/**
 * One-way, idempotent migration run on workflow load: relocate legacy
 * single-field Person values onto the post-split facial-geometry fields
 * (eyeShape → eyelidType/canthalTilt/eyeSpacing; lips → lipFullness/lipShape).
 *
 * Correctness does NOT depend on this — `buildPersonHints` resolves the legacy
 * ids identically either way. This only keeps the picker UI showing each value
 * in its new home and lets the next save persist the clean shape. Only `person`
 * nodes are touched; every other node is returned by reference unchanged.
 */
export function migratePersonNodes(nodes: ReadonlyArray<WorkflowNode>): WorkflowNode[] {
  return nodes.map((n) => {
    if (n.type !== "person") return n
    const data = (n.data ?? {}) as Record<string, unknown>
    const migrated = migratePersonValue(data)
    if (migrated === data) return n
    return { ...n, data: migrated }
  }) as WorkflowNode[]
}
