import { useCallback, useMemo } from "react"
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react"
import { useReactFlow } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowNode } from "@/types/nodes"

type Direction = "left" | "right" | "up" | "down"

/**
 * Find the nearest node in the given direction using a 90-degree cone filter.
 * React Flow coords: x-right, y-down.
 */
export function findNearestNode(
  originId: string,
  direction: Direction,
  nodes: readonly WorkflowNode[],
): { id: string; label: string } | null {
  const origin = nodes.find((n) => n.id === originId)
  if (!origin) return null

  const ox = origin.position.x
  const oy = origin.position.y

  let best: { id: string; label: string; dist: number } | null = null

  for (const node of nodes) {
    if (node.id === originId) continue
    if (node.type === "sticky-note") continue
    if ((node.data as Record<string, unknown>).hidden) continue

    const dx = node.position.x - ox
    const dy = node.position.y - oy

    // 90-degree cone: primary axis must dominate
    let inCone = false
    switch (direction) {
      case "right": inCone = dx > 0 && Math.abs(dy) <= dx; break
      case "left":  inCone = dx < 0 && Math.abs(dy) <= Math.abs(dx); break
      case "down":  inCone = dy > 0 && Math.abs(dx) <= dy; break
      case "up":    inCone = dy < 0 && Math.abs(dx) <= Math.abs(dy); break
    }
    if (!inCone) continue

    const dist = Math.sqrt(dx * dx + dy * dy)
    if (!best || dist < best.dist) {
      const label = (node.data as Record<string, unknown>).label as string || node.type || "Node"
      best = { id: node.id, label, dist }
    }
  }

  return best ? { id: best.id, label: best.label } : null
}

interface FocusModeNavProps {
  readonly selectedNodeId: string
  readonly onNavigate: (nodeId: string) => void
}

export function FocusModeNav({ selectedNodeId, onNavigate }: FocusModeNavProps) {
  const nodes = useWorkflowStore((s) => s.nodes)

  const neighbors = useMemo(() => ({
    left: findNearestNode(selectedNodeId, "left", nodes),
    right: findNearestNode(selectedNodeId, "right", nodes),
    up: findNearestNode(selectedNodeId, "up", nodes),
    down: findNearestNode(selectedNodeId, "down", nodes),
  }), [selectedNodeId, nodes])

  const hasAny = neighbors.left || neighbors.right || neighbors.up || neighbors.down
  if (!hasAny) return null

  return (
    <>
      {neighbors.left && (
        <button
          type="button"
          onClick={() => onNavigate(neighbors.left!.id)}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-40 w-10 h-10 flex items-center justify-center rounded-full bg-black/30 dark:bg-white/15 backdrop-blur-sm text-white active:bg-black/50 dark:active:bg-white/30 transition-colors touch-manipulation"
          aria-label={`Navigate left to ${neighbors.left.label}`}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}
      {neighbors.right && (
        <button
          type="button"
          onClick={() => onNavigate(neighbors.right!.id)}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-40 w-10 h-10 flex items-center justify-center rounded-full bg-black/30 dark:bg-white/15 backdrop-blur-sm text-white active:bg-black/50 dark:active:bg-white/30 transition-colors touch-manipulation"
          aria-label={`Navigate right to ${neighbors.right.label}`}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}
      {neighbors.up && (
        <button
          type="button"
          onClick={() => onNavigate(neighbors.up!.id)}
          className="absolute top-[28%] left-1/2 -translate-x-1/2 z-40 w-10 h-10 flex items-center justify-center rounded-full bg-black/30 dark:bg-white/15 backdrop-blur-sm text-white active:bg-black/50 dark:active:bg-white/30 transition-colors touch-manipulation"
          aria-label={`Navigate up to ${neighbors.up.label}`}
        >
          <ChevronUp className="w-5 h-5" />
        </button>
      )}
      {neighbors.down && (
        <button
          type="button"
          onClick={() => onNavigate(neighbors.down!.id)}
          className="absolute bottom-[calc(15vh+12px)] left-1/2 -translate-x-1/2 z-40 w-10 h-10 flex items-center justify-center rounded-full bg-black/30 dark:bg-white/15 backdrop-blur-sm text-white active:bg-black/50 dark:active:bg-white/30 transition-colors touch-manipulation"
          aria-label={`Navigate down to ${neighbors.down.label}`}
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      )}
    </>
  )
}
