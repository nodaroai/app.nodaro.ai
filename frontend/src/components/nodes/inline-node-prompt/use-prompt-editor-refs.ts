import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getUpstreamNodes, buildNodeRefMap } from "@/lib/node-refs"
import {
  buildImageConnectedReferences,
  connectedReferencesToRefImages,
  type ConnectedRefsData,
} from "@/components/editor/config-panels/connected-references"
import { getConnectedSources } from "@/components/editor/config-panels/helpers"
import {
  buildVideoRefVideoAutocomplete,
  buildVideoRefAudioAutocomplete,
} from "@/components/editor/config-panels/video-audio-ref-items"
import { getSnippetMedia } from "@/lib/prompt-fields"
import { useSnippetPool } from "@/hooks/queries/use-prompt-snippets-queries"
import type { RefImageItem } from "@/components/editor/config-panels/tag-textarea"
import type { NodeRefItem } from "@/lib/node-refs"

export interface PromptEditorRefs {
  readonly referenceImages: readonly RefImageItem[]
  readonly nodeRefs: readonly NodeRefItem[]
  readonly refMap: ReadonlyMap<string, string>
  readonly promptSnippets: ReturnType<typeof useSnippetPool>
}

/**
 * Single source for the four `<PromptEditor>` inputs (referenceImages, nodeRefs,
 * refMap, promptSnippets) for a node id. Reused by the inline canvas editor, the
 * quick-edit modal, and the config panels so they never drift.
 *
 * Memoized off a PRIMITIVE topology fingerprint (upstream id|label|type) — NOT a
 * raw nodes/edges subscription — so that with many inline editors mounted at
 * once, none re-runs the graph BFS on every keystroke/drag frame. Mirrors the
 * text-prompt-node.tsx primitive-key pattern.
 */
export function usePromptEditorRefs(nodeId: string): PromptEditorRefs {
  // Primitive fingerprint of this node's data + upstream topology. Changes only
  // on real edits, not on unrelated store churn.
  const { nodeType, dataKey, topoKey, charsKey } = useWorkflowStore(
    useShallow((s) => {
      const node = s.nodes.find((n) => n.id === nodeId)
      const data = (node?.data ?? {}) as Record<string, unknown>
      const incoming = s.edges.filter((e) => e.target === nodeId)
      const attachedIds = (data.characterDefinitionIds as readonly string[] | undefined) ?? []
      return {
        nodeType: (node?.type ?? "") as string,
        // JSON of the ref-bearing data fields only (cheap + stable).
        dataKey: JSON.stringify({
          ref: data.referenceImageUrls ?? null,
          chars: data.characterDefinitionIds ?? null,
          extra: data.extraRefs ?? null,
        }),
        topoKey: incoming
          .map((e) => `${e.source}${e.sourceHandle ?? ""}${e.targetHandle ?? ""}`)
          .sort()
          .join(""),
        // Content signature of ONLY the ATTACHED character definitions, so the
        // memo re-fires when an attached def is EDITED IN PLACE (new
        // referenceImageUrl, renamed, recategorized) — a count alone (the old
        // String(length)) would miss those, leaving the @-list stale here and
        // in the quick-edit modal (which shares this hook). Attach/detach is
        // already covered by dataKey (characterDefinitionIds). We sign only the
        // CharacterDefinition fields buildImageConnectedReferences actually
        // reads off `attachedChars` — type/referenceImageUrl gate appearance,
        // name drives the @-mention slug, category picks the source. Attached
        // defs are few, so this is cheap.
        charsKey: attachedIds
          .map((id) => {
            const def = s.characterDefinitions.find((c) => c.id === id)
            return `${id}:${def?.type ?? ""}:${def?.referenceImageUrl ?? ""}:${def?.name ?? ""}:${def?.category ?? ""}`
          })
          .join("|"),
      }
    }),
  )

  const snippetMedia = getSnippetMedia(nodeType)
  const promptSnippets = useSnippetPool(snippetMedia, "prompt")

  return useMemo(() => {
    const state = useWorkflowStore.getState()
    const node = state.nodes.find((n) => n.id === nodeId)
    if (!node) {
      return { referenceImages: [], nodeRefs: [], refMap: new Map(), promptSnippets }
    }
    // AUDIT-CORRECTED call shapes (verified vs prompt-quick-edit-modal.tsx:185-201):
    //  - getConnectedSources(nodeId, EDGES, NODES) — edges before nodes
    //  - buildImageConnectedReferences({ data, sources, nodes, attachedChars }) —
    //    NO nodeId/edges; attachedChars REQUIRED or attached-definition refs vanish.
    const data = node.data as Record<string, unknown>
    const attachedIds = (data.characterDefinitionIds as readonly string[] | undefined) ?? []
    const attachedChars = state.characterDefinitions.filter((c) => attachedIds.includes(c.id))
    const sources = getConnectedSources(nodeId, state.edges, state.nodes)
    const connected = buildImageConnectedReferences({
      data: node.data as unknown as ConnectedRefsData,
      sources,
      nodes: state.nodes,
      attachedChars,
    })
    // Image refs first, then the independently-numbered reference-VIDEO and
    // reference-AUDIO items. Self-gating: the builders key off
    // `referenceModalityForHandle(targetHandle)`, so they yield [] for every
    // node that has no video/audio reference handle wired (i.e. everything but
    // a Generate Video node fed those edges) — appending them is a no-op there.
    const referenceImages = [
      ...connectedReferencesToRefImages(connected),
      ...buildVideoRefVideoAutocomplete(sources),
      ...buildVideoRefAudioAutocomplete(sources),
    ]
    const nodeRefs = getUpstreamNodes(nodeId, state.nodes, state.edges)
    const refMap = buildNodeRefMap(nodeId, state.nodes, state.edges)
    return { referenceImages, nodeRefs, refMap, promptSnippets }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, nodeType, dataKey, topoKey, charsKey, promptSnippets])
}
