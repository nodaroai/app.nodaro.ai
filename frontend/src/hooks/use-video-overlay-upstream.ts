import { useMemo } from "react"
import { VIDEO_OVERLAY_HANDLE_IDS } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"

export interface VideoOverlayUpstream {
  /** The base video URL (the `video` handle, or the first handle-less wire). */
  readonly base?: string
  /** Wired layer images by handle: [0] ↔ overlay, [1] ↔ overlay2 … sparse when unwired. */
  readonly layers: ReadonlyArray<string | undefined>
  /** Every target handle that has a wire (even if its source has no result yet). */
  readonly connected: ReadonlySet<string>
}

/**
 * What is wired into each of a Video Overlay node's target handles, read
 * through `extractNodeOutput` — the single source of truth the executor uses.
 * The selector returns ONE string (a JSON array of `[handle, url]` pairs) so
 * the component re-renders only when a wire or an upstream result changes.
 * The reserved `layerPlan` id is ignored in v1.
 */
export function useVideoOverlayUpstream(nodeId: string): VideoOverlayUpstream {
  const key = useWorkflowStore((s) => {
    const incoming = s.edges.filter((e) => e.target === nodeId)
    if (incoming.length === 0) return ""
    const byId = new Map(s.nodes.map((n) => [n.id, n]))
    const pairs: Array<readonly [string, string]> = []
    for (const edge of incoming) {
      const src = byId.get(edge.source)
      if (!src) continue
      pairs.push([edge.targetHandle ?? "", extractNodeOutput(src, edge.sourceHandle ?? undefined) ?? ""])
    }
    return JSON.stringify(pairs)
  })
  return useMemo(() => {
    const layers: Array<string | undefined> = []
    const connected = new Set<string>()
    let base: string | undefined
    const pairs = key ? (JSON.parse(key) as Array<[string, string]>) : []
    for (const [handle, rawUrl] of pairs) {
      const url = rawUrl || undefined
      if (handle) connected.add(handle)
      if (handle === "layerPlan") continue
      const idx = (VIDEO_OVERLAY_HANDLE_IDS as readonly string[]).indexOf(handle)
      if (idx >= 0) layers[idx] = url
      else if (handle === "video" || base === undefined) base = url
    }
    return { base, layers, connected }
  }, [key])
}
