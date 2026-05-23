import { useEffect, useRef } from "react"
import { useUpdateNodeInternals } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { groupHandleId, type AggregateableType } from "@nodaro/shared"

/**
 * Cleans up edges that point at handles a Group/Collect no longer exposes,
 * then triggers React Flow to re-measure. The diff is in-effect (not via
 * deps) because `types` arrives as a memoized array; reference equality
 * from upstream already suppresses re-fires when contents haven't changed.
 */
export function useStaleHandleCleanup(id: string, types: AggregateableType[]): void {
  const updateNodeInternals = useUpdateNodeInternals()
  const prevTypesRef = useRef<AggregateableType[]>([])

  useEffect(() => {
    const prev = prevTypesRef.current
    const same = prev.length === types.length && prev.every((t, i) => t === types[i])
    if (same) return
    const removed = prev.filter((t) => !types.includes(t))
    if (removed.length > 0) {
      const removedHandles = new Set(removed.map(groupHandleId))
      const { edges, deleteEdge } = useWorkflowStore.getState()
      const stale = edges
        .filter((e) => e.source === id && e.sourceHandle && removedHandles.has(e.sourceHandle))
        .map((e) => e.id)
      for (const edgeId of stale) deleteEdge(edgeId)
    }
    prevTypesRef.current = types
    updateNodeInternals(id)
  }, [id, types, updateNodeInternals])
}
