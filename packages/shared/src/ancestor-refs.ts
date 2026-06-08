/**
 * Ancestor reference image collection — traverses upstream nodes to find
 * image-producing ancestors, with passthrough for text/logic nodes.
 * Shared between frontend and backend via a callback for extracting image URLs.
 */

import type { GenericNode, GenericEdge } from "./types.js"

// Node types that produce reference images
export const IMAGE_REF_TYPES = new Set([
  "upload-image", "face", "character", "object", "creature", "location",
  "generate-image", "edit-image", "image-to-image",
])

// Node types that pass through (don't produce images but connect to ancestors that do)
export const PASSTHROUGH_TYPES = new Set([
  "ai-writer", "llm-chat", "split-text", "combine-text", "text-prompt", "list",
])

/**
 * Collect reference image URLs from upstream ancestor nodes.
 * @param getImageUrl - Callback to extract an image URL from a node. Frontend uses
 *   extractNodeOutput(), backend uses nodeStates[id]?.output?.imageUrl.
 */
export function collectAncestorRefs<N extends GenericNode, E extends GenericEdge>(
  nodeId: string,
  nodes: N[],
  edges: E[],
  getImageUrl: (node: N) => string | undefined,
  visited = new Set<string>(),
): string[] {
  if (visited.has(nodeId)) return []
  visited.add(nodeId)
  const refs: string[] = []
  const incoming = edges.filter((e) => e.target === nodeId)
  for (const edge of incoming) {
    const src = nodes.find((n) => n.id === edge.source)
    if (!src) continue
    if (IMAGE_REF_TYPES.has(src.type)) {
      const url = getImageUrl(src)
      if (url?.trim()) refs.push(url.trim())
    }
    if (PASSTHROUGH_TYPES.has(src.type)) {
      refs.push(...collectAncestorRefs(src.id, nodes, edges, getImageUrl, visited))
    }
  }
  return refs
}
