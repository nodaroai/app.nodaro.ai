import type {
  ConnectedReference,
  ReferenceSource,
} from "@nodaro/shared"
import {
  DEFAULT_LABEL_BY_SOURCE,
  characterMentionSlug,
  locationMentionSlug,
  expandExtraRefsToConnectedReferences,
} from "@nodaro/shared"
import type {
  CharacterNodeData,
  CharacterDefinition,
  WorkflowNode,
  ManualReferenceImage,
} from "@/types/nodes"
import type { SourceNodeInfo } from "./types"
import type { RefImageItem } from "./tag-textarea"

/**
 * Single source of truth for the image-generation "@"-autocomplete reference
 * assembly. Extracted from `image-configs.tsx` so the config panel AND the
 * quick-edit Prompt modal build the exact same `@`-mention candidate list (no
 * drift). Pure: given the node's data + connected sources + attached character
 * definitions + the canvas nodes, it returns the ordered `ConnectedReference[]`,
 * and `connectedReferencesToRefImages` maps that to the `RefImageItem[]` the
 * `PromptEditor` consumes.
 */

/** The subset of node data this assembly reads. */
export interface ConnectedRefsData {
  readonly referenceImageUrls?: readonly ManualReferenceImage[]
  readonly referenceImageOrder?: readonly string[]
  readonly extraRefs?: Parameters<typeof expandExtraRefsToConnectedReferences>[0]
}

/** Location variant buckets — kept in lockstep with backend
 *  `LOCATION_VARIANT_BUCKETS` in payload-builder.ts and the runtime path in
 *  `execute-node.ts`. Used to expand a wired Location upstream into one
 *  `ConnectedReference` entry per (bucket, variant) pair so the
 *  `@`-autocomplete surfaces every variant for selection. */
const IMAGE_LOCATION_VARIANT_BUCKETS = [
  "timeOfDay",
  "weather",
  "seasons",
  "angles",
  "lighting",
  "atmosphereMotions",
] as const

/**
 * Expand a wired Location upstream into canonical + per-variant
 * `ConnectedReference` entries. Returns null when the location has no source
 * image (caller falls back to the generic single-entry handling).
 */
export function expandLocationSourceForAutocomplete(
  sourceId: string,
  nd: Record<string, unknown>,
  fallbackLabel: string,
): Array<ConnectedReference> | null {
  const locName = (nd.locationName as string) || fallbackLabel || "Location"
  const locSlug = locationMentionSlug(locName)
  const sourceUrl = nd.sourceImageUrl as string | undefined
  if (!sourceUrl || !locSlug) return null
  const description = (nd.description as string | undefined) ?? undefined
  const canonicalDescription = (nd.canonicalDescription as string | null | undefined) ?? null
  const entries: ConnectedReference[] = []
  entries.push({
    id: sourceId,
    defaultName: locName,
    source: "wired-location",
    description,
    url: sourceUrl,
    locationSlug: locSlug,
    locationCanonicalDescription: canonicalDescription,
    locationVariantDisplayName: "canonical",
  })
  for (const bucket of IMAGE_LOCATION_VARIANT_BUCKETS) {
    const items = nd[bucket]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const variantName = (item as { name?: string }).name
      const variantUrl = (item as { url?: string }).url
      if (!variantName || !variantUrl) continue
      const variantSlug = locationMentionSlug(variantName)
      if (!variantSlug) continue
      entries.push({
        id: `${sourceId}_${bucket}_${variantSlug}`,
        defaultName: `${locName} / ${variantName}`,
        source: "wired-location",
        description,
        url: variantUrl,
        locationSlug: locSlug,
        locationCanonicalDescription: canonicalDescription,
        locationVariantBucket: bucket,
        locationVariantSlug: variantSlug,
        locationVariantDisplayName: variantName,
      })
    }
  }
  return entries
}

/**
 * Build the ordered `ConnectedReference[]` for an image-generation node's
 * `@`-autocomplete. Mirrors the runtime path through `buildImagePrompt` /
 * `execute-node.ts` so the candidates match what the model actually receives.
 */
export function buildImageConnectedReferences(params: {
  readonly data: ConnectedRefsData
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly attachedChars: ReadonlyArray<CharacterDefinition>
}): ConnectedReference[] {
  const { data, sources, nodes, attachedChars } = params
  const wiredSourceTypeMap: Record<string, ReferenceSource> = {
    "upload-image": "wired-image",
    "generate-image": "wired-image",
    "edit-image": "wired-image",
    "image-to-image": "wired-image",
    "modify-image": "wired-image",
    "upscale-image": "wired-image",
    "remove-background": "wired-image",
    "extract-frame": "wired-image",
    "character": "wired-character",
    "face": "wired-face",
    "object": "wired-object",
    "location": "wired-location",
    "scene": "wired-image",
  }
  const charCategorySource: Record<string, ReferenceSource> = {
    face: "wired-face",
    object: "wired-object",
    location: "wired-location",
  }

  const map = new Map<string, ConnectedReference>()

  // Manual uploads
  const manualImgs = data.referenceImageUrls ?? []
  for (let i = 0; i < manualImgs.length; i++) {
    const img = manualImgs[i]
    map.set(img.id, {
      id: img.id,
      defaultName: `Image ${i + 1}`,
      source: "manual",
      url: img.url,
    })
  }

  // Wired upstream nodes (sources from @xyflow incoming edges).
  for (const s of sources) {
    if (!(s.type in wiredSourceTypeMap)) continue
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
          map.set(s.id, {
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
            const variantId = `${s.id}_${arrayName}_${variantSlug}`
            map.set(variantId, {
              id: variantId,
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
      // Unnamed character — fall through to generic upstream handling.
    }
    if (s.type === "location") {
      const expanded = expandLocationSourceForAutocomplete(s.id, nd as Record<string, unknown>, s.label)
      if (expanded) {
        for (const e of expanded) map.set(e.id, e)
        continue
      }
      // No source image yet — fall through to generic handling.
    }
    const url = (nd.generatedImageUrl as string) || (nd.url as string) || (nd.referenceImageUrl as string) || ""
    if (!url) continue
    map.set(s.id, {
      id: s.id,
      defaultName: s.label || s.type,
      source: wiredSourceTypeMap[s.type],
      description: nd.description as string | undefined,
      url,
    })
  }

  // Attached character definitions (from character-definitions store).
  for (const c of attachedChars) {
    if (c.type !== "reference" || !c.referenceImageUrl) continue
    const source = charCategorySource[c.category ?? ""] ?? "wired-character"
    const slug = source === "wired-character" ? characterMentionSlug(c.name) : ""
    const matchingCharNode = source === "wired-character" && slug
      ? nodes.find((n) => {
          if (n.type !== "character") return false
          const nd = n.data as CharacterNodeData
          return nd.characterDbId === c.id
        })
      : undefined
    if (matchingCharNode && slug) {
      const charData = matchingCharNode.data as CharacterNodeData
      const defaultUsageMode = charData.defaultUsageMode
      const canonicalUrl = charData.defaultAssetUrl || c.referenceImageUrl || charData.sourceImageUrl
      if (canonicalUrl) {
        map.set(`char_${c.id}`, {
          id: `char_${c.id}`,
          defaultName: c.name,
          source,
          description: c.description ?? charData.description,
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
          const variantId = `char_${c.id}_${arrayName}_${variantSlug}`
          map.set(variantId, {
            id: variantId,
            defaultName: `${c.name} / ${item.name}`,
            source,
            description: item.description ?? c.description ?? charData.description,
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
    // No matching canvas node — emit single canonical entry.
    map.set(`char_${c.id}`, {
      id: `char_${c.id}`,
      defaultName: c.name,
      source,
      description: c.description,
      url: c.referenceImageUrl,
      ...(slug
        ? { characterSlug: slug, variantSlug: undefined, variantDisplayName: "canonical" }
        : {}),
    })
  }

  // Apply ordering
  const orderIds = data.referenceImageOrder ?? []
  const ordered: ConnectedReference[] = []
  const seen = new Set<string>()
  for (const id of orderIds) {
    const entry = map.get(id)
    if (entry) {
      ordered.push(entry)
      seen.add(id)
    }
  }
  for (const [id, entry] of map) {
    if (!seen.has(id)) ordered.push(entry)
  }
  // User-attached extras — appended after regular refs so they get the last
  // positional slots, matching the runtime `execute-node.ts` order.
  const ctxLookup = (slug: string) => {
    for (const n of nodes) {
      if (n.type !== "character") continue
      const cd = n.data as CharacterNodeData
      const name = cd.characterName || (cd.label as string) || ""
      if (characterMentionSlug(name) === slug) {
        return {
          defaultUsageMode: cd.defaultUsageMode,
          canonicalDescription: cd.canonicalDescription ?? null,
          displayName: name,
        }
      }
    }
    return undefined
  }
  const extras = expandExtraRefsToConnectedReferences(data.extraRefs, ctxLookup)
  for (const e of extras) ordered.push(e)
  return ordered
}

/** Map `ConnectedReference[]` → the `RefImageItem[]` the PromptEditor's "@"
 *  autocomplete consumes. Preserves the per-source default label + slugs. */
export function connectedReferencesToRefImages(
  refs: ReadonlyArray<ConnectedReference>,
): RefImageItem[] {
  return refs.map((ref, i) => ({
    url: ref.url,
    label: ref.defaultName,
    source:
      ref.source === "manual" ? "uploaded"
      : ref.source === "wired-image" ? "wired"
      : ref.source === "wired-location" ? "location"
      : "character",
    index: i + 1,
    defaultLabel: DEFAULT_LABEL_BY_SOURCE[ref.source],
    characterSlug: ref.characterSlug,
    variantSlug: ref.variantSlug,
    variantDisplayName: ref.variantDisplayName,
    locationSlug: ref.locationSlug,
    locationVariantBucket: ref.locationVariantBucket,
    locationVariantSlug: ref.locationVariantSlug,
    locationVariantDisplayName: ref.locationVariantDisplayName,
    defaultUsageMode: ref.defaultUsageMode,
    loraTrainingStatus: ref.loraTrainingStatus,
  }))
}
