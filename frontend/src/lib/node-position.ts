// frontend/src/lib/node-position.ts
import type { WorkflowNode } from "@/types/nodes"

const COLS = 4
const COL_W = 320
const ROW_H = 220

function hasFinitePosition(n: WorkflowNode): boolean {
  const p = (n as { position?: { x?: unknown; y?: unknown } }).position
  return !!p && Number.isFinite(p.x as number) && Number.isFinite(p.y as number)
}

/**
 * Guarantees every node has a finite `position: {x,y}`. React Flow (xyflow)
 * reads `node.position.x` on adoption and crashes on `undefined`. Studio
 * exports omit positions entirely. Synchronous so it runs before nodes reach
 * `<ReactFlow>`. Missing/non-finite positions get a deterministic grid slot;
 * valid positions are preserved. Never mutates the input array or its nodes.
 */
export function ensureNodePositions(
  nodes: WorkflowNode[],
): { nodes: WorkflowNode[]; filledCount: number } {
  let filledCount = 0
  const out = nodes.map((n, i) => {
    if (hasFinitePosition(n)) return n
    filledCount++
    return {
      ...n,
      position: { x: (i % COLS) * COL_W, y: Math.floor(i / COLS) * ROW_H },
    }
  })
  return { nodes: out, filledCount }
}
