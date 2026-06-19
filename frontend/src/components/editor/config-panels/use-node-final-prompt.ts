import { useMemo } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useSnippetPool } from "@/hooks/queries/use-prompt-snippets-queries"
import { getSnippetMedia } from "@/lib/prompt-fields"
import { getConnectedSources } from "./helpers"
import { buildImageConnectedReferences, type ConnectedRefsData } from "./connected-references"
import { useFinalPromptSegments, type UseFinalPromptSegmentsResult } from "./use-final-prompt-segments"
import type { ConnectedReference, IdentityMeta } from "@nodaro/shared"

/**
 * Final-prompt assembly for a node BY ID — the SAME machinery the config panel's
 * final view uses (`getConnectedSources` → `buildImageConnectedReferences` →
 * `useFinalPromptSegments`), so the canvas node's "Final" view byte-matches the
 * config panel and what the run sends.
 *
 * - generate-image → the provider (image) path WITH connected-reference
 *   directives (`buildImageConnectedReferences`), exactly as `image-configs`.
 * - generate-video → the provider-less video path: `videoProvider` negative
 *   routing prediction, NO `connectedReferences` — exactly as `video-configs`
 *   calls the hook (it passes no refs).
 *
 * Mount the consumer CONDITIONALLY (only when the Final/Both view is shown) so a
 * canvas full of nodes in plain Edit mode doesn't pay the assembly cost.
 */
export function useNodeFinalPrompt(nodeId: string): UseFinalPromptSegmentsResult {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const allCharDefs = useWorkflowStore((s) => s.characterDefinitions)

  const node = nodes.find((n) => n.id === nodeId)
  const nodeType = node?.type ?? ""
  const data = (node?.data ?? {}) as Record<string, unknown>
  const isVideo = nodeType === "generate-video"

  const media = getSnippetMedia(nodeType) ?? "image"
  const promptSnippets = useSnippetPool(media, "prompt")
  const negativeSnippets = useSnippetPool(media, "negative")

  const sources = useMemo(() => getConnectedSources(nodeId, edges, nodes), [nodeId, edges, nodes])
  const attachedChars = useMemo(() => {
    const ids = (data.characterDefinitionIds as string[] | undefined) ?? []
    return allCharDefs.filter((c) => ids.includes(c.id))
  }, [allCharDefs, data.characterDefinitionIds])

  // Image path mirrors the runtime ref directives; video path is provider-less
  // (no connectedReferences), exactly how video-configs calls the hook. Deps
  // mirror image-configs' connectedReferences memo for content-stability.
  const connectedReferences = useMemo<ConnectedReference[] | undefined>(
    () =>
      isVideo
        ? undefined
        : buildImageConnectedReferences({ data: data as unknown as ConnectedRefsData, sources, nodes, attachedChars }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isVideo, data.referenceImageUrls, data.referenceImageOrder, data.extraRefs, sources, attachedChars, nodes],
  )

  return useFinalPromptSegments({
    userPrompt: data.prompt as string | undefined,
    style: isVideo ? undefined : (data.style as string | undefined),
    negativePrompt: data.negativePrompt as string | undefined,
    consumerNodeId: nodeId,
    nodes,
    edges,
    ...(isVideo
      ? { videoProvider: (data.provider as string) || "seedance-2-fast" }
      : { provider: (data.provider as string) || "nano-banana-pro" }),
    connectedReferences,
    identityMeta: isVideo ? undefined : (data.identityMeta as ReadonlyArray<IdentityMeta> | undefined),
    snippets: promptSnippets,
    negativeSnippets,
  })
}
