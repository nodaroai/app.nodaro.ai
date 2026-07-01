/**
 * Video-family prompt assembly — the SHARED composition building blocks used by
 * BOTH the run path (`execute-node.ts`) and the final-prompt PREVIEW
 * (`use-final-prompt-segments.ts`).
 *
 * Previously these helpers were inline in `execute-node.ts` and the preview
 * hand-rolled a provider-less composition that diverged from what the run
 * actually sends (missing @-mention resolution, motion/cinematography folding,
 * identity clause). Moving them here lets the preview compose the prompt the
 * EXACT same way the run does — `execute-node.ts` imports them back, so run
 * behaviour is unchanged.
 *
 * Dependencies are limited to `@nodaro/shared` (pure prompt helpers + model
 * registries) and `@/types/nodes` (type-only) — neither imports back from
 * `execute-node.ts`, so there is no circular-import risk.
 */

import type { WorkflowNode, WorkflowEdge, CharacterNodeData, ExtraRef } from "@/types/nodes"
import type { ConnectedReference } from "@nodaro/shared"
import {
  characterMentionSlug,
  extractCharacterLoraFields,
  characterMentionableAssetArrays,
  computeNodePrompt,
  collectIdentityLockClause,
  resolveEffectiveSourceType,
  resolveVideoReferenceCore,
  resolveVideoProviderForMode,
  hasFeature,
  countRefModalityEdges,
  type CharacterMeta,
  type ReferenceModality,
} from "@nodaro/shared"
import { collectCinematographyHints } from "@/lib/cinematography-hints"
import { stampElementInjections, collectCharacterElementInjections } from "@/components/editor/workflow-editor/node-input-resolver"
import { collectWiredPromptContribution } from "@/lib/node-refs"
import { IMAGE_REFERENCE_FORMAT } from "@/lib/image-reference-format"

/**
 * Strip the editor's reference tokens — `{image:N:label}` AND `{video:N:label}` /
 * `{audio:N:label}` — from video prompts (label kept, curly syntax removed).
 * Used on the run paths where the provider does NOT resolve reference tokens
 * (non-ref-capable i2v/t2v/v2v providers, and the FE `switchx` branch which has
 * no core pass): the curly tokens must collapse to plain text exactly as the BE
 * `switchx` case bare-labels them (count 0), closing the FE-run vs BE-orchestrator
 * parity hole where a hand-typed `{video:1:clip}` shipped raw to the provider.
 *
 * The label class matches the core's `REFERENCE_TOKEN_RE` (`[a-zA-Z0-9_ -]`,
 * spaces allowed) so `{audio:2:my song}` → `my song`. MOVED from `execute-node.ts`
 * (was the inline image-only `stripVideoImageTokens`); `execute-node.ts` imports
 * it back. Name kept (low-churn) — it now covers all three modalities.
 */
export function stripVideoImageTokens(text: string | undefined): string | undefined {
  if (!text) return text
  return text.replace(/\{(?:image|video|audio):\d+(?::([a-zA-Z0-9_ -]+))?\}/gi, (_, label) => label ?? "").replace(/\s{2,}/g, " ").trim() || undefined
}

/**
 * Expand a wired upstream Character node into a canonical entry + one entry
 * per asset variant (expressions / poses / motions / angles / bodyAngles /
 * lighting). Mirrors the backend `expandWiredCharacterRefs` in
 * `payload-builder.ts` so single-node frontend runs produce the same
 * `@kira:N:variant` mention resolution as orchestrator-driven runs.
 *
 * Returns `[entryId, ConnectedReference]` pairs so callers can drop them
 * straight into a Map keyed by ID (preserving Map dedup + insertion-order).
 * Returns an empty array when the character has no usable slug — the caller
 * is expected to fall back to a generic `wired-image` entry.
 *
 * MOVED verbatim from `execute-node.ts` (was the inline `expandCharacterNodeIntoRefs`
 * at ~line 479). Still consumed by `execute-node.ts`'s image branches
 * (`buildConnectedRefsForI2I`) via re-import, AND by `expandWiredCharacterRefsForVideo`
 * below.
 *
 * @param characterNode - The upstream Character node (must have type === "character").
 * @param fallbackUrl - URL to use for the canonical entry when the node has
 *   no `defaultAssetUrl` (typically the upstream-output URL). The backend
 *   doesn't have this fallback (it prefers `defaultAssetUrl || sourceImageUrl`);
 *   the frontend keeps it because `chainRefs[i]` may carry a fresher generated
 *   result than `sourceImageUrl`.
 */
export function expandCharacterNodeIntoRefs(
  characterNode: WorkflowNode,
  fallbackUrl?: string,
): Array<[string, Omit<ConnectedReference, "id">]> {
  const charData = characterNode.data as CharacterNodeData
  const upstreamData = characterNode.data as Record<string, unknown>
  const charName = charData.characterName || (upstreamData.label as string) || "Character"
  const characterSlug = characterMentionSlug(charName)
  if (!characterSlug) return []

  const out: Array<[string, Omit<ConnectedReference, "id">]> = []
  // Propagated to every entry derived from this character so downstream
  // `resolveCharacterMentions` can use it as the fallback when a slug doesn't
  // carry an explicit `:mode` override. `undefined` ↔ "identical" (the global
  // default) is handled by the resolver, not here, to keep the JSON small.
  const defaultUsageMode = charData.defaultUsageMode
  // LoRA training fields — character-level (same across all variants). Shared
  // helper keeps this in lockstep with backend `expandWiredCharacterRefs`.
  const loraFields = extractCharacterLoraFields(charData)
  const canonicalUrl = charData.defaultAssetUrl || fallbackUrl || charData.sourceImageUrl
  if (canonicalUrl) {
    out.push([
      characterNode.id,
      {
        defaultName: charName,
        source: "wired-character",
        description: charData.description,
        url: canonicalUrl,
        characterSlug,
        variantSlug: undefined,
        characterCanonicalDescription: charData.canonicalDescription ?? null,
        variantDescription: null,
        variantDisplayName: "canonical",
        defaultUsageMode,
        ...loraFields,
      },
    ])
  }
  const assetArrays = characterMentionableAssetArrays(charData as unknown as Record<string, unknown>)
  for (const [arrayName, items] of Object.entries(assetArrays)) {
    for (const item of items) {
      if (!item.url) continue
      const variantSlug = characterMentionSlug(item.name)
      if (!variantSlug) continue
      out.push([
        `${characterNode.id}_${arrayName}_${variantSlug}`,
        {
          defaultName: `${charName} / ${item.name}`,
          source: "wired-character",
          description: charData.description,
          url: item.url,
          characterSlug,
          variantSlug,
          characterCanonicalDescription: charData.canonicalDescription ?? null,
          variantDescription: null,
          variantDisplayName: item.name,
          defaultUsageMode,
          ...loraFields,
        },
      ])
    }
  }
  return out
}

/**
 * Expand every wired upstream Character node into canonical + per-variant
 * `ConnectedReference` entries. Frontend mirror of the backend
 * `expandWiredCharacterRefs` in `payload-builder.ts`, dropping the asset-id
 * keys (callers only need the list, not the map).
 *
 * Used by the video branches' `@-mention` resolution. The image branches use
 * `expandCharacterNodeIntoRefs` per-upstream because they merge with other
 * sources (chainRefs / character definitions) into a single keyed Map; the
 * video branches consume a flat list and don't need that level of detail.
 *
 * MOVED verbatim from `execute-node.ts` (was the inline
 * `expandWiredCharacterRefsForVideo` at ~line 873).
 */
export function expandWiredCharacterRefsForVideo(
  consumerNodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): ConnectedReference[] {
  const out: ConnectedReference[] = []
  const incomingEdges = edges.filter((e) => e.target === consumerNodeId)
  for (const e of incomingEdges) {
    const upstream = nodes.find((n) => n.id === e.source)
    // The entity `image` handle is a PLAIN image, not an identity ref — skip it
    // (resolveEffectiveSourceType maps `image` → "upload-image"). The portrait
    // still rides along as a plain reference via the resolved image inputs.
    if (!upstream || resolveEffectiveSourceType(upstream.type, e.sourceHandle) !== "character") continue
    const expansion = expandCharacterNodeIntoRefs(upstream)
    for (const [id, meta] of expansion) {
      out.push({ id, ...meta })
    }
  }
  // Stamp wired-element injection so it rides each character's identity bullet
  // in the video "Use these characters:" block (parity with the image side).
  return stampElementInjections(out, consumerNodeId, nodes, edges)
}

/**
 * Expand wired Assets-handle ENTITIES (location/object/creature-animal) into
 * auto-attach `{ url, description }` extras for the unified `{image:N}` numbering
 * (D5 — unified-asset-references). FE mirror of the backend
 * `expandWiredEntityExtraRefs` — RAW canonical image (`sourceImageUrl`), no
 * smart-variant, so the preview ≡ the run. Characters keep their own mention path
 * (`expandWiredCharacterRefsForVideo`). An entity wired via its plain `image`
 * handle is `resolveEffectiveSourceType`-mapped to "upload-image" and so flows
 * through the normal image-ref path instead (not here).
 */
function expandWiredEntityExtrasForVideo(
  consumerNodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): Array<{ url: string; description: string }> {
  const out: Array<{ url: string; description: string }> = []
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const))
  for (const e of edges) {
    if (e.target !== consumerNodeId) continue
    const upstream = nodeById.get(e.source)
    if (!upstream) continue
    const t = resolveEffectiveSourceType(upstream.type, e.sourceHandle)
    if (t !== "location" && t !== "object" && t !== "creature") continue
    const d = upstream.data as Record<string, unknown>
    const url =
      (d.sourceImageUrl as string | undefined) ||
      (d.generatedImageUrl as string | undefined) ||
      (d.url as string | undefined) ||
      (d.referenceImageUrl as string | undefined) ||
      ""
    if (!url) continue
    const name =
      (d.locationName as string | undefined) ||
      (d.objectName as string | undefined) ||
      (d.creatureName as string | undefined) ||
      (d.label as string | undefined) ||
      (t === "location" ? "Location" : t === "creature" ? "Creature" : "Object")
    out.push({ url, description: (d.description as string | undefined)?.trim() || name })
  }
  return out
}

/**
 * Resolve `@kira:N` / `@kira:N:smile` mentions in a video-node prompt against
 * wired Character upstreams AND apply the per-character canonical fallback
 * for unmentioned wired characters.
 *
 * Frontend mirror of the backend `resolveVideoPromptMentions` in
 * `payload-builder.ts`. Without this, single-node frontend runs (clicking
 * "Run" on a single video node) skipped @-mention resolution while running
 * the full workflow worked correctly — producing inconsistent behavior.
 *
 * Per-character behavior contract (parity with image-side + backend):
 *   - wired-character with at least one `@-mention` → contribute ONLY the
 *     mentioned variant URLs (no canonical auto-attach), prepend the
 *     mention-derived directive block.
 *   - wired-character with NO `@-mention` → contribute the canonical URL
 *     + a strong identity directive. Mirrors the pre-mention behavior.
 *
 * Returns the mutated prompt + the asset URLs to slot into the worker
 * payload. The caller decides where (i2v has both `imageUrl` and
 * `referenceImageUrls`; v2v has only a single `referenceImageUrl`; t2v has
 * `referenceImageUrls` only).
 *
 * MOVED verbatim from `execute-node.ts` (was the inline
 * `resolveVideoPromptMentions` at ~line 913). `execute-node.ts` imports it back.
 */
export function resolveVideoPromptMentions(
  prompt: string | undefined,
  consumerNodeId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  extraRefs?: readonly ExtraRef[],
  opts?: {
    /** User-defined reorder (see compute-injected-refs). */
    referenceOrder?: readonly string[]
    /** Character slugs whose canonical-fallback is hidden. */
    suppressedCanonicalCharacterIds?: readonly string[]
    /**
     * Positional reference counts the core resolves `{image:N}` / `{video:N}` /
     * `{audio:N}` body tokens against (worker-payload order). Pure pass-through
     * to `resolveVideoReferenceCore` (Task 2.4 args). When omitted, the core
     * falls back to its own merged-URL count for `image` and 0 for video/audio.
     */
    imageRefCount?: number
    videoRefCount?: number
    audioRefCount?: number
    /**
     * Number of leading image-refs the caller merges itself (EDGE count) — the
     * core offsets asset ordinals + the `{image:N}` count by this much without
     * prepending URLs (D5 image-refs-first). Mirrors the backend orchestrator.
     */
    ordinalOffset?: number
    /**
     * Attach wired Assets-handle entities (location/object/creature) as auto-attach
     * extras in the unified numbering. Set by ref-capable video callers. Mirrors
     * the backend `expandWiredEntityExtraRefs`.
     */
    includeWiredEntities?: boolean
  },
): { prompt: string | undefined; additionalUrls: string[] } {
  // ── FE-only expansion: wire upstream Character nodes → ConnectedReference[].
  // Canonical-suppression filtering lives in the shared core (single source of
  // truth) — pass the raw expansion + the suppressed set straight through. ──
  const wiredCharRefs = expandWiredCharacterRefsForVideo(consumerNodeId, nodes, edges)
  // Wired Assets-handle entities (location/object/creature) → auto-attach extras
  // (D5). FE mirror of the backend `expandWiredEntityExtraRefs` — RAW canonical
  // image, no smart-variant, so preview ≡ run.
  const wiredEntityExtras = opts?.includeWiredEntities
    ? expandWiredEntityExtrasForVideo(consumerNodeId, nodes, edges)
    : []
  // FE-only lookup for an extra-ref's character metadata: find the upstream
  // Character node whose name slugifies to `slug`, then read its usage-mode +
  // canonical description (the BE supplies the same shape from its build ctx).
  const lookupCharacterBySlug = (slug: string): CharacterMeta | undefined => {
    const upstream = nodes.find((n) => {
      if (n.type !== "character") return false
      const cd = n.data as CharacterNodeData
      return characterMentionSlug(cd.characterName || (cd.label as string) || "") === slug
    })
    if (!upstream) return undefined
    const cd = upstream.data as CharacterNodeData
    return {
      characterName: cd.characterName as string | undefined,
      defaultUsageMode: cd.defaultUsageMode,
      canonicalDescription: cd.canonicalDescription as string | undefined,
    }
  }
  // First-sight character extras: surface the wired character's scene-composition
  // (held-prop / styling / text) as the extra's `elementInjection`, mirroring how
  // the mention/canonical paths derive `ConnectedReference.elementInjection` (via
  // `stampElementInjections`). Same map + "Inject Elements" off-switch as those
  // paths (BE mirror in `payload-builder.ts`). `identityLock` is intentionally
  // NOT populated — `ExtraRef` carries no per-extra lock yet (the per-mention
  // lock toggle is follow-up F4); no source → leave undefined (don't fabricate).
  const extraConsumer = nodes.find((n) => n.id === consumerNodeId)
  const extraElementInjections =
    (extraConsumer?.data as { injectElements?: boolean } | undefined)?.injectElements === false
      ? new Map<string, string>()
      : collectCharacterElementInjections(consumerNodeId, nodes, edges)
  // All mention / numbering / canonical-fallback / extras assembly lives in the
  // shared core — the single source of truth shared with the backend resolver.
  return resolveVideoReferenceCore({
    prompt,
    wiredCharRefs,
    extraRefs: [
      ...(extraRefs?.map((ex) => ({
        url: ex.url,
        description: ex.description,
        characterSlug: ex.characterSlug,
        variantSlug: ex.variantSlug,
        usageMode: ex.usageMode,
        elementInjection: ex.characterSlug ? extraElementInjections.get(ex.characterSlug) : undefined,
      })) ?? []),
      // Wired Assets-handle entities auto-attach AFTER the caller's extras.
      ...wiredEntityExtras,
    ],
    lookupCharacterBySlug,
    referenceOrder: opts?.referenceOrder,
    suppressedCanonicalCharacterIds: opts?.suppressedCanonicalCharacterIds,
    ordinalOffset: opts?.ordinalOffset,
    imageRefCount: opts?.imageRefCount,
    videoRefCount: opts?.videoRefCount,
    audioRefCount: opts?.audioRefCount,
    // FE gate: same module-level `IMAGE_REFERENCE_FORMAT` constant the image side
    // uses (test→legacy, dev→hybrid, prod→VITE_IMAGE_REFERENCE_FORMAT). This is
    // the FE's single `resolveVideoReferenceCore` call site, so both the run
    // (execute-node.ts → resolveVideoPromptMentions) and the preview
    // (assembleVideoPrompt → resolveVideoPromptMentions) inherit it. Default
    // false = legacy block (dark in prod); flips in lockstep with image.
    hybridRoles: IMAGE_REFERENCE_FORMAT === "hybrid",
  })
}

export interface AssembleVideoPromptArgs {
  /** The video consumer node (its `data` + `id` + `type` drive composition). */
  readonly node: WorkflowNode
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  /**
   * Label→output map for resolving `{Node Label}` variable refs in the typed
   * prompt fields. The PREVIEW passes `{ refMap }` only into `computeNodePrompt`
   * (there is no `wired`/`override` in a preview, unlike the run).
   */
  readonly refMap: ReadonlyMap<string, string>
}

/**
 * Resolve the unified `generate-video` node to the concrete i2v/t2v mode the RUN
 * dispatches it as (execute-node.ts ~1814), using the editor graph instead of
 * resolved run inputs: a wired START or END frame image → image-to-video, else
 * text-to-video. Reference-handle images (`imageReferences` / `videoReferences` /
 * `audioReferences`) are NOT frames — they feed the `{image:N}` body tokens — so
 * they never flip the mode, matching the run where they resolve to
 * `referenceImageUrls`/etc., not `startFrameUrl`. `gemini-omni-video`'s V2V mode
 * is the one provider-scoped exception that routes a wired reference VIDEO to i2v,
 * mirroring the run's gemini-scoped override.
 *
 * `generate-video`'s only image-input handles are `startFrame`/`endFrame` (the
 * node defines no generic image target — references live on their own handles),
 * so an edge to either handle is the faithful editor-side equivalent of the run's
 * `inputs.startFrameUrl || inputs.endFrameUrl || inputs.imageUrl`. The
 * preview↔run parity test pins this against the real `executeNode` dispatch.
 */
function resolveGenerateVideoMode(
  node: WorkflowNode,
  edges: ReadonlyArray<WorkflowEdge>,
): "image-to-video" | "text-to-video" {
  const incoming = edges.filter((e) => e.target === node.id)
  const hasFrame = incoming.some(
    (e) => e.targetHandle === "startFrame" || e.targetHandle === "endFrame",
  )
  const provider = (node.data as { provider?: string }).provider
  const hasGeminiVideoRef =
    provider === "gemini-omni-video" &&
    incoming.some((e) => e.targetHandle === "videoReferences")
  return hasFrame || hasGeminiVideoRef ? "image-to-video" : "text-to-video"
}

/**
 * Reproduce the RUN's video-prompt TEXT composition EXACTLY for a single video
 * node, so the final-prompt PREVIEW matches what the run sends. Dispatches per
 * the node's EFFECTIVE type — the unified `generate-video` is resolved to its
 * concrete i2v/t2v mode first (see {@link resolveGenerateVideoMode}), exactly as
 * the run re-types it before dispatch; without this its `{image:N}` tokens would
 * ride through raw in the preview while the run shows the `@image_N` binding.
 * Returns ONLY the composed prompt string (negative-prompt routing is layered on
 * top by the caller via `applyVideoNegativePrompt`).
 *
 * Mirrors `execute-node.ts`'s per-type handlers (line ranges current as of this
 * commit — kept here for drift auditability):
 *   - `stripVideoImageTokens` inline at execute-node.ts:2150-2152
 *   - image-to-video handler ~2196-2435 (motion + cinematography merged into ONE
 *     list, then identity clause, then `resolveVideoPromptMentions`)
 *   - video-to-video handler ~2438-2505 (cinematography, identity, mentions)
 *   - text-to-video handler ~2508-2662 (cinematography, identity, mentions)
 *   - speech-to-video handler ~4274-4351 (cinematography, identity; NO mentions)
 *   - cinematic-avatar handler ~4459-4524 (cinematography, identity; NO mentions)
 *   - extend-video handler ~4607-4727 (cinematography, identity; NO mentions)
 *   - video-retake handler ~4730-4774 (cinematography, identity; NO mentions)
 *   - motion-transfer handler ~4527-4567 (NO folding — bare resolved prompt)
 *   - video-sfx handler ~4867-4884 (NO folding — bare resolved prompt)
 *
 * The exact join strings (". " between body and hint-list, " " before the
 * identity clause) and the i2v motion-merge (motion hint FIRST, then
 * cinematography hints, joined by ", ") are load-bearing — they must match the
 * run byte-for-byte.
 *
 * NOTE on the preview vs run delta: the run resolves the typed prompt with
 * `{ wired, override, refMap }`; the preview has no wired/override input, so it
 * passes `{ refMap }` only. For nodes whose prompt is purely user-typed (the
 * normal preview case) this is identical to the run.
 */
export function assembleVideoPrompt(nodeType: string, args: AssembleVideoPromptArgs): string {
  const { node, nodes, edges, refMap } = args
  const id = node.id
  const data = node.data as Record<string, unknown>

  // ── Effective dispatch type ──
  // The unified `generate-video` node has no handlers of its own here — the RUN
  // re-types it to image-to-video / text-to-video before composing (execute-node.ts
  // ~1814). Resolve the same effective mode so every per-mode branch below (token
  // strip/resolve, motion-vs-cinematography hint fold, @-mention) fires identically.
  // Every other type passes through unchanged. `node.type` (the REAL type) still
  // drives `appendWired` — generate-video appends its wired prompt-handle.
  const effectiveType =
    nodeType === "generate-video" ? resolveGenerateVideoMode(node, edges) : nodeType

  // ── Base prompt: typed candidate fields resolved via refMap. generate-video
  // APPENDS the wired prompt-handle contribution (parity with execute-node's
  // appendWired); standalone t2v/i2v keep wired as a fallback (no append). The
  // candidate-field lists for generate-video and i2v/t2v are identical
  // (["prompt","motionPrompt"]), so computing on `effectiveType` reads the same
  // typed text the run does. ──
  const appendWired = node.type === "generate-video"
  const wired = appendWired
    ? collectWiredPromptContribution(node.id, nodes, edges, "prompt") || undefined
    : undefined
  let prompt: string | undefined = computeNodePrompt(effectiveType, data, { refMap, wired, appendWired })

  // ── motion-transfer / video-sfx: NO folding — bare resolved prompt ──
  if (effectiveType === "motion-transfer" || effectiveType === "video-sfx") {
    return prompt ?? ""
  }

  // ── {image:N} reference tokens (i2v / t2v / v2v) ──
  // DATA-DRIVEN off the catalog (no hardcoded provider list): a provider whose
  // model declares the `reference-image` capability RESOLVES the tokens into
  // `@image_N` bindings downstream (via resolveVideoPromptMentions → core →
  // resolveReferenceTokens), so leave them in the prompt. A provider with no
  // reference support keeps the legacy strip-to-bare-label (plain text to the
  // video API).
  // generate-video stores the unified picker's BASE model id; the RUN remaps it to
  // the chosen mode's concrete id (resolveVideoProviderForMode) before the i2v/t2v
  // handler's reference-image feature check, so split-id models (Grok/Wan) gate
  // refs by the right id. Mirror that remap here. Standalone i2v/t2v already store
  // a mode-specific id, so they pass through untouched (no behaviour change).
  const rawProvider = data.provider as string | undefined
  const provider =
    nodeType === "generate-video" && rawProvider
      ? resolveVideoProviderForMode(rawProvider, effectiveType as "image-to-video" | "text-to-video")
      : rawProvider
  const providerSupportsRefs = !!provider && hasFeature(provider, "reference-image")
  if (
    effectiveType === "image-to-video" ||
    effectiveType === "text-to-video" ||
    effectiveType === "video-to-video"
  ) {
    if (!providerSupportsRefs) prompt = stripVideoImageTokens(prompt)
  }

  // ── Hint folding ──
  if (effectiveType === "image-to-video") {
    // i2v ONLY: motion hint + cinematography hints merged into ONE list, then
    // joined to the body with ". " (execute-node.ts:2290-2295).
    const motionHints: string[] = []
    if (data.motionEnabled && data.motion) motionHints.push(`${data.motion as string} motion`)
    for (const h of collectCinematographyHints(id, nodes, edges, { excludeCharacterElements: true })) motionHints.push(h)
    if (motionHints.length > 0 && prompt) prompt = `${prompt}. ${motionHints.join(", ")}`
    else if (motionHints.length > 0) prompt = motionHints.join(", ")
  } else {
    // t2v / v2v / s2v / cinematic-avatar / extend-video / video-retake:
    // cinematography hints only (execute-node.ts t2v:2519-2523 et al).
    const hints = collectCinematographyHints(id, nodes, edges, { excludeCharacterElements: true })
    if (hints.length > 0) {
      const joined = hints.join(", ")
      prompt = prompt ? `${prompt}. ${joined}` : joined
    }
  }

  // ── Identity-lock clause (joined with a single space) ──
  // Currently a no-op (`collectIdentityLockClause` returns "" — deprecated),
  // but mirror the run exactly so the preview stays faithful if it's revived.
  const identityClause = collectIdentityLockClause(id, nodes, edges)
  if (identityClause) prompt = prompt ? `${prompt} ${identityClause}` : identityClause

  // ── @-mention resolution (i2v / t2v / v2v ONLY) ──
  if (
    effectiveType === "image-to-video" ||
    effectiveType === "text-to-video" ||
    effectiveType === "video-to-video"
  ) {
    // Positional reference counts the core resolves `{image:N}` / `{video:N}` /
    // `{audio:N}` body tokens against. Count by reference MODALITY via the shared
    // `referenceModalityForHandle` (single source of truth) so BOTH the legacy
    // `references`/`reference-videos`/`reference-audio` ids AND the canonical
    // `imageReferences`/`videoReferences`/`audioReferences` ids real generate-video
    // nodes wire are counted — matching the backend (payload-builder.ts
    // `countRefModalityEdges`) and the run path (execute-node.ts) so editor-preview
    // numbering matches the worker-payload order. Only meaningful for ref-capable
    // providers — for the rest the tokens were already stripped above, so pass
    // `undefined` (the core then falls back to its own merged-URL count).
    const countRefModality = (modality: ReferenceModality): number =>
      countRefModalityEdges(edges, id, modality)
    const resolved = resolveVideoPromptMentions(
      prompt,
      id,
      nodes,
      edges,
      data.extraRefs as readonly ExtraRef[] | undefined,
      {
        referenceOrder: data.referenceOrder as readonly string[] | undefined,
        suppressedCanonicalCharacterIds: data.suppressedCanonicalCharacterIds as readonly string[] | undefined,
        // D5: assets number AFTER the leading image-refs (ordinalOffset = EDGE
        // count, FE↔BE parity) + wired entities attach — mirrors the orchestrator
        // (payload-builder.ts). Non-ref providers keep tokens stripped (handled
        // above) and attach no entities.
        ...(providerSupportsRefs
          ? { ordinalOffset: countRefModality("image"), includeWiredEntities: true }
          : {}),
        videoRefCount: providerSupportsRefs ? countRefModality("video") : undefined,
        audioRefCount: providerSupportsRefs ? countRefModality("audio") : undefined,
      },
    )
    // t2v's run falls back to the pre-resolution prompt when the resolver
    // returns undefined (`?? prompt`); i2v/v2v adopt the resolver output
    // directly. Use `?? prompt` uniformly — for i2v/v2v the resolver only
    // returns undefined when the input was already undefined, so the behaviour
    // is identical.
    prompt = resolved.prompt ?? prompt
  }

  return prompt ?? ""
}
