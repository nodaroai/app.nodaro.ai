/**
 * Builds the prompt-wizard nodeContext for a selected node: which input types
 * are wired in, how many reference images the generation will carry, and
 * whether a source video is attached. Extracted from PromptHelperButton so
 * the counting rules are unit-testable.
 *
 * Counted refs = wired image-producing nodes + wired character images + the
 * node's own manual referenceImageUrls (deduped by URL). @-mention refs are
 * resolved at run time and intentionally not counted here.
 */

import type { MinimalNode, MinimalEdge } from "@nodaro/shared"

const IMAGE_SOURCE_TYPES = new Set([
  "generate-image", "upload-image", "edit-image", "image-to-image",
])

export interface PromptHelperNodeContext {
  connectedInputTypes: string[]
  referenceImageCount: number
  referenceImageUrls: string[]
  hasSourceVideo: boolean
}

function imageUrlFromNode(d: Record<string, unknown>): string | undefined {
  const results = d.generatedResults as Array<{ url: string }> | undefined
  const activeIdx = (d.activeResultIndex as number) ?? 0
  return results?.[activeIdx]?.url ?? (d.generatedImageUrl as string) ?? (d.url as string)
}

// CharacterNodeData carries its portrait as `sourceImageUrl` (types/nodes.ts).
function characterImageUrl(d: Record<string, unknown>): string | undefined {
  return (d.sourceImageUrl as string) ?? (d.generatedImageUrl as string) ?? undefined
}

export function buildPromptHelperNodeContext(
  selectedNodeId: string | null | undefined,
  allNodes: readonly MinimalNode[],
  allEdges: readonly MinimalEdge[],
  nodeType: string | undefined,
): PromptHelperNodeContext | undefined {
  if (!selectedNodeId) return undefined
  if (nodeType === "text-prompt") return undefined // downstream targeting, not upstream context

  const incomingEdges = allEdges.filter((e) => e.target === selectedNodeId)
  const connectedInputTypes: string[] = []
  const referenceImageUrls: string[] = []
  let hasSourceVideo = false

  for (const e of incomingEdges) {
    const sourceNode = allNodes.find((n) => n.id === e.source)
    if (!sourceNode?.type) continue
    connectedInputTypes.push(sourceNode.type)
    const d = (sourceNode.data ?? {}) as Record<string, unknown>
    if (IMAGE_SOURCE_TYPES.has(sourceNode.type)) {
      const u = imageUrlFromNode(d)
      if (u) referenceImageUrls.push(u)
    } else if (sourceNode.type === "character") {
      const u = characterImageUrl(d)
      if (u) referenceImageUrls.push(u)
    }
    if (sourceNode.type.includes("video") || sourceNode.type === "upload-video") hasSourceVideo = true
  }

  // The node's own manually-attached refs ride along too.
  const selected = allNodes.find((n) => n.id === selectedNodeId)
  const manual = ((selected?.data ?? {}) as Record<string, unknown>).referenceImageUrls as
    | Array<{ url?: string }>
    | undefined
  for (const m of manual ?? []) {
    if (typeof m?.url === "string" && m.url.length > 0) referenceImageUrls.push(m.url)
  }

  const deduped = [...new Set(referenceImageUrls)]
  const referenceImageCount = deduped.length
  if (!connectedInputTypes.length && !referenceImageCount && !hasSourceVideo) return undefined
  return { connectedInputTypes, referenceImageCount, referenceImageUrls: deduped, hasSourceVideo }
}
