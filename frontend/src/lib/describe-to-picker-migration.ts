import { isAnalyzablePicker } from "@nodaro/prompts"
import type { WorkflowNode } from "@/types/nodes"

/**
 * One-way, idempotent load migration for describe-to-picker nodes:
 *  - legacy FLAT `generatedPickerJson` (person-only era) → `{ person: <it> }`,
 *    so the new multi-section consumers read the right section instead of
 *    wiping on the next reload.
 *  - drop the dead `targetPicker` field (selection is edge-derived now).
 * Already-nested JSON and clean nodes are returned by reference. Only
 * `describe-to-picker` nodes are touched.
 */
export function migrateDescribeToPickerNodes(nodes: ReadonlyArray<WorkflowNode>): WorkflowNode[] {
  return nodes.map((n) => {
    if (n.type !== "describe-to-picker") return n
    const data = { ...((n.data ?? {}) as Record<string, unknown>) }
    let changed = false
    const json = data.generatedPickerJson as Record<string, unknown> | undefined
    if (json && Object.keys(json).length > 0 && !Object.keys(json).some((k) => isAnalyzablePicker(k))) {
      data.generatedPickerJson = { person: json }
      changed = true
    }
    if ("targetPicker" in data) {
      delete data.targetPicker
      changed = true
    }
    return changed ? ({ ...n, data } as WorkflowNode) : n
  })
}
