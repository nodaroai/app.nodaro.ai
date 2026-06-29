import { useMemo } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useSnippetPool } from "@/hooks/queries/use-prompt-snippets-queries"
import { getSnippetMedia, getPromptFields } from "@/lib/prompt-fields"
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
 * Modality is read from the node's snippet media (`getSnippetMedia`, the single
 * source of truth in `prompt-fields.ts`), mirroring how the three config-panel
 * families call `useFinalPromptSegments` — so a node of ANY modality routes
 * correctly without a per-type list here:
 * - image (e.g. generate-image) → the `provider` path WITH connected-reference
 *   directives (`buildImageConnectedReferences`), exactly as `image-configs`.
 * - video (e.g. generate-video, image-to-video, switchx) → the `videoProvider`
 *   path: negative-routing prediction, NO `connectedReferences` — exactly as
 *   `video-configs` calls the hook.
 * - audio (e.g. suno-generate, generate-music, text-to-audio, voice-design) →
 *   the provider-LESS path so `useFinalPromptSegments` folds the connected
 *   audio-style pickers (genre / mood / instrumentation / voice) into the Final
 *   prompt EXACTLY as the run does — passing a (fake) image `provider` here was
 *   the inline-prompt-rollout bug that made the canvas "Final" view drop them.
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

  // Modality is the single lever that selects the assembly path. Read it from
  // the snippet media (single source of truth in prompt-fields.ts) so audio and
  // the non-`generate-video` video nodes route correctly too — NOT a hand-kept
  // `nodeType === "generate-video"` check, which forced every other media node
  // onto the image path (the bug that dropped audio-style pickers from Final).
  const media = getSnippetMedia(nodeType) ?? "image"
  const isVideo = media === "video"
  const isAudio = media === "audio"
  const isImage = !isVideo && !isAudio

  // The prompt source field is per-node (suno-style-boost→content,
  // voice-design→voiceDescription, text-to-speech→directText, …); default
  // "prompt" covers image/video and most audio nodes.
  const promptField = getPromptFields(nodeType)?.prompt ?? "prompt"

  const promptSnippets = useSnippetPool(media, "prompt")
  const negativeSnippets = useSnippetPool(media, "negative")

  const sources = useMemo(() => getConnectedSources(nodeId, edges, nodes), [nodeId, edges, nodes])
  const attachedChars = useMemo(() => {
    const ids = (data.characterDefinitionIds as string[] | undefined) ?? []
    return allCharDefs.filter((c) => ids.includes(c.id))
  }, [allCharDefs, data.characterDefinitionIds])

  // Connected image-reference directives exist only on the image path; video and
  // audio carry none (video-configs / audio-configs pass no refs). Deps mirror
  // image-configs' connectedReferences memo for content-stability.
  const connectedReferences = useMemo<ConnectedReference[] | undefined>(
    () =>
      isImage
        ? buildImageConnectedReferences({ data: data as unknown as ConnectedRefsData, sources, nodes, attachedChars })
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isImage, data.referenceImageUrls, data.referenceImageOrder, data.extraRefs, sources, attachedChars, nodes],
  )

  return useFinalPromptSegments({
    userPrompt: data[promptField] as string | undefined,
    // `style` + `identityMeta` are image-only levers; audio's style field is
    // handled inside the audio assembler, not passed here.
    style: isImage ? (data.style as string | undefined) : undefined,
    negativePrompt: data.negativePrompt as string | undefined,
    consumerNodeId: nodeId,
    nodes,
    edges,
    // image → `provider`; video → `videoProvider`; audio → NEITHER, so
    // useFinalPromptSegments takes its audio path and folds the connected
    // audio-style pickers into the Final prompt exactly as the run does.
    ...(isVideo
      ? { videoProvider: (data.provider as string) || "seedance-2-fast" }
      : isImage
        ? { provider: (data.provider as string) || "nano-banana-pro" }
        : {}),
    connectedReferences,
    identityMeta: isImage ? (data.identityMeta as ReadonlyArray<IdentityMeta> | undefined) : undefined,
    snippets: promptSnippets,
    negativeSnippets,
  })
}
