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
  findCharacterMentionTokens,
  resolveCharacterMentions,
  usageModeDirective,
  DEFAULT_USAGE_MODE,
  applyReferenceOrderToVideo,
  extractCharacterLoraFields,
  characterMentionableAssetArrays,
  computeNodePrompt,
  collectIdentityLockClause,
} from "@nodaro/shared"
import { collectCinematographyHints } from "@/lib/cinematography-hints"
import { stampElementInjections } from "@/components/editor/workflow-editor/node-input-resolver"

/**
 * Strip `{image:N:label}` tokens from video prompts (label kept, curly syntax
 * removed). Video APIs don't process image-reference tokens — strip them to
 * plain text.
 *
 * MOVED verbatim from `execute-node.ts` (was the inline `stripVideoImageTokens`
 * at ~line 2150). `execute-node.ts` imports it back; the run path is unchanged.
 */
export function stripVideoImageTokens(text: string | undefined): string | undefined {
  if (!text) return text
  return text.replace(/\{image:\d+(?::([a-zA-Z0-9_-]+))?\}/gi, (_, label) => label ?? "").replace(/\s{2,}/g, " ").trim() || undefined
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
    if (!upstream || upstream.type !== "character") continue
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
  },
): { prompt: string | undefined; additionalUrls: string[] } {
  let wiredCharRefs = expandWiredCharacterRefsForVideo(consumerNodeId, nodes, edges)
  const suppressedSlugs = new Set(opts?.suppressedCanonicalCharacterIds ?? [])
  if (suppressedSlugs.size > 0) {
    wiredCharRefs = wiredCharRefs.filter((r) => {
      if (r.source !== "wired-character") return true
      if (!r.characterSlug) return true
      if (r.variantSlug) return true
      return !suppressedSlugs.has(r.characterSlug)
    })
  }
  // Extras are valid even WITHOUT any wired character upstream (e.g. the user
  // uploaded loose reference photos and typed per-row descriptions). The
  // early-return below is gated on (no chars AND no extras) so we don't skip
  // extras-only setups.
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

  // Canonical fallback for any wired character NOT @-mentioned. Single
  // canonical URL + strong directive per unmentioned character — mirrors
  // `buildCanonicalFallback` from the shared prompt-builder and the backend
  // `resolveVideoPromptMentions`. The directive's wording is mode-aware:
  // resolves through the character node's `defaultUsageMode` → global
  // `DEFAULT_USAGE_MODE` so a character configured for "face" emits a
  // face-only directive instead of the identity-lock language.
  const fallbackUrls: string[] = []
  const fallbackDirectiveLines: string[] = []
  const seenSlugs = new Set<string>()
  // Character-slug → first emitted position, used by extras to pair back via
  // "Image B is the same subject as Image A, …". Built from mention URLs +
  // canonical fallback URLs as they're emitted.
  const positionsByChar = new Map<string, number>()
  // `position` walks the FINAL merged URL list (mention URLs first, then
  // canonical fallback, then extras). Used so directive numbering aligns
  // with the worker's `referenceImageUrls` order.
  let position = 0
  for (let i = 0; i < resolved.additionalUrls.length; i++) {
    position += 1
    // Look up which ref this URL came from to learn its characterSlug.
    const ref = wiredCharRefs.find((r) => r.url === resolved.additionalUrls[i])
    const slug = ref?.characterSlug
    if (slug && !positionsByChar.has(slug)) positionsByChar.set(slug, position)
  }
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
    const effectiveMode = r.defaultUsageMode ?? DEFAULT_USAGE_MODE
    // Minimal-intervention modes:
    //   - "none": URL attached, NO bullet emitted.
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
    // Wired elements ride the bullet alongside the (mode-gated) canonical desc —
    // mirrors the shared image-side `composeIdentityDescPart`. The subject here
    // is the bare display name (video numbering is applied separately above).
    const descBodyParts: string[] = []
    if (includeCanonicalDesc && r.characterCanonicalDescription?.trim()) {
      descBodyParts.push(r.characterCanonicalDescription.trim())
    }
    if (r.elementInjection?.trim()) descBodyParts.push(r.elementInjection.trim())
    const descPart = descBodyParts.length > 0
      ? `${displayName} — ${descBodyParts.join(". ")}`
      : displayName
    fallbackDirectiveLines.push(`- ${descPart}.${directive ? ` ${directive}` : ""}`)
  }

  // Extras: emit one directive per row. Numbering continues from `position`
  // so the worker's `referenceImageUrls` order lines up with "Image N" in
  // the assembled prompt. Pair-back ("same subject as Image M, …") fires
  // when the same `characterSlug` was already attached as a mention or
  // canonical fallback.
  const extraUrls: string[] = []
  const extraDirectiveLines: string[] = []
  if (hasExtras) {
    for (const ex of extraRefs!) {
      if (!ex.url) continue
      position += 1
      const desc = (ex.description ?? "").trim()
      if (ex.characterSlug) {
        // First sight of this character via an extra. Resolution chain
        // matches the image side: per-ref override → upstream node default
        // → global identical. We don't have direct access to the upstream
        // character node here, so look it up via slug.
        const upstream = nodes.find((n) => {
          if (n.type !== "character") return false
          const cd = n.data as CharacterNodeData
          const name = cd.characterName || (cd.label as string) || ""
          return characterMentionSlug(name) === ex.characterSlug
        })
        const charDefaultMode = upstream
          ? ((upstream.data as CharacterNodeData).defaultUsageMode)
          : undefined
        const effectiveMode = ex.usageMode ?? charDefaultMode ?? DEFAULT_USAGE_MODE
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
          const displayName = upstream
            ? ((upstream.data as CharacterNodeData).characterName as string) || ex.characterSlug
            : ex.characterSlug
          const subject = `Image ${position} (${displayName})`
          const descPart = desc ? `${subject} — ${desc}` : subject
          extraDirectiveLines.push(`- ${descPart}.`)
          positionsByChar.set(ex.characterSlug, position)
        } else {
          const directive = usageModeDirective(effectiveMode)
          const displayName = upstream
            ? ((upstream.data as CharacterNodeData).characterName as string) || ex.characterSlug
            : ex.characterSlug
          const subject = `Image ${position} (${displayName})`
          const includeCanonicalDesc = effectiveMode === "identical" || effectiveMode === "face-pose"
          const canonicalDesc = upstream
            ? (upstream.data as CharacterNodeData).canonicalDescription as string | undefined
            : undefined
          let descPart = subject
          if (desc) descPart = `${subject} — ${desc}`
          else if (includeCanonicalDesc && canonicalDesc?.trim()) descPart = `${subject} — ${canonicalDesc.trim()}`
          extraDirectiveLines.push(`- ${descPart}.${directive ? ` ${directive}` : ""}`)
          positionsByChar.set(ex.characterSlug, position)
        }
      } else {
        // Manual extra. Description goes in the bullet; absent description
        // still emits a positional marker so the model knows what Image N is.
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
  // then extras). The "Image N" labels in the prompt assume this exact order
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

  // Apply user-defined reorder + renumber `Image N` tokens — parity with the
  // backend `resolveVideoPromptMentions` and the shared image builder.
  const referenceOrder = opts?.referenceOrder
  if (referenceOrder && referenceOrder.length > 0 && merged.length > 1) {
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
 * Reproduce the RUN's video-prompt TEXT composition EXACTLY for a single video
 * node, so the final-prompt PREVIEW matches what the run sends. Dispatches per
 * `nodeType`. Returns ONLY the composed prompt string (negative-prompt routing
 * is layered on top by the caller via `applyVideoNegativePrompt`).
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

  // ── Base prompt: typed candidate fields resolved via refMap (no wired/override) ──
  let prompt: string | undefined = computeNodePrompt(nodeType, data, { refMap })

  // ── motion-transfer / video-sfx: NO folding — bare resolved prompt ──
  if (nodeType === "motion-transfer" || nodeType === "video-sfx") {
    return prompt ?? ""
  }

  // ── Strip {image:N} tokens (i2v / t2v / v2v send plain text to the video API) ──
  if (
    nodeType === "image-to-video" ||
    nodeType === "text-to-video" ||
    nodeType === "video-to-video"
  ) {
    prompt = stripVideoImageTokens(prompt)
  }

  // ── Hint folding ──
  if (nodeType === "image-to-video") {
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
    nodeType === "image-to-video" ||
    nodeType === "text-to-video" ||
    nodeType === "video-to-video"
  ) {
    const resolved = resolveVideoPromptMentions(
      prompt,
      id,
      nodes,
      edges,
      data.extraRefs as readonly ExtraRef[] | undefined,
      {
        referenceOrder: data.referenceOrder as readonly string[] | undefined,
        suppressedCanonicalCharacterIds: data.suppressedCanonicalCharacterIds as readonly string[] | undefined,
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
