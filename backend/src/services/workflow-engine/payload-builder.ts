/**
 * Build BullMQ job payloads for each node type from node data + resolved inputs.
 * Returns { jobName, queueName, payload } for worker-queued nodes.
 */

import type { SimpleNode, SimpleEdge, ResolvedInputs, NodeExecutionState } from "./types.js"

// Shared logic from packages/shared — single source of truth
import { collectAncestorRefs as sharedCollectAncestorRefs } from "@nodaro/shared"
import { buildImagePrompt, assembleImageInput, buildScenePrompt, applyReferenceOrderToVideo } from "@nodaro/shared"
import { collectIdentityLockClause as sharedCollectIdentityLockClause } from "@nodaro/shared"
import { resolveTemplate, applyTemplate } from "@nodaro/shared"
import { buildCreditModelIdentifier, buildVideoCreditModelIdentifier, buildMotionCreditModelIdentifier, applyVideoNegativePrompt, resolveVideoProviderForMode } from "@nodaro/shared"
import { buildLipSyncCreditId, isPerSecondLipSyncProvider } from "@nodaro/shared"
import { resolveAiAvatarCreditId } from "@nodaro/shared"
import { resolveCinematicCreditId } from "@nodaro/shared"
import { referenceSheetCreditId } from "@nodaro/shared"
import { validateAiAvatarPayload, validateCinematicAvatarPayload } from "@nodaro/shared"
import { resolveNodeRefs } from "@nodaro/shared"
import {
  composeSoundHintFromConnections,
  truncateForField,
  appendField,
  getEffectiveSunoCustomMode,
  type SoundConsumerType,
  type SoundComposition,
} from "@nodaro/shared"
import { getParameterPromptHint } from "@nodaro/shared"
import { PARAMETER_NODE_TYPES } from "@nodaro/shared"
import { computeNodePrompt } from "@nodaro/shared"
import type { CharacterDef, ConnectedReference, SceneData, ExtraRefInput, ExtraRefCharacterContext } from "@nodaro/shared"
import { characterMentionSlug, findCharacterMentionTokens, resolveCharacterMentions, usageModeDirective, DEFAULT_USAGE_MODE } from "@nodaro/shared"
import { expandExtraRefsToConnectedReferences } from "@nodaro/shared"
import { PLATFORM_SPECS } from "@nodaro/shared"
import { isSeedance2Provider, MODEL_CATALOG } from "@nodaro/shared"
import { COMPOSER_PLAN_MAP, ASPECT_RATIO_DIMENSIONS } from "@nodaro/shared"
import { buildLlmCreditIdentifier } from "@nodaro/shared"
import {
  buildCharacterPrompt,
  buildObjectPrompt,
  buildLocationPrompt,
  buildFaceTemplateInputs,
  LOCATION_REFERENCE_PHOTO_KINDS,
  locationReferencePhotoKindLabel,
  type LocationReferencePhotoKind,
} from "@nodaro/shared"
import { selectLoraRoutingForMentions } from "../../lib/character-lora.js"
import { config } from "../../lib/config.js"
import { ltxCameraMotionFromUpstream } from "../../lib/ltx-camera-motion.js"
import { FLUX_LORA_CHARACTER_MODEL_ID, extractCharacterLoraFields } from "@nodaro/shared"
import { extractSavedNodeOutput, extractSourceNodeOutput, getPrimaryOutput } from "./output-extractor.js"
import { IMAGE_SOURCE_TYPES, VIDEO_SOURCE_TYPES, AUDIO_SOURCE_TYPES, isSourceNode } from "./execution-graph.js"

// ---------------------------------------------------------------------------
// Character definitions + prompt template types (from workflow settings)
// ---------------------------------------------------------------------------

export interface CharacterDefinition {
  id: string
  name: string
  type: "reference" | "description"
  category?: "character" | "face" | "location" | "object"
  referenceImageUrl?: string
  description?: string
}

export interface WorkflowSettings {
  characterDefinitions?: CharacterDefinition[]
  flowPromptTemplates?: Record<string, string>
  /** User-level prompt templates from profiles.prompt_templates */
  userPromptTemplates?: Record<string, string>
}

/** Context passed to buildPayload for nodes that need workflow-level data. */
export interface PayloadBuildContext {
  settings?: WorkflowSettings
  nodes?: SimpleNode[]
  edges?: SimpleEdge[]
  nodeStates?: Record<string, NodeExecutionState>
}

// ---------------------------------------------------------------------------
// Ancestor reference image collection — delegates to shared implementation
// ---------------------------------------------------------------------------

/** Get image URL from execution state, falling back to saved node data (matches frontend). */
function getNodeImageUrl(
  node: SimpleNode,
  nodeStates: Record<string, NodeExecutionState>,
): string | undefined {
  return nodeStates[node.id]?.output?.imageUrl ?? extractSavedNodeOutput(node)?.imageUrl
}

function collectAncestorRefs(
  nodeId: string,
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  nodeStates: Record<string, NodeExecutionState>,
  visited = new Set<string>(),
): string[] {
  return sharedCollectAncestorRefs(
    nodeId,
    nodes,
    edges,
    (src) => getNodeImageUrl(src, nodeStates),
    visited,
  )
}

// ---------------------------------------------------------------------------
// Character connection → `ConnectedReference[]` expansion
//
// Mirror of the frontend `execute-node.ts` expansion: each wired upstream
// Character node contributes a canonical entry plus one entry per asset
// variant (expressions / poses / motions / angles / bodyAngles / lighting),
// powering `@kira` / `@kira-smile` mention resolution in `buildImagePrompt`
// for orchestrator-driven runs (webhook / cron / MCP) where the frontend's
// `execute-node.ts` doesn't run.
//
// Returns ConnectedReference entries for ALL wired character upstreams. If
// none have a usable slug (named character), returns an empty array — the
// caller should then fall back to the legacy URL-only path. Field names use
// camelCase from the workflow JSON saved by the frontend (the canvas keeps
// CharacterNodeData in camelCase; the snake_case `characters` DB row is
// distinct and not what flows through SimpleNode.data).
// ---------------------------------------------------------------------------

interface CharacterAssetItem {
  readonly name?: string
  readonly url?: string
}

function asAssetItems(value: unknown): readonly CharacterAssetItem[] {
  if (!Array.isArray(value)) return []
  return value as readonly CharacterAssetItem[]
}

/**
 * Build a complete `connectedReferences` list for an image-gen / i2i node.
 * Emits the wired-character expanded entries first (canonical + per-variant
 * for every wired Character upstream — these power `@kira-smile` resolution
 * in `buildImagePrompt`'s Phase 0), then appends any remaining URLs from the
 * ref-URL map (manual uploads, extracted refs, character-definition refs,
 * non-character wired upstream images) as plain `wired-image` entries.
 * Duplicates by URL are skipped so the canonical character URL doesn't get
 * listed twice (the existing flow keys upstream character URLs as
 * `wired_<i>` in refUrlMap — same URL as the expanded canonical entry).
 * Used only when the prompt contains an `@-mention`.
 */
function buildConnectedRefsForGenerate(
  wiredCharRefs: readonly ConnectedReference[],
  refUrlMap: ReadonlyMap<string, string>,
  orderIds: readonly string[],
  /** Wired Location upstream refs (Phase 2 #1) — emitted first so the
   *  directive builder can attach the location's canonical description to
   *  its bullet. URL-deduped against the wired-character refs and refUrlMap. */
  wiredLocRefs: readonly ConnectedReference[] = [],
): ConnectedReference[] {
  const out: ConnectedReference[] = []
  const seenUrls = new Set<string>()
  for (const r of wiredLocRefs) {
    if (!r.url || seenUrls.has(r.url)) continue
    seenUrls.add(r.url)
    out.push(r)
  }
  for (const r of wiredCharRefs) {
    if (!r.url || seenUrls.has(r.url)) continue
    seenUrls.add(r.url)
    out.push(r)
  }
  const addRawUrl = (id: string, url: string): void => {
    if (!url || seenUrls.has(url)) return
    seenUrls.add(url)
    out.push({
      id,
      defaultName: id,
      source: "wired-image",
      url,
    })
  }
  // Honor user-specified ordering first, then default insertion order.
  for (const id of orderIds) {
    const url = refUrlMap.get(id)
    if (url) addRawUrl(id, url)
  }
  for (const [id, url] of refUrlMap) {
    addRawUrl(id, url)
  }
  return out
}

/**
 * Variant of `buildConnectedRefsForGenerate` for the image-to-image case
 * (and any other case that has a flat `directRefs: string[]` list rather
 * than a refUrlMap). Emits the wired-character expansion first, then any
 * remaining URLs from `directRefs` as plain `wired-image` entries, deduped
 * by URL.
 */
function buildConnectedRefsFromUrls(
  wiredCharRefs: readonly ConnectedReference[],
  directRefs: readonly string[],
  /** Wired Location upstream refs (Phase 2 #1). Same dedup contract as
   *  `buildConnectedRefsForGenerate`. */
  wiredLocRefs: readonly ConnectedReference[] = [],
): ConnectedReference[] {
  const out: ConnectedReference[] = []
  const seenUrls = new Set<string>()
  for (const r of wiredLocRefs) {
    if (!r.url || seenUrls.has(r.url)) continue
    seenUrls.add(r.url)
    out.push(r)
  }
  for (const r of wiredCharRefs) {
    if (!r.url || seenUrls.has(r.url)) continue
    seenUrls.add(r.url)
    out.push(r)
  }
  for (let i = 0; i < directRefs.length; i++) {
    const url = directRefs[i]
    if (!url || seenUrls.has(url)) continue
    seenUrls.add(url)
    out.push({
      id: `direct_${i}`,
      defaultName: `Image ${i + 1}`,
      source: "wired-image",
      url,
    })
  }
  return out
}

/**
 * Walk the incoming edges of a reference-sheet node to the upstream composable
 * entity and read its (kind, DB id). Mirrors the `expandWiredCharacterRefs`
 * upstream-walk but returns just the first character/object/location's identity
 * — a sheet composes from ONE entity. Extracted as a pure helper so the
 * upstream-walk is directly unit-testable without standing up the whole
 * payload-builder (`buildPayload` builds a ref-map + resolves @mentions first).
 *
 * `face` is intentionally NOT a candidate — it has no panel buckets and the
 * input-handle predicate already rejects it; this keeps the BE in lockstep.
 */
export function resolveSheetEntity(
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
): { entityKind?: "character" | "object" | "location"; entityDbId?: string } {
  if (!buildCtx?.nodes || !buildCtx.edges) return {}
  const nodeById = new Map(buildCtx.nodes.map((n) => [n.id, n] as const))
  const incoming = buildCtx.edges.filter((e) => e.target === consumerNodeId)
  for (const e of incoming) {
    const up = nodeById.get(e.source)
    if (!up) continue
    if (up.type === "character" || up.type === "object" || up.type === "location") {
      const d = up.data as Record<string, unknown>
      const idField =
        up.type === "character" ? "characterDbId" : up.type === "object" ? "objectDbId" : "locationDbId"
      const entityDbId = d[idField] as string | undefined
      return { entityKind: up.type, entityDbId: typeof entityDbId === "string" && entityDbId.length > 0 ? entityDbId : undefined }
    }
  }
  return {}
}

/** Expand wired upstream Character nodes into canonical + per-variant refs. */
function expandWiredCharacterRefs(
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
): ConnectedReference[] {
  if (!buildCtx?.nodes || !buildCtx.edges) return []
  const out: ConnectedReference[] = []
  const nodeById = new Map(buildCtx.nodes.map((n) => [n.id, n] as const))
  const incoming = buildCtx.edges.filter((e) => e.target === consumerNodeId)
  for (const e of incoming) {
    const upstream = nodeById.get(e.source)
    if (!upstream || upstream.type !== "character") continue
    const charData = upstream.data
    const charName =
      (charData.characterName as string | undefined) ??
      (charData.label as string | undefined) ??
      ""
    const characterSlug = characterMentionSlug(charName)
    if (!characterSlug) continue // unnamed character — skip from autocomplete

    const description = charData.description as string | undefined
    const canonicalDescription =
      (charData.canonicalDescription as string | null | undefined) ?? null
    // Propagate the character node's default usage mode into every entry —
    // `resolveCharacterMentions` reads this as the fallback when a per-mention
    // slug omits its own `:mode` override. The cast is defensive — the JSON
    // saved by the canvas already constrains this field to a `UsageMode`
    // literal, but `SimpleNode.data` is a structural `Record<string, unknown>`
    // so we narrow at the boundary. Invalid values trip the resolver into
    // returning the global `DEFAULT_USAGE_MODE`, so the failure mode is safe.
    const defaultUsageMode = charData.defaultUsageMode as
      | ConnectedReference["defaultUsageMode"]
      | undefined
    // LoRA training fields — character-level (same across all variants).
    // Shared helper keeps backend + frontend `expand*Refs` in lockstep.
    const loraFields = extractCharacterLoraFields(
      charData as { loraReplicateVersion?: string | null; loraTriggerWord?: string | null; loraTrainingStatus?: string | null },
    )
    const canonicalUrl =
      (charData.defaultAssetUrl as string | undefined) ||
      (charData.sourceImageUrl as string | undefined)
    if (canonicalUrl) {
      out.push({
        id: `char_${upstream.id}`,
        defaultName: charName,
        source: "wired-character",
        description,
        url: canonicalUrl,
        characterSlug,
        variantSlug: undefined,
        characterCanonicalDescription: canonicalDescription,
        variantDescription: null,
        variantDisplayName: "canonical",
        defaultUsageMode,
        ...loraFields,
      })
    }

    const assetArrays: Record<string, readonly CharacterAssetItem[]> = {
      expressions: asAssetItems(charData.expressions),
      poses: asAssetItems(charData.poses),
      motions: asAssetItems(charData.motions),
      angles: asAssetItems(charData.angles),
      bodyAngles: asAssetItems(charData.bodyAngles),
      lightingVariations: asAssetItems(charData.lightingVariations),
    }
    for (const [arrayName, items] of Object.entries(assetArrays)) {
      for (const item of items) {
        if (!item?.url) continue
        const variantSlug = characterMentionSlug(item.name ?? "")
        if (!variantSlug) continue
        out.push({
          id: `char_${upstream.id}_${arrayName}_${variantSlug}`,
          defaultName: `${charName} / ${item.name}`,
          source: "wired-character",
          description,
          url: item.url,
          characterSlug,
          variantSlug,
          characterCanonicalDescription: canonicalDescription,
          variantDescription: null,
          variantDisplayName: item.name,
          defaultUsageMode,
          ...loraFields,
        })
      }
    }
  }
  return out
}

/** Location variant buckets — kept in sync with frontend LocationNodeData. */
export const LOCATION_VARIANT_BUCKETS = [
  "timeOfDay",
  "weather",
  "seasons",
  "angles",
  "lighting",
  "atmosphereMotions",
] as const

/**
 * Expand a wired Location upstream into a canonical ConnectedReference plus
 * one entry per variant across the 6 buckets (timeOfDay / weather / seasons
 * / angles / lighting / atmosphereMotions). Phase 2 #2 — powers
 * `@oldlibrary:1:weather/rain` mention resolution by giving the resolver
 * pre-indexed entries to match against.
 *
 * Returns an empty list when no wired-location upstream OR upstream has no
 * `sourceImageUrl` — caller falls through to the existing wired-image flow.
 */
/**
 * Common environmental terms → publisher-named variant slug. The
 * variant's own name is the primary match; synonyms catch common
 * alternatives (e.g. `"Light Rain"` matches via `rain`, `"Golden Hour"`
 * via `dusk`'s synonyms). Longest match wins so `twilight` beats `night`.
 */
const VARIANT_SYNONYMS: Record<string, ReadonlyArray<string>> = {
  night: ["night", "nighttime", "midnight"],
  dusk: ["dusk", "sunset", "twilight", "golden hour"],
  dawn: ["dawn", "sunrise", "daybreak"],
  morning: ["morning"],
  noon: ["noon", "midday"],
  afternoon: ["afternoon"],
  rain: ["rain", "rainy", "raining", "rainfall", "downpour"],
  snow: ["snow", "snowy", "snowing", "snowfall", "blizzard"],
  fog: ["fog", "foggy", "misty", "mist", "haze"],
  clear: ["clear sky", "sunny", "cloudless"],
  storm: ["storm", "stormy", "thunderstorm", "thunder", "lightning"],
  cloudy: ["cloudy", "overcast"],
  spring: ["spring"],
  summer: ["summer"],
  autumn: ["autumn", "fall foliage"],
  winter: ["winter"],
  neon: ["neon", "neon-lit", "neon lights"],
  candlelit: ["candlelit", "candle", "candlelight"],
  moonlit: ["moonlit", "moonlight"],
  cinematic: ["cinematic"],
}

// Bucket priority: timeOfDay tends to be the most semantically load-bearing
// modifier; atmosphereMotions are last because their names are usually
// action phrases that don't appear in static prompts.
const SMART_VARIANT_BUCKETS_BY_PRIORITY: ReadonlyArray<string> = [
  "timeOfDay", "weather", "seasons", "lighting", "angles", "atmosphereMotions",
]

// Precompile term → regex at module load. Word-boundary `\b` is fine for
// single-word terms; multi-word terms ("golden hour") use a relaxed
// non-word boundary because `\b` doesn't sit between letter+space.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
const SYNONYM_REGEXES: ReadonlyMap<string, RegExp> = (() => {
  const m = new Map<string, RegExp>()
  for (const terms of Object.values(VARIANT_SYNONYMS)) {
    for (const term of terms) {
      if (m.has(term)) continue
      m.set(term, term.includes(" ")
        ? new RegExp(`(^|\\W)${escapeRegex(term)}(\\W|$)`, "i")
        : new RegExp(`\\b${escapeRegex(term)}\\b`, "i"))
    }
  }
  return m
})()
function regexFor(term: string): RegExp {
  const cached = SYNONYM_REGEXES.get(term)
  if (cached) return cached
  return term.includes(" ")
    ? new RegExp(`(^|\\W)${escapeRegex(term)}(\\W|$)`, "i")
    : new RegExp(`\\b${escapeRegex(term)}\\b`, "i")
}

function pickSmartVariant(
  prompt: string | undefined,
  locData: Record<string, unknown>,
): { bucket: string; name: string; url: string } | null {
  if (!prompt) return null
  let best: { bucket: string; name: string; url: string; len: number } | null = null
  for (const bucket of SMART_VARIANT_BUCKETS_BY_PRIORITY) {
    const items = locData[bucket]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const name = (item as { name?: unknown }).name
      const url = (item as { url?: unknown }).url
      if (typeof name !== "string" || typeof url !== "string" || !url) continue
      const slug = name.toLowerCase().trim()
      const matchTerms = [slug, ...(VARIANT_SYNONYMS[slug] ?? [])]
      for (const term of matchTerms) {
        if (regexFor(term).test(prompt)) {
          if (!best || term.length > best.len) {
            best = { bucket, name, url, len: term.length }
          }
        }
      }
    }
  }
  return best
    ? { bucket: best.bucket, name: best.name, url: best.url }
    : null
}

export function expandWiredLocationRefs(
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
): ConnectedReference[] {
  if (!buildCtx?.nodes || !buildCtx.edges) return []
  const out: ConnectedReference[] = []
  const nodeById = new Map(buildCtx.nodes.map((n) => [n.id, n] as const))
  const incoming = buildCtx.edges.filter((e) => e.target === consumerNodeId)
  const consumer = nodeById.get(consumerNodeId)
  const consumerPrompt =
    (consumer?.data?.prompt as string | undefined) ??
    (consumer?.data?.motionPrompt as string | undefined) ??
    undefined
  for (const e of incoming) {
    const upstream = nodeById.get(e.source)
    if (!upstream || upstream.type !== "location") continue
    const locData = upstream.data
    let sourceUrl = locData.sourceImageUrl as string | undefined
    if (!sourceUrl) continue
    const locName =
      (locData.locationName as string | undefined) ??
      (locData.label as string | undefined) ??
      "Location"
    const locationSlug = characterMentionSlug(locName) || undefined
    const description = (locData.description as string | undefined) ?? undefined
    const canonicalDescription =
      (locData.canonicalDescription as string | null | undefined) ?? null

    // Smart variant selection — only fires when the user hasn't explicitly
    // pinned a variant via `selectedVariant` (app-input override path).
    if (!(locData.selectedVariant as string | undefined)) {
      const smart = pickSmartVariant(consumerPrompt, locData)
      if (smart) sourceUrl = smart.url
    }

    // Canonical entry — the main image URL.
    out.push({
      id: upstream.id,
      defaultName: locName,
      source: "wired-location",
      description,
      url: sourceUrl,
      locationCanonicalDescription: canonicalDescription,
      locationSlug,
    })

    // Per-variant entries. Each bucket holds `{name, url}[]`; the variant
    // slug used by the mention resolver is `locationMentionSlug(name)` so
    // a stored "Light Rain" matches `@oldlibrary:1:weather/light-rain`.
    for (const bucket of LOCATION_VARIANT_BUCKETS) {
      const items = locData[bucket]
      if (!Array.isArray(items)) continue
      for (const item of items) {
        const variantName = (item as { name?: string }).name
        const variantUrl = (item as { url?: string }).url
        if (!variantName || !variantUrl) continue
        const variantSlug = characterMentionSlug(variantName)
        if (!variantSlug) continue
        out.push({
          id: `${upstream.id}_${bucket}_${variantSlug}`,
          defaultName: `${locName} / ${variantName}`,
          source: "wired-location",
          description,
          url: variantUrl,
          locationCanonicalDescription: canonicalDescription,
          locationSlug,
          locationVariantBucket: bucket,
          locationVariantSlug: variantSlug,
          locationVariantDisplayName: variantName,
        })
      }
    }

    // Phase 2 #3: emit one ConnectedReference per user-uploaded reference photo.
    // These auto-attach (unlike per-variant entries which are mention-only) and
    // carry their `kind` so the prompt-builder can annotate the subject line.
    const refPhotos = (locData.referencePhotos as Array<{ kind?: string; url?: string }> | undefined) ?? []
    for (let idx = 0; idx < refPhotos.length; idx++) {
      const photo = refPhotos[idx]
      const photoUrl = (photo.url ?? "").trim()
      if (!photoUrl) continue
      if (!photo.kind) continue
      // Validate the kind is one of the 6 known values to avoid passing
      // arbitrary strings downstream. Cast through the union after the guard.
      if (!LOCATION_REFERENCE_PHOTO_KINDS.includes(photo.kind as LocationReferencePhotoKind)) continue
      const kind = photo.kind as LocationReferencePhotoKind
      out.push({
        id: `${upstream.id}_refphoto_${kind}_${idx}`,
        defaultName: `${locName} (${locationReferencePhotoKindLabel(kind)})`,
        source: "wired-location",
        url: photoUrl,
        locationCanonicalDescription: canonicalDescription,
        locationSlug,
        locationReferencePhotoKind: kind,
      })
    }
  }
  return out
}

/**
 * Build a `slug → ExtraRefCharacterContext` lookup for character-sourced
 * extras. Mirrors the frontend `buildExtraRefCharacterContextLookup` in
 * `execute-node.ts`. Used by the extras directive emission below + by
 * `expandExtraRefsToConnectedReferences` so character-sourced extras inherit
 * `defaultUsageMode` and `canonicalDescription` from the upstream node.
 */
function buildExtraRefCharacterContextLookup(
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
): (slug: string) => ExtraRefCharacterContext | undefined {
  if (!buildCtx?.nodes || !buildCtx.edges) return () => undefined
  const bySlug = new Map<string, ExtraRefCharacterContext>()
  const nodeById = new Map(buildCtx.nodes.map((n) => [n.id, n] as const))
  const incoming = buildCtx.edges.filter((e) => e.target === consumerNodeId)
  for (const e of incoming) {
    const upstream = nodeById.get(e.source)
    if (!upstream || upstream.type !== "character") continue
    const charData = upstream.data
    const charName =
      (charData.characterName as string | undefined) ??
      (charData.label as string | undefined) ??
      ""
    const slug = characterMentionSlug(charName)
    if (!slug) continue
    if (!bySlug.has(slug)) {
      bySlug.set(slug, {
        defaultUsageMode: charData.defaultUsageMode as ExtraRefCharacterContext["defaultUsageMode"],
        canonicalDescription: (charData.canonicalDescription as string | null | undefined) ?? null,
        displayName: charName,
      })
    }
  }
  return (slug) => bySlug.get(slug)
}

/** Read the `extraRefs` field from a SimpleNode's `data`, returning a typed
 *  array (cast at the boundary — the JSON schema isn't enforced server-side
 *  but the frontend type's interface is structural). */
function readExtraRefs(data: Record<string, unknown>): readonly ExtraRefInput[] | undefined {
  const raw = data.extraRefs
  if (!Array.isArray(raw)) return undefined
  return raw as readonly ExtraRefInput[]
}

/**
 * Read an unknown field from `data` as `readonly string[]`, returning
 * undefined when the field is missing or not a (non-empty) string array.
 *
 * Used for `referenceOrder` + `suppressedCanonicalCharacterIds` — both
 * additive fields the consumer node may or may not have set. The shared
 * `buildImagePrompt` already treats `[]` and `undefined` identically (no-op
 * contract), so returning undefined for either case is safe.
 */
function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const v of value) {
    if (typeof v === "string" && v.length > 0) out.push(v)
  }
  return out.length > 0 ? out : undefined
}

/**
 * Resolve `@kira:N` / `@kira:N:smile` mentions in a video-node prompt against
 * wired Character upstreams AND apply the per-character canonical fallback
 * for unmentioned wired characters. Also emits directives + appends URLs for
 * user-attached extra references (the `extraRefs` field on node data).
 *
 * Mirrors `buildImagePrompt`'s Phase 0 mention pass + canonical fallback +
 * extras pass, but lives outside the image-specific assembly pipeline (which
 * appends style hints, routes negative prompts, filters refs by model
 * support, etc.) so it can be applied to video routes that have their own
 * payload shape.
 *
 * Per-character behavior contract (parity with image-side):
 *   - wired-character with at least one `@-mention` → contribute ONLY the
 *     mentioned variant URLs (no canonical auto-attach), prepend the
 *     mention-derived directive block.
 *   - wired-character with NO `@-mention` → contribute the canonical URL
 *     + a strong identity directive. Mirrors the pre-mention behavior.
 *
 * Returns the mutated prompt + the asset URLs to slot into the worker
 * payload. The caller decides where (i2v has both `imageUrl` and
 * `referenceImageUrls`; v2v has only `referenceImageUrl`; t2v has
 * `referenceImageUrls` only).
 */
function resolveVideoPromptMentions(
  prompt: string | undefined,
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
  extraRefs?: readonly ExtraRefInput[],
  opts?: {
    /** Stable-ID reorder — see `compute-injected-refs.ts`. */
    referenceOrder?: readonly string[]
    /** Character slugs whose canonical-fallback the user has hidden. */
    suppressedCanonicalCharacterIds?: readonly string[]
  },
): { prompt: string | undefined; additionalUrls: string[] } {
  let wiredCharRefs = expandWiredCharacterRefs(consumerNodeId, buildCtx)
  const suppressedSlugs = new Set(opts?.suppressedCanonicalCharacterIds ?? [])
  if (suppressedSlugs.size > 0) {
    // Drop ONLY the canonical entry — `@-mentioned` variants stay.
    wiredCharRefs = wiredCharRefs.filter((r) => {
      if (r.source !== "wired-character") return true
      if (!r.characterSlug) return true
      if (r.variantSlug) return true
      return !suppressedSlugs.has(r.characterSlug)
    })
  }
  const hasExtras = (extraRefs?.length ?? 0) > 0
  if (wiredCharRefs.length === 0 && !hasExtras) {
    return { prompt, additionalUrls: [] }
  }
  const knownCharSlugs = Array.from(
    new Set(
      wiredCharRefs
        .map((r) => r.characterSlug)
        .filter((s): s is string => typeof s === "string" && s.length > 0),
    ),
  )
  // Empty user prompt is allowed — canonical fallback / mention resolution
  // can fill the prompt entirely. Treat undefined/empty as `""` so the
  // resolver flows through to mention + canonical-fallback assembly below.
  const promptForResolution = prompt ?? ""
  const mentionTokens = knownCharSlugs.length > 0
    ? findCharacterMentionTokens(promptForResolution, knownCharSlugs)
    : []
  // Resolve any mentions (may be empty); always check fallback after.
  const resolved = mentionTokens.length > 0
    ? resolveCharacterMentions(promptForResolution, mentionTokens, wiredCharRefs)
    : { prompt: promptForResolution, additionalUrls: [] as string[], mentionedCharacterSlugs: new Set<string>() }

  // Track position of the first emitted URL per characterSlug — used by
  // extras to pair back via "Image B is the same subject as Image A".
  const positionsByChar = new Map<string, number>()
  let position = 0
  for (let i = 0; i < resolved.additionalUrls.length; i++) {
    position += 1
    const ref = wiredCharRefs.find((r) => r.url === resolved.additionalUrls[i])
    const slug = ref?.characterSlug
    if (slug && !positionsByChar.has(slug)) positionsByChar.set(slug, position)
  }

  // Canonical fallback for any wired character NOT @-mentioned. Single
  // canonical URL + strong directive per unmentioned character — mirrors
  // `buildCanonicalFallback` from the shared prompt-builder.
  const fallbackUrls: string[] = []
  const fallbackDirectiveLines: string[] = []
  const seenSlugs = new Set<string>()
  for (const r of wiredCharRefs) {
    if (r.source !== "wired-character") continue
    if (!r.characterSlug) continue
    if (resolved.mentionedCharacterSlugs.has(r.characterSlug)) continue
    if (seenSlugs.has(r.characterSlug)) continue
    if (r.variantSlug) continue
    if (!r.url) continue
    seenSlugs.add(r.characterSlug)
    fallbackUrls.push(r.url)
    position += 1
    if (!positionsByChar.has(r.characterSlug)) positionsByChar.set(r.characterSlug, position)
    const displayName = r.defaultName || r.characterSlug
    // Mode-aware directive: character node's `defaultUsageMode` → global
    // `DEFAULT_USAGE_MODE`. Keeps backend video runs in lock-step with the
    // frontend `resolveVideoPromptMentions` and the shared image builder.
    const effectiveMode = r.defaultUsageMode ?? DEFAULT_USAGE_MODE
    // Minimal-intervention modes:
    //   - "none": URL is attached but NO bullet is emitted (no textual bias).
    //   - "name": one bullet with the name, no trailing directive.
    if (effectiveMode === "none") {
      continue
    }
    if (effectiveMode === "name") {
      fallbackDirectiveLines.push(`- Image ${position} (${displayName})`)
      continue
    }
    const directive = usageModeDirective(effectiveMode)
    const includeCanonicalDesc = effectiveMode === "identical" || effectiveMode === "face-pose"
    const descPart = includeCanonicalDesc && r.characterCanonicalDescription
      ? `${displayName} — ${r.characterCanonicalDescription.trim()}`
      : displayName
    fallbackDirectiveLines.push(`- ${descPart}.${directive ? ` ${directive}` : ""}`)
  }

  // Extras: emit one directive per row. Numbering continues from `position`
  // so the worker's `referenceImageUrls` order lines up with "Image N" in
  // the assembled prompt. Mirrors the frontend `resolveVideoPromptMentions`.
  const extraUrls: string[] = []
  const extraDirectiveLines: string[] = []
  if (hasExtras) {
    const ctxLookup = buildExtraRefCharacterContextLookup(consumerNodeId, buildCtx)
    for (const ex of extraRefs!) {
      if (!ex.url) continue
      position += 1
      const desc = (ex.description ?? "").trim()
      if (ex.characterSlug) {
        const ctx = ctxLookup(ex.characterSlug)
        const effectiveMode = ex.usageMode ?? ctx?.defaultUsageMode ?? DEFAULT_USAGE_MODE
        const earlierPos = positionsByChar.get(ex.characterSlug)
        if (earlierPos !== undefined) {
          // Pair-back. Suppressed for "none" so the extras-side respects the
          // same minimal-intervention contract as primary mentions.
          if (effectiveMode !== "none") {
            const tail = desc ? `, ${desc}` : ""
            extraDirectiveLines.push(
              `- Image ${position} is the same subject as Image ${earlierPos}${tail}.`,
            )
          }
        } else if (effectiveMode === "none") {
          // URL attached, no bullet. Record the slot for any later same-
          // character extras that pair-back via "same subject as Image N".
          positionsByChar.set(ex.characterSlug, position)
        } else if (effectiveMode === "name") {
          // Labeled subject + per-ref description, no trailing directive.
          const displayName = ctx?.displayName || ex.characterSlug
          const subject = `Image ${position} (${displayName})`
          const descPart = desc ? `${subject} — ${desc}` : subject
          extraDirectiveLines.push(`- ${descPart}.`)
          positionsByChar.set(ex.characterSlug, position)
        } else {
          const directive = usageModeDirective(effectiveMode)
          const displayName = ctx?.displayName || ex.characterSlug
          const subject = `Image ${position} (${displayName})`
          const includeCanonicalDesc = effectiveMode === "identical" || effectiveMode === "face-pose"
          const canonicalDesc = ctx?.canonicalDescription
          let descPart = subject
          if (desc) descPart = `${subject} — ${desc}`
          else if (includeCanonicalDesc && canonicalDesc?.trim()) descPart = `${subject} — ${canonicalDesc.trim()}`
          extraDirectiveLines.push(`- ${descPart}.${directive ? ` ${directive}` : ""}`)
          positionsByChar.set(ex.characterSlug, position)
        }
      } else {
        if (desc) {
          extraDirectiveLines.push(`- Image ${position} (reference): ${desc}.`)
        } else {
          extraDirectiveLines.push(`- Image ${position} (reference).`)
        }
      }
      extraUrls.push(ex.url)
    }
  }

  let finalPrompt = resolved.prompt
  const allFallbackLines = [...fallbackDirectiveLines, ...extraDirectiveLines]
  if (allFallbackLines.length > 0) {
    // Mirror shared `buildImagePrompt`'s consolidation: append fallback
    // bullets into an existing "Use these characters:" block when present,
    // otherwise create a new one.
    if (finalPrompt && finalPrompt.startsWith("Use these characters:\n")) {
      const splitIdx = finalPrompt.indexOf("\n\n")
      if (splitIdx !== -1) {
        const header = finalPrompt.slice(0, splitIdx)
        const rest = finalPrompt.slice(splitIdx)
        finalPrompt = `${header}\n${allFallbackLines.join("\n")}${rest}`
      } else {
        finalPrompt = `${finalPrompt}\n${allFallbackLines.join("\n")}`
      }
    } else {
      const block = `Use these characters:\n${allFallbackLines.join("\n")}`
      finalPrompt = finalPrompt ? `${block}\n\n${finalPrompt}` : block
    }
  }

  // Dedup combined URLs while preserving order (mentions first, fallback,
  // then extras). "Image N" labels in the prompt assume this exact order
  // BEFORE any user-defined `referenceOrder` reorder below.
  const merged: string[] = []
  const seen = new Set<string>()
  for (const u of resolved.additionalUrls) {
    if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
  }
  for (const u of fallbackUrls) {
    if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
  }
  for (const u of extraUrls) {
    if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
  }

  // Apply user-defined reorder + renumber `Image N` tokens. Skipped fast when
  // `referenceOrder` is absent or there's <2 URLs (nothing to reorder).
  const referenceOrder = opts?.referenceOrder
  if (referenceOrder && referenceOrder.length > 0 && merged.length > 1) {
    // Build a synthetic ConnectedReference list that combines wired chars +
    // extras so `applyReferenceOrderToVideo` can identify each URL. Extras
    // don't have a stable `id` field on the input shape, so we derive one
    // from the URL — extras are tile-matched as `wired:<url>` in this path.
    const refsForOrdering: ConnectedReference[] = [...wiredCharRefs]
    if (hasExtras) {
      for (const ex of extraRefs!) {
        if (!ex.url) continue
        refsForOrdering.push({
          id: ex.url,
          defaultName: ex.characterSlug || "Extra",
          source: ex.characterSlug ? "wired-character" : "manual",
          url: ex.url,
          characterSlug: ex.characterSlug,
          variantSlug: ex.variantSlug,
          isExtraRef: true,
        })
      }
    }
    const reordered = applyReferenceOrderToVideo(merged, finalPrompt, refsForOrdering, referenceOrder)
    return { prompt: reordered.prompt, additionalUrls: reordered.urls }
  }

  return { prompt: finalPrompt, additionalUrls: merged }
}

// ---------------------------------------------------------------------------
// Apply user-specified ordering to a list of items with IDs
// ---------------------------------------------------------------------------

function applyOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  if (!order.length) return [...items]
  const ordered: T[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const item = items.find((i) => i.id === id)
    if (item) {
      ordered.push(item)
      seen.add(id)
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) {
      ordered.push(item)
    }
  }
  return ordered
}

/** Source-node types accepted as reference images by image-to-video and
 * text-to-video. Mirrors the frontend `connectedRefImages` filter in
 * `video-configs.tsx` so the orchestrator's reorder picks up exactly the
 * upstreams the user reordered in the config panel. */
const VIDEO_REF_IMAGE_SOURCE_TYPES = new Set([
  "generate-image",
  "upload-image",
  "character",
  "object",
  "location",
  "edit-image",
  "image-to-image",
  "scene",
  // extract-frame outputs a still image — must be reorderable alongside
  // other image producers when wired into generate-video.imageReferences
  // (mirrors the frontend IMAGE_PRODUCER_TYPES which already includes it).
  "extract-frame",
])

/** Re-derive `referenceImageUrls` from the workflow graph in user-defined
 * order. Walks the consumer node's incoming edges (filtered by `edgeFilter`
 * to a specific `targetHandle` or accepted source types), then sorts the
 * resulting source nodes by `order` (IDs not in `order` go to the end), and
 * finally pulls each source's image URL via `getNodeImageUrl`. Used by
 * image-to-video / text-to-video so the positional Image-N letters in the
 * assembled prompt respect the user's drag-to-reorder list in
 * `connectedRefImageOrder`.
 *
 * Returns `undefined` when the order array is empty (caller should keep the
 * original `resolvedInputs.referenceImageUrls` in that case to avoid extra
 * work). */
function applyOrderToReferenceUrls(
  consumerNodeId: string,
  order: readonly string[] | undefined,
  buildCtx: PayloadBuildContext | undefined,
  edgeFilter: (edge: SimpleEdge, sourceNode: SimpleNode) => boolean,
): string[] | undefined {
  if (!order?.length) return undefined
  if (!buildCtx) return undefined
  const allNodes = buildCtx.nodes ?? []
  const allEdges = buildCtx.edges ?? []
  const states = buildCtx.nodeStates ?? {}
  const nodeById = new Map(allNodes.map((n) => [n.id, n] as const))
  const matchedSources: SimpleNode[] = []
  const seenSrcIds = new Set<string>()
  for (const e of allEdges) {
    if (e.target !== consumerNodeId) continue
    const src = nodeById.get(e.source)
    if (!src) continue
    if (!edgeFilter(e, src)) continue
    if (seenSrcIds.has(src.id)) continue
    seenSrcIds.add(src.id)
    matchedSources.push(src)
  }
  if (matchedSources.length === 0) return undefined
  const ordered = applyOrder(matchedSources, order)
  const orderedUrls = ordered
    .map((n) => getNodeImageUrl(n, states))
    .filter((u): u is string => !!u)
  return orderedUrls.length > 0 ? orderedUrls : undefined
}

interface PayloadResult {
  /** BullMQ job name (e.g., "generate-image") */
  jobName: string
  /** Queue to add to: "video-generation" or "video-render" */
  queueName: "video-generation" | "video-render"
  /** Job data payload */
  payload: Record<string, unknown>
  /** Model identifier for credit reservation */
  modelIdentifier: string
}

/** Shorthand for FFmpeg nodes that all share queueName + modelIdentifier. */
function ffmpegResult(
  jobName: string,
  payload: Record<string, unknown>,
): PayloadResult {
  return {
    jobName,
    queueName: "video-generation",
    modelIdentifier: jobName,
    payload,
  }
}

/** Shorthand for nodes with a fixed model identifier and no provider selection. */
function simpleResult(
  jobName: string,
  modelIdentifier: string,
  payload: Record<string, unknown>,
): PayloadResult {
  return {
    jobName,
    queueName: "video-generation",
    modelIdentifier,
    payload,
  }
}

/**
 * Resolve `personaId` + `personaModel` for a Suno music node. Upstream wiring
 * (from a `suno-voice` node) wins over manual `data` fields. Returns an empty
 * object when no persona is set so spreading into a payload is a no-op.
 */
function resolvePersona(
  resolvedInputs: { personaId?: string; personaModel?: string },
  data: Record<string, unknown>,
): { personaId?: string; personaModel?: string } {
  const personaId = resolvedInputs.personaId ?? (data.personaId as string | undefined)
  if (!personaId) return {}
  const personaModel = resolvedInputs.personaModel ?? (data.personaModel as string | undefined)
  return { personaId, personaModel: personaModel ?? "voice_persona" }
}

/**
 * Assemble the cinematic-avatar `references` array from the resolved reference
 * handle inputs (refVideoUrl/refAudioUrl/refImageUrl — one upstream producer
 * per handle) plus any pre-seeded `data.references` (single-node Run path,
 * where the orchestrator hasn't resolved handles). Wired inputs take priority
 * over a same-kind data entry; duplicate urls are dropped so a node that both
 * wires a handle and carries a stale data.references entry doesn't double-send.
 * `type` here is the INTERNAL media kind — the provider maps it to HeyGen's
 * AssetUrl shape. Caps are enforced at the route, not re-validated here.
 */
function buildCinematicReferences(
  resolvedInputs: ResolvedInputs,
  data: Record<string, unknown>,
): Array<{ type: "video" | "image" | "audio"; url: string }> {
  const refs: Array<{ type: "video" | "image" | "audio"; url: string }> = []
  const seen = new Set<string>()

  const push = (type: "video" | "image" | "audio", url: unknown) => {
    if (typeof url !== "string" || !url || seen.has(url)) return
    seen.add(url)
    refs.push({ type, url })
  }

  // Wired handle inputs first (highest priority).
  push("video", resolvedInputs.refVideoUrl)
  push("audio", resolvedInputs.refAudioUrl)
  push("image", resolvedInputs.refImageUrl)

  // Then any references carried on node data (single-node Run / manual config).
  const dataRefs = data.references
  if (Array.isArray(dataRefs)) {
    for (const r of dataRefs) {
      if (!r || typeof r !== "object") continue
      const type = (r as { type?: unknown }).type
      const url = (r as { url?: unknown }).url
      if (type === "video" || type === "image" || type === "audio") push(type, url)
    }
  }

  return refs
}

// ---------------------------------------------------------------------------
// List-like node helpers for buildNodeRefMap edge-aware output extraction
// ---------------------------------------------------------------------------

const LIST_LIKE_TYPES = new Set(["list", "split-text"])

/** Return the outputMode from connecting edges, defaulting to "each" for list-like nodes. */
function getEdgeOutputMode(
  connectingEdges: ReadonlyArray<SimpleEdge>,
): string {
  for (const edge of connectingEdges) {
    const mode = (edge.data as Record<string, unknown> | undefined)
      ?.outputMode as string | undefined
    if (mode) return mode
  }
  return "each"
}

/** Parse the list of items from a list/split-text node. */
function extractListItems(
  node: SimpleNode,
  states: Record<string, NodeExecutionState>,
): string[] {
  const data = node.data
  if (node.type === "list") {
    // Modern format: columns + rows. Without this, node refs like {List Name}
    // resolving to list items only saw the legacy items string; modern lists
    // returned an empty array.
    const cols = data.columns as Array<{ handleId: string }> | undefined
    if (cols) {
      const rows = data.rows as string[][] | undefined
      return (rows ?? []).map((r) => r[0]?.trim() ?? "").filter(Boolean)
    }
    // Rows-only shape (rows present, columns absent) — the loop→list rename
    // does NOT backfill columns, so a renamed rows-only loop lands here. Read
    // the first column (as the retired `loop` case did), BEFORE the legacy
    // `items` fallback, so `list` is a true superset of `loop`.
    const rowsOnly = data.rows as string[][] | undefined
    if (rowsOnly) {
      return rowsOnly.map((r) => r[0]?.trim() ?? "").filter(Boolean)
    }
    // Legacy format: newline-separated items string
    return ((data.items as string | undefined) || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
  }
  if (node.type === "split-text") {
    const state = states[node.id]
    if (state?.output?.splitResults) return state.output.splitResults
    return (data.splitResults as string[] | undefined) ?? []
  }
  return []
}

/** Resolve a list of items using the given output mode. */
function resolveListOutput(
  items: string[],
  mode: string,
): string | undefined {
  if (items.length === 0) return undefined
  // "last" here means the final item in a list-like source (list/loop/split-text),
  // because lists have no user-selection concept. For generic sources, "last"
  // ("Selected" in the UI) means the currently selected result via
  // activeResultIndex — handled separately in input-resolver.ts.
  if (mode === "last") return items[items.length - 1]
  if (mode.startsWith("item:")) {
    const idx = parseInt(mode.split(":")[1], 10)
    return items[idx] ?? items[0]
  }
  if (mode === "all") return items.join(", ")
  // "each" — return first item; fan-out clones get their own item via execution engine
  return items[0]
}

/**
 * Build a label→output map for resolving {Node Label} refs in text fields.
 * Uses BFS with edge tracking so list/loop/split-text nodes respect the
 * connecting edge's outputMode (e.g. "item:1", "last", "all").
 */
export function buildNodeRefMap(
  nodeId: string,
  ctx?: PayloadBuildContext,
): Map<string, string> {
  const map = new Map<string, string>()
  if (!ctx?.nodes || !ctx?.edges || !ctx?.nodeStates) return map

  const nodes = ctx.nodes
  const edges = ctx.edges
  const states = ctx.nodeStates
  // Index nodes by id and edges by target once, so the BFS below is O(N+E)
  // instead of re-scanning every node/edge on each dequeued node.
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const))
  const edgesByTarget = new Map<string, SimpleEdge[]>()
  for (const edge of edges) {
    const group = edgesByTarget.get(edge.target)
    if (group) group.push(edge)
    else edgesByTarget.set(edge.target, [edge])
  }
  const visited = new Set<string>()
  const queue: Array<{ id: string; connectingEdges: ReadonlyArray<SimpleEdge> }> = []

  // Seed BFS with direct parents, grouping edges by source
  const seedEdges = new Map<string, SimpleEdge[]>()
  for (const edge of edgesByTarget.get(nodeId) ?? []) {
    if (!seedEdges.has(edge.source)) seedEdges.set(edge.source, [])
    seedEdges.get(edge.source)!.push(edge)
  }
  for (const [sourceId, edgeGroup] of seedEdges) {
    visited.add(sourceId)
    queue.push({ id: sourceId, connectingEdges: edgeGroup })
  }

  while (queue.length > 0) {
    const { id: currentId, connectingEdges } = queue.shift()!
    const node = nodesById.get(currentId)
    if (!node) continue

    const label = (node.data.label as string) || node.type || currentId

    // List-like nodes always go through list extraction (even "each" is not
    // regular behavior — it's fan-out, so the ref should resolve via items)
    let output: string | undefined
    if (LIST_LIKE_TYPES.has(node.type)) {
      const mode = getEdgeOutputMode(connectingEdges)
      const items = extractListItems(node, states)
      output = resolveListOutput(items, mode)
    }

    // All other nodes: extract from state or node data
    if (output === undefined) {
      const state = states[currentId]
      if (state?.output?.text) {
        output = state.output.text
      } else if (state?.output?.imageUrl) {
        output = state.output.imageUrl
      } else if (state?.output?.videoUrl) {
        output = state.output.videoUrl
      } else if (state?.output?.audioUrl) {
        output = state.output.audioUrl
      } else if (PARAMETER_NODE_TYPES.has(node.type)) {
        // Parameter nodes (Animal, Setting, Style, etc.) don't have job outputs —
        // derive a text hint from their picker state so {Label} refs resolve to a
        // meaningful string. Mirrors the frontend extractNodeOutput branch at
        // execution-graph.ts:600.
        output = getNodePromptHint(node) || undefined
      } else {
        const saved = extractSavedNodeOutput(node)
        if (saved) {
          output = saved.text ?? saved.imageUrl ?? saved.videoUrl ?? saved.audioUrl
        }
      }
    }

    if (output) map.set(label, output)

    // BFS: traverse to parents of current node
    const nextEdges = new Map<string, SimpleEdge[]>()
    for (const edge of edgesByTarget.get(currentId) ?? []) {
      if (!visited.has(edge.source)) {
        if (!nextEdges.has(edge.source)) nextEdges.set(edge.source, [])
        nextEdges.get(edge.source)!.push(edge)
      }
    }
    for (const [sourceId, edgeGroup] of nextEdges) {
      visited.add(sourceId)
      queue.push({ id: sourceId, connectingEdges: edgeGroup })
    }
  }

  return map
}

/** Resolve {Node Label} refs in a text string if the map is non-empty. */
function resolveRefs(text: string | undefined, refMap: Map<string, string>): string | undefined {
  if (!text || refMap.size === 0) return text
  return resolveNodeRefs(text, refMap)
}

// ---------------------------------------------------------------------------
// Camera-motion v2 (graph-aware) — collect prompt hints from connected
// parameter nodes via the source camera-motion node's startState/endState
// input handles. Mirror of the frontend executor (execute-node.ts).
// ---------------------------------------------------------------------------

/**
 * Extract a prompt-hint string from a parameter-style node by dispatching to
 * the shared `getParameterPromptHint`. Backend parameter nodes don't execute,
 * so values come straight from the node's data record.
 *
 * The shared dispatcher is the single source of truth shared with the frontend
 * DAG executor — keep both call sites lined up by editing it instead of this
 * one-line wrapper.
 */
function getNodePromptHint(node: SimpleNode | undefined): string {
  return getParameterPromptHint(node)
}

/**
 * True when the consumer node has a connected Style parameter node on its
 * `cinematography` handle. Mirror of the frontend `hasConnectedStyleNode`.
 * Used to bypass the inline `style` field on image payloads — when a Style
 * node is wired, its richer promptHint is already appended via cinematography
 * hints, so we skip the thin inline `Style: <id>` append.
 */
function hasConnectedStyleNode(
  consumerNodeId: string,
  ctx: PayloadBuildContext | undefined,
): boolean {
  const nodes = ctx?.nodes ?? []
  const edges = ctx?.edges ?? []
  for (const edge of edges) {
    if (edge.target !== consumerNodeId) continue
    // Generate Image v2.1 splits `style` into `look` + `elements`; accept all
    // four (legacy + v2 + v2.1) so the connected-style check stays correct
    // across the migration window.
    if (
      edge.targetHandle !== "cinematography" &&
      edge.targetHandle !== "style" &&
      edge.targetHandle !== "look" &&
      edge.targetHandle !== "elements"
    ) continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (srcNode?.type === "style") return true
  }
  return false
}

/**
 * Walk the `cinematography` target handle's incoming edges on a consumer node
 * and aggregate one prompt-hint string per connected source. Camera-motion
 * sources are composed via their own startState/endState walk; all other
 * parameter nodes dispatch through `getNodePromptHint`.
 *
 * Mirror of the frontend executor (execute-node.ts:collectCinematographyHints).
 */
/** Video-only cinematography dims; callers targeting still-image consumers
 *  pass these via `options.excludeTypes` to strip incoherent hints. */
const STILL_IMAGE_EXCLUDE_TYPES: ReadonlySet<string> = new Set(["camera-motion", "character-fx", "temporal", "transition"])

function collectCinematographyHints(
  consumerNodeId: string,
  ctx: PayloadBuildContext | undefined,
  options?: { excludeTypes?: ReadonlySet<string> },
): string[] {
  const hints: string[] = []
  const nodes = ctx?.nodes ?? []
  const edges = ctx?.edges ?? []
  const exclude = options?.excludeTypes
  for (const edge of edges) {
    if (edge.target !== consumerNodeId) continue
    // v2.1: accept `cinematography` / `style` / `look` / `elements` — all four
    // route hints through this same collector at runtime.
    if (
      edge.targetHandle !== "cinematography" &&
      edge.targetHandle !== "style" &&
      edge.targetHandle !== "look" &&
      edge.targetHandle !== "elements"
    ) continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    if (exclude?.has(srcNode.type ?? "")) continue

    if (srcNode.type === "camera-motion") {
      // Use the shared getParameterPromptHint WITH graph context so the
      // startState/endState walk runs AND the node's preText/postText is applied
      // (withCustomText). The old composeCameraMotionHintForNode bypassed custom
      // text (and dropped everything when no motion was set), so it was lost at
      // execution while the injection preview promised it.
      const composed = getParameterPromptHint(srcNode, { nodes, edges })
      if (composed) hints.push(composed)
      continue
    }

    const hint = getNodePromptHint(srcNode)
    if (hint) hints.push(hint)
  }
  return hints
}

/**
 * Audio-style aggregator. Mirror of the frontend `collectAudioStyleHints` —
 * delegates to the shared composer so the canvas preview and orchestrator
 * runs produce byte-identical prompt enrichment for the 4 audio consumers
 * (suno-generate, generate-music, voice-design, text-to-audio).
 */
function collectAudioStyleHints(
  consumerNode: SimpleNode,
  consumerType: SoundConsumerType,
  ctx: PayloadBuildContext | undefined,
): SoundComposition {
  const allNodes = ctx?.nodes ?? []
  const allEdges = ctx?.edges ?? []
  return composeSoundHintFromConnections(
    { id: consumerNode.id, type: consumerNode.type, data: consumerNode.data },
    consumerType,
    {
      nodes: allNodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
      edges: allEdges.map((e) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      })),
    },
  )
}

/**
 * Walk upstream Character nodes and return the strongest identityLock clause
 * (or empty string). Mirror of frontend `collectIdentityLockClause` —
 * delegates to the shared implementation but adapts the `(nodeId, ctx)`
 * call signature used elsewhere in this file.
 */
function collectIdentityLockClause(consumerNodeId: string, ctx: PayloadBuildContext | undefined): string {
  if (!ctx?.nodes || !ctx?.edges) return ""
  return sharedCollectIdentityLockClause(consumerNodeId, ctx.nodes, ctx.edges)
}

/**
 * Compose a video-generation prompt: merge user prompt + cinematography hints
 * + identity-lock clause. Used by both the legacy image-to-video / text-to-video
 * cases AND the new generate-video case so all three emit identical text.
 *
 * The optional `motionHint` is prepended to the cinematography hint list before
 * joining — so an i2v node with `motion="zoom"` and a connected camera hint
 * "tracking shot" emits `"<user>. zoom motion, tracking shot"` (single sentence,
 * comma-separated). Without the motion hint, behaviour matches t2v exactly:
 * `"<user>. <cine1>, <cine2>"`.
 *
 * Caller is responsible for any provider-specific motion/data fallback chains
 * (e.g. i2v's `data.motionPrompt` initial fallback) — pass them as `rawPrompt`.
 */
function composeVideoPrompt(args: {
  rawPrompt: string | undefined
  nodeId: string
  buildCtx: PayloadBuildContext | undefined
  motionHint?: string | undefined
}): string | undefined {
  let p = args.rawPrompt
  const hints: string[] = []
  if (args.motionHint) hints.push(args.motionHint)
  const cinematographyHints = collectCinematographyHints(args.nodeId, args.buildCtx)
  for (const h of cinematographyHints) hints.push(h)
  if (hints.length > 0) {
    const joined = hints.join(", ")
    p = p ? `${p}. ${joined}` : joined
  }
  const identityClause = collectIdentityLockClause(args.nodeId, args.buildCtx)
  if (identityClause) p = p ? `${p} ${identityClause}` : identityClause
  return p
}

export function buildPayload(
  node: SimpleNode,
  jobId: string,
  resolvedInputs: ResolvedInputs,
  usageLogId?: string,
  buildCtx?: PayloadBuildContext,
): PayloadResult {
  const data = node.data
  const type = node.type

  // Build label→output map for resolving {Node Label} refs in text fields
  const refMap = buildNodeRefMap(node.id, buildCtx)
  // Pre-resolve refs in the upstream prompt so all downstream code sees clean text
  if (resolvedInputs.prompt && refMap.size > 0) {
    resolvedInputs.prompt = resolveRefs(resolvedInputs.prompt, refMap)
  }

  // Typed-primary prompt resolution for single-prompt nodes (precedence:
  // override > typed candidate fields > wired). Shared with the frontend
  // executor via @nodaro/shared so field-selection + precedence are
  // structurally identical. Each single-prompt case below calls promptFor(type).
  const promptFor = (nodeType: string) =>
    computeNodePrompt(nodeType, data, {
      wired: resolvedInputs.prompt,
      override: resolvedInputs.overridePrompt,
      refMap,
    })

  switch (type) {
    // --- Image generation ---
    case "generate-image": {
      const provider = (data.provider as string) ?? "nano-banana"
      const settings = buildCtx?.settings

      // Build a map of all available reference images by ID
      const refUrlMap = new Map<string, string>()

      // Manual uploads (new multi-image format: ManualReferenceImage[])
      const manualRefs = data.referenceImageUrls as Array<{ id: string; url: string }> | undefined
      if (manualRefs?.length) {
        for (const img of manualRefs) {
          refUrlMap.set(img.id, img.url)
        }
      }
      // Legacy single referenceImageUrl
      const nodeRefUrl = data.referenceImageUrl as string | undefined
      if (nodeRefUrl && refUrlMap.size === 0) {
        refUrlMap.set("__legacy__", nodeRefUrl)
      }
      // Wired upstream images — use source node IDs as keys (matching frontend)
      const chainRefs = resolvedInputs.referenceImageUrls
        ?? (resolvedInputs.imageUrl ? [resolvedInputs.imageUrl] : undefined)
      if (chainRefs) {
        const imageSourceTypes = new Set(["upload-image", "generate-image", "edit-image", "image-to-image", "modify-image", "upscale-image", "remove-background", "extract-frame"])
        const wiredSourceIds = (buildCtx?.edges ?? [])
          .filter((e) => e.target === node.id)
          .map((e) => (buildCtx?.nodes ?? []).find((n) => n.id === e.source))
          .filter((n): n is SimpleNode => !!n && imageSourceTypes.has(n.type))
          .map((n) => n.id)
        for (let i = 0; i < chainRefs.length; i++) {
          const key = wiredSourceIds[i] ?? `wired_${i}`
          refUrlMap.set(key, chainRefs[i])
        }
      }
      const extractedRefs = data.extractedReferenceUrls as string[] | undefined
      if (extractedRefs) {
        for (let i = 0; i < extractedRefs.length; i++) {
          refUrlMap.set(`extracted_${i}`, extractedRefs[i])
        }
      }
      // Character reference images
      const charIds = (data.characterDefinitionIds as string[]) ?? []
      const charDefs = (settings?.characterDefinitions ?? []).filter(
        (c) => charIds.includes(c.id),
      )
      for (const c of charDefs) {
        if (c.type === "reference" && c.referenceImageUrl) {
          refUrlMap.set(`char_${c.id}`, c.referenceImageUrl)
        }
      }

      // Apply ordering: use referenceImageOrder if set, otherwise default map order
      const orderIds = (data.referenceImageOrder as string[]) ?? []
      const directRefs: string[] = []
      const seen = new Set<string>()
      for (const id of orderIds) {
        const url = refUrlMap.get(id)
        if (url) {
          directRefs.push(url)
          seen.add(id)
        }
      }
      for (const [id, url] of refUrlMap) {
        if (!seen.has(id)) directRefs.push(url)
      }

      // Ancestor refs fallback
      const ancestorRefs = directRefs.length === 0 && buildCtx?.nodes && buildCtx?.edges && buildCtx?.nodeStates
        ? collectAncestorRefs(node.id, buildCtx.nodes, buildCtx.edges, buildCtx.nodeStates)
        : []

      let rawPrompt = promptFor("generate-image")
      {
        const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES })
        if (cinematographyHints.length > 0) {
          const joined = cinematographyHints.join(", ")
          rawPrompt = rawPrompt ? `${rawPrompt}. ${joined}` : joined
        }
      }
      {
        const identityClause = collectIdentityLockClause(node.id, buildCtx)
        if (identityClause) rawPrompt = rawPrompt ? `${rawPrompt} ${identityClause}` : identityClause
      }

      // Wired-character @-mention expansion: when an upstream Character node
      // is wired, ALWAYS route through `connectedReferences` so buildImagePrompt's
      // Phase 0 applies the per-character contract uniformly:
      //   - mentioned (`@kira:N:smile`) → variant URL only, no canonical.
      //   - unmentioned wired character → canonical URL via the default
      //     fallback (matches pre-mention behavior of "wire = use it").
      // This is the path the frontend takes too — keeping them aligned is the
      // entire point of running the workflow through the orchestrator producing
      // identical output to a frontend single-node run.
      // We ALSO route through `connectedReferences` when user-attached extras
      // exist (even without a wired character) — extras need the dedicated
      // directive emission in `buildExtraRefDirectives`.
      const wiredCharRefs = expandWiredCharacterRefs(node.id, buildCtx)
      // Phase 2 #1: location canonical-description injection. Prepend wired
      // Location refs so the directive builder emits "Image N (location —
      // <canonical>)" bullets. URL-dedupe in the connected-refs builder
      // keeps a Location's main image URL from appearing twice if it also
      // arrived via the chainRefs path.
      const wiredLocRefs = expandWiredLocationRefs(node.id, buildCtx)
      const extraRefEntries = expandExtraRefsToConnectedReferences(
        readExtraRefs(data),
        buildExtraRefCharacterContextLookup(node.id, buildCtx),
      )
      const hasWiredCharacter = wiredCharRefs.length > 0
      const useConnectedRefs = hasWiredCharacter || extraRefEntries.length > 0

      // ─── Character LoRA routing decision (see design §6.3) ─────────────
      // EXACTLY ONE distinct character mentioned AND that character has a
      // succeeded LoRA → swap to replicate/flux-lora-character, skip ref
      // injection, strip mention tokens, prepend trigger word.
      // Gated by CHARACTER_LORA_ROUTING_ENABLED (default true) — operators
      // can flip the env to "false" to disable the swap org-wide without
      // a deploy if inference quality regresses.
      const lora = config.CHARACTER_LORA_ROUTING_ENABLED
        ? selectLoraRoutingForMentions(wiredCharRefs)
        : null
      const effectiveProvider = lora ? "replicate" : provider
      const loraExtras = lora
        ? {
            lora_version: lora.loraVersion,
            lora_trigger: lora.triggerWord,
          }
        : undefined

      // Use shared prompt builder (single source of truth with frontend)
      const styleBypass = hasConnectedStyleNode(node.id, buildCtx)
      const generateRefOrder = readStringArray(data.referenceOrder)
      const generateSuppressed = readStringArray(data.suppressedCanonicalCharacterIds)
      const generateSuppressedLoc = readStringArray(data.suppressedCanonicalLocationIds)
      // Shared node-input assembly (WI-1a) — single source of truth with the
      // frontend execute-node + Studio. `rawPrompt` is already graph-composed
      // (cinematography hints + identity clause folded above), passed as
      // `userPrompt` with NO `direction`/`structured` (composer is a no-op) →
      // byte-identical to the previous inline `buildImagePrompt` calls. No
      // `throwOnEmpty` — the orchestrator never rejected an empty prompt here.
      const result = useConnectedRefs
        ? assembleImageInput({
            userPrompt: rawPrompt,
            provider: effectiveProvider,
            style: styleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
            negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
            characterDefs: charDefs as CharacterDef[],
            userTemplates: settings?.userPromptTemplates,
            flowTemplates: settings?.flowPromptTemplates,
            connectedReferences: [
              ...buildConnectedRefsForGenerate(
                wiredCharRefs,
                refUrlMap,
                orderIds,
                wiredLocRefs,
              ),
              ...extraRefEntries,
            ],
            ancestorRefs,
            referenceOrder: generateRefOrder,
            suppressedCanonicalCharacterIds: generateSuppressed,
            suppressedCanonicalLocationIds: generateSuppressedLoc,
            // LoRA path: skip mention machinery (trigger word + LoRA carry identity).
            skipCharacterMentions: lora !== null,
          })
        : assembleImageInput({
            userPrompt: rawPrompt,
            provider: effectiveProvider,
            style: styleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
            negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
            characterDefs: charDefs as CharacterDef[],
            userTemplates: settings?.userPromptTemplates,
            flowTemplates: settings?.flowPromptTemplates,
            extraReferenceImageUrls: directRefs,
            ancestorRefs,
            referenceOrder: generateRefOrder,
            suppressedCanonicalCharacterIds: generateSuppressed,
            suppressedCanonicalLocationIds: generateSuppressedLoc,
          })

      return {
        jobName: "generate-image",
        queueName: "video-generation",
        modelIdentifier: lora
          ? FLUX_LORA_CHARACTER_MODEL_ID
          : buildCreditModelIdentifier(
              provider,
              data.quality as string | undefined,
              data.resolution as string | undefined,
              data.renderingSpeed as string | undefined,
            ),
        payload: {
          jobId,
          prompt: result.prompt,
          // LoRA path emits zero refs — the trained LoRA + trigger word carry identity.
          referenceImageUrls: lora ? [] : result.referenceImageUrls,
          provider: effectiveProvider,
          // Hand the synthetic model id to the Replicate provider when LoRA is
          // active. Otherwise pass `undefined` so the worker falls back to
          // `provider` for routing — `data.model` is a frontend DISPLAY name
          // (e.g. "gemini-2.5-flash-image" for "nano-banana") and is NOT a
          // valid provider/router model identifier. Matches the single-node
          // route at `routes/generate-image.ts:288`.
          model: lora ? FLUX_LORA_CHARACTER_MODEL_ID : undefined,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          quality: data.quality,
          negativePrompt: result.nativeNegativePrompt,
          seed: data.seed,
          renderingSpeed: data.renderingSpeed,
          styleType: data.styleType,
          expandPrompt: data.expandPrompt,
          // Pass lora_version + lora_trigger through to ReplicateImageProvider.buildInput.
          extraParams: loraExtras,
          usageLogId,
        },
      }
    }

    case "edit-image": {
      const provider = (data.provider as string) ?? "recraft-upscale"

      // Apply connectedMediaOrder to determine main image vs references
      let mainImageUrl = resolvedInputs.imageUrl || data.imageUrl
      let editRefUrls: string[] | undefined
      const connectedOrder = data.connectedMediaOrder as string[] | undefined
      if (connectedOrder?.length && resolvedInputs.referenceImageUrls?.length) {
        const allNodes = buildCtx?.nodes ?? []
        const allEdges = buildCtx?.edges ?? []
        const states = buildCtx?.nodeStates ?? {}
        const sourceNodeIds = allEdges
          .filter((e) => e.target === node.id)
          .map((e) => e.source)
        const sourceNodes = sourceNodeIds
          .map((id) => allNodes.find((n) => n.id === id))
          .filter((n): n is SimpleNode => !!n)
        const ordered = applyOrder(sourceNodes, connectedOrder)
        const orderedUrls = ordered
          .map((n) => getNodeImageUrl(n, states))
          .filter((u): u is string => !!u)
        if (orderedUrls.length > 0) {
          mainImageUrl = orderedUrls[0]
          editRefUrls = orderedUrls.slice(1)
        }
      }

      let editPrompt = (resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap)) as string | undefined
      if (provider === "nano-banana-edit" && editPrompt) {
        const charIds = (data.characterDefinitionIds as string[]) ?? []
        const charDefs = (buildCtx?.settings?.characterDefinitions ?? []).filter(
          (c: { id: string }) => charIds.includes(c.id),
        )
        if (charDefs.length > 0) {
          const descriptions = charDefs
            .map((c: { name: string; description?: string }) =>
              c.description ? `${c.name}: ${c.description}` : c.name,
            )
            .join("; ")
          editPrompt = `${editPrompt}\n\nContext: ${descriptions}`
        }
      }
      {
        const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES })
        if (cinematographyHints.length > 0) {
          const joined = cinematographyHints.join(", ")
          editPrompt = editPrompt ? `${editPrompt}. ${joined}` : joined
        }
      }
      {
        const identityClause = collectIdentityLockClause(node.id, buildCtx)
        if (identityClause) editPrompt = editPrompt ? `${editPrompt} ${identityClause}` : identityClause
      }

      const targetResolution = data.targetResolution as string | undefined
      return {
        jobName: "edit-image",
        queueName: "video-generation",
        modelIdentifier: buildCreditModelIdentifier(provider, undefined, undefined, undefined, targetResolution),
        payload: {
          jobId,
          imageUrl: mainImageUrl,
          prompt: editPrompt,
          provider,
          upscaleFactor: data.upscaleFactor,
          targetResolution,
          aspectRatio: data.aspectRatio,
          negativePrompt: data.negativePrompt,
          style: hasConnectedStyleNode(node.id, buildCtx) ? undefined : data.style,
          seed: data.seed,
          referenceImageUrls: editRefUrls,
          usageLogId,
        },
      }
    }

    case "image-to-image": {
      const provider = (data.provider as string) ?? "nano-banana"
      const settings = buildCtx?.settings

      // Apply connectedMediaOrder to determine main image vs references
      let i2iMainImage = resolvedInputs.imageUrl || data.imageUrl
      let i2iChainRefs = resolvedInputs.referenceImageUrls ?? []
      const i2iOrder = data.connectedMediaOrder as string[] | undefined
      if (i2iOrder?.length && i2iChainRefs.length > 0) {
        const allNodes = buildCtx?.nodes ?? []
        const allEdges = buildCtx?.edges ?? []
        const states = buildCtx?.nodeStates ?? {}
        const srcIds = allEdges.filter((e) => e.target === node.id).map((e) => e.source)
        const srcNodes = srcIds
          .map((id) => allNodes.find((n) => n.id === id))
          .filter((n): n is SimpleNode => !!n)
        const ordered = applyOrder(srcNodes, i2iOrder)
        const orderedUrls = ordered
          .map((n) => getNodeImageUrl(n, states))
          .filter((u): u is string => !!u)
        if (orderedUrls.length > 0) {
          i2iMainImage = orderedUrls[0]
          i2iChainRefs = orderedUrls.slice(1)
        }
      }

      // Collect reference images from character assets
      const charIds = (data.characterDefinitionIds as string[]) ?? []
      const charDefs = (settings?.characterDefinitions ?? []).filter(
        (c) => charIds.includes(c.id),
      )
      const charRefUrls = charDefs
        .filter((c) => c.type === "reference" && c.referenceImageUrl)
        .map((c) => c.referenceImageUrl as string)
      const nodeRefUrl = data.referenceImageUrl as string | undefined
      const directRefs = [
        ...(nodeRefUrl ? [nodeRefUrl] : []),
        ...i2iChainRefs,
        ...charRefUrls,
      ]

      let rawPrompt = resolveRefs(resolvedInputs.prompt as string | undefined, refMap)
        || resolveRefs(data.prompt as string | undefined, refMap)
        || ""
      {
        const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES })
        if (cinematographyHints.length > 0) {
          const joined = cinematographyHints.join(", ")
          rawPrompt = rawPrompt ? `${rawPrompt}. ${joined}` : joined
        }
      }
      {
        const identityClause = collectIdentityLockClause(node.id, buildCtx)
        if (identityClause) rawPrompt = rawPrompt ? `${rawPrompt} ${identityClause}` : identityClause
      }

      // Wired-character @-mention expansion: see generate-image case above.
      // Same uniform-path strategy — always route through `connectedReferences`
      // when any wired character exists so the canonical fallback applies for
      // unmentioned characters and frontend/backend parity is preserved.
      const i2iWiredCharRefs = expandWiredCharacterRefs(node.id, buildCtx)
      const i2iWiredLocRefs = expandWiredLocationRefs(node.id, buildCtx)  // Phase 2 #1
      const i2iExtraRefEntries = expandExtraRefsToConnectedReferences(
        readExtraRefs(data),
        buildExtraRefCharacterContextLookup(node.id, buildCtx),
      )
      const i2iUseConnectedRefs =
        i2iWiredCharRefs.length > 0 || i2iWiredLocRefs.length > 0 || i2iExtraRefEntries.length > 0

      // Build prompt with style + character descriptions (same as generate-image)
      const i2iStyleBypass = hasConnectedStyleNode(node.id, buildCtx)
      const i2iRefOrder = readStringArray(data.referenceOrder)
      const i2iSuppressed = readStringArray(data.suppressedCanonicalCharacterIds)
      const i2iSuppressedLoc = readStringArray(data.suppressedCanonicalLocationIds)
      const i2iResult = i2iUseConnectedRefs
        ? buildImagePrompt({
            prompt: rawPrompt,
            provider,
            style: i2iStyleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
            negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
            characterDefs: charDefs as CharacterDef[],
            userTemplates: settings?.userPromptTemplates,
            flowTemplates: settings?.flowPromptTemplates,
            connectedReferences: [
              ...buildConnectedRefsFromUrls(i2iWiredCharRefs, directRefs, i2iWiredLocRefs),
              ...i2iExtraRefEntries,
            ],
            ancestorRefs: [],
            referenceOrder: i2iRefOrder,
            suppressedCanonicalCharacterIds: i2iSuppressed,
            suppressedCanonicalLocationIds: i2iSuppressedLoc,
          })
        : buildImagePrompt({
            prompt: rawPrompt,
            provider,
            style: i2iStyleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
            negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
            characterDefs: charDefs as CharacterDef[],
            userTemplates: settings?.userPromptTemplates,
            flowTemplates: settings?.flowPromptTemplates,
            referenceImageUrls: directRefs,
            ancestorRefs: [],
            referenceOrder: i2iRefOrder,
            suppressedCanonicalCharacterIds: i2iSuppressed,
            suppressedCanonicalLocationIds: i2iSuppressedLoc,
          })

      return {
        jobName: "image-to-image",
        queueName: "video-generation",
        modelIdentifier: buildCreditModelIdentifier(
          provider,
          data.quality as string | undefined,
          data.resolution as string | undefined,
          data.renderingSpeed as string | undefined,
        ),
        payload: {
          jobId,
          imageUrl: i2iMainImage,
          prompt: i2iResult.prompt,
          referenceImageUrls: i2iResult.referenceImageUrls,
          provider,
          strength: data.strength,
          aspectRatio: data.aspectRatio,
          resolution: data.resolution,
          quality: data.quality,
          negativePrompt: i2iResult.nativeNegativePrompt,
          seed: data.seed,
          renderingSpeed: data.renderingSpeed,
          guidanceScale: data.guidanceScale,
          maskUrl: resolvedInputs.maskUrl || (data.maskUrl as string | undefined),
          usageLogId,
        },
      }
    }

    case "modify-image": {
      const provider = (data.provider as string) ?? "nano-banana"
      if (provider === "nano-banana-edit") {
        // Same logic as edit-image case for nano-banana-edit

        // Apply connectedMediaOrder to determine main image vs references
        let mainImageUrl = resolvedInputs.imageUrl || data.imageUrl
        let editRefUrls: string[] | undefined
        const connectedOrder = data.connectedMediaOrder as string[] | undefined
        if (connectedOrder?.length && resolvedInputs.referenceImageUrls?.length) {
          const allNodes = buildCtx?.nodes ?? []
          const allEdges = buildCtx?.edges ?? []
          const states = buildCtx?.nodeStates ?? {}
          const sourceNodeIds = allEdges
            .filter((e) => e.target === node.id)
            .map((e) => e.source)
          const sourceNodes = sourceNodeIds
            .map((id) => allNodes.find((n) => n.id === id))
            .filter((n): n is SimpleNode => !!n)
          const ordered = applyOrder(sourceNodes, connectedOrder)
          const orderedUrls = ordered
            .map((n) => getNodeImageUrl(n, states))
            .filter((u): u is string => !!u)
          if (orderedUrls.length > 0) {
            mainImageUrl = orderedUrls[0]
            editRefUrls = orderedUrls.slice(1)
          }
        }

        let editPrompt = (resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap)) as string | undefined
        if (editPrompt) {
          const charIds = (data.characterDefinitionIds as string[]) ?? []
          const charDefs = (buildCtx?.settings?.characterDefinitions ?? []).filter(
            (c: { id: string }) => charIds.includes(c.id),
          )
          if (charDefs.length > 0) {
            const descriptions = charDefs
              .map((c: { name: string; description?: string }) =>
                c.description ? `${c.name}: ${c.description}` : c.name,
              )
              .join("; ")
            editPrompt = `${editPrompt}\n\nContext: ${descriptions}`
          }
        }
        {
          const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES })
          if (cinematographyHints.length > 0) {
            const joined = cinematographyHints.join(", ")
            editPrompt = editPrompt ? `${editPrompt}. ${joined}` : joined
          }
        }
        {
          const identityClause = collectIdentityLockClause(node.id, buildCtx)
          if (identityClause) editPrompt = editPrompt ? `${editPrompt} ${identityClause}` : identityClause
        }

        return {
          jobName: "edit-image",
          queueName: "video-generation",
          modelIdentifier: buildCreditModelIdentifier(provider),
          payload: {
            jobId,
            imageUrl: mainImageUrl,
            prompt: editPrompt,
            provider,
            aspectRatio: data.aspectRatio,
            negativePrompt: data.negativePrompt,
            style: hasConnectedStyleNode(node.id, buildCtx) ? undefined : data.style,
            seed: data.seed,
            referenceImageUrls: editRefUrls,
            usageLogId,
          },
        }
      } else {
        // All other providers route through image-to-image
        const settings = buildCtx?.settings

        // Apply connectedMediaOrder to determine main image vs references
        let i2iMainImage = resolvedInputs.imageUrl || data.imageUrl
        let i2iChainRefs = resolvedInputs.referenceImageUrls ?? []
        const i2iOrder = data.connectedMediaOrder as string[] | undefined
        if (i2iOrder?.length && i2iChainRefs.length > 0) {
          const allNodes = buildCtx?.nodes ?? []
          const allEdges = buildCtx?.edges ?? []
          const states = buildCtx?.nodeStates ?? {}
          const srcIds = allEdges.filter((e) => e.target === node.id).map((e) => e.source)
          const srcNodes = srcIds
            .map((id) => allNodes.find((n) => n.id === id))
            .filter((n): n is SimpleNode => !!n)
          const ordered = applyOrder(srcNodes, i2iOrder)
          const orderedUrls = ordered
            .map((n) => getNodeImageUrl(n, states))
            .filter((u): u is string => !!u)
          if (orderedUrls.length > 0) {
            i2iMainImage = orderedUrls[0]
            i2iChainRefs = orderedUrls.slice(1)
          }
        }

        // Collect reference images from character assets
        const charIds = (data.characterDefinitionIds as string[]) ?? []
        const charDefs = (settings?.characterDefinitions ?? []).filter(
          (c) => charIds.includes(c.id),
        )
        const charRefUrls = charDefs
          .filter((c) => c.type === "reference" && c.referenceImageUrl)
          .map((c) => c.referenceImageUrl as string)
        const nodeRefUrl = data.referenceImageUrl as string | undefined
        const directRefs = [
          ...(nodeRefUrl ? [nodeRefUrl] : []),
          ...i2iChainRefs,
          ...charRefUrls,
        ]

        let rawPrompt = resolveRefs(resolvedInputs.prompt as string | undefined, refMap)
          || resolveRefs(data.prompt as string | undefined, refMap)
          || ""
        {
          const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES })
          if (cinematographyHints.length > 0) {
            const joined = cinematographyHints.join(", ")
            rawPrompt = rawPrompt ? `${rawPrompt}. ${joined}` : joined
          }
        }
        {
          const identityClause = collectIdentityLockClause(node.id, buildCtx)
          if (identityClause) rawPrompt = rawPrompt ? `${rawPrompt} ${identityClause}` : identityClause
        }

        // Wired-character @-mention expansion: see generate-image case above.
        // Uniform-path: always use `connectedReferences` when any wired
        // character exists so the per-character contract (mentioned → variant
        // only / unmentioned → canonical fallback) applies in both paths.
        const modWiredCharRefs = expandWiredCharacterRefs(node.id, buildCtx)
        const modWiredLocRefs = expandWiredLocationRefs(node.id, buildCtx)  // Phase 2 #1
        const modExtraRefEntries = expandExtraRefsToConnectedReferences(
          readExtraRefs(data),
          buildExtraRefCharacterContextLookup(node.id, buildCtx),
        )
        const modUseConnectedRefs =
          modWiredCharRefs.length > 0 || modWiredLocRefs.length > 0 || modExtraRefEntries.length > 0

        const modStyleBypass = hasConnectedStyleNode(node.id, buildCtx)
        const modRefOrder = readStringArray(data.referenceOrder)
        const modSuppressed = readStringArray(data.suppressedCanonicalCharacterIds)
        const modSuppressedLoc = readStringArray(data.suppressedCanonicalLocationIds)
        const i2iResult = modUseConnectedRefs
          ? buildImagePrompt({
              prompt: rawPrompt,
              provider,
              style: modStyleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
              negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
              characterDefs: charDefs as CharacterDef[],
              userTemplates: settings?.userPromptTemplates,
              flowTemplates: settings?.flowPromptTemplates,
              connectedReferences: [
                ...buildConnectedRefsFromUrls(modWiredCharRefs, directRefs, modWiredLocRefs),
                ...modExtraRefEntries,
              ],
              ancestorRefs: [],
              referenceOrder: modRefOrder,
              suppressedCanonicalCharacterIds: modSuppressed,
              suppressedCanonicalLocationIds: modSuppressedLoc,
            })
          : buildImagePrompt({
              prompt: rawPrompt,
              provider,
              style: modStyleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
              negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
              characterDefs: charDefs as CharacterDef[],
              userTemplates: settings?.userPromptTemplates,
              flowTemplates: settings?.flowPromptTemplates,
              referenceImageUrls: directRefs,
              ancestorRefs: [],
              referenceOrder: modRefOrder,
              suppressedCanonicalCharacterIds: modSuppressed,
              suppressedCanonicalLocationIds: modSuppressedLoc,
            })

        return {
          jobName: "image-to-image",
          queueName: "video-generation",
          modelIdentifier: buildCreditModelIdentifier(
            provider,
            data.quality as string | undefined,
            data.resolution as string | undefined,
            data.renderingSpeed as string | undefined,
          ),
          payload: {
            jobId,
            imageUrl: i2iMainImage,
            prompt: i2iResult.prompt,
            referenceImageUrls: i2iResult.referenceImageUrls,
            provider,
            strength: data.strength,
            aspectRatio: data.aspectRatio,
            resolution: data.resolution,
            quality: data.quality,
            negativePrompt: i2iResult.nativeNegativePrompt,
            seed: data.seed,
            renderingSpeed: data.renderingSpeed,
            guidanceScale: data.guidanceScale,
            maskUrl: resolvedInputs.maskUrl || (data.maskUrl as string | undefined),
            usageLogId,
          },
        }
      }
    }

    case "upscale-image": {
      const provider = (data.provider as string) ?? "recraft-upscale"
      const targetResolution = data.targetResolution as string | undefined
      return {
        jobName: "edit-image",
        queueName: "video-generation",
        modelIdentifier: buildCreditModelIdentifier(provider, undefined, undefined, undefined, targetResolution),
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl,
          provider,
          upscaleFactor: data.upscaleFactor,
          targetResolution,
          usageLogId,
        },
      }
    }

    case "remove-background": {
      return {
        jobName: "edit-image",
        queueName: "video-generation",
        modelIdentifier: "recraft-remove-bg",
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl,
          provider: "recraft-remove-bg",
          usageLogId,
        },
      }
    }

    // --- Video generation ---
    case "image-to-video": {
      const provider = (data.provider as string) ?? "kling"
      const isS2 = isSeedance2Provider(provider)
      const s2Mode = isS2 ? ((data.seedance2InputMode as string | undefined) ?? "frames") : "frames"
      const hasVideoRef = (resolvedInputs.referenceVideoUrls?.length ?? 0) > 0
      // Compose the prompt first so we can run @-mention resolution against
      // it before the worker sees the final string. The mention pass swaps
      // `@kira-smile` for "Kira" + prepends a "Use these characters:" block
      // + returns variant/canonical URLs to slot into the worker payload.
      const i2vRawPrompt = promptFor("image-to-video")
      let i2vPrompt = composeVideoPrompt({
        rawPrompt: i2vRawPrompt,
        nodeId: node.id,
        buildCtx,
        motionHint: data.motionEnabled && data.motion ? `${data.motion} motion` : undefined,
      })
      const i2vMention = resolveVideoPromptMentions(i2vPrompt, node.id, buildCtx, readExtraRefs(data), {
        referenceOrder: readStringArray(data.referenceOrder),
        suppressedCanonicalCharacterIds: readStringArray(data.suppressedCanonicalCharacterIds),
      })
      i2vPrompt = i2vMention.prompt
      // Splice mention-resolved URLs into the i2v payload. i2v has two slots:
      // (1) `imageUrl` is the primary input frame, (2) `referenceImageUrls`
      // is an additional pool that maxRefImages-aware providers will consume.
      // Existing frames/refs from upstream wins — mentions augment, never
      // overwrite. When no `imageUrl` is wired yet, the first resolved
      // mention URL fills that slot so a pure "@kira-smile dancing" prompt
      // gets the smile image as input rather than failing with no image.
      const i2vBaseImage = (isS2 && s2Mode === "references")
        ? undefined
        : (resolvedInputs.startFrameUrl || resolvedInputs.imageUrl || data.imageUrl as string | undefined)
      // Apply user-defined reorder before mention-merge so the positional
      // Image-N letters assigned by `resolveVideoPromptMentions` match the
      // order shown in the config panel's drag-list. Walks the `references`
      // handle edges so end-frame / start-frame connections aren't touched.
      const i2vOrderedRefs = applyOrderToReferenceUrls(
        node.id,
        data.connectedRefImageOrder as string[] | undefined,
        buildCtx,
        (e) => e.targetHandle === "references",
      )
      const i2vBaseRefs = (isS2 && s2Mode === "frames")
        ? undefined
        : (i2vOrderedRefs ?? resolvedInputs.referenceImageUrls)
      let i2vImageUrl = i2vBaseImage
      let i2vReferenceImageUrls = i2vBaseRefs
      if (i2vMention.additionalUrls.length > 0) {
        let remainingMentionUrls = i2vMention.additionalUrls
        if (!i2vImageUrl) {
          i2vImageUrl = remainingMentionUrls[0]
          remainingMentionUrls = remainingMentionUrls.slice(1)
        }
        if (remainingMentionUrls.length > 0) {
          const existing = i2vReferenceImageUrls ?? []
          const merged: string[] = []
          const seen = new Set<string>()
          for (const u of existing) {
            if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
          }
          for (const u of remainingMentionUrls) {
            if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
          }
          i2vReferenceImageUrls = merged
        }
      }
      return {
        jobName: "image-to-video",
        queueName: "video-generation",
        modelIdentifier: buildVideoCreditModelIdentifier(
          provider,
          data.duration as number | string | undefined,
          (data.sound ?? data.kling3Sound) as boolean | undefined,
          "image-to-video",
          (data.videoSize as string | undefined) ?? (data.mode ?? data.kling3Mode) as string | undefined,
          data.resolution as string | undefined,
          hasVideoRef,
        ),
        payload: {
          jobId,
          imageUrl: i2vImageUrl,
          endFrameUrl: (isS2 && s2Mode === "references") ? undefined : resolvedInputs.endFrameUrl,
          audioUrl: resolvedInputs.audioUrl,
          prompt: i2vPrompt,
          provider,
          duration: data.duration,
          mode: data.mode ?? data.kling3Mode,
          sound: data.sound ?? data.kling3Sound,
          generateAudio: data.generateAudio,
          negativePrompt: data.negativePrompt,
          cfgScale: data.cfgScale,
          // Seedance 2 config pickers render defaults in the UI without
          // persisting them to data until the user explicitly picks, so
          // untouched nodes submitted aspectRatio / resolution undefined.
          // Fill the defaults here so the request matches the UI.
          aspectRatio: (data.aspectRatio as string | undefined) ?? (isSeedance2Provider(provider) ? "16:9" : undefined),
          resolution: (data.resolution as string | undefined) ?? (isSeedance2Provider(provider) ? MODEL_CATALOG[provider]?.resolutions?.[0] : undefined),
          seed: data.seed,
          cameraFixed: data.cameraFixed,
          multiShot: data.multiShot,
          shots: data.shots,
          elements: data.elements,
          grokMode: data.grokMode,
          videoSize: data.videoSize,
          removeWatermark: data.removeWatermark,
          referenceImageUrls: i2vReferenceImageUrls,
          referenceVideoUrls: (isS2 && s2Mode === "frames") ? undefined : resolvedInputs.referenceVideoUrls,
          referenceAudioUrls: (isS2 && s2Mode === "frames") ? undefined : resolvedInputs.referenceAudioUrls,
          webSearch: data.webSearch,
          nsfwChecker: data.nsfwChecker,
          generationType: data.veoMode === "reference" ? "REFERENCE_2_VIDEO" : undefined,
          // Generic smart-loop-cut post-process. Worker reads loopTrim.enabled.
          // Legacy autoLoopTrim is normalized at the route level; orchestrator
          // path sees it migrated by the frontend already (use-workflow-store).
          loopTrim: data.loopTrim,
          enableTranslation: data.enableTranslation,
          usageLogId,
        },
      }
    }

    case "text-to-video": {
      const provider = (data.provider as string) ?? "kling"
      const hasVideoRef = (resolvedInputs.referenceVideoUrls?.length ?? 0) > 0
      // Resolve @-mentions in the t2v prompt (see i2v case for the rationale).
      // t2v has no `imageUrl` slot — all resolved URLs become entries in
      // `referenceImageUrls`, merged with whatever upstream already provided.
      const t2vRawPrompt = promptFor("text-to-video")
      let t2vPrompt = composeVideoPrompt({ rawPrompt: t2vRawPrompt, nodeId: node.id, buildCtx })
      const t2vMention = resolveVideoPromptMentions(t2vPrompt, node.id, buildCtx, readExtraRefs(data), {
        referenceOrder: readStringArray(data.referenceOrder),
        suppressedCanonicalCharacterIds: readStringArray(data.suppressedCanonicalCharacterIds),
      })
      t2vPrompt = t2vMention.prompt
      // Apply user-defined reorder for t2v references — mirrors i2v. t2v has
      // no startFrame handle, so the filter accepts any wired image/character/
      // entity upstream (matches the `connectedRefImages` filter in
      // `video-configs.tsx` TextToVideoConfig).
      const t2vOrderedRefs = applyOrderToReferenceUrls(
        node.id,
        data.connectedRefImageOrder as string[] | undefined,
        buildCtx,
        (_e, src) => VIDEO_REF_IMAGE_SOURCE_TYPES.has(src.type),
      )
      let t2vReferenceImageUrls = t2vOrderedRefs ?? resolvedInputs.referenceImageUrls
      if (t2vMention.additionalUrls.length > 0) {
        const existing = t2vReferenceImageUrls ?? []
        const merged: string[] = []
        const seen = new Set<string>()
        for (const u of existing) {
          if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
        }
        for (const u of t2vMention.additionalUrls) {
          if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
        }
        t2vReferenceImageUrls = merged
      }
      return {
        jobName: "text-to-video",
        queueName: "video-generation",
        modelIdentifier: buildVideoCreditModelIdentifier(
          provider,
          data.duration as number | string | undefined,
          (data.sound ?? data.kling3Sound) as boolean | undefined,
          "text-to-video",
          (data.mode ?? data.kling3Mode ?? data.videoSize) as string | undefined,
          data.resolution as string | undefined,
          hasVideoRef,
        ),
        payload: {
          jobId,
          prompt: t2vPrompt,
          provider,
          duration: data.duration,
          mode: data.mode ?? data.kling3Mode,
          sound: data.sound ?? data.kling3Sound,
          // See i2v note above — Seedance 2 UI default fallbacks.
          aspectRatio: (data.aspectRatio as string | undefined) ?? (isSeedance2Provider(provider) ? "16:9" : undefined),
          negativePrompt: data.negativePrompt,
          cfgScale: data.cfgScale,
          multiShot: data.multiShot,
          shots: data.shots,
          elements: data.elements,
          removeWatermark: data.removeWatermark,
          seed: data.seed,
          resolution: (data.resolution as string | undefined) ?? (isSeedance2Provider(provider) ? MODEL_CATALOG[provider]?.resolutions?.[0] : undefined),
          generateAudio: data.generateAudio,
          referenceImageUrls: t2vReferenceImageUrls,
          referenceVideoUrls: resolvedInputs.referenceVideoUrls,
          referenceAudioUrls: resolvedInputs.referenceAudioUrls,
          webSearch: data.webSearch,
          nsfwChecker: data.nsfwChecker,
          enableTranslation: data.enableTranslation,
          usageLogId,
        },
      }
    }

    // Unified video node — dispatches `jobName` dynamically based on whether
    // any image input is wired. Reuses the existing i2v + t2v worker handlers
    // and credit pricing without modifying them. The case lives next to its
    // legacy siblings so future provider routing tweaks stay co-located.
    case "generate-video": {
      const provider = (data.provider as string) ?? "kling"
      const isS2 = isSeedance2Provider(provider)

      // ─── LTX 2.3 task dispatch ───────────────────────────────────────────
      // LTX has a single Replicate endpoint per variant that switches behavior
      // via a `task` discriminator in the input. Dispatch the right task based
      // on which input handles are wired, emit a flat snake_case payload that
      // mirrors the LTX provider's input shape (so the worker can forward
      // directly to `runLtxTextToVideo` / `runLtxImageToVideo` /
      // `runLtxAudioToVideo` without re-deriving the task).
      //
      // Fast variant lacks audio_to_video — wiring audio against Fast falls
      // back to text_to_video (Task 1.3 already disables the audio handle in
      // the UI, but the orchestrator may still receive payloads from older
      // workflows or webhook triggers, so we degrade gracefully here).
      if (provider === "ltx-2.3-pro" || provider === "ltx-2.3-fast") {
        const hasAudio = !!resolvedInputs.audioUrl && provider === "ltx-2.3-pro"
        const hasStart = !!resolvedInputs.startFrameUrl
        const hasEnd = !!resolvedInputs.endFrameUrl

        let task: "text_to_video" | "image_to_video" | "audio_to_video"
        if (hasAudio) task = "audio_to_video"
        else if (hasStart) task = "image_to_video"
        else task = "text_to_video"

        // Walk incoming edges to derive the LTX camera_motion enum. Mirrors
        // the upstream-hint shape `ltxCameraMotionFromUpstream` expects.
        const incomingNodes = (buildCtx?.edges ?? [])
          .filter((e) => e.target === node.id)
          .map((e) => (buildCtx?.nodes ?? []).find((n) => n.id === e.source))
          .filter((n): n is SimpleNode => !!n)
        const hints = incomingNodes.map((n) => ({
          nodeType: n.type,
          data: { cameraMotion: (n.data as Record<string, unknown>).cameraMotion as string | undefined },
        }))
        const cameraMotion = ltxCameraMotionFromUpstream(hints) ?? "none"

        return {
          jobName: task === "audio_to_video" ? "text-to-video" : (task === "image_to_video" ? "image-to-video" : "text-to-video"),
          queueName: "video-generation",
          modelIdentifier: provider,
          payload: {
            jobId,
            provider,
            task,
            prompt: promptFor("generate-video"),
            ...(task === "image_to_video" && {
              image: resolvedInputs.startFrameUrl,
              ...(hasEnd && { last_frame_image: resolvedInputs.endFrameUrl }),
            }),
            ...(task === "audio_to_video" && { audio: resolvedInputs.audioUrl }),
            resolution: data.resolution as string | undefined,
            duration: data.duration as number | undefined,
            aspect_ratio: data.aspectRatio as string | undefined,
            fps: data.fps as number | undefined,
            generate_audio: (data.generateAudio as boolean | undefined) ?? true,
            camera_motion: cameraMotion,
            usageLogId,
          },
        }
      }

      // EndFrame-only swap: if user wired endFrame but no startFrame, use
      // endFrame as the start so providers (veo3, minimax, kling-turbo, etc.)
      // get at least one image in their primary slot. We then clear
      // endFrameUrl to avoid the worker repeating the same image twice.
      const startFrameUrl = resolvedInputs.startFrameUrl ?? resolvedInputs.imageUrl ?? resolvedInputs.endFrameUrl
      const endFrameUrl = (resolvedInputs.startFrameUrl || resolvedInputs.imageUrl)
        ? resolvedInputs.endFrameUrl
        : undefined
      const hasStart = !!startFrameUrl
      const hasImageRef = (resolvedInputs.referenceImageUrls?.length ?? 0) > 0
      const hasVideoRef = (resolvedInputs.referenceVideoUrls?.length ?? 0) > 0

      // Mode dispatch — decides BOTH jobName and credit identifier so the
      // existing worker handlers + STATIC_CREDIT_COSTS entries keep working
      // without modification.
      const mode: "image-to-video" | "text-to-video" = hasStart ? "image-to-video" : "text-to-video"

      // Gemini Omni: a connected source video is a video-edit (V2V) job, routed
      // through the image-to-video worker path (one handler serves all modes).
      const effectiveMode: "image-to-video" | "text-to-video" =
        (provider === "gemini-omni-video" && hasVideoRef) ? "image-to-video" : mode

      // Split-id video models (Grok Imagine 1, Wan 2.6/2.7) use a different KIE
      // id per mode but are one user-facing model in the unified picker. Remap
      // the stored id to the concrete id for the chosen mode so BOTH the worker
      // model lookup (payload.provider) AND the credit identifier are correct.
      // No-op for single-id providers. Mirrors the frontend executor
      // (execute-node.ts) — shared source of truth in @nodaro/shared.
      const resolvedProvider = resolveVideoProviderForMode(provider, effectiveMode)

      // Prompt composition (typed-primary, via the shared helper): list-override
      // → data.prompt → data.motionPrompt (legacy field still emitted by the
      // inline picker) → upstream wire. composeVideoPrompt appends cinematography
      // hints + optional motion-hint + identity-lock.
      const rawPrompt = promptFor("generate-video")
      const motionHint = data.motionEnabled && typeof data.motion === "string" && data.motion
        ? `${data.motion} motion`
        : undefined
      let composedPrompt = composeVideoPrompt({ rawPrompt, motionHint, nodeId: node.id, buildCtx })

      // Mention resolution + ref-image merging (mirrors i2v case). Extras /
      // suppressed-canonicals stay opt-in via the same node-data fields.
      const mentionResult = resolveVideoPromptMentions(
        composedPrompt,
        node.id,
        buildCtx,
        readExtraRefs(data),
        {
          referenceOrder: readStringArray(data.referenceImageOrder),
          suppressedCanonicalCharacterIds: readStringArray(data.suppressedCanonicalCharacterIds),
        },
      )
      composedPrompt = mentionResult.prompt

      // Apply user-defined reorder (drag-to-reorder writes referenceImageOrder
      // on the new node — the rename migration normalizes the legacy
      // connectedRefImageOrder field). The handle filter accepts all three
      // typed-handle ids the new node exposes for image inputs.
      const orderedRefs = applyOrderToReferenceUrls(
        node.id,
        data.referenceImageOrder as string[] | undefined,
        buildCtx,
        (e) => e.targetHandle === "imageReferences" || e.targetHandle === "references" || e.targetHandle === "reference-images",
      )
      let referenceImageUrls = orderedRefs ?? resolvedInputs.referenceImageUrls
      let imageUrl = startFrameUrl
      if (mentionResult.additionalUrls.length > 0) {
        let remaining = mentionResult.additionalUrls
        if (!imageUrl) {
          imageUrl = remaining[0]
          remaining = remaining.slice(1)
        }
        if (remaining.length > 0) {
          const existing = referenceImageUrls ?? []
          const merged: string[] = []
          const seen = new Set<string>()
          for (const u of existing) if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
          for (const u of remaining) if (u && !seen.has(u)) { seen.add(u); merged.push(u) }
          referenceImageUrls = merged
        }
      }

      // VEO-specific generationType hint — derived from the wiring shape so
      // the worker doesn't have to inspect the resolved inputs itself.
      let generationType: "TEXT_2_VIDEO" | "FIRST_AND_LAST_FRAMES_2_VIDEO" | "REFERENCE_2_VIDEO" | undefined
      if (!hasStart && !hasImageRef && !hasVideoRef) generationType = "TEXT_2_VIDEO"
      else if (hasStart && !!endFrameUrl) generationType = "FIRST_AND_LAST_FRAMES_2_VIDEO"
      else if (hasImageRef || hasVideoRef) generationType = "REFERENCE_2_VIDEO"

      return {
        jobName: effectiveMode,
        queueName: "video-generation",
        modelIdentifier: buildVideoCreditModelIdentifier(
          resolvedProvider,
          data.duration as number | string | undefined,
          (data.sound ?? data.kling3Sound) as boolean | undefined,
          effectiveMode,
          (data.videoSize as string | undefined) ?? (data.mode ?? data.kling3Mode) as string | undefined,
          data.resolution as string | undefined,
          hasVideoRef,
        ),
        payload: {
          jobId,
          provider: resolvedProvider,
          prompt: composedPrompt,
          // Typed `negative` handle takes precedence over the config-panel
          // field, with the config field as fallback (parallel to `prompt`).
          negativePrompt: resolvedInputs.negativePrompt ?? (data.negativePrompt as string | undefined),
          imageUrl,            // swap-aware
          endFrameUrl,         // gated on having a startFrame to pair with
          referenceImageUrls,
          referenceVideoUrls: resolvedInputs.referenceVideoUrls,
          videoTrimStart: data.videoTrimStart,
          videoTrimEnd: data.videoTrimEnd,
          referenceAudioUrls: resolvedInputs.referenceAudioUrls,
          audioUrl: resolvedInputs.audioUrl,
          duration: data.duration,
          mode: data.mode ?? data.kling3Mode,
          sound: data.sound ?? data.kling3Sound,
          generateAudio: data.generateAudio,
          cfgScale: data.cfgScale,
          // Seedance 2 config pickers render defaults in the UI without
          // persisting them to data until the user explicitly picks; fill
          // them in here so the worker request matches the visible UI state.
          aspectRatio: (data.aspectRatio as string | undefined) ?? (isS2 ? "16:9" : undefined),
          resolution: (data.resolution as string | undefined) ?? (isS2 ? MODEL_CATALOG[provider]?.resolutions?.[0] : undefined),
          seed: data.seed,
          cameraFixed: data.cameraFixed,
          multiShot: data.multiShot,
          shots: data.shots,
          elements: data.elements,
          grokMode: data.grokMode,
          videoSize: data.videoSize,
          removeWatermark: data.removeWatermark,
          webSearch: data.webSearch,
          nsfwChecker: data.nsfwChecker,
          generationType,
          loopTrim: data.loopTrim,
          enableTranslation: data.enableTranslation,
          usageLogId,
        },
      }
    }

    // Replicate MMAudio — generates synchronized SFX/foley/ambient audio for a
    // video clip and merges it into the original. Three typed input handles:
    // `video` (required, the clip to score), `prompt` (text describing the
    // sound — text-prompt source or literal data field), `negative` (sounds
    // to suppress; defaults to "music" so MMAudio doesn't synthesize a
    // soundtrack instead of foley).
    //
    // `versions` (1-4) is the multi-take batch knob. The standalone route
    // (`POST /v1/video-sfx`) fans this out into N jobs rows up front; here in
    // the orchestrator we keep it in the payload so the worker layer can
    // honor it the same way the standalone route does once orchestrator-side
    // batching lands. node-executor creates ONE job per node — the worker
    // re-reads `input_data` from the row, so writing `versions` into the
    // payload propagates it via the input_data backfill in node-executor.
    case "video-sfx": {
      return {
        jobName: "video-sfx",
        queueName: "video-generation",
        modelIdentifier: "replicate-mmaudio",
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl ?? (data.videoUrl as string | undefined),
          prompt: resolvedInputs.prompt ?? (data.prompt as string | undefined),
          // `negative` handle takes precedence over the config field; default
          // to "music" so MMAudio synthesizes SFX/foley rather than a score
          // (mirrors the route's Zod default at `routes/video-sfx.ts:18`).
          negativePrompt:
            resolvedInputs.negativePrompt
            ?? (data.negativePrompt as string | undefined)
            ?? "music",
          cfgStrength: (data.cfgStrength as number | undefined) ?? 4.5,
          numSteps: (data.numSteps as number | undefined) ?? 25,
          seed: data.seed as number | undefined,
          versions: (data.versions as number | undefined) ?? 1,
          usageLogId,
        },
      }
    }

    case "reference-sheet": {
      // Compose-only: resolve the connected entity's (kind, DB id) by walking the
      // incoming edge. The worker (`workers/handlers/reference-sheet.ts`) reads
      // job.data.{type, skin, flavour, entityKind, entityDbId} — `type` is the
      // SHEET type (data.type), NOT the queue discriminator (`jobName`). Keys here
      // MUST match the route's `videoQueue.add("reference-sheet", { ...body })`
      // shape so workflow-run + single-node Run hit the same handler.
      const { entityKind, entityDbId } = resolveSheetEntity(node.id, buildCtx)
      return {
        jobName: "reference-sheet",
        queueName: "video-generation",
        // Flavour-aware so a motion sheet reserves the same id the route's
        // single-node path uses (`sheetCreditId` in routes/reference-sheet.ts):
        // motion → 6cr assembly, still → 4cr. Resolving different ids at the two
        // sites would under-bill workflow runs (was hardcoded to the still id).
        // Shared single source of truth (mirrors the route + node display).
        modelIdentifier: referenceSheetCreditId(data.flavour as { outputFormat?: string } | undefined),
        payload: {
          jobId,
          type: data.type,
          skin: data.skin,
          flavour: data.flavour,
          entityKind,
          entityDbId,
          usageLogId,
        },
      }
    }

    case "video-to-video": {
      const v2vProvider = (data.provider as string) ?? "wan"
      // Resolve @-mentions in the v2v prompt. v2v has only a single
      // `referenceImageUrl` slot — when an upstream ref image is wired we
      // keep it; otherwise the first resolved mention URL fills it. Extra
      // mention URLs beyond slot 0 are dropped: v2v providers (Wan 2.6 et al)
      // accept exactly one reference image and silently ignore the rest, so
      // there's no payload key to plumb them into. Prompt token replacement
      // still happens so the LLM sees the character names regardless.
      let v2vPrompt: string | undefined = (() => {
        let p: string | undefined = promptFor("video-to-video")
        {
          const cinematographyHints = collectCinematographyHints(node.id, buildCtx)
          if (cinematographyHints.length > 0) {
            const joined = cinematographyHints.join(", ")
            p = p ? `${p}. ${joined}` : joined
          }
        }
        const identityClause = collectIdentityLockClause(node.id, buildCtx)
        if (identityClause) p = p ? `${p} ${identityClause}` : identityClause
        return p
      })()
      const v2vMention = resolveVideoPromptMentions(v2vPrompt, node.id, buildCtx, readExtraRefs(data), {
        referenceOrder: readStringArray(data.referenceOrder),
        suppressedCanonicalCharacterIds: readStringArray(data.suppressedCanonicalCharacterIds),
      })
      v2vPrompt = v2vMention.prompt
      const v2vUpstreamRef = (typeof resolvedInputs.referenceImageUrls === "string"
        ? resolvedInputs.referenceImageUrls
        : Array.isArray(resolvedInputs.referenceImageUrls)
          ? resolvedInputs.referenceImageUrls[0]
          : undefined) as string | undefined
      const v2vReferenceImageUrl = v2vUpstreamRef ?? v2vMention.additionalUrls[0]
      return {
        jobName: "video-to-video",
        queueName: "video-generation",
        modelIdentifier: v2vProvider,
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          prompt: v2vPrompt,
          provider: v2vProvider,
          duration: data.v2vDuration as string | undefined,
          resolution: data.v2vResolution as string | undefined,
          audio: data.audio as boolean | undefined,
          multiShots: data.multiShots as boolean | undefined,
          aspectRatio: data.aspectRatio as string | undefined,
          seed: data.seed as number | undefined,
          referenceImageUrl: v2vReferenceImageUrl,
          negativePrompt: resolvedInputs.negativePrompt || (data.negativePrompt as string | undefined),
          videoEditDuration: data.videoEditDuration as string | undefined,
          audioSetting: data.audioSetting as string | undefined,
          promptExtend: data.promptExtend as boolean | undefined,
          usageLogId,
        },
      }
    }

    case "generate-mask": {
      return {
        jobName: "generate-mask",
        queueName: "video-generation",
        modelIdentifier: "generate-mask",
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl || (data.generatedImageUrl as string | undefined),
          prompt: data.prompt as string,
          threshold: (data.threshold as number | undefined) ?? 0.3,
          usageLogId,
        },
      }
    }

    case "face-swap": {
      return {
        jobName: "face-swap",
        queueName: "video-generation",
        modelIdentifier: "roop-face-swap",
        payload: {
          jobId,
          faceImageUrl: data.faceImageUrl,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          provider: (data.provider as string) ?? "roop",
          usageLogId,
        },
      }
    }

    case "lip-sync": {
      const provider = (data.provider as string) ?? "kling-avatar"
      // infinitalk is tier-priced by resolution. Per-second providers
      // (kling-avatar(-pro), heygen-lipsync-precision, lipsync-2-pro) bucket by
      // the persisted audio duration when it's known — mirroring the route's
      // resolveLipSyncIdentifier. When the duration is unknown (e.g. audio is
      // produced by an upstream node at runtime), fall back to the bare provider
      // id: for HeyGen/Sync that bare entry is the 5-min ceiling (billing-safe),
      // and kling-avatar(-pro) keep their existing bare reservation unchanged.
      const lipSyncResolution = (data.resolution as string | undefined) ?? "720p"
      const audioDurationSec = typeof data.audioDurationSec === "number" ? data.audioDurationSec : undefined
      const lipSyncIdentifier =
        provider === "infinitalk"
          ? `infinitalk:${lipSyncResolution}`
          : isPerSecondLipSyncProvider(provider) && audioDurationSec !== undefined
            ? buildLipSyncCreditId(provider, audioDurationSec)
            : provider
      return {
        jobName: "lip-sync",
        queueName: "video-generation",
        modelIdentifier: lipSyncIdentifier,
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl || data.imageUrl,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          audioUrl: resolvedInputs.audioUrl || data.audioUrl,
          prompt: resolvedInputs.prompt || data.prompt || "A person talking naturally",
          provider,
          resolution: data.resolution,
          audioDurationSec,
          guidanceScale: data.guidanceScale,
          inferenceSteps: data.inferenceSteps,
          seed: data.seed,
          pads: data.pads,
          smooth: data.smooth,
          fps: data.fps,
          resizeFactor: data.resizeFactor,
          enhancer: data.enhancer,
          preprocess: data.preprocess,
          still: data.still,
          poseStyle: data.poseStyle,
          expressionScale: data.expressionScale,
          enableDynamicDuration: data.enableDynamicDuration,
          disableMusicTrack: data.disableMusicTrack,
          enableSpeechEnhancement: data.enableSpeechEnhancement,
          syncMode: data.syncMode,
          temperature: data.temperature,
          activeSpeaker: data.activeSpeaker,
          usageLogId,
        },
      }
    }

    case "speech-to-video": {
      const s2vResolution = (data.resolution as string) ?? "480p"
      const s2vModelId = s2vResolution === "720p"
        ? "speech-to-video:720p"
        : s2vResolution === "580p"
          ? "speech-to-video:580p"
          : "speech-to-video"
      return {
        jobName: "speech-to-video",
        queueName: "video-generation",
        modelIdentifier: s2vModelId,
        payload: {
          jobId,
          imageUrl: resolvedInputs.imageUrl || data.imageUrl,
          audioUrl: resolvedInputs.audioUrl || data.audioUrl,
          prompt: (() => {
            let p: string | undefined = promptFor("speech-to-video")
            {
              const cinematographyHints = collectCinematographyHints(node.id, buildCtx)
              if (cinematographyHints.length > 0) {
                const joined = cinematographyHints.join(", ")
                p = p ? `${p}. ${joined}` : joined
              }
            }
            const identityClause = collectIdentityLockClause(node.id, buildCtx)
            if (identityClause) p = p ? `${p} ${identityClause}` : identityClause
            return p
          })(),
          resolution: s2vResolution,
          negativePrompt: data.negativePrompt,
          seed: data.seed,
          numFrames: data.numFrames,
          fps: data.fps,
          inferenceSteps: data.inferenceSteps,
          guidanceScale: data.guidanceScale,
          shift: data.shift,
          usageLogId,
        },
      }
    }

    case "ai-avatar": {
      // The `script` field is verbatim TTS — do NOT fold cinematography or
      // identity hints into it (unlike the speech-to-video case). The avatar
      // reads it aloud exactly as written.
      const aiAvatarEngine = (data.engine as string) ?? "avatar-iv"
      const aiAvatarResolution = (data.resolution as string) ?? "720p"
      // Credit identifier MUST come from resolveAiAvatarCreditId (the single
      // source of truth shared with the route's creditGuard) so that:
      //  (a) it is always one of the SEEDED duration-bucket ids (5/10/15/30/60/
      //      120/240/360/600/900s) — never an unseeded bucket that would hard-fail
      //      with 503 price_not_configured at reserve time, and
      //  (b) image-source mode pins the rate engine to avatar-iv (image is
      //      IV-class), matching the route's reservation exactly.
      // The data shape here carries the same fields the route body does
      // (engine/resolution/speechMode/voiceSpeed/script/avatarSource).
      //
      // CRITICAL: bucket the reserve on the SAME script that will be SENT, not
      // on raw node data. In text mode the script can be WIRED from an upstream
      // text producer (text-prompt/generate-script/ai-writer → `script` handle)
      // while `data.script` is empty. resolveAiAvatarCreditId buckets by script
      // LENGTH; if we passed raw `data` here the reserve would estimate from the
      // empty data.script (→ 30s bucket, ~135cr) while the payload sends the long
      // wired script (a multi-minute clip). The metered true-up at commit can
      // ONLY refund a surplus — it never charges an overage — so that mismatch
      // silently undercharges by the full overage (refund-only invariant
      // violation). Note ai-avatar is NOT in NODE_MAPPABLE_FIELDS, so
      // FieldMappings never backfills data.script — the merge below is the only
      // place the wired script reaches the bucket. Single-node Run already
      // resolves script-first before reserving, so this aligns both paths.
      const aiAvatarResolvedScript =
        resolvedInputs.script ?? (data.script as string | undefined)
      const aiAvatarCreditBody = { ...(data as Record<string, unknown>), script: aiAvatarResolvedScript }
      const aiAvatarCreditId = resolveAiAvatarCreditId(aiAvatarCreditBody)
      const aiAvatarPayload: Record<string, unknown> = {
        jobId,
        avatarSource: (data.avatarSource as string | undefined) ?? "avatar",
        engine: aiAvatarEngine,
        avatarId: data.avatarId,
        imageUrl: resolvedInputs.imageUrl || (data.imageUrl as string | undefined),
        speechMode: data.speechMode ?? "text",
        script: aiAvatarResolvedScript,
        voiceId: data.voiceId,
        voiceSpeed: data.voiceSpeed,
        pitch: data.pitch,
        volume: data.volume,
        locale: data.locale,
        ttsEngine: data.ttsEngine,
        audioUrl: resolvedInputs.audioUrl || (data.audioUrl as string | undefined),
        resolution: aiAvatarResolution,
        aspectRatio: data.aspectRatio ?? "16:9",
        fit: data.fit,
        outputFormat: data.outputFormat,
        caption: data.caption,
        captionStyle: data.captionStyle,
        background: data.background,
        removeBackground: data.removeBackground,
        motionPrompt: data.motionPrompt,
        expressiveness: data.expressiveness,
        usageLogId,
      }
      // Structural validation on the ASSEMBLED payload — the orchestrator/app/MCP
      // paths bypass the route Zod (`aiAvatarBody`). Throws BEFORE reserve/enqueue
      // (node-executor deletes the orphaned pending job on throw). Single source
      // of truth shared with the route via @nodaro/shared.
      validateAiAvatarPayload(aiAvatarPayload)
      return {
        jobName: "ai-avatar",
        queueName: "video-generation",
        modelIdentifier: aiAvatarCreditId,
        payload: aiAvatarPayload,
      }
    }

    case "cinematic-avatar": {
      // Credit identifier MUST come from resolveCinematicCreditId (the single
      // source of truth shared with the route's creditGuard) so that:
      //  (a) it is always one of the 24 SEEDED exact-duration ids — never an
      //      unseeded id that would hard-fail with 503 price_not_configured, and
      //  (b) out-of-range durations are clamped to 4–15s exactly as the route does.
      const cinematicCreditId = resolveCinematicCreditId(data as Record<string, unknown>)
      // Assemble the references array from the resolved reference handle inputs
      // (the orchestrator routes ref-video/ref-audio/ref-image →
      // refVideoUrl/refAudioUrl/refImageUrl) plus any pre-seeded data.references
      // (single-node Run path). Wired inputs take priority over a same-kind
      // data entry; duplicate urls are dropped. Empty → references omitted.
      const cinematicReferences = buildCinematicReferences(resolvedInputs, data)
      const cinematicPayload: Record<string, unknown> = {
        jobId,
        prompt: promptFor("cinematic-avatar"),
        avatarLooks: data.avatarLooks,
        duration: data.duration,
        autoDuration: data.autoDuration,
        aspectRatio: data.aspectRatio ?? "16:9",
        resolution: (data.resolution as string) ?? "720p",
        enhancePrompt: data.enhancePrompt,
        ...(cinematicReferences.length > 0 ? { references: cinematicReferences } : {}),
        usageLogId,
      }
      // Structural validation on the ASSEMBLED payload — the orchestrator/app/MCP
      // paths bypass the route Zod (`cinematicAvatarBody`). Enforces avatarLooks
      // count (1–3), enum bounds, and the combined reference caps (≤3 videos;
      // avatarLooks + image refs ≤ 9) that cinematic.ts forwards to HeyGen
      // unvalidated. Throws BEFORE reserve/enqueue (node-executor deletes the
      // orphaned pending job on throw). Single source of truth shared with the
      // route via @nodaro/shared.
      validateCinematicAvatarPayload(cinematicPayload)
      return {
        jobName: "cinematic-avatar",
        queueName: "video-generation",
        modelIdentifier: cinematicCreditId,
        payload: cinematicPayload,
      }
    }

    case "motion-transfer": {
      const mtProvider = (data.provider as string) ?? "kling"
      const mtResolution = (data.resolution as string) ?? "720p"
      const mtVideoDuration = data.videoDuration as number | undefined
      const mtModelId = buildMotionCreditModelIdentifier(mtProvider, mtResolution, mtVideoDuration)
      return {
        jobName: "motion-transfer",
        queueName: "video-generation",
        modelIdentifier: mtModelId,
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          imageUrl: resolvedInputs.imageUrl || data.imageUrl,
          prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
          negativePrompt: resolvedInputs.negativePrompt || (data.negativePrompt as string | undefined),
          provider: mtProvider,
          backgroundSource: data.backgroundSource,
          characterOrientation: data.characterOrientation,
          resolution: mtResolution,
          videoDuration: mtVideoDuration,
          usageLogId,
        },
      }
    }

    case "video-upscale": {
      const vuProvider = (data.provider as string) ?? "topaz"
      const vuModel = vuProvider === "veo-1080p" ? "veo-1080p"
        : vuProvider === "veo-4k" ? "veo-4k"
        : "topaz-video"
      return {
        jobName: "video-upscale",
        queueName: "video-generation",
        modelIdentifier: vuModel,
        payload: {
          jobId,
          videoUrl: resolvedInputs.videoUrl || data.videoUrl,
          upscaleFactor: data.upscaleFactor,
          provider: vuProvider,
          kieTaskId: resolvedInputs.kieTaskId || data.kieTaskId,
          usageLogId,
        },
      }
    }

    case "extend-video": {
      const evProvider = (data.provider as string) ?? "veo-extend"

      // ─── LTX 2.3 Pro extend ──────────────────────────────────────────────
      // LTX extend operates on the source video URL (no KIE taskId — Replicate
      // accepts any HTTPS-reachable video). Webhook-driven completion via the
      // standard Replicate prediction reconcile path. `duration` is the number
      // of seconds to ADD (1–20); `extendMode` is "start" or "end" (defaults
      // to "end" — append).
      if (evProvider === "ltx-2.3-pro") {
        return {
          jobName: "extend-video",
          queueName: "video-generation",
          modelIdentifier: evProvider,
          payload: {
            jobId,
            provider: evProvider,
            video: resolvedInputs.videoUrl || data.videoUrl,
            duration: data.duration,
            extend_mode: (data.extendMode as string | undefined) ?? "end",
            usageLogId,
          },
        }
      }

      const evModel = evProvider === "veo-extend"
        ? (evProvider + (data.model === "quality" ? ":quality" : ""))
        : evProvider
      return {
        jobName: "extend-video",
        queueName: "video-generation",
        modelIdentifier: evModel,
        payload: {
          jobId,
          kieTaskId: resolvedInputs.kieTaskId || data.kieTaskId,
          prompt: (() => {
            let p: string | undefined = promptFor("extend-video")
            {
              const cinematographyHints = collectCinematographyHints(node.id, buildCtx)
              if (cinematographyHints.length > 0) {
                const joined = cinematographyHints.join(", ")
                p = p ? `${p}. ${joined}` : joined
              }
            }
            const identityClause = collectIdentityLockClause(node.id, buildCtx)
            if (identityClause) p = p ? `${p} ${identityClause}` : identityClause
            // Inject `Avoid: <negativePrompt>` for non-native providers —
            // none of the extend providers accept native negative_prompt, so
            // this always applies when negativePrompt is set. Mirrors the
            // /v1/extend-video route's behavior.
            const neg = (resolvedInputs.negativePrompt || (data.negativePrompt as string | undefined))
            const { prompt: pWithNeg } = applyVideoNegativePrompt(p, neg, evProvider)
            return pWithNeg
          })(),
          provider: evProvider,
          model: evProvider === "veo-extend" ? (data.model ?? "fast") : undefined,
          quality: evProvider === "runway-extend" ? (data.quality ?? "720p") : undefined,
          seeds: evProvider === "veo-extend" ? data.seeds : undefined,
          usageLogId,
        },
      }
    }

    // ─── LTX 2.3 Pro Retake ───────────────────────────────────────────────
    // Replace a portion of a video — audio only / video only / both —
    // using LTX 2.3 Pro's `retake` task on Replicate. Webhook-driven
    // completion via the standard Replicate reconcile path. Credit math is
    // `ltx-2.3-pro-retake:per-second × retakeDuration` (the route hook
    // applies the multiplication on the single-node path; the orchestrator
    // path also bills `:per-second` here so reconciliation sums match).
    case "video-retake": {
      // Walk incoming edges to derive the LTX camera_motion enum. Mirror of
      // the LTX generate-video case — `ltxCameraMotionFromUpstream` consumes
      // the same `{ nodeType, data: { cameraMotion } }[]` shape.
      const incomingNodes = (buildCtx?.edges ?? [])
        .filter((e) => e.target === node.id)
        .map((e) => (buildCtx?.nodes ?? []).find((n) => n.id === e.source))
        .filter((n): n is SimpleNode => !!n)
      const hints = incomingNodes.map((n) => ({
        nodeType: n.type,
        data: { cameraMotion: (n.data as Record<string, unknown>).cameraMotion as string | undefined },
      }))
      const cameraMotion = ltxCameraMotionFromUpstream(hints) ?? "none"

      return {
        jobName: "video-retake",
        queueName: "video-generation",
        // Orchestrator path uses the static `video-retake` fallback (100cr,
        // ~2s worth). Single-node route uses `computeCredits` with the actual
        // `ltx-2.3-pro-retake:per-second × retakeDuration` math — mirrors the
        // extend-video LTX pattern where orchestrator reserves the base rate
        // and reconciliation refunds the diff once Replicate reports actual.
        modelIdentifier: "video-retake",
        payload: {
          jobId,
          provider: "ltx-2.3-pro",
          video: resolvedInputs.videoUrl || (data.videoUrl as string | undefined),
          prompt: promptFor("video-retake"),
          retake_start_time: data.retakeStartTime as number | undefined,
          retake_duration: data.retakeDuration as number | undefined,
          retake_mode: data.retakeMode as string | undefined,
          resolution: "1080p",
          aspect_ratio: (data.aspectRatio as string | undefined) ?? "16:9",
          fps: (data.fps as number | undefined) ?? 25,
          generate_audio: (data.generateAudio as boolean | undefined) ?? true,
          camera_motion: cameraMotion,
          usageLogId,
        },
      }
    }

    // --- Audio ---
    case "text-to-speech": {
      const provider = (data.provider as string) ?? "elevenlabs-v3"
      // Frontend reads text from directText field when textSource is "direct"
      const ttsText = promptFor("text-to-speech")
      return {
        jobName: "text-to-speech",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          text: ttsText,
          voice: data.voiceId || data.voice,
          provider,
          voiceType: data.voiceType || "premade",
          stability: data.stability,
          similarityBoost: data.similarityBoost,
          style: data.style,
          speed: data.speed,
          languageCode: data.languageCode,
          usageLogId,
        },
      }
    }

    case "generate-music": {
      const provider = (data.provider as string) ?? "musicgen"
      const audioStyle = collectAudioStyleHints(node, "generate-music", buildCtx)
      const userPrompt = promptFor("generate-music")
      const composed = truncateForField(audioStyle.text, userPrompt, 2000)
      const finalPrompt = appendField(userPrompt, composed)
      // composeSoundHintFromConnections already gates fields.{genre,mood,instrumental}
      // on consumer.data.provider === "minimax" — they're undefined for other
      // providers, so a flat `data.x || audioStyle.fields.x` short-circuits
      // correctly without an outer isMinimax ternary.
      return {
        jobName: "generate-music",
        queueName: "video-generation",
        modelIdentifier: "generate-music",
        payload: {
          jobId,
          prompt: finalPrompt,
          provider,
          duration: data.duration,
          genre: data.genre || audioStyle.fields.genre,
          mood:  data.mood  || audioStyle.fields.mood,
          instrumental: data.instrumental || audioStyle.fields.instrumental || false,
          lyrics: resolveRefs(data.lyrics as string | undefined, refMap),
          referenceAudioUrl: resolvedInputs.audioUrl || data.referenceAudioUrl,
          // modelVersion is an optional Suno-family field (v4/v5/v4.5); forward
          // so orchestrator runs respect the user's model selection.
          modelVersion: data.modelVersion,
          usageLogId,
        },
      }
    }

    case "text-to-audio": {
      const t2aProvider = (data.provider as string) ?? "elevenlabs-sfx"
      const audioStyle = collectAudioStyleHints(node, "text-to-audio", buildCtx)
      const userPrompt = promptFor("text-to-audio")
      const composed = truncateForField(audioStyle.text, userPrompt, 2000)
      const finalPrompt = appendField(userPrompt, composed)
      return simpleResult("text-to-audio", "elevenlabs-sfx", {
        jobId,
        prompt: finalPrompt,
        provider: t2aProvider,
        duration: data.duration,
        // Only send SFX-specific options for elevenlabs-sfx (matches frontend)
        ...(t2aProvider === "elevenlabs-sfx" ? {
          loop: data.loop,
          promptInfluence: data.promptInfluence,
        } : {}),
        usageLogId,
      })
    }

    case "audio-isolation":
      return simpleResult("audio-isolation", "elevenlabs-isolation", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        usageLogId,
      })

    case "text-to-dialogue": {
      // Filter empty dialogue lines (matches frontend behavior)
      const rawDialogue = (data.dialogue ?? data.script) as Array<{ text: string; voice?: string }> | undefined
      const filteredDialogue = rawDialogue?.filter((l) => l.text?.trim())
      return simpleResult("text-to-dialogue", "elevenlabs-dialogue", {
        jobId,
        dialogue: filteredDialogue,
        stability: data.stability,
        languageCode: data.languageCode,
        usageLogId,
      })
    }

    case "voice-changer":
      // Dual-mode: a wired video input switches the worker to video mode
      // (demux → STS → remux). Video wins over audio when both are present.
      return simpleResult("voice-changer", "elevenlabs-voice-changer", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        voiceId: data.voiceId || data.voice,
        stability: data.stability,
        similarityBoost: data.similarityBoost,
        style: data.style,
        removeBackgroundNoise: data.removeBackgroundNoise,
        usageLogId,
      })

    case "dubbing":
      return simpleResult("dubbing", "elevenlabs-dubbing", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        targetLanguage: data.targetLanguage,
        sourceLanguage: data.sourceLanguage,
        numSpeakers: data.numSpeakers,
        usageLogId,
      })

    case "voice-remix":
      return simpleResult("voice-remix", "elevenlabs-voice-remix", {
        jobId,
        voiceDescription: data.voiceDescription,
        text: resolvedInputs.prompt || resolveRefs(data.text as string | undefined, refMap),
        usageLogId,
      })

    case "voice-design": {
      const audioStyle = collectAudioStyleHints(node, "voice-design", buildCtx)
      const userVoiceDesc = (data.voiceDescription as string | undefined) ?? ""
      const composed = truncateForField(audioStyle.text, userVoiceDesc, 1000)
      const finalVoiceDescription = appendField(userVoiceDesc, composed)
      return simpleResult("voice-design", "elevenlabs-voice-design", {
        jobId,
        text: resolvedInputs.prompt || resolveRefs(data.text as string | undefined, refMap),
        voiceDescription: finalVoiceDescription,
        model: data.model,
        loudness: data.loudness,
        guidanceScale: data.guidanceScale,
        seed: data.seed,
        quality: data.quality,
        shouldEnhance: data.shouldEnhance,
        usageLogId,
      })
    }

    case "forced-alignment":
      return simpleResult("forced-alignment", "elevenlabs-forced-alignment", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        transcript: resolvedInputs.prompt || resolveRefs(data.transcript as string | undefined, refMap),
        usageLogId,
      })

    // --- Suno ---
    case "suno-generate": {
      const sunoGenCreditId = (data.model as string) === "V5" ? "suno-v5" : "suno-generate"
      const audioStyle = collectAudioStyleHints(node, "suno-generate", buildCtx)
      const effectiveCustomMode = getEffectiveSunoCustomMode(data)
      const userStyle = (data.style as string | undefined) ?? ""
      const userPromptForSuno = resolvedInputs.prompt
        || resolveRefs(data.prompt as string | undefined, refMap)
        || ""
      let finalStyle = userStyle
      let finalSunoPrompt = userPromptForSuno
      if (effectiveCustomMode) {
        const composed = truncateForField(audioStyle.text, userStyle, 500)
        finalStyle = appendField(userStyle, composed)
      } else {
        const composed = truncateForField(audioStyle.text, userPromptForSuno, 3000)
        finalSunoPrompt = appendField(userPromptForSuno, composed)
      }
      return simpleResult("suno-generate", sunoGenCreditId, {
        jobId,
        prompt: finalSunoPrompt,
        model: data.model,
        lyrics: resolveRefs(data.lyrics as string | undefined, refMap),
        style: finalStyle,
        title: data.title,
        negativeStyle: data.negativeStyle,
        // Manual vocalGender wins; otherwise derive from a connected
        // voice-character node (audioStyle.fields.vocalGender).
        vocalGender: data.vocalGender ?? audioStyle.fields.vocalGender,
        styleWeight: data.styleWeight,
        weirdnessConstraint: data.weirdnessConstraint,
        audioWeight: data.audioWeight,
        customMode: effectiveCustomMode,
        instrumental: data.instrumental ?? false,
        ...resolvePersona(resolvedInputs, data),
        usageLogId,
      })
    }

    case "suno-cover": {
      const hasCoverCustomFields = !!(data.style || data.title || data.lyrics)
      const sunoCoverCreditId = (data.model as string) === "V5" ? "suno-v5" : "suno-cover"
      return simpleResult("suno-cover", sunoCoverCreditId, {
        jobId,
        prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
        uploadUrl: resolvedInputs.uploadUrl || resolvedInputs.audioUrl || data.uploadUrl || data.audioUrl,
        model: data.model,
        lyrics: resolveRefs(data.lyrics as string | undefined, refMap),
        style: data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        customMode: data.customMode ?? hasCoverCustomFields,
        instrumental: data.instrumental ?? false,
        ...resolvePersona(resolvedInputs, data),
        usageLogId,
      })
    }

    case "suno-extend": {
      const sunoExtCreditId = (data.model as string) === "V5" ? "suno-v5" : "suno-extend"
      return simpleResult("suno-extend", sunoExtCreditId, {
        jobId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        defaultParamFlag: data.defaultParamFlag ?? true,
        prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
        model: data.model,
        style: data.style,
        title: data.title,
        continueAt: data.continueAt ?? data.continueFrom,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        styleWeight: data.styleWeight,
        weirdnessConstraint: data.weirdnessConstraint,
        audioWeight: data.audioWeight,
        ...resolvePersona(resolvedInputs, data),
        usageLogId,
      })
    }

    case "suno-lyrics":
      return simpleResult("suno-lyrics", "suno-lyrics", {
        jobId,
        prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
        usageLogId,
      })

    case "suno-separate": {
      // `split_stem` is ~3x more expensive than `separate_vocal` — the route's
      // creditGuard switches identifiers based on `type`. Mirror that here so
      // orchestrated split_stem runs don't under-charge the user.
      const separateType = (data.type as string | undefined) || "separate_vocal"
      const separateIdentifier =
        separateType === "split_stem" ? "suno-separate-stem" : "suno-separate"
      return simpleResult("suno-separate", separateIdentifier, {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        type: separateType,
        usageLogId,
      })
    }

    case "suno-music-video":
      return simpleResult("suno-music-video", "suno-music-video", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        usageLogId,
      })

    case "suno-mashup":
      return simpleResult("suno-mashup", "suno-mashup", {
        jobId,
        uploadUrlList: resolvedInputs.uploadUrlList || [
          resolvedInputs.audioUrl,
          resolvedInputs.audioUrl2,
        ].filter(Boolean),
        model: data.model,
        customMode: data.customMode ?? false,
        style: data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        usageLogId,
      })

    case "suno-replace-section":
      return simpleResult("suno-replace-section", "suno-replace-section", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        infillStartS: data.infillStartS ?? 0,
        infillEndS: data.infillEndS ?? 30,
        prompt: promptFor("suno-replace-section"),
        tags: data.tags,
        title: data.title,
        usageLogId,
      })

    case "suno-add-instrumental":
      return simpleResult("suno-add-instrumental", "suno-add-instrumental", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        model: data.model,
        usageLogId,
      })

    case "suno-add-vocals":
      return simpleResult("suno-add-vocals", "suno-add-vocals", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        model: data.model,
        usageLogId,
      })

    case "suno-convert-wav":
      return simpleResult("suno-convert-wav", "suno-convert-wav", {
        jobId,
        taskId: resolvedInputs.sunoTaskId || data.sunoTaskId || data.taskId,
        audioId: resolvedInputs.sunoTrackId || data.sunoTrackId || data.audioId,
        usageLogId,
      })

    case "suno-upload-extend":
      return simpleResult("suno-upload-extend", "suno-upload-extend", {
        jobId,
        uploadUrl: resolvedInputs.audioUrl || data.uploadUrl || data.audioUrl,
        prompt: resolveRefs(data.prompt as string | undefined, refMap),
        // Route schema requires continueAt as a non-negative number; default to
        // 0 (extend from start) to match the frontend single-node behaviour.
        continueAt: (data.continueAt as number | undefined) ?? 0,
        defaultParamFlag: data.defaultParamFlag ?? true,
        model: data.model,
        style: resolvedInputs.prompt || data.style,
        title: data.title,
        negativeStyle: data.negativeStyle,
        vocalGender: data.vocalGender,
        usageLogId,
      })

    // --- Transcription / OCR ---
    case "transcribe": {
      const provider = (data.provider as string) ?? "elevenlabs-stt"
      let transcribeAudioUrl = resolvedInputs.audioUrl || resolvedInputs.videoUrl || data.audioUrl

      // If the audio source is a youtube-video node, prefer its downloadedAudioUrl
      // (matches frontend logic that calls downloadYouTubeAudio before transcribing)
      if (buildCtx?.edges && buildCtx?.nodes && buildCtx?.nodeStates) {
        const transcribeInEdges = buildCtx.edges.filter((e) => e.target === node.id)
        for (const edge of transcribeInEdges) {
          const srcNode = buildCtx.nodes.find((n) => n.id === edge.source)
          if (!srcNode || srcNode.type !== "youtube-video") continue
          const ytAudio = (srcNode.data.downloadedAudioUrl as string | undefined)?.trim()
          if (ytAudio) {
            transcribeAudioUrl = ytAudio
            break
          }
        }
      }

      return {
        jobName: "transcribe",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          audioUrl: transcribeAudioUrl,
          provider,
          language: data.language,
          diarize: data.diarize,
          tagAudioEvents: data.tagAudioEvents,
          usageLogId,
        },
      }
    }

    // --- FFmpeg processing (0 credits) ---
    case "combine-videos": {
      let combineVideoUrls = resolvedInputs.videoUrls || data.videoUrls || []
      // Apply user-configured clip ordering if available (matches frontend logic)
      const clipOrder = data.clipOrder as string[] | undefined
      const sourceEntries = resolvedInputs.videoUrlsWithSourceIds
      let upstreamDurations: Array<number | undefined> | undefined
      if (clipOrder?.length && sourceEntries?.length) {
        const ordered: string[] = []
        const orderedDurations: Array<number | undefined> = []
        for (const nodeId of clipOrder) {
          const entry = sourceEntries.find((e) => e.nodeId === nodeId)
          if (entry) {
            ordered.push(entry.url)
            orderedDurations.push(entry.duration)
          }
        }
        if (ordered.length >= 2) {
          combineVideoUrls = ordered
          upstreamDurations = orderedDurations
        }
      } else if (sourceEntries?.length) {
        upstreamDurations = sourceEntries.map((e) => e.duration)
      }
      return ffmpegResult("combine-videos", {
        jobId,
        videoUrls: combineVideoUrls,
        transition: data.transition ?? "cut",
        transitionDuration: data.transitionDuration ?? 0.5,
        audioMode: data.audioMode ?? "crossfade",
        trimStartFrames: (data.trimStartFrames as number) ?? 0,
        trimEndFrames: (data.trimEndFrames as number) ?? 0,
        upstreamDurations,
        usageLogId,
      })
    }

    case "merge-video-audio": {
      // Build audioTracks from resolved audioSources (matches frontend mergeVideoAudioApi shape)
      const trackSettings = (data.trackSettings as Record<string, Record<string, unknown>> | undefined) ?? {}
      const voiceoverVol = (data.voiceoverVolume as number | undefined) ?? 100
      const audioTracks = (resolvedInputs.audioSources ?? []).map((s) => {
        const settings = trackSettings[s.sourceNodeId]
        return {
          url: s.url,
          startTime: (settings?.startTime as number | undefined) ?? 0,
          volume: (settings?.volume as number | undefined) ?? voiceoverVol,
          sourceType: s.sourceType ?? (settings?.sourceType as "audio" | "video" | undefined),
        }
      })
      // If only a single audioUrl was resolved (no audioSources), add it as a track
      if (audioTracks.length === 0 && resolvedInputs.audioUrl) {
        audioTracks.push({
          url: resolvedInputs.audioUrl,
          startTime: 0,
          volume: voiceoverVol,
          sourceType: "audio" as const,
        })
      }
      return ffmpegResult("merge-video-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        audioTracks,
        voiceoverVolume: voiceoverVol,
        backgroundVolume: (data.originalAudioVolume as number | undefined) ?? (data.backgroundVolume as number | undefined) ?? 30,
        keepOriginalAudio: data.keepOriginalAudio ?? true,
        usageLogId,
      })
    }

    case "trim-audio":
      return ffmpegResult("trim-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || resolvedInputs.audioUrl || data.videoUrl,
        audioFormat: data.audioFormat,
        startTime: data.startTime,
        endTime: data.endTime,
        usageLogId,
      })

    case "split-media":
      return ffmpegResult("split-media", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        chunkDuration: data.chunkDuration,
        audioFormat: data.audioFormat,
        usageLogId,
      })

    case "extract-audio":
      return ffmpegResult("extract-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        usageLogId,
      })

    case "remove-audio":
      return ffmpegResult("remove-audio", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        usageLogId,
      })

    case "trim-video": {
      const trimMode = (data.trimMode as string | undefined) ?? "time"
      return ffmpegResult("trim-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        startTime: trimMode === "time" ? data.startTime : 0,
        endTime: trimMode === "time" ? data.endTime : undefined,
        // outputSilentVideo: when true, the main trimmed clip is encoded
        // with `-an` (no audio).
        outputSilentVideo: data.outputSilentVideo,
        // Frame-based trim — worker probes source fps and converts.
        trimStartFrames: trimMode === "frames" ? data.trimStartFrames : undefined,
        trimEndFrames: trimMode === "frames" ? data.trimEndFrames : undefined,
        // Smart loop cut — worker picks the trailing frame closest to frame 0.
        smartLoopCut: trimMode === "smart-loop-cut",
        smartLoopCutLookback: trimMode === "smart-loop-cut" ? data.smartLoopCutLookback : undefined,
        // Pass through trimMode + upstream duration for accurate credit estimation
        // (frame and smart-loop-cut modes need source length to derive output duration).
        trimMode,
        upstreamDuration: resolvedInputs.videoDuration,
        usageLogId,
      })
    }

    case "extract-frame":
      return ffmpegResult("extract-frame", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        mode: data.mode || "first",
        timestamp: data.timestamp,
        usageLogId,
      })

    case "resize-video":
      return ffmpegResult("resize-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        targetAspect: data.targetAspect ?? data.aspectRatio,
        // Default "pad" matches the route's Zod schema; sending "fit" (an
        // unsupported enum value) would make the worker silently no-op.
        method: data.method ?? "pad",
        padColor: data.padColor,
        usageLogId,
      })

    case "social-media-format": {
      const mediaUrl = resolvedInputs.videoUrl || resolvedInputs.imageUrl || data.mediaUrl
      const mediaType = resolvedInputs.videoUrl ? "video" : "image"
      const specKey = (data.specKey as string) || "instagram:feed-square"
      const spec = PLATFORM_SPECS[specKey]
      return ffmpegResult("social-media-format", {
        jobId,
        mediaUrl,
        mediaType,
        specKey,
        width: spec?.width ?? 1080,
        height: spec?.height ?? 1080,
        method: data.method || "pad",
        padColor: data.padColor || "#000000",
        usageLogId,
      })
    }

    case "speed-ramp":
      return ffmpegResult("speed-ramp", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        speed: data.speed,
        adjustAudio: data.adjustAudio,
        reverse: data.reverse,
        audioMode: data.audioMode,
        quality: data.quality,
        ramps: data.ramps,
        usageLogId,
      })

    case "loop-video":
      return ffmpegResult("loop-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        mode: data.mode ?? "repeat",
        repeatCount: data.repeatCount ?? data.loops,
        targetDuration: data.targetDuration,
        smartLoopCutBeforeRepeat: data.smartLoopCutBeforeRepeat,
        smartLoopCutLookback: data.smartLoopCutLookback,
        // Pass through upstream duration for accurate credit estimation
        // (repeat mode multiplies upstream duration by repeatCount to derive cost).
        upstreamDuration: resolvedInputs.videoDuration,
        usageLogId,
      })

    case "fade-video":
      return ffmpegResult("fade-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        fadeIn: data.fadeIn ?? true,
        fadeInDuration: data.fadeInDuration ?? 0.5,
        fadeOut: data.fadeOut ?? true,
        fadeOutDuration: data.fadeOutDuration ?? 0.5,
        color: data.color ?? "black",
        usageLogId,
      })

    case "transcode-video":
      return ffmpegResult("transcode-video", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        codec: data.codec,
        crf: data.crf,
        resolution: data.resolution,
        audioBitrate: data.audioBitrate,
        usageLogId,
      })

    case "add-captions": {
      const captionsValue = data.captions
      const isCaptionArray = Array.isArray(captionsValue) && captionsValue.length > 0 && typeof (captionsValue[0] as { startMs?: number })?.startMs === "number"
      return ffmpegResult("add-captions", {
        jobId,
        videoUrl: resolvedInputs.videoUrl || data.videoUrl,
        text: !isCaptionArray ? (resolvedInputs.prompt || resolveRefs(data.text as string | undefined, refMap)) : undefined,
        captions: isCaptionArray ? captionsValue : (resolvedInputs.captions ?? undefined),
        auto_transcribe: data.auto_transcribe as boolean | undefined,
        transcribe_provider: data.transcribe_provider as string | undefined,
        style: data.captionStyle ?? data.style,
        position: data.captionPosition ?? data.position,
        fontSize: data.fontSize,
        color: data.color,
        backgroundColor: data.backgroundColor,
        usageLogId,
      })
    }

    case "mix-audio": {
      // Build ordered [{nodeId, url}] so we can key trackVolumes by nodeId and
      // emit them in the same order as audioUrls (the worker expects a plain
      // number[] aligned with audioUrls indexing).
      const sourceEntries = resolvedInputs.audioUrlsWithSourceIds ?? []
      let orderedEntries: Array<{ nodeId: string; url: string }> = sourceEntries
      const trackOrder = data.trackOrder as string[] | undefined
      if (trackOrder?.length && sourceEntries.length) {
        const ordered: Array<{ nodeId: string; url: string }> = []
        for (const nodeId of trackOrder) {
          const entry = sourceEntries.find((e) => e.nodeId === nodeId)
          if (entry) ordered.push(entry)
        }
        if (ordered.length >= 2) orderedEntries = ordered
      }

      // If the frontend only gave us raw audioUrls (no source IDs), fall back.
      const fallbackUrls = resolvedInputs.audioUrls || (data.audioUrls as string[] | undefined) || []
      const mixAudioUrls: string[] = orderedEntries.length > 0
        ? orderedEntries.map((e) => e.url)
        : fallbackUrls

      // trackVolumes on the node data is stored as Record<nodeId, number>, but
      // the worker (backend/src/workers/handlers/ffmpeg.ts) expects number[]
      // aligned with audioUrls. Convert here so orchestrated runs honour
      // user-configured per-track volumes. Legacy `volumes` array is kept as
      // a fallback for direct API callers.
      const rawVolumes = data.trackVolumes as Record<string, number> | undefined
      let trackVolumes: number[] | undefined
      if (orderedEntries.length > 0 && rawVolumes && typeof rawVolumes === "object") {
        trackVolumes = orderedEntries.map((e) => rawVolumes[e.nodeId] ?? 100)
      } else if (Array.isArray(data.volumes)) {
        trackVolumes = data.volumes as number[]
      }

      return ffmpegResult("mix-audio", {
        jobId,
        audioUrls: mixAudioUrls,
        trackVolumes,
        usageLogId,
      })
    }

    case "combine-audio": {
      let combineAudioUrls: string[] = resolvedInputs.audioUrls ?? (Array.isArray(data.audioUrls) ? data.audioUrls as string[] : [])
      const segmentOrder = data.segmentOrder as string[] | undefined
      if (segmentOrder?.length && resolvedInputs.audioUrlsWithSourceIds?.length) {
        const ordered: string[] = []
        for (const nodeId of segmentOrder) {
          const entry = resolvedInputs.audioUrlsWithSourceIds.find((e) => e.nodeId === nodeId)
          if (entry) ordered.push(entry.url)
        }
        if (ordered.length >= 1) combineAudioUrls = ordered
      }
      const segmentSettings = (data.segmentSettings ?? {}) as Record<string, { startTime?: number; endTime?: number }>
      const sourceEntries: Array<{ nodeId: string; url: string }> = resolvedInputs.audioUrlsWithSourceIds ?? combineAudioUrls.map((url) => ({ nodeId: "", url }))
      const segments = sourceEntries.map((entry) => {
        const settings = segmentSettings[entry.nodeId] ?? {}
        return {
          url: entry.url,
          ...(settings.startTime != null ? { startTime: settings.startTime } : {}),
          ...(settings.endTime != null ? { endTime: settings.endTime } : {}),
        }
      })
      return ffmpegResult("combine-audio", {
        jobId,
        segments,
        usageLogId,
      })
    }

    case "adjust-volume": {
      const avInputUrl = resolvedInputs.audioUrl || resolvedInputs.videoUrl || data.audioUrl || data.videoUrl
      const avVideoUrl = resolvedInputs.videoUrl || data.videoUrl
      return ffmpegResult("adjust-volume", {
        jobId,
        audioUrl: avInputUrl,
        videoUrl: avVideoUrl,
        volume: data.volume,
        normalize: data.normalize,
        fadeIn: data.fadeIn,
        fadeOut: data.fadeOut,
        usageLogId,
      })
    }

    // --- Entity generation (character, face, object, location) ---
    // IMPORTANT: build the same prompt the route would produce. A single-node
    // HTTP call hits /v1/generate-{character,face,object,location} which enriches
    // the prompt from name/gender/style/baseOutfit/category. The orchestrator
    // enqueues directly to the worker, bypassing that enrichment — so we must
    // construct the prompt ourselves using the shared builders.
    case "character": {
      const provider = (data.provider as string) ?? "nano-banana"
      const name = (data.name as string | undefined) ?? ""
      const entityPrompt = name
        ? buildCharacterPrompt({
            name,
            description: data.description as string | undefined,
            gender: data.gender as string | undefined,
            style: data.style as string | undefined,
            baseOutfit: data.baseOutfit as string | undefined,
          })
        : resolveRefs(data.description as string | undefined, refMap)
          ?? resolveRefs(data.prompt as string | undefined, refMap)
      return {
        jobName: "generate-character",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: entityPrompt,
          sourceImageUrl: data.sourceImageUrl,
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          usageLogId,
        },
      }
    }
    case "face": {
      const provider = (data.provider as string) ?? "nano-banana"
      const name = (data.name as string | undefined) ?? ""
      let entityPrompt: string | undefined
      if (name) {
        const templateInputs = buildFaceTemplateInputs({
          name,
          description: data.description as string | undefined,
          style: data.style as string | undefined,
        })
        const template = resolveTemplate(
          "face-generation",
          buildCtx?.settings?.userPromptTemplates,
          buildCtx?.settings?.flowPromptTemplates,
        )
        entityPrompt = applyTemplate(template, templateInputs)
      } else {
        entityPrompt = resolveRefs(data.description as string | undefined, refMap)
          ?? resolveRefs(data.prompt as string | undefined, refMap)
      }
      return {
        jobName: "generate-face",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: entityPrompt,
          sourceImageUrl: data.sourceImageUrl,
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          usageLogId,
        },
      }
    }
    case "object": {
      const provider = (data.provider as string) ?? "nano-banana"
      const name = (data.name as string | undefined) ?? ""
      const entityPrompt = name
        ? buildObjectPrompt({
            name,
            description: data.description as string | undefined,
            category: data.category as string | undefined,
            style: data.style as string | undefined,
          })
        : resolveRefs(data.description as string | undefined, refMap)
          ?? resolveRefs(data.prompt as string | undefined, refMap)
      return {
        jobName: "generate-object",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: entityPrompt,
          sourceImageUrl: data.sourceImageUrl,
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          usageLogId,
        },
      }
    }
    case "location": {
      const provider = (data.provider as string) ?? "nano-banana"
      const name = (data.name as string | undefined) ?? ""
      const cinematographyHints = collectCinematographyHints(node.id, buildCtx, { excludeTypes: STILL_IMAGE_EXCLUDE_TYPES })
      const cineSuffix = cinematographyHints.length > 0 ? cinematographyHints.join(", ") : ""
      const baseDescription = (data.description as string | undefined) ?? ""
      const augmentedDescription = cineSuffix
        ? (baseDescription ? `${baseDescription}. ${cineSuffix}` : cineSuffix)
        : (baseDescription || undefined)
      const entityPrompt = name
        ? buildLocationPrompt({
            name,
            description: augmentedDescription,
            category: data.category as string | undefined,
            style: data.style as string | undefined,
          })
        : resolveRefs(augmentedDescription, refMap)
          ?? resolveRefs(data.prompt as string | undefined, refMap)
      return {
        jobName: "generate-location",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: entityPrompt,
          sourceImageUrl: data.sourceImageUrl,
          provider,
          referenceImageUrls: resolvedInputs.referenceImageUrls,
          usageLogId,
        },
      }
    }

    case "scene": {
      const provider = (data.provider as string) ?? "nano-banana"
      const sceneSettings = buildCtx?.settings
      const charDefs = sceneSettings?.characterDefinitions ?? []
      const userTpl = sceneSettings?.userPromptTemplates
      const flowTpl = sceneSettings?.flowPromptTemplates

      // Build the rich scene prompt (matches frontend execute-node.ts logic).
      // Wrapped in try/catch because node data is cast from Record<string, unknown>
      // and may be missing required SceneData fields on older/malformed nodes.
      let scenePrompt: string
      const sceneRefUrls = [...(resolvedInputs.referenceImageUrls ?? [])]
      try {
        const sceneStylePrompt = buildScenePrompt(data as unknown as SceneData, charDefs as CharacterDef[])
        const upstreamPrompt = resolvedInputs.prompt ?? ""
        scenePrompt = upstreamPrompt
          ? `${upstreamPrompt}. ${sceneStylePrompt}`
          : sceneStylePrompt

        // Append character description templates (matches frontend charDescs logic).
        // buildScenePrompt adds compositional info (name + mood + action);
        // this loop adds full description text via templates for the image generator.
        const allAssetIds = [
          ...((data.characters as Array<{ assetId: string }>) ?? []).map((c) => c.assetId),
          ...((data.locations as Array<{ assetId: string }>) ?? []).map((l) => l.assetId),
          ...((data.objects as Array<{ assetId: string }>) ?? []).map((o) => o.assetId),
        ].filter(Boolean)
        const sceneCharDescs: string[] = []
        for (const assetId of allAssetIds) {
          const asset = charDefs.find((a) => a.id === assetId)
          if (!asset) continue
          if (asset.referenceImageUrl) sceneRefUrls.push(asset.referenceImageUrl)
          if (asset.type === "description" && asset.description) {
            const templateKey =
              asset.category === "face" ? "face-description"
                : asset.category === "location" ? "location-description"
                  : asset.category === "object" ? "object-description"
                    : "character-description"
            const template = resolveTemplate(templateKey, userTpl, flowTpl)
            sceneCharDescs.push(applyTemplate(template, { name: asset.name, description: asset.description }))
          }
        }
        if (sceneCharDescs.length > 0) {
          scenePrompt = `${scenePrompt}\n${sceneCharDescs.join(" ")}`
        }
      } catch {
        // Malformed scene data — fall back to raw prompt fields
        scenePrompt = resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap) || ""
      }

      return {
        jobName: "generate-image",
        queueName: "video-generation",
        modelIdentifier: provider,
        payload: {
          jobId,
          prompt: scenePrompt,
          provider,
          referenceImageUrls: sceneRefUrls.length > 0 ? sceneRefUrls : undefined,
          aspectRatio: data.aspectRatio,
          usageLogId,
        },
      }
    }

    case "generate-script": {
      // Credit ID is tier-based when an LLM model is selected (e.g.
      // `generate-script:economy`). Must also forward `llmModel` so the worker
      // routes to the user's chosen model instead of the default.
      const scriptLlmModel = data.llmModel as string | undefined
      return {
        jobName: "generate-script",
        queueName: "video-generation",
        modelIdentifier: buildLlmCreditIdentifier("generate-script", scriptLlmModel),
        payload: {
          jobId,
          prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
          sceneCount: data.sceneCount,
          tone: data.tone ?? data.style,
          targetDuration: data.targetDuration ?? data.targetLength,
          provider: data.provider,
          llmModel: scriptLlmModel,
          usageLogId,
        },
      }
    }

    // --- Render video (goes to render queue) ---
    case "render-video": {
      // Resolve plan from upstream composer nodes (matches frontend execute-node.ts logic)
      let resolvedPlanType = data.planType as string | undefined
      let resolvedPlan = data.plan as Record<string, unknown> | undefined
      let resolvedSceneGraph = data.sceneGraph as Record<string, unknown> | undefined

      // Search upstream nodes for plan output (matches frontend logic)
      if (!resolvedPlan && !resolvedSceneGraph && buildCtx?.edges && buildCtx?.nodes && buildCtx?.nodeStates) {
        const incomingEdges = buildCtx.edges.filter((e) => e.target === node.id)
        for (const edge of incomingEdges) {
          const srcNode = buildCtx.nodes.find((n) => n.id === edge.source)
          if (!srcNode) continue
          const mapping = COMPOSER_PLAN_MAP[srcNode.type]
          if (!mapping) continue
          // Check execution state output first (current run), then saved node data
          const foundPlan =
            (buildCtx.nodeStates?.[srcNode.id]?.output?.plan as Record<string, unknown> | undefined) ??
            (srcNode.data[mapping.planField] as Record<string, unknown> | undefined)
          if (foundPlan) {
            resolvedPlanType = mapping.planType
            if (mapping.planType === "scene-graph") {
              resolvedSceneGraph = foundPlan
            } else {
              resolvedPlan = foundPlan
            }
            break
          }
        }

        // Auto-composition fallback: if no plan found, collect media assets and
        // build a simple scene graph (matches frontend buildAutoComposition)
        if (!resolvedPlan && !resolvedSceneGraph) {
          const assets = collectMediaAssetsForRender(node, buildCtx.edges, buildCtx.nodes, buildCtx.nodeStates)
          if (assets.length > 0) {
            const renderFps = (data.fps as number) ?? 30
            const renderDuration = (data.durationSeconds as number) ?? 10
            const renderAspect = (data.aspectRatio as string) ?? "16:9"
            const renderBg = (data.backgroundColor as string) ?? "#000000"
            resolvedSceneGraph = buildAutoCompositionForRender(assets, renderFps, renderDuration, renderAspect, renderBg)
          }
        }
      }

      return {
        jobName: "render-video",
        queueName: "video-render",
        modelIdentifier: "render-video",
        payload: {
          jobId,
          planType: resolvedPlanType,
          plan: resolvedPlan,
          sceneGraph: resolvedSceneGraph,
          template: data.template,
          usageLogId,
        },
      }
    }

    default:
      throw new Error(`[payload-builder] Unknown node type: ${type}`)
  }
}

// ---------------------------------------------------------------------------
// Auto-composition helpers for render-video fallback (matches frontend)
// ---------------------------------------------------------------------------

/** Collect image/video/audio assets from upstream nodes (matches frontend collectMediaAssets). */
function collectMediaAssetsForRender(
  node: SimpleNode,
  edges: SimpleEdge[],
  allNodes: SimpleNode[],
  nodeStates: Record<string, NodeExecutionState>,
): Array<{ id: string; type: "image" | "video" | "audio"; url: string }> {
  const assets: Array<{ id: string; type: "image" | "video" | "audio"; url: string }> = []
  const seen = new Set<string>()
  const incomingEdges = edges.filter((e) => e.target === node.id)

  for (const edge of incomingEdges) {
    const srcNode = allNodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const srcType = srcNode.type
    // Skip plan nodes — they're handled by the plan resolution path
    if (COMPOSER_PLAN_MAP[srcType]) continue

    let output: string | undefined
    const state = nodeStates[srcNode.id]
    if (state?.output) {
      output = getPrimaryOutput(state.output, srcType, edge.sourceHandle)
    } else if (isSourceNode(srcType)) {
      const srcOutput = extractSourceNodeOutput(srcNode)
      if (srcOutput) output = getPrimaryOutput(srcOutput, srcType, edge.sourceHandle)
    }
    if (!output || output === "plan-ready" || seen.has(srcNode.id)) continue
    seen.add(srcNode.id)

    let assetType: "image" | "video" | "audio" | undefined
    if (IMAGE_SOURCE_TYPES.has(srcType)) assetType = "image"
    else if (VIDEO_SOURCE_TYPES.has(srcType)) assetType = "video"
    else if (AUDIO_SOURCE_TYPES.has(srcType)) assetType = "audio"

    if (assetType) {
      assets.push({ id: srcNode.id, type: assetType, url: output })
    }
  }

  return assets
}

/** Build a simple scene graph from media assets (matches frontend buildAutoComposition). */
function buildAutoCompositionForRender(
  assets: Array<{ id: string; type: "image" | "video" | "audio"; url: string }>,
  fps: number,
  totalDuration: number,
  aspectRatio: string,
  backgroundColor: string,
): Record<string, unknown> {
  const visualAssets = assets.filter((a) => a.type !== "audio")
  const audioAssets = assets.filter((a) => a.type === "audio")

  const perAssetDuration = visualAssets.length > 0 ? totalDuration / visualAssets.length : totalDuration
  const perAssetFrames = Math.round(perAssetDuration * fps)
  const transitionFrames = 15
  const lastIndex = Math.max(visualAssets.length - 1, 0)

  const tracks: unknown[] = []

  if (visualAssets.length > 0) {
    const mediaSegments = visualAssets.map((asset, i) => ({
      id: `seg_${i}`,
      src: asset.url,
      mediaType: asset.type as "image" | "video",
      startFrame: i * perAssetFrames,
      durationInFrames: perAssetFrames,
      layout: { mode: "fullscreen" as const },
      transitionIn: i > 0 ? { type: "fade", durationFrames: transitionFrames } : undefined,
      transitionOut: i < lastIndex ? { type: "fade", durationFrames: transitionFrames } : undefined,
      effects: asset.type === "image" ? [{ type: "ken-burns", startValue: 1.0, endValue: 1.1 }] : [],
    }))
    tracks.push({
      id: "track_media",
      type: "media",
      zIndex: 0,
      segments: mediaSegments,
    })
  }

  for (let i = 0; i < audioAssets.length; i++) {
    tracks.push({
      id: `track_audio_${i}`,
      type: "audio",
      src: audioAssets[i].url,
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      startFrame: 0,
    })
  }

  const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? ASPECT_RATIO_DIMENSIONS["16:9"]

  return {
    fps,
    width: dimensions.width,
    height: dimensions.height,
    durationInFrames: Math.round(totalDuration * fps),
    backgroundColor,
    tracks,
  }
}
