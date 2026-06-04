/**
 * Best-effort aspect ratio of the image feeding a node from upstream.
 *
 * Walks the node's incoming edges to the first source node that exposes image
 * dimensions — its active `generatedResults` entry's width/height, or a stored
 * `width`/`height` on the node data (uploads/external) — and returns
 * width / height. Returns `undefined` when nothing upstream has measurable
 * image dimensions yet.
 *
 * This is the middle fallback for `imageNodeSizing`: an image node with no
 * result of its own still previews at the aspect of the image it will
 * transform, instead of defaulting to 16:9. Mirrors the lightweight
 * store-selector pattern of `useUpstreamVideoDuration`. The selector returns a
 * primitive, so a component only re-renders when the resolved aspect changes.
 */

import { useWorkflowStore } from "@/hooks/use-workflow-store"

export function useUpstreamImageAspect(nodeId: string): number | undefined {
  return useWorkflowStore((s) => {
    for (const edge of s.edges) {
      if (edge.target !== nodeId) continue
      const src = s.nodes.find((n) => n.id === edge.source)
      if (!src) continue
      const d = (src.data ?? {}) as Record<string, unknown>
      const results = (d.generatedResults as Array<{ width?: number; height?: number }> | undefined) ?? []
      const idx = (d.activeResultIndex as number | undefined) ?? 0
      const r = results[idx] ?? results[0]
      if (r?.width && r?.height) return r.width / r.height
      const w = d.width as number | undefined
      const h = d.height as number | undefined
      if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) return w / h
    }
    return undefined
  })
}
