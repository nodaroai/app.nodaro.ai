/**
 * Shared helper for building the `ConnectedReference[]` list consumed by
 * `<InjectedReferenceList>` from a consumer node's `sources` array.
 *
 * Centralizes the wired-character expansion logic so each consumer config
 * (image-configs, video-configs, audio-configs, etc.) doesn't have to
 * duplicate the canonical + per-variant + asset-array expansion.
 *
 * The expansion logic mirrors:
 *   - the image-side path in `image-configs.tsx :: connectedReferences`
 *   - the video-side path in `video-configs.tsx :: buildVideoRefAutocomplete`
 *
 * Output is a flat `ConnectedReference[]` ready to pass to
 * `computeInjectedRefs` or `<InjectedReferenceList>`.
 */

import {
  characterMentionSlug,
  type ConnectedReference,
  type ReferenceSource,
} from "@nodaro/shared"
import type { CharacterNodeData } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"

/** Same mapping as `buildVideoRefAutocomplete` — accept image-y upstreams. */
const SOURCE_TYPE_MAP: Record<string, ReferenceSource> = {
  "upload-image": "wired-image",
  "generate-image": "wired-image",
  "edit-image": "wired-image",
  "image-to-image": "wired-image",
  "modify-image": "wired-image",
  "upscale-image": "wired-image",
  "remove-background": "wired-image",
  "extract-frame": "wired-image",
  "scene": "wired-image",
  "character": "wired-character",
  "face": "wired-face",
  "object": "wired-object",
  "location": "wired-location",
}

/**
 * Build `ConnectedReference[]` from a consumer node's `sources` array.
 *
 * For Character upstreams: expands into canonical + per-variant entries
 * (expressions / poses / motions / angles / bodyAngles / lighting) so the
 * @-mention resolution + canonical-fallback in `buildImagePrompt` /
 * `resolveVideoPromptMentions` works against the same set of variants.
 *
 * For non-character upstreams: emits a single canonical entry per source.
 */
export function buildConnectedRefsFromSources(
  sources: ReadonlyArray<SourceNodeInfo>,
): ConnectedReference[] {
  const out: ConnectedReference[] = []
  for (const s of sources) {
    const refSource = SOURCE_TYPE_MAP[s.type]
    if (!refSource) continue
    const nd = s.nodeData ?? {}

    if (s.type === "character") {
      const charData = nd as unknown as CharacterNodeData
      const charName = charData.characterName || s.label || "Character"
      const slug = characterMentionSlug(charName)
      if (slug) {
        const defaultUsageMode = charData.defaultUsageMode
        const canonicalUrl =
          charData.defaultAssetUrl ||
          charData.sourceImageUrl ||
          (nd.generatedImageUrl as string) ||
          (nd.url as string) ||
          ""
        if (canonicalUrl) {
          out.push({
            id: s.id,
            defaultName: charName,
            source: "wired-character",
            description: charData.description,
            url: canonicalUrl,
            characterSlug: slug,
            variantSlug: undefined,
            characterCanonicalDescription: charData.canonicalDescription ?? null,
            variantDescription: null,
            variantDisplayName: "canonical",
            defaultUsageMode,
          })
        }
        const assetArrays: Record<string, ReadonlyArray<{ readonly name: string; readonly url: string; readonly description?: string }>> = {
          expressions: charData.expressions ?? [],
          poses: charData.poses ?? [],
          motions: charData.motions ?? [],
          angles: charData.angles ?? [],
          bodyAngles: charData.bodyAngles ?? [],
          lightingVariations: charData.lightingVariations ?? [],
        }
        for (const [arrayName, items] of Object.entries(assetArrays)) {
          for (const item of items) {
            if (!item.url) continue
            const variantSlug = characterMentionSlug(item.name)
            if (!variantSlug) continue
            out.push({
              id: `${s.id}_${arrayName}_${variantSlug}`,
              defaultName: `${charName} / ${item.name}`,
              source: "wired-character",
              description: item.description ?? charData.description,
              url: item.url,
              characterSlug: slug,
              variantSlug,
              characterCanonicalDescription: charData.canonicalDescription ?? null,
              variantDescription: item.description ?? null,
              variantDisplayName: item.name,
              defaultUsageMode,
            })
          }
        }
        continue
      }
      // Unnamed character — fall through to generic path
    }

    const url =
      (nd.generatedImageUrl as string) ||
      (nd.url as string) ||
      (nd.sourceImageUrl as string) ||
      (nd.referenceImageUrl as string) ||
      ""
    if (!url) continue
    out.push({
      id: s.id,
      defaultName: s.label || s.type,
      source: refSource,
      description: nd.description as string | undefined,
      url,
    })
  }
  return out
}
