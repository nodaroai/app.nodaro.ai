/**
 * Shared video-reference resolver CORE — the ONE pure implementation of the
 * video-prompt `@-mention` + canonical-fallback + extras assembly that BOTH the
 * frontend (`frontend/src/lib/video-prompt-assembly.ts`) and backend
 * (`backend/src/services/workflow-engine/payload-builder.ts`) resolvers delegate
 * to.
 *
 * Historically the FE and BE each hand-rolled a byte-for-byte copy of this logic
 * (they had to stay in lock-step or single-node FE runs and orchestrator runs
 * would diverge). This module is the lift-and-shift of the FRONTEND resolver's
 * post-expansion body into one place so there is a single source of truth.
 *
 * Purity contract: NO FE/BE-only dependencies. The caller is responsible for the
 * layer-specific work BEFORE calling in:
 *   - expanding wired Character upstreams into `ConnectedReference[]`
 *     (`wiredCharRefs`), and
 *   - looking up an extra-ref's character metadata by slug
 *     (`lookupCharacterBySlug` — FE: `nodes.find(...)`, BE: `buildCtx`).
 *
 * Behavior-preserving when first extracted (the FE resolver's post-expansion
 * body was lifted verbatim). The ONE intended output change since is the
 * reference-binding surface string: the per-image subject phrasing, the bullet
 * ordinals, and the frame directive now emit `@image_N` / `@video_N` /
 * `@audio_N` (the legacy form was `Image N`) — all routed through the single
 * `REF_BINDING` swap-point below. The structural strings ("Use these
 * characters:", the bullet layout, "… is the same subject as …") are otherwise
 * unchanged.
 */

import { DEFAULT_USAGE_MODE, usageModeDirective, type UsageMode } from "./character-usage-mode.js"
import { findCharacterMentionTokens } from "./character-mention-slug.js"
import { resolveCharacterMentions, applyReferenceOrderToVideo } from "./prompt-builder.js"
import type { ConnectedReference } from "./types.js"

/**
 * The SINGLE swap-point for the reference-binding surface-string (design D1/D7).
 *
 * Every place that renders an `@image_N`-style binding into a video prompt — the
 * per-image subject phrasing, the bare ordinal in a "Use these characters" /
 * pair-back bullet, and the opening/closing frame directive — MUST go through
 * these five arrows. The default form is `@image_N`; if the D7 probe shows a
 * provider prefers the legacy `Image N` form, flipping is editing ONLY these five
 * arrows (`@image_${n}` → `Image ${n}`), nothing downstream.
 *
 * This IS the live swap-point: `resolveVideoReferenceCore` routes the per-image
 * subject phrasing, the "Use these characters" / pair-back bullet ordinals, and
 * the frame directive through these arrows, and `resolveReferenceTokens` resolves
 * the body `{image:N}` tokens through `REF_BINDING[kind]` — so the five arrows
 * are the ONLY emission sites for the binding surface string.
 */
export const REF_BINDING = {
  image: (label: string, n: number) => `the ${label} from @image_${n}`,
  video: (label: string, n: number) => `the ${label} from @video_${n}`,
  audio: (label: string, n: number) => `the ${label} from @audio_${n}`,
  /** ordinal as it appears in a "Use these characters" bullet / pair-back */
  ordinal: (n: number) => `@image_${n}`,
  frame: (n: number, role: "opening" | "closing") =>
    `Use @image_${n} as the ${role} (${role === "opening" ? "first" : "last"}) frame of the video.`,
} as const

/**
 * Positional reference counts the editor tokens are resolved against — how many
 * image / video / audio references are wired into the node, in worker-payload
 * order. `{image:N:…}` is 1-based against `image`, `{video:N:…}` against `video`,
 * etc. A token whose N exceeds its count (or whose kind has count 0) is dropped.
 */
export interface ReferenceCounts {
  image: number
  video: number
  audio: number
}

/** Matches an editor reference token: `{image:1}`, `{video:2:clip}`, `{audio:3:my song}`.
 *  Group 1 = kind, group 2 = 1-based slot N, group 3 = optional label
 *  (alphanumerics, underscore, space, hyphen). Case-insensitive on the kind. */
const REFERENCE_TOKEN_RE = /\{(image|video|audio):(\d+)(?::([a-zA-Z0-9_ -]+))?\}/gi

/**
 * Rewrite the editor's `{image:N:label}` / `{video:N:label}` / `{audio:N:label}`
 * reference tokens into `@image_N` / `@video_N` / `@audio_N` subject bindings.
 *
 * The token's `N` is POSITIONAL (1-based) against the matching `counts` entry —
 * the worker-payload order of wired references of that kind. Per match:
 *   - `N < 1` or `N > counts[kind]` (out of range / no such reference) → drop to
 *     the bare `label` (or empty if label-less). This is the legacy
 *     `stripVideoImageTokens` strip behavior: drop the token, keep the label text.
 *   - in range, label present → `REF_BINDING[kind](label, N)`
 *     (e.g. `the person from @image_2`).
 *   - in range, no label → `the subject in @${kind}_${N}` so the binding still
 *     lands even when the author didn't name the subject.
 *
 * Runs of 2+ HORIZONTAL whitespace (left behind by a dropped label-less token)
 * collapse to one space, the result is trimmed, and an empty result becomes
 * `undefined` — matching the `stripVideoImageTokens` contract so this can replace
 * it cleanly. The collapse class is `[^\S\r\n]` (NOT `\s`) on purpose: Task 2.4
 * applies this to the FULLY-ASSEMBLED core prompt, which carries `\n\n` block
 * separators between the "Use these characters:" directive block and the body —
 * a `\s{2,}` collapse would silently merge those paragraphs. Horizontal-only
 * collapse preserves newline structure while still tidying the dropped-token gap.
 * The `kind` is lowercased before indexing `counts`/`REF_BINDING`, so a
 * case-variant token (`{Image:1}`) resolves to the same binding rather than
 * mis-classifying as out-of-range.
 */
export function resolveReferenceTokens(
  prompt: string | undefined,
  counts: ReferenceCounts,
): string | undefined {
  if (!prompt) return prompt
  return (
    prompt
      .replace(REFERENCE_TOKEN_RE, (_match, rawKind: string, nStr: string, label?: string) => {
        const kind = rawKind.toLowerCase() as keyof ReferenceCounts
        const n = parseInt(nStr, 10)
        if (n < 1 || n > counts[kind]) return label ?? ""
        if (label) return REF_BINDING[kind](label, n)
        return `the subject in @${kind}_${n}`
      })
      // Horizontal whitespace only — preserve `\n` / `\n\n` block separators.
      .replace(/[^\S\r\n]{2,}/g, " ")
      .trim() || undefined
  )
}

/**
 * A user-attached "extra reference image" row. Layer-agnostic shape of the
 * frontend `ExtraRef` / backend extras: only the fields this core reads.
 */
export interface VideoExtraRef {
  url: string
  description?: string
  characterSlug?: string
  variantSlug?: string
  usageMode?: UsageMode
}

/**
 * Character metadata resolved by the caller for an extra-ref's `characterSlug`.
 * Mirrors the per-layer upstream lookup: FE reads `CharacterNodeData`
 * (`characterName` / `defaultUsageMode` / `canonicalDescription`); BE reads its
 * `buildExtraRefCharacterContextLookup` context (`displayName` →
 * `characterName`, etc.).
 */
export interface CharacterMeta {
  characterName?: string
  defaultUsageMode?: UsageMode
  canonicalDescription?: string
}

export interface ResolveVideoReferenceCoreArgs {
  prompt: string | undefined
  /** Already expanded by the caller's layer-specific expander. */
  wiredCharRefs: ConnectedReference[]
  extraRefs?: readonly VideoExtraRef[]
  /** Look up an extra-ref's character metadata by slug (FE: nodes.find; BE: buildCtx). */
  lookupCharacterBySlug?: (slug: string) => CharacterMeta | undefined
  referenceOrder?: readonly string[]
  suppressedCanonicalCharacterIds?: readonly string[]
  /**
   * Positional counts the editor numbers `{image:N}` / `{video:N}` / `{audio:N}`
   * body tokens against — the TOTAL reference-handle count of each kind wired
   * into the node (base reference images + mention additions), in worker-payload
   * order. Supplied by the callers in Tasks 3.2/4.1; when omitted, `image` falls
   * back to the core's own merged-URL count and `video`/`audio` to 0 (the core
   * only attaches image URLs).
   */
  imageRefCount?: number
  videoRefCount?: number
  audioRefCount?: number
}

/**
 * Resolve `@kira:N` / `@kira:N:smile` mentions in a video-node prompt against
 * the caller-supplied wired Character references AND apply the per-character
 * canonical fallback for unmentioned wired characters, plus manual/extra refs.
 *
 * Per-character behavior contract (parity with image-side + backend):
 *   - wired-character with at least one `@-mention` → contribute ONLY the
 *     mentioned variant URLs (no canonical auto-attach), prepend the
 *     mention-derived directive block.
 *   - wired-character with NO `@-mention` → contribute the canonical URL
 *     + a strong identity directive (mode-aware via `defaultUsageMode`).
 *
 * Returns the mutated prompt + the asset URLs to slot into the worker payload.
 * The caller decides where (i2v has both `imageUrl` and `referenceImageUrls`;
 * v2v has only a single `referenceImageUrl`; t2v has `referenceImageUrls` only).
 */
export function resolveVideoReferenceCore(
  args: ResolveVideoReferenceCoreArgs,
): { prompt: string | undefined; additionalUrls: string[] } {
  // Counts the editor numbers `{image:N}` / `{video:N}` / `{audio:N}` body tokens
  // against. `image` falls back to the core's own merged-URL count (passed by the
  // caller as `imageFallback`); `video`/`audio` to 0 since the core attaches only
  // image URLs. Applied at every return so token resolution is uniform.
  const tokenCounts = (imageFallback: number): ReferenceCounts => ({
    image: args.imageRefCount ?? imageFallback,
    video: args.videoRefCount ?? 0,
    audio: args.audioRefCount ?? 0,
  })
  let wiredCharRefs = [...args.wiredCharRefs]
  const suppressedSlugs = new Set(args.suppressedCanonicalCharacterIds ?? [])
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
  const hasExtras = (args.extraRefs?.length ?? 0) > 0
  if (wiredCharRefs.length === 0 && !hasExtras) {
    // No wired chars / extras, but the node can still carry plain base reference
    // images, so `{image:N}` body tokens MUST still resolve. `merged` isn't built
    // on this path → image fallback is 0 (resolve only against the caller count).
    return { prompt: resolveReferenceTokens(args.prompt, tokenCounts(0)), additionalUrls: [] }
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
  const promptForResolution = args.prompt ?? ""
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
      fallbackDirectiveLines.push(`- ${REF_BINDING.ordinal(position)} (${displayName})`)
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
    for (const ex of args.extraRefs!) {
      if (!ex.url) continue
      position += 1
      const desc = (ex.description ?? "").trim()
      if (ex.characterSlug) {
        // First sight of this character via an extra. Resolution chain
        // matches the image side: per-ref override → upstream character
        // default → global identical. The caller supplies the upstream
        // character's metadata via `lookupCharacterBySlug`.
        const meta = args.lookupCharacterBySlug?.(ex.characterSlug)
        const charDefaultMode = meta?.defaultUsageMode
        const effectiveMode = ex.usageMode ?? charDefaultMode ?? DEFAULT_USAGE_MODE
        const earlierPos = positionsByChar.get(ex.characterSlug)
        if (earlierPos !== undefined) {
          // Pair-back. Suppressed for "none" so the extras-side respects the
          // same minimal-intervention contract as primary mentions.
          if (effectiveMode !== "none") {
            const tail = desc ? `, ${desc}` : ""
            extraDirectiveLines.push(
              `- ${REF_BINDING.ordinal(position)} is the same subject as ${REF_BINDING.ordinal(earlierPos)}${tail}.`,
            )
          }
        } else if (effectiveMode === "none") {
          // URL attached, no bullet. Record the slot for any later same-
          // character extras that pair-back via "same subject as Image N".
          positionsByChar.set(ex.characterSlug, position)
        } else if (effectiveMode === "name") {
          const displayName = meta?.characterName || ex.characterSlug
          const subject = `${REF_BINDING.ordinal(position)} (${displayName})`
          const descPart = desc ? `${subject} — ${desc}` : subject
          extraDirectiveLines.push(`- ${descPart}.`)
          positionsByChar.set(ex.characterSlug, position)
        } else {
          const directive = usageModeDirective(effectiveMode)
          const displayName = meta?.characterName || ex.characterSlug
          const subject = `${REF_BINDING.ordinal(position)} (${displayName})`
          const includeCanonicalDesc = effectiveMode === "identical" || effectiveMode === "face-pose"
          const canonicalDesc = meta?.canonicalDescription
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
          extraDirectiveLines.push(`- ${REF_BINDING.ordinal(position)} (reference): ${desc}.`)
        } else {
          extraDirectiveLines.push(`- ${REF_BINDING.ordinal(position)} (reference).`)
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
  const referenceOrder = args.referenceOrder
  if (referenceOrder && referenceOrder.length > 0 && merged.length > 1) {
    const refsForOrdering: ConnectedReference[] = [...wiredCharRefs]
    if (hasExtras) {
      for (const ex of args.extraRefs!) {
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
    // Resolve body tokens LAST — AFTER the reorder's `@image_N` renumber pass, so
    // it can't miscorrect a freshly-resolved binding (the curly `{image:N}` tokens
    // are invisible to the reorder's `(@image_|Image )` regex, so they ride through
    // untouched and keep their author-typed N — documented v1 behavior).
    return {
      prompt: resolveReferenceTokens(reordered.prompt, tokenCounts(merged.length)),
      additionalUrls: reordered.urls,
    }
  }

  // Same as the reorder branch but no user reorder ran — resolve the body tokens
  // on the assembled prompt as the final step.
  return {
    prompt: resolveReferenceTokens(finalPrompt, tokenCounts(merged.length)),
    additionalUrls: merged,
  }
}
