/**
 * Build BullMQ job payloads for each node type from node data + resolved inputs.
 * Returns { jobName, queueName, payload } for worker-queued nodes.
 */

import type { SimpleNode, SimpleEdge, ResolvedInputs, NodeExecutionState } from "./types.js"

// Shared logic from packages/shared — single source of truth
import { collectAncestorRefs as sharedCollectAncestorRefs } from "@nodaro/shared"
import { buildImagePrompt, buildScenePrompt, applyReferenceOrderToVideo } from "@nodaro/shared"
import { collectIdentityLockClause as sharedCollectIdentityLockClause } from "@nodaro/shared"
import { resolveTemplate, applyTemplate } from "@nodaro/shared"
import { buildCreditModelIdentifier, buildVideoCreditModelIdentifier, buildMotionCreditModelIdentifier } from "@nodaro/shared"
import { resolveNodeRefs } from "@nodaro/shared"
import { composeCameraMotionHintFromConnections } from "@nodaro/shared"
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
} from "@nodaro/shared"
import { selectLoraRoutingForMentions } from "../../lib/character-lora.js"
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
): ConnectedReference[] {
  const out: ConnectedReference[] = []
  const seenUrls = new Set<string>()
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
): ConnectedReference[] {
  const out: ConnectedReference[] = []
  const seenUrls = new Set<string>()
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

/** Expand wired upstream Character nodes into canonical + per-variant refs. */
function expandWiredCharacterRefs(
  consumerNodeId: string,
  buildCtx: PayloadBuildContext | undefined,
): ConnectedReference[] {
  if (!buildCtx?.nodes || !buildCtx.edges) return []
  const out: ConnectedReference[] = []
  const incoming = buildCtx.edges.filter((e) => e.target === consumerNodeId)
  for (const e of incoming) {
    const upstream = buildCtx.nodes.find((n) => n.id === e.source)
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
    // Used by selectLoraRoutingForMentions to decide the LoRA inference path.
    const loraReplicateVersion =
      (charData.loraReplicateVersion as string | null | undefined) ?? null
    const loraTriggerWord =
      (charData.loraTriggerWord as string | null | undefined) ?? null
    const loraTrainingStatus =
      (charData.loraTrainingStatus as string | null | undefined) ?? null
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
        loraReplicateVersion,
        loraTriggerWord,
        loraTrainingStatus,
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
          loraReplicateVersion,
          loraTriggerWord,
          loraTrainingStatus,
        })
      }
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
  const incoming = buildCtx.edges.filter((e) => e.target === consumerNodeId)
  for (const e of incoming) {
    const upstream = buildCtx.nodes.find((n) => n.id === e.source)
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
  const matchedSources: SimpleNode[] = []
  const seenSrcIds = new Set<string>()
  for (const e of allEdges) {
    if (e.target !== consumerNodeId) continue
    const src = allNodes.find((n) => n.id === e.source)
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

// ---------------------------------------------------------------------------
// List-like node helpers for buildNodeRefMap edge-aware output extraction
// ---------------------------------------------------------------------------

const LIST_LIKE_TYPES = new Set(["list", "loop", "split-text"])

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

/** Parse the list of items from a list/loop/split-text node. */
function extractListItems(
  node: SimpleNode,
  states: Record<string, NodeExecutionState>,
): string[] {
  const data = node.data
  if (node.type === "list") {
    // Modern format: columns + rows (same as loop). Without this, node refs
    // like {List Name} resolving to list items only saw the legacy items
    // string; modern lists returned an empty array.
    const cols = data.columns as Array<{ handleId: string }> | undefined
    if (cols) {
      const rows = data.rows as string[][] | undefined
      return (rows ?? []).map((r) => r[0]?.trim() ?? "").filter(Boolean)
    }
    // Legacy format: newline-separated items string
    return ((data.items as string | undefined) || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
  }
  if (node.type === "loop") {
    const rows = data.rows as string[][] | undefined
    return (rows ?? []).map((r) => r[0]?.trim() ?? "").filter(Boolean)
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
  const visited = new Set<string>()
  const queue: Array<{ id: string; connectingEdges: ReadonlyArray<SimpleEdge> }> = []

  // Seed BFS with direct parents, grouping edges by source
  const seedEdges = new Map<string, SimpleEdge[]>()
  for (const edge of edges) {
    if (edge.target === nodeId) {
      if (!seedEdges.has(edge.source)) seedEdges.set(edge.source, [])
      seedEdges.get(edge.source)!.push(edge)
    }
  }
  for (const [sourceId, edgeGroup] of seedEdges) {
    visited.add(sourceId)
    queue.push({ id: sourceId, connectingEdges: edgeGroup })
  }

  while (queue.length > 0) {
    const { id: currentId, connectingEdges } = queue.shift()!
    const node = nodes.find((n) => n.id === currentId)
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
    for (const edge of edges) {
      if (edge.target === currentId && !visited.has(edge.source)) {
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
 * Compose a camera-motion hint for a camera-motion SOURCE node: read its
 * `cameraMotion` id, walk its startState/endState incoming edges to collect
 * prompt hints from connected parameter nodes, and delegate to the shared
 * composer. Returns the empty string when the motion id is missing.
 */
function composeCameraMotionHintForNode(
  motionId: string | undefined,
  sourceNodeId: string,
  ctx: PayloadBuildContext | undefined,
): string {
  if (!motionId) return ""
  const nodes = ctx?.nodes ?? []
  const edges = ctx?.edges ?? []
  const startHints: string[] = []
  const endHints: string[] = []
  for (const edge of edges) {
    if (edge.target !== sourceNodeId) continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const hint = getNodePromptHint(srcNode)
    if (!hint) continue
    if (edge.targetHandle === "startState") startHints.push(hint)
    else if (edge.targetHandle === "endState") endHints.push(hint)
  }
  return composeCameraMotionHintFromConnections(motionId, startHints, endHints)
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
    if (edge.targetHandle !== "cinematography") continue
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
const STILL_IMAGE_EXCLUDE_TYPES: ReadonlySet<string> = new Set(["camera-motion", "temporal"])

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
    if (edge.targetHandle !== "cinematography") continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    if (exclude?.has(srcNode.type ?? "")) continue

    if (srcNode.type === "camera-motion") {
      const motionId = (srcNode.data as Record<string, unknown>).cameraMotion as string | undefined
      const composed = composeCameraMotionHintForNode(motionId, srcNode.id, ctx)
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
        const imageSourceTypes = new Set(["upload-image", "generate-image", "edit-image", "image-to-image", "modify-image", "upscale-image", "remove-background"])
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
      const lora = selectLoraRoutingForMentions(wiredCharRefs)
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
      const result = useConnectedRefs
        ? buildImagePrompt({
            prompt: rawPrompt,
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
              ),
              ...extraRefEntries,
            ],
            ancestorRefs,
            referenceOrder: generateRefOrder,
            suppressedCanonicalCharacterIds: generateSuppressed,
            // LoRA path: skip mention machinery (trigger word + LoRA carry identity).
            skipCharacterMentions: lora !== null,
          })
        : buildImagePrompt({
            prompt: rawPrompt,
            provider: effectiveProvider,
            style: styleBypass ? undefined : (typeof data.style === "string" ? data.style : undefined),
            negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
            characterDefs: charDefs as CharacterDef[],
            userTemplates: settings?.userPromptTemplates,
            flowTemplates: settings?.flowPromptTemplates,
            referenceImageUrls: directRefs,
            ancestorRefs,
            referenceOrder: generateRefOrder,
            suppressedCanonicalCharacterIds: generateSuppressed,
          })

      return {
        jobName: "generate-image",
        queueName: "video-generation",
        modelIdentifier: lora
          ? "flux-lora-character"
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
          // Hand the synthetic model id to the Replicate provider when LoRA is active.
          model: lora ? "flux-lora-character" : (data.model as string | undefined),
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
      const i2iExtraRefEntries = expandExtraRefsToConnectedReferences(
        readExtraRefs(data),
        buildExtraRefCharacterContextLookup(node.id, buildCtx),
      )
      const i2iUseConnectedRefs = i2iWiredCharRefs.length > 0 || i2iExtraRefEntries.length > 0

      // Build prompt with style + character descriptions (same as generate-image)
      const i2iStyleBypass = hasConnectedStyleNode(node.id, buildCtx)
      const i2iRefOrder = readStringArray(data.referenceOrder)
      const i2iSuppressed = readStringArray(data.suppressedCanonicalCharacterIds)
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
              ...buildConnectedRefsFromUrls(i2iWiredCharRefs, directRefs),
              ...i2iExtraRefEntries,
            ],
            ancestorRefs: [],
            referenceOrder: i2iRefOrder,
            suppressedCanonicalCharacterIds: i2iSuppressed,
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
        const modExtraRefEntries = expandExtraRefsToConnectedReferences(
          readExtraRefs(data),
          buildExtraRefCharacterContextLookup(node.id, buildCtx),
        )
        const modUseConnectedRefs = modWiredCharRefs.length > 0 || modExtraRefEntries.length > 0

        const modStyleBypass = hasConnectedStyleNode(node.id, buildCtx)
        const modRefOrder = readStringArray(data.referenceOrder)
        const modSuppressed = readStringArray(data.suppressedCanonicalCharacterIds)
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
                ...buildConnectedRefsFromUrls(modWiredCharRefs, directRefs),
                ...modExtraRefEntries,
              ],
              ancestorRefs: [],
              referenceOrder: modRefOrder,
              suppressedCanonicalCharacterIds: modSuppressed,
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
      let i2vPrompt: string | undefined = (() => {
        let p = resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap) || resolveRefs(data.motionPrompt as string | undefined, refMap)
        const hints: string[] = []
        if (data.motionEnabled && data.motion) hints.push(`${data.motion} motion`)
        const cinematographyHints = collectCinematographyHints(node.id, buildCtx)
        for (const h of cinematographyHints) hints.push(h)
        if (hints.length > 0 && p) p = `${p}. ${hints.join(", ")}`
        else if (hints.length > 0) p = hints.join(", ")
        const identityClause = collectIdentityLockClause(node.id, buildCtx)
        if (identityClause) p = p ? `${p} ${identityClause}` : identityClause
        return p
      })()
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
      let t2vPrompt: string | undefined = (() => {
        let p = resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap)
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
        let p = resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap)
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
          negativePrompt: data.negativePrompt as string | undefined,
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
      // infinitalk is tier-priced by resolution — `/v1/lip-sync` reserves
      // credits using the composite `infinitalk:{resolution}` identifier.
      const lipSyncResolution = (data.resolution as string | undefined) ?? "720p"
      const lipSyncIdentifier =
        provider === "infinitalk" ? `infinitalk:${lipSyncResolution}` : provider
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
            let p = (resolvedInputs.prompt || data.prompt) as string | undefined
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
            let p = resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap)
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
          provider: evProvider,
          model: evProvider === "veo-extend" ? (data.model ?? "fast") : undefined,
          quality: evProvider === "runway-extend" ? (data.quality ?? "720p") : undefined,
          seeds: evProvider === "veo-extend" ? data.seeds : undefined,
          usageLogId,
        },
      }
    }

    // --- Audio ---
    case "text-to-speech": {
      const provider = (data.provider as string) ?? "elevenlabs-v3"
      // Frontend reads text from directText field when textSource is "direct"
      const ttsText = resolvedInputs.prompt
        || (data.textSource === "direct" ? resolveRefs(data.directText as string | undefined, refMap) : undefined)
        || resolveRefs(data.text as string | undefined, refMap)
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
      const userPrompt = resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap) || ""
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
      const userPrompt = resolvedInputs.prompt
        || resolveRefs(data.prompt as string | undefined, refMap)
        || resolveRefs(data.text as string | undefined, refMap)
        || ""
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
      return simpleResult("voice-changer", "elevenlabs-voice-changer", {
        jobId,
        audioUrl: resolvedInputs.audioUrl || data.audioUrl,
        voiceId: data.voiceId || data.voice,
        stability: data.stability,
        similarityBoost: data.similarityBoost,
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
        prompt: resolvedInputs.prompt || resolveRefs(data.prompt as string | undefined, refMap),
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
