import { useStore } from "@xyflow/react"
import { useSurfaceAvailability } from "@/lib/surface-availability"
import { targetHandleShown } from "@/lib/target-handle-availability"

/**
 * Whether a node draws this input pip (`targetHandleShown`): offered to the
 * viewer, or already wired. The wire is looked up in the CANVAS's own edges
 * (React Flow's store), so a read-only template or tutorial canvas — whose
 * edges never enter the workflow store, and which never loads availability —
 * still draws the pip under its wire. Re-renders when the viewer's
 * availability lands (the render re-runs the selector) and when a wire to the
 * pip comes or goes (the selector returns a boolean, so other edge changes do not re-render the node).
 */
export function useTargetHandleShown(nodeId: string, nodeType: string, handleId: string): boolean {
  useSurfaceAvailability()
  return useStore((s) => targetHandleShown(nodeId, nodeType, handleId, s.edges))
}
