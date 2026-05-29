"use client"

import { useEffect } from "react"
import type { ELK as ElkInstance, ElkNode } from "elkjs/lib/elk.bundled.js"
import { useReactFlow } from "@xyflow/react"

// Lazily-instantiated single ELK instance, shared for the lifetime of the
// module — `ELK` is purely stateless across `layout()` calls and reusing the
// instance avoids the (small but real) Worker bootstrap cost on every layout
// invocation. elkjs (~458KB gz) is dynamically imported on first use so it
// stays out of the editor's initial bundle; "Tidy Up" / auto-layout are the
// only consumers and both await `getElk()`.
let _elk: ElkInstance | undefined

export async function getElk(): Promise<ElkInstance> {
  if (!_elk) {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js")
    _elk = new ELK()
  }
  return _elk
}

/**
 * Canonical ELK layered-layout options shared by both the auto-layout hook
 * (live-build during pipeline runs) and the manual Tidy Up button.
 *
 * Kept consistent so a user who has watched a pipeline materialize and then
 * presses Tidy Up sees a layout that's continuous with what was running.
 */
export const ELK_LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "60",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.separateConnectedComponents": "true",
  "elk.spacing.componentComponent": "80",
} as const

/**
 * Debounce window for the live-build auto-layout. Stage 2/3/4 fan-out can
 * insert 5-10 nodes within a few hundred ms; coalescing the layout calls
 * keeps the canvas from thrashing while ELK is still computing the previous
 * layout.
 */
const LAYOUT_DEBOUNCE_MS = 50

interface UseElkLayoutOpts {
  /** When false, the hook is a no-op (no layout calls, no setNodes). */
  readonly enabled: boolean
  /**
   * Bumping this value re-runs the layout. Typical inputs:
   *  - node count (`String(nodes.length)`) — re-runs every time a node is added/removed
   *  - last-added pipeline node id — re-runs on each entity materialization
   *
   * Avoid coupling to viewport/selection state — that would re-layout on
   * every drag and stop the user from positioning nodes by hand.
   */
  readonly triggerKey?: string
}

/**
 * Phase 1B.4 — async ELK auto-layout. Reads the current React Flow nodes/edges,
 * builds an ELK graph (layered, left-to-right), awaits the layout, and writes
 * the resulting positions back via `setNodes`. Cancellation-safe: if
 * `triggerKey` changes again before the previous layout resolves, the older
 * result is dropped.
 *
 * Debounced ({@link LAYOUT_DEBOUNCE_MS}) so burst materializations coalesce
 * into one layout pass — both the timer and the `cancelled` flag protect
 * against stale writes if the trigger changes mid-layout.
 *
 * The hook intentionally reads measured dimensions from `n.measured` when
 * present and falls back to 200×120 — this matches the median scene/entity
 * node size and keeps the initial layout from coalescing under-sized boxes
 * before React Flow has had a chance to measure them. The next layout pass
 * (triggered by any subsequent node add) will see real measurements.
 */
export function useElkLayout(opts: UseElkLayoutOpts) {
  const { getNodes, getEdges, setNodes } = useReactFlow()
  const { enabled, triggerKey } = opts

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        const nodes = getNodes()
        const edges = getEdges()
        if (nodes.length === 0) return
        const elkGraph: ElkNode = {
          id: "root",
          layoutOptions: { ...ELK_LAYOUT_OPTIONS },
          children: nodes.map((n) => ({
            id: n.id,
            width: n.measured?.width ?? 200,
            height: n.measured?.height ?? 120,
          })),
          edges: edges.map((e) => ({
            id: e.id,
            sources: [e.source],
            targets: [e.target],
          })),
        }
        let result: ElkNode
        try {
          const elk = await getElk()
          result = await elk.layout(elkGraph)
        } catch (err) {
          // ELK throws on cycles / disconnected graphs in some configurations.
          // We don't fail the canvas over an auto-layout miss — the user can
          // still drag nodes manually.
          console.error("[use-elk-layout] elk.layout failed:", err)
          return
        }
        if (cancelled) return
        const positionById = new Map<string, { x: number; y: number }>()
        for (const child of result.children ?? []) {
          positionById.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
        }
        setNodes((nds) =>
          nds.map((n) => {
            const pos = positionById.get(n.id)
            if (!pos) return n
            return { ...n, position: pos }
          }),
        )
      })()
    }, LAYOUT_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, triggerKey, getNodes, getEdges, setNodes])
}
