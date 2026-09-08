import { useMemo } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { OVERLAY_HANDLE_IDS } from "@/types/nodes"

export interface ImageOverlayUpstream {
  /** The base image URL (the `image` handle, or the first handle-less wire). */
  readonly base?: string
  /** Indexed by handle: [0] ↔ overlay, [1] ↔ overlay2 … sparse when unwired. */
  readonly layers: ReadonlyArray<string | undefined>
  /** Every target handle that has a wire (even if its source has no result yet). */
  readonly connected: ReadonlySet<string>
  /** Text wired into the QR link handle, when its source has a value. */
  readonly qrText?: string
  /** The base's TRUE pixel size when the source knows it (result metadata /
   *  upload dims) — the preview's thumbnail cannot tell. */
  readonly baseSize?: { w: number; h: number }
}

type WireTuple = readonly [handle: string, url: string, w: number, h: number]

/**
 * What is wired into each of an Image Overlay node's target handles. The store
 * selector returns ONE string (a JSON array of `[handle, url, w, h]` tuples —
 * URLs may legally contain any delimiter, so no hand-rolled encoding) and the
 * component re-renders only when a wire or an upstream result changes, not on
 * every canvas tick.
 */
export function useImageOverlayUpstream(nodeId: string): ImageOverlayUpstream {
  const key = useWorkflowStore((s) => {
    const incoming = s.edges.filter((e) => e.target === nodeId)
    if (incoming.length === 0) return ""
    const byId = new Map(s.nodes.map((n) => [n.id, n]))
    const tuples: WireTuple[] = []
    for (const edge of incoming) {
      const src = byId.get(edge.source)
      if (!src) continue
      const url = extractNodeOutput(src, edge.sourceHandle ?? undefined) ?? ""
      const d = (src.data ?? {}) as Record<string, unknown>
      const results = (d.generatedResults as Array<{ width?: number; height?: number }> | undefined) ?? []
      const r = results[(d.activeResultIndex as number | undefined) ?? 0] ?? results[0]
      const w = r?.width ?? (d.width as number | undefined) ?? 0
      const h = r?.height ?? (d.height as number | undefined) ?? 0
      tuples.push([edge.targetHandle ?? "image", url, w, h])
    }
    return JSON.stringify(tuples)
  })
  return useMemo(() => {
    const layers: (string | undefined)[] = []
    const connected = new Set<string>()
    let base: string | undefined
    let baseSize: { w: number; h: number } | undefined
    let qrText: string | undefined
    const tuples: WireTuple[] = key ? (JSON.parse(key) as WireTuple[]) : []
    for (const [handle, rawUrl, w, h] of tuples) {
      const url = rawUrl || undefined
      connected.add(handle)
      if (handle === "qrText") {
        qrText = url
        continue
      }
      const idx = (OVERLAY_HANDLE_IDS as readonly string[]).indexOf(handle)
      if (idx >= 0) {
        layers[idx] = url
      } else if (handle === "image" || base === undefined) {
        base = url
        baseSize = w > 0 && h > 0 ? { w, h } : undefined
      }
    }
    return { base, layers, connected, baseSize, qrText }
  }, [key])
}
