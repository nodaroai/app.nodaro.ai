/**
 * Image prompt assembly logic shared between frontend and backend.
 * Handles character description expansion, style appending, negative prompt routing,
 * 2000-char truncation, and reference image filtering by model support.
 */

import { resolveTemplate, applyTemplate } from "./prompt-templates.js"
import { NATIVE_NEGATIVE_PROMPT_MODELS, MODELS_WITH_REFERENCE_IMAGE_SUPPORT } from "./model-constants.js"
import { getStylePromptHint } from "./style.js"
import { findCharacterMentionTokens, type CharacterMentionTokenInfo } from "./character-mention-slug.js"
import { usageModeDirective, DEFAULT_USAGE_MODE, type UsageMode } from "./character-usage-mode.js"
import type {
  CharacterDef,
  ConnectedReference,
  IdentityFidelity,
  IdentityMeta,
  ReferenceSource,
  SceneData,
} from "./types.js"

export interface ResolveCharacterMentionsResult {
  /** Prompt with @-tokens replaced by display names + "Use these characters:" directive prepended. */
  prompt: string
  /** Resolved URLs from matched mention tokens, in mention order, deduped via caller responsibility. */
  additionalUrls: string[]
  /**
   * Set of character slugs that had at least one resolved mention token.
   * Callers use this to gate the per-character "no mention → canonical
   * fallback" behavior so a wired character with no `@-mention` still gets
   * its canonical URL attached (existing pre-mention-feature behavior).
   */
  mentionedCharacterSlugs: Set<string>
}

/**
 * Resolve @-mention tokens in a prompt against connected references.
 * Returns: augmented prompt (with directives prepended + tokens replaced
 * by character display names) and the set of asset URLs to include as refs.
 *
 * Behavior:
 * - Build two lookup Maps: `bySlug` for canonical entries, `byVariant` for variant entries.
 * - Iterate tokens left-to-right so directives are emitted in mention order.
 * - For each token, prefer the variant match when variantSlug present; fall back to canonical.
 * - `charactersSeen` Set guards the long canonical description to appear AT MOST ONCE
 *   per character even when the character is mentioned in several tokens.
 * - Build a `replacements` array (token + offset + replacement display name) and
 *   apply right-to-left so earlier replacements do not shift later offsets.
 * - Prepend a "Use these characters:\n…" directive section when any directives were emitted.
 * - Each directive bullet leads with the user-visible `Image N (Name)` index pulled
 *   directly from the typed token (e.g. `@kira:1:smile` → `Image 1 (Kira)`).
 *   This lets the user trace a literal slug in the prompt to its appearance in
 *   the final assembled identity-directive block.
 */
export function resolveCharacterMentions(
  prompt: string,
  tokens: readonly CharacterMentionTokenInfo[],
  refs: readonly ConnectedReference[],
): ResolveCharacterMentionsResult {
  const bySlug = new Map<string, ConnectedReference>()
  const byVariant = new Map<string, ConnectedReference>()
  for (const r of refs) {
    if (!r.characterSlug) continue
    if (!r.variantSlug) {
      bySlug.set(r.characterSlug, r)
    } else {
      byVariant.set(`${r.characterSlug}:${r.variantSlug}`, r)
    }
  }

  const additionalUrls: string[] = []
  // `firstBulletEmittedFor` tracks the slug of characters that have already
  // produced a non-"none" bullet. Each character emits AT MOST ONE primary
  // bullet (the rich identity / name-only line). "none" mentions don't claim
  // this slot — they emit no bullet AT ALL — so a later "face" mention of the
  // same character still emits its directive bullet on first sight. Without
  // this split, a `[none, face]` mention pair would suppress both bullets
  // because the first iteration would silently consume the "first mention"
  // slot without emitting anything.
  const firstBulletEmittedFor = new Set<string>()
  const mentionedCharacterSlugs = new Set<string>()
  const directiveLines: string[] = []

  const replacements: Array<{ token: string; offset: number; replacement: string }> = []
  for (const t of tokens) {
    const match = t.variantSlug
      ? byVariant.get(`${t.characterSlug}:${t.variantSlug}`)
      : bySlug.get(t.characterSlug)
    if (!match) continue

    additionalUrls.push(match.url)
    mentionedCharacterSlugs.add(t.characterSlug)

    // Per-mention effective mode. Resolution order: per-mention slug override
    // → character node default → global DEFAULT_USAGE_MODE. Used both to
    // shape the inline replacement and to decide whether (and how) to emit a
    // bullet for this mention.
    const effectiveMode: UsageMode =
      t.usageMode ?? match.defaultUsageMode ?? DEFAULT_USAGE_MODE

    const displayName = bySlug.get(t.characterSlug)?.defaultName ?? t.characterSlug
    // Inline replacement of `@kira:1:smile` in the user's prompt. For "none"
    // mode we substitute the bare positional reference (`Image 1`) so the
    // user's sentence reads "show Image 1 dancing" — the image is attached,
    // the model sees the position label, but no character name biases the
    // textual prompt. Every other mode (including "name") keeps the legacy
    // `Kira` substitution so prose flows naturally.
    const replacement = effectiveMode === "none"
      ? `Image ${t.imageIndex}`
      : displayName
    replacements.push({ token: t.token, offset: t.offset, replacement })

    // Bullet emission rules per mode:
    //   - "none": NO bullet (zero textual intervention; only the image is
    //     attached). Doesn't consume the per-character "first bullet" slot —
    //     a later non-none mention can still emit its primary directive.
    //     If EVERY mention of a character is "none", that character
    //     contributes no bullets at all, so it won't appear under the
    //     "Use these characters:" header.
    //   - "name": ONE bullet on first non-none mention only —
    //     `- Image N (Name)` with no trailing directive. Tells the model who
    //     the character is so it can correlate, without prescribing how to
    //     use the image.
    //   - other modes: ONE bullet on first non-none mention only,
    //     `- Image N (Name) — <canonical?>. <directive>`.
    if (effectiveMode === "none") {
      // Suppress everything — the inline replacement above is the only signal.
      continue
    }
    const isFirstBullet = !firstBulletEmittedFor.has(t.characterSlug)
    if (effectiveMode === "name") {
      if (isFirstBullet) {
        directiveLines.push(`- Image ${t.imageIndex} (${displayName})`)
        firstBulletEmittedFor.add(t.characterSlug)
      }
    } else if (isFirstBullet) {
      const directive = usageModeDirective(effectiveMode)
      const subject = `Image ${t.imageIndex} (${displayName})`
      // Canonical description is identity-context — only useful when the model
      // is being asked to lock to that identity ("identical" / "face-pose").
      // For "emotion" / "style" modes the canonical description (face/body/
      // features) is noise relative to the directive's intent, so we omit it
      // and keep the bullet focused on the mode-specific instruction.
      const includeCanonicalDesc =
        effectiveMode === "identical" || effectiveMode === "face-pose"
      const descPart = includeCanonicalDesc && match.characterCanonicalDescription
        ? `${subject} — ${match.characterCanonicalDescription.trim()}`
        : subject
      // `directive` is non-null here because usageModeDirective only returns
      // null for "none"/"name", both of which are already handled above.
      directiveLines.push(`- ${descPart}.${directive ? ` ${directive}` : ""}`)
      firstBulletEmittedFor.add(t.characterSlug)
    }
    // Variant-description sub-line only makes sense alongside an emitted
    // bullet — for "none"/"name" modes it's dropped (those modes are
    // intentionally minimal).
    if (
      t.variantSlug
      && match.variantDescription
      && effectiveMode !== "name"
      && isFirstBullet
    ) {
      directiveLines.push(`  (in this image: ${match.variantDescription.trim()})`)
    }
  }

  // Apply replacements right-to-left so offsets remain valid.
  let resolvedPrompt = prompt
  for (const r of [...replacements].sort((a, b) => b.offset - a.offset)) {
    resolvedPrompt = resolvedPrompt.slice(0, r.offset)
      + r.replacement
      + resolvedPrompt.slice(r.offset + r.token.length)
  }

  if (directiveLines.length > 0) {
    resolvedPrompt = `Use these characters:\n${directiveLines.join("\n")}\n\n${resolvedPrompt}`
  }

  return { prompt: resolvedPrompt, additionalUrls, mentionedCharacterSlugs }
}

/**
 * Build the canonical-fallback directive lines + URLs for wired characters
 * that were NOT @-mentioned in the prompt. Matches the pre-mention behavior:
 * a character wired to a generator without any `@-mention` still contributes
 * its default URL + a strong identity directive, so users who wire a single
 * character without typing anything get the same result they did before the
 * `@-mention` feature shipped.
 *
 * Returns directive lines (matching `resolveCharacterMentions`'s format) and
 * canonical URLs (variantSlug === undefined entries only) keyed by
 * `characterSlug`, deduped. Callers prepend the directives + merge the URLs.
 *
 * Numbering: each emitted line is prefixed with `Image N (Name) — …` where
 * N is the position of this canonical URL in the final `referenceImageUrls`
 * list. The caller passes `startIndex` (1-based) for the first canonical
 * URL; subsequent canonical URLs get `startIndex + 1`, `+ 2`, etc.
 *
 * Without the numeric prefix the model has no way to link "Image 1" in its
 * input array to the directive bullet "shira — young woman…" — which led
 * users to see uncorrelated directives and ungrouped reference images.
 */
function buildCanonicalFallback(
  refs: readonly ConnectedReference[],
  mentionedSlugs: ReadonlySet<string>,
  startIndex: number,
): { directiveLines: string[]; urls: string[] } {
  const directiveLines: string[] = []
  const urls: string[] = []
  const seenSlugs = new Set<string>()
  let cursor = startIndex
  for (const r of refs) {
    if (r.source !== "wired-character") continue
    if (!r.characterSlug) continue
    if (mentionedSlugs.has(r.characterSlug)) continue
    if (seenSlugs.has(r.characterSlug)) continue
    // Canonical entry only — never auto-attach a variant for an unmentioned
    // character. Multiple wired characters each contribute one canonical
    // URL + one directive, mirroring the legacy auto-attach behavior.
    if (r.variantSlug) continue
    if (!r.url) continue
    seenSlugs.add(r.characterSlug)
    urls.push(r.url)
    const displayName = r.defaultName || r.characterSlug
    // Mode source: character node's `defaultUsageMode` (if set), else the
    // global `DEFAULT_USAGE_MODE` ("identical"). Without a slug-level
    // override available here (the user hasn't @-mentioned this character),
    // the node's default is the only signal — preserves the legacy "match
    // exactly" behavior when no default is configured.
    const effectiveMode: UsageMode = r.defaultUsageMode ?? DEFAULT_USAGE_MODE
    // Minimal-intervention modes:
    //   - "none": URL is attached but NO bullet is emitted — the visual
    //     speaks for itself, no textual bias.
    //   - "name": one bullet with the name, no trailing directive — lets the
    //     model correlate the position with a named entity without
    //     prescribing usage.
    if (effectiveMode === "none") {
      // Bare URL attachment, no bullet — `cursor` still advances so any
      // downstream extras that pair-back via "same subject as Image N" see
      // the correct positional slot for this character.
      cursor += 1
      continue
    }
    if (effectiveMode === "name") {
      directiveLines.push(`- Image ${cursor} (${displayName})`)
      cursor += 1
      continue
    }
    const directive = usageModeDirective(effectiveMode)
    const includeCanonicalDesc =
      effectiveMode === "identical" || effectiveMode === "face-pose"
    // Subject line includes the numeric position so the model can correlate
    // "Image N in the input array" with the named character in the directive.
    const subject = `Image ${cursor} (${displayName})`
    const descPart = includeCanonicalDesc && r.characterCanonicalDescription
      ? `${subject} — ${r.characterCanonicalDescription.trim()}`
      : subject
    // `directive` is non-null here ("none"/"name" already short-circuited).
    directiveLines.push(`- ${descPart}.${directive ? ` ${directive}` : ""}`)
    cursor += 1
  }
  return { directiveLines, urls }
}

/**
 * Build directive lines + URLs for user-attached "extra reference images"
 * (entries with `isExtraRef === true`). Runs alongside `buildCanonicalFallback`
 * — both feed into the same "Use these characters:\n..." block prepended to
 * the prompt.
 *
 * Numbering rule: starts at `nextImageIndex` (passed in by the caller — equal
 * to the count of already-emitted canonical fallback URLs + the count of
 * mention URLs) and increments by 1 per extra ref. The caller's URL merge
 * order must match this counter so "Image N" in the directive resolves to
 * the N-th URL in the final `referenceImageUrls` array.
 *
 * Per-extra directive shape:
 *   - manual extra (source === "manual" + description set)
 *     → `Image N (reference): <description>.`
 *   - character extra (source === "wired-character" + characterSlug set
 *     + description set) where the SAME `characterSlug` was already emitted
 *     as a mention or canonical entry
 *     → `Image N is the same subject as Image M, <description>.`
 *     where M is the position of the earlier same-character image.
 *   - character extra of a previously-unseen character (no canonical, no
 *     mention) → emit a canonical-style directive (display name + mode
 *     directive). Acts as the "first sight" attachment for that character.
 *
 * The caller is responsible for:
 *   1. Merging `urls` into `referenceImageUrls` in the same order as the
 *      directive lines (so positions align).
 *   2. Concatenating `directiveLines` onto the existing "Use these characters:"
 *      block (or creating a new one).
 *
 * `emittedCharacterPositions` is a map from characterSlug → position (1-based)
 * of the FIRST emitted image for that character. The caller pre-populates it
 * with positions from mentions + canonical fallback so that "Image B is the
 * same subject as Image A" can reference an earlier slot correctly.
 */
function buildExtraRefDirectives(
  refs: readonly ConnectedReference[],
  emittedCharacterPositions: ReadonlyMap<string, number>,
  startIndex: number,
): { directiveLines: string[]; urls: string[] } {
  const directiveLines: string[] = []
  const urls: string[] = []
  // Local copy of the position map so first-sight extras can be referenced by
  // later extras of the same character (e.g. two extras of Kira where the
  // first becomes "Image M" and the second pairs back to "M").
  const positionsByChar = new Map(emittedCharacterPositions)
  let cursor = startIndex
  for (const r of refs) {
    if (!r.isExtraRef) continue
    if (!r.url) continue
    const description = (r.description ?? r.variantDescription ?? "").trim()
    // Character extra
    if (r.source === "wired-character" && r.characterSlug) {
      const effectiveMode: UsageMode = r.defaultUsageMode ?? DEFAULT_USAGE_MODE
      const earlierPos = positionsByChar.get(r.characterSlug)
      if (earlierPos !== undefined) {
        // Pair-back form. `Image N is the same subject as Image M, <desc>.`
        // Description is optional — when absent we still emit the pairing.
        // Minimal-intervention modes suppress even the pair-back bullet so
        // the user's "don't bias with text" intent extends to extras.
        if (effectiveMode !== "none") {
          const tail = description ? `, ${description}` : ""
          directiveLines.push(`- Image ${cursor} is the same subject as Image ${earlierPos}${tail}.`)
        }
      } else if (effectiveMode === "none") {
        // First sight of this character via an extra ref, but mode is "none".
        // Attach the URL, emit no bullet, record the position so any later
        // extras of the same character that pair-back land on the right slot.
        positionsByChar.set(r.characterSlug, cursor)
      } else if (effectiveMode === "name") {
        // "Name only" — labeled subject + the per-ref description (when
        // present), no trailing directive.
        const displayName = r.defaultName || r.characterSlug
        const subject = `Image ${cursor} (${displayName})`
        const descPart = description ? `${subject} — ${description}` : subject
        directiveLines.push(`- ${descPart}.`)
        positionsByChar.set(r.characterSlug, cursor)
      } else {
        // First sight of this character via an extra ref. Emit a canonical-style
        // directive — the description (or the character's canonical desc) is
        // the descriptive part, and the usage mode is whatever the caller
        // resolved onto `defaultUsageMode` (per-ref override → node default →
        // identical, applied when the ExtraRef was mapped to a ConnectedReference).
        const directive = usageModeDirective(effectiveMode)
        const displayName = r.defaultName || r.characterSlug
        const subject = `Image ${cursor} (${displayName})`
        const includeCanonicalDesc =
          effectiveMode === "identical" || effectiveMode === "face-pose"
        const canonicalDesc = r.characterCanonicalDescription?.trim()
        // Description preference: per-ref description > canonical (when mode
        // allows it) > nothing. The per-ref description is what the user
        // typed in the extra-ref row, so it always wins.
        let descPart = subject
        if (description) {
          descPart = `${subject} — ${description}`
        } else if (includeCanonicalDesc && canonicalDesc) {
          descPart = `${subject} — ${canonicalDesc}`
        }
        directiveLines.push(`- ${descPart}.${directive ? ` ${directive}` : ""}`)
        positionsByChar.set(r.characterSlug, cursor)
      }
    } else {
      // Manual / generic extra. Description (when present) goes in the
      // parenthetical; absent description still emits a positional marker so
      // the URL position is unambiguous in the prompt.
      if (description) {
        directiveLines.push(`- Image ${cursor} (reference): ${description}.`)
      } else {
        directiveLines.push(`- Image ${cursor} (reference).`)
      }
    }
    urls.push(r.url)
    cursor += 1
  }
  return { directiveLines, urls }
}

/**
 * Per-character extra refs need to know which numbered slot the EARLIER
 * emitted image of the same character lives in. This helper walks the
 * URL-merge order built up by `buildImagePrompt` and returns the
 * `characterSlug → first-position` map used by `buildExtraRefDirectives`.
 *
 * The merge order matches `mergedUrls` in `buildImagePrompt`:
 *   [pre-existing referenceImageUrls] + [resolved mentions] + [canonical fallback]
 * (followed by extras when this helper is consulted).
 *
 * For each URL in the merged list, we look up the originating
 * `ConnectedReference` to learn its `characterSlug`. The first time we see
 * a slug, we record its position; later same-slug images don't overwrite.
 */
/**
 * Build a stable-tile-ID-per-URL mapping for the FINAL URL list emitted by
 * `buildImagePrompt`. Mirrors the scheme in `compute-injected-refs.ts` so the
 * frontend reorder UI and the backend `referenceOrder` sort agree.
 *
 * Used internally by `applyReferenceOrder` below. Kept as a separate helper
 * so the test in `prompt-builder.test.ts` can pin the ID scheme contract.
 *
 * Resolution order (first wins per URL):
 *   1. URL is a wired character variant whose @-mention is in `prompt` →
 *      `mention:<slug>:<variant|canonical>`. Variant slug derived from the
 *      mention token, NOT the ref's `variantSlug` — the same URL can match
 *      multiple variants in edge cases, but the mention token is the
 *      authoritative user-typed source.
 *   2. URL belongs to an `isExtraRef` entry → `wired:<id>` (the extra ref's
 *      stable id, which the consumer panel keeps in sync with the row's id).
 *   3. URL is a non-character wired ref → `wired:<sourceNodeId>` via the
 *      provided `sourceNodeIdById` map, falling back to `ref.id`.
 *   4. URL is a wired character canonical (no mention) → `char-canonical:<slug>`.
 *
 * URLs not matched by any of the above keep a null entry; they're sorted
 * stable after the matched URLs and don't participate in reorder.
 */
function buildTileIdForUrl(
  urls: readonly string[],
  refs: readonly ConnectedReference[],
  prompt: string,
  sourceNodeIdById?: ReadonlyMap<string, string>,
): Array<string | null> {
  // Build slug → mention's variant decision (the first time the mention
  // resolved per slug+variant): used to key mention URLs.
  const knownSlugs = Array.from(
    new Set(
      refs.map((r) => r.characterSlug).filter((s): s is string => Boolean(s)),
    ),
  )
  const mentionTokens = knownSlugs.length > 0
    ? findCharacterMentionTokens(prompt, knownSlugs)
    : []
  // url → tile id, populated only for mentioned variants.
  const mentionUrlToId = new Map<string, string>()
  const bySlug = new Map<string, ConnectedReference>()
  const byVariant = new Map<string, ConnectedReference>()
  for (const r of refs) {
    if (!r.characterSlug) continue
    if (!r.variantSlug) {
      if (!bySlug.has(r.characterSlug)) bySlug.set(r.characterSlug, r)
    } else {
      byVariant.set(`${r.characterSlug}:${r.variantSlug}`, r)
    }
  }
  for (const t of mentionTokens) {
    const match = t.variantSlug
      ? byVariant.get(`${t.characterSlug}:${t.variantSlug}`)
      : bySlug.get(t.characterSlug)
    if (!match?.url) continue
    if (!mentionUrlToId.has(match.url)) {
      mentionUrlToId.set(match.url, `mention:${t.characterSlug}:${t.variantSlug || "canonical"}`)
    }
  }

  // url → first matching ref (used for both canonical and wired-raw paths).
  const firstRefByUrl = new Map<string, ConnectedReference>()
  for (const r of refs) {
    if (!r.url) continue
    if (!firstRefByUrl.has(r.url)) firstRefByUrl.set(r.url, r)
  }

  return urls.map((url) => {
    const mentionId = mentionUrlToId.get(url)
    if (mentionId) return mentionId
    const ref = firstRefByUrl.get(url)
    if (!ref) return null
    // Extra refs use their stable id (set by the consumer panel).
    if (ref.isExtraRef) {
      return `wired:${sourceNodeIdById?.get(ref.id) ?? ref.id}`
    }
    if (ref.source === "wired-character" && ref.characterSlug) {
      // Canonical entry (no variant slug) when reached via the fallback path.
      // Variant entries are handled by the mention path above.
      if (!ref.variantSlug) {
        return `char-canonical:${ref.characterSlug}`
      }
      // A wired-character VARIANT URL with no mention shouldn't appear in the
      // final URL list under normal flow, but handle it defensively.
      return `mention:${ref.characterSlug}:${ref.variantSlug}`
    }
    // Non-character wired or manual entry.
    return `wired:${sourceNodeIdById?.get(ref.id) ?? ref.id}`
  })
}

/**
 * Reorder URLs by `referenceOrder` AND renumber `Image N` tokens in the
 * prompt to match. Returns the new URL list + the rewritten prompt. When
 * `referenceOrder` is empty / null / all-stale, the original URLs + prompt
 * are returned unchanged (no-op contract).
 *
 * Renumbering rule: build an `original-pos → new-pos` map from the URL move
 * indices, then regex-replace `Image N` substrings (word-boundary-anchored
 * so we don't touch "Image 12" while remapping "Image 1"). Done in one pass
 * via a callback that looks up each match in the map; unknown positions are
 * left as-is.
 *
 * NB: `findCharacterMentionTokens` is already applied BEFORE this step, so
 * any `@kira:1:smile` literals in the prompt have been replaced with display
 * names — only positional `Image N` markers remain to be remapped.
 *
 * Exposed (non-export internal) — also called by video branches in
 * payload-builder / execute-node via `applyReferenceOrderToVideo` so video
 * prompts honor the same reorder semantics as image prompts.
 */
export function applyReferenceOrderToVideo(
  urls: readonly string[],
  prompt: string | undefined,
  refs: readonly ConnectedReference[],
  referenceOrder: readonly string[] | undefined,
  sourceNodeIdById?: ReadonlyMap<string, string>,
): { urls: string[]; prompt: string | undefined } {
  if (!referenceOrder || !referenceOrder.length || urls.length < 2) {
    return { urls: [...urls], prompt }
  }
  const reordered = applyReferenceOrder(
    urls,
    prompt ?? "",
    refs,
    referenceOrder,
    sourceNodeIdById,
  )
  return {
    urls: reordered.urls,
    prompt: prompt === undefined ? undefined : reordered.prompt,
  }
}

function applyReferenceOrder(
  urls: readonly string[],
  prompt: string,
  refs: readonly ConnectedReference[],
  referenceOrder: readonly string[],
  sourceNodeIdById?: ReadonlyMap<string, string>,
): { urls: string[]; prompt: string } {
  if (!referenceOrder.length) return { urls: [...urls], prompt }
  const tileIds = buildTileIdForUrl(urls, refs, prompt, sourceNodeIdById)
  // Map: tile id → original index in URLs array. Keeps first occurrence per
  // tile id (URLs are already deduped by `buildImagePrompt`'s merge step).
  const byTileId = new Map<string, number>()
  for (let i = 0; i < tileIds.length; i++) {
    const id = tileIds[i]
    if (id && !byTileId.has(id)) byTileId.set(id, i)
  }
  const newOrderIndices: number[] = []
  const seenIndices = new Set<number>()
  for (const id of referenceOrder) {
    const idx = byTileId.get(id)
    if (idx === undefined) continue
    if (seenIndices.has(idx)) continue
    newOrderIndices.push(idx)
    seenIndices.add(idx)
  }
  // Append URLs not in `referenceOrder` in their original order.
  for (let i = 0; i < urls.length; i++) {
    if (!seenIndices.has(i)) {
      newOrderIndices.push(i)
      seenIndices.add(i)
    }
  }
  // No-op check: if `newOrderIndices` is `[0, 1, 2, …]` we'd rebuild the same
  // arrays. Cheap to detect, lets us avoid the regex when the user hasn't
  // actually changed anything.
  let isNoop = newOrderIndices.length === urls.length
  for (let i = 0; isNoop && i < newOrderIndices.length; i++) {
    if (newOrderIndices[i] !== i) isNoop = false
  }
  if (isNoop) return { urls: [...urls], prompt }
  const newUrls = newOrderIndices.map((i) => urls[i])
  // Build orig-1based-pos → new-1based-pos map for prompt renumbering.
  const remap = new Map<number, number>()
  for (let newPos = 0; newPos < newOrderIndices.length; newPos++) {
    remap.set(newOrderIndices[newPos] + 1, newPos + 1)
  }
  // Replace every `Image N` (1-2 digit, word-boundary) substring. Negative
  // lookahead on digits guards against `Image 12` → `Image 32` when remapping
  // 1 → 3. Same lookbehind on `Image` prevents catching `XImage 1`.
  const renumbered = prompt.replace(/(?<![A-Za-z])Image (\d{1,3})(?!\d)/g, (whole, n) => {
    const orig = parseInt(n, 10)
    const next = remap.get(orig)
    if (next === undefined || next === orig) return whole
    return `Image ${next}`
  })
  return { urls: newUrls, prompt: renumbered }
}

function buildCharacterPositionMap(
  mergedUrls: readonly string[],
  refs: readonly ConnectedReference[],
): Map<string, number> {
  const byUrl = new Map<string, ConnectedReference>()
  for (const r of refs) {
    if (!r.url) continue
    if (!byUrl.has(r.url)) byUrl.set(r.url, r)
  }
  const positions = new Map<string, number>()
  for (let i = 0; i < mergedUrls.length; i++) {
    const ref = byUrl.get(mergedUrls[i])
    const slug = ref?.characterSlug
    if (slug && !positions.has(slug)) {
      positions.set(slug, i + 1)
    }
  }
  return positions
}

export interface BuildImagePromptConfig {
  /** Raw user prompt text */
  prompt: string
  /** Image provider key (e.g. "nano-banana", "gpt-image") */
  provider: string
  /** Style text to append (e.g. "cinematic") */
  style?: string
  /** Negative prompt text */
  negativePrompt?: string
  /** Character definitions selected for this node */
  characterDefs?: CharacterDef[]
  /** User-level prompt template overrides */
  userTemplates?: Record<string, string>
  /** Flow-level prompt template overrides */
  flowTemplates?: Record<string, string>
  /** Reference image URLs from direct connections, extracted refs, and character refs */
  referenceImageUrls?: string[]
  /** Ancestor reference image URLs (fallback when no direct refs exist) */
  ancestorRefs?: string[]
  /**
   * Rich connected-reference data. When provided, supersedes `characterDefs`
   * and `referenceImageUrls`: per-identity directives come from this list +
   * any `{image:N:label}` mentions in the prompt, URLs come from this list
   * in order, and tokens expand to "the {label} from image {N}".
   */
  connectedReferences?: ConnectedReference[]
  /** Per-identity (imageIndex+label) user overrides for fidelity / custom text. */
  identityMeta?: readonly IdentityMeta[]
  /**
   * User-defined reorder of the injected reference list. Each entry is a
   * stable tile ID using the scheme from `compute-injected-refs.ts`:
   *   - `wired:<sourceNodeId>` (a wired upstream — manual / wired-image /
   *     wired-face / wired-object / wired-location / extra-ref)
   *   - `mention:<characterSlug>:<variantSlug|canonical>` (an `@-mention`
   *     resolved to a character variant URL)
   *   - `char-canonical:<characterSlug>` (the auto-attached canonical
   *     fallback for a wired character that the user did NOT `@-mention`)
   *
   * Behavior: after the existing assembly produces a URL list + a prompt
   * with `Image N` directives, the URLs are re-ordered to match this list
   * AND every `Image N` token in the prompt is renumbered consistently
   * (so directive bullets, the user's typed `Image N` references, and the
   * worker `referenceImageUrls` index all agree).
   *
   * IDs in this array that don't match any tile are silently dropped. Tiles
   * whose ID is NOT in this array fall to the end in their natural order.
   * Identical fixtures on frontend + backend MUST produce identical URL
   * lists — the helper is shared via `compute-injected-refs.ts`.
   *
   * Stable-ID-per-URL mapping for the post-assembly re-order is computed
   * from `connectedReferences` + the user's prompt; passing `referenceOrder`
   * is a no-op when `connectedReferences` is missing (legacy path).
   *
   * Optional, omit to keep the existing natural order.
   */
  referenceOrder?: readonly string[]
  /**
   * Map of `connectedReferences[i].id → sourceNodeId` so wired-raw tile IDs
   * match the upstream node IDs the consumer panel exposes. When omitted, the
   * builder falls back to `connectedReferences[i].id` (which equals the
   * upstream node ID for wired entries built by the existing image-configs +
   * payload-builder flow).
   */
  sourceNodeIdById?: ReadonlyMap<string, string>
  /**
   * Character slugs whose canonical-fallback the user has explicitly hidden
   * via the × button. Mention URLs for the same character still attach.
   */
  suppressedCanonicalCharacterIds?: readonly string[]
  /**
   * When true, skip the entire mention-resolution block (character identity
   * directives, `Image N (Kira)` bullets, additional ref URLs from
   * `connectedReferences`) AND strip raw `@slug[:V[:variant]]` tokens from
   * the prompt. Used by the LoRA inference path
   * (`flux-lora-character`) — the trigger word + LoRA carries identity, so
   * the directive bullets are redundant and the wired-character refs
   * shouldn't be injected as `Image N`.
   */
  skipCharacterMentions?: boolean
}

export interface BuildImagePromptResult {
  /** Final assembled prompt */
  prompt: string
  /** Native negative prompt (only for models that support it), undefined otherwise */
  nativeNegativePrompt: string | undefined
  /** Filtered reference image URLs (only for models that support them) */
  referenceImageUrls: string[] | undefined
}

/**
 * Build the final image generation prompt from config.
 * Handles character description wrapping, style appending, negative prompt routing,
 * truncation, and reference image filtering.
 */
export function buildImagePrompt(config: BuildImagePromptConfig): BuildImagePromptResult {
  let {
    provider,
    style,
    negativePrompt,
    characterDefs = [],
    userTemplates,
    flowTemplates,
    referenceImageUrls = [],
    ancestorRefs = [],
    connectedReferences,
    identityMeta = [],
  } = config
  const referenceOrder = config.referenceOrder ?? []
  const sourceNodeIdById = config.sourceNodeIdById
  const suppressedCanonicalCharacterIds = new Set(
    config.suppressedCanonicalCharacterIds ?? [],
  )

  // Character LoRA inference path: trigger word + LoRA model carry identity,
  // so we strip raw `@slug[:V[:variant]]` tokens from the prompt AND drop the
  // connected-reference machinery entirely (no Image N bullets, no
  // ref URLs). The LoRA model gets a clean prompt + the trigger word
  // injected by the Replicate buildInput (see providers/replicate/image.ts).
  if (config.skipCharacterMentions) {
    config = {
      ...config,
      prompt: config.prompt.replace(
        /@[a-z0-9_-]+(?::\d+(?::[a-z0-9_-]+)?)?\s?/gi,
        "",
      ).trim(),
    }
    connectedReferences = undefined
    referenceImageUrls = []
  }

  // Apply canonical suppression UP FRONT so `buildCanonicalFallback` never
  // sees the suppressed slugs. This is the only way to drop both the URL
  // and the directive line; filtering after the fact would leave the
  // directive numbering misaligned.
  if (
    connectedReferences
    && suppressedCanonicalCharacterIds.size > 0
  ) {
    connectedReferences = connectedReferences.filter((r) => {
      if (r.source !== "wired-character") return true
      if (!r.characterSlug) return true
      // Only drop the CANONICAL entry — `@-mentioned` variants are explicit
      // and should stay even when canonical is suppressed.
      if (r.variantSlug) return true
      if (r.isExtraRef) return true
      return !suppressedCanonicalCharacterIds.has(r.characterSlug)
    })
  }

  // -------------------------------------------------------------------------
  // Phase 0: resolve `@<character-slug>:<index>(:<variant-slug>)?` tokens
  // AND apply the per-character canonical fallback for unmentioned wired
  // characters. Runs BEFORE the existing `{image:N}` resolution path. Both
  // coexist: Phase 0 handles slug-based character mentions / fallbacks;
  // the existing path below handles `{image:N:label}` tokens for
  // non-character refs.
  //
  // Per-character contract:
  //   - wired-character WITHOUT any `@-mention` → contribute canonical URL
  //     + a strong identity directive (pre-mention-feature behavior).
  //   - wired-character WITH at least one `@-mention` → contribute ONLY
  //     mentioned variant URLs (no canonical auto-attach).
  // -------------------------------------------------------------------------
  if (connectedReferences && connectedReferences.length > 0) {
    const knownCharacterSlugs = Array.from(
      new Set(
        connectedReferences
          .map((r) => r.characterSlug)
          .filter((s): s is string => typeof s === "string" && s.length > 0)
      )
    )
    const hasExtraRefs = connectedReferences.some((r) => r.isExtraRef === true)
    // We only need to run the directive-emission machinery if either
    // (a) there's at least one character ref (mention / canonical fallback
    //     could fire), or (b) there's at least one user-attached extra ref
    //     (manual uploads with descriptions, or character-variant extras).
    // The empty-extras-empty-characters case falls through to the standard
    // non-character ref path unchanged.
    if (knownCharacterSlugs.length > 0 || hasExtraRefs) {
      const mentionTokens = knownCharacterSlugs.length > 0
        ? findCharacterMentionTokens(config.prompt, knownCharacterSlugs)
        : []
      const resolved = mentionTokens.length > 0
        ? resolveCharacterMentions(config.prompt, mentionTokens, connectedReferences)
        : { prompt: config.prompt, additionalUrls: [], mentionedCharacterSlugs: new Set<string>() }
      // Default-fallback canonical URLs + directives for any wired character
      // that has zero mentions in the prompt. Mirrors the legacy behavior the
      // mention feature replaced — wire a character with no typing required.
      //
      // `startIndex` = position (1-based) of the first canonical fallback
      // URL in the final merged list. Computed by deduping the prefix
      // (pre-existing refs + mention URLs) so that if a mention URL
      // coincidentally equals an upstream ref, the canonical lines still
      // point at the correct position.
      const prefixDedupedLength = ([
        ...(referenceImageUrls || []),
        ...resolved.additionalUrls,
      ].filter((u, i, a) => a.indexOf(u) === i)).length
      const fallback = buildCanonicalFallback(
        connectedReferences,
        resolved.mentionedCharacterSlugs,
        prefixDedupedLength + 1,
      )
      let promptForNext = resolved.prompt
      if (fallback.directiveLines.length > 0) {
        // Mirror `resolveCharacterMentions`'s "Use these characters:\n…" block
        // structure. When both blocks exist, append fallback bullets to the
        // same block so the model sees one consolidated header.
        if (promptForNext.startsWith("Use these characters:\n")) {
          const splitIdx = promptForNext.indexOf("\n\n")
          if (splitIdx !== -1) {
            const header = promptForNext.slice(0, splitIdx)
            const rest = promptForNext.slice(splitIdx)
            promptForNext = `${header}\n${fallback.directiveLines.join("\n")}${rest}`
          } else {
            promptForNext = `${promptForNext}\n${fallback.directiveLines.join("\n")}`
          }
        } else {
          promptForNext = `Use these characters:\n${fallback.directiveLines.join("\n")}\n\n${promptForNext}`
        }
      }
      const mergedUrls = [
        ...(referenceImageUrls || []),
        ...resolved.additionalUrls,
        ...fallback.urls,
      ].filter((u, i, a) => a.indexOf(u) === i)

      // Extra-ref directives: user-attached refs (manual uploads + picked
      // character variants). Emitted AFTER mentions + canonical fallback so
      // they get the next positional slots. Numbering = position in the final
      // ref URL list (mergedUrls.length + 1, +2, …).
      const characterPositions = buildCharacterPositionMap(mergedUrls, connectedReferences)
      const extras = buildExtraRefDirectives(
        connectedReferences,
        characterPositions,
        mergedUrls.length + 1,
      )
      // Always merge extras' URLs — minimal-intervention modes ("none" /
      // "name") may emit zero or one bullet while still attaching the image.
      // Gating the URL merge on `directiveLines.length > 0` would silently
      // drop the URL for a `none`-mode extra.
      const finalMergedUrls = [...mergedUrls, ...extras.urls]
        .filter((u, i, a) => a.indexOf(u) === i)
      if (extras.directiveLines.length > 0) {
        if (promptForNext.startsWith("Use these characters:\n")) {
          const splitIdx = promptForNext.indexOf("\n\n")
          if (splitIdx !== -1) {
            const header = promptForNext.slice(0, splitIdx)
            const rest = promptForNext.slice(splitIdx)
            promptForNext = `${header}\n${extras.directiveLines.join("\n")}${rest}`
          } else {
            promptForNext = `${promptForNext}\n${extras.directiveLines.join("\n")}`
          }
        } else {
          promptForNext = `Use these characters:\n${extras.directiveLines.join("\n")}\n\n${promptForNext}`
        }
      }

      // Mutate the config locals (NOT the original passed config).
      config = {
        ...config,
        prompt: promptForNext,
        referenceImageUrls: finalMergedUrls,
      }
      referenceImageUrls = config.referenceImageUrls || []
    }
  }

  // -------------------------------------------------------------------------
  // New path: rich `connectedReferences` provided. Per-identity directives
  // are emitted at the top, `{image:N:label}` tokens expand to natural-
  // language phrases, and URLs are sent in connectedReferences order.
  //
  // Character refs (source === "wired-character") are AUTOCOMPLETE-ONLY by
  // default — they ONLY contribute URLs + directives via Phase 0 mention
  // resolution above (`referenceImageUrls` and a "Use these characters…"
  // prefix). A wired character with no @-mention in the prompt contributes
  // zero URLs and zero directives here. Non-character refs (manual,
  // wired-image, wired-face, wired-object, wired-location) still auto-
  // attach so unchanged behavior for them.
  // -------------------------------------------------------------------------
  if (connectedReferences) {
    let prompt = config.prompt

    // Non-character refs are still emitted as per-identity directives + URLs.
    // Character refs are filtered out here — Phase 0 has already added their
    // URLs to `referenceImageUrls` (via mention resolution) and prepended the
    // "Use these characters…" directive block. User-attached extras
    // (isExtraRef === true) are also filtered out: Phase 0 already emitted
    // their per-ref directive ("Image N (reference): <description>." / "same
    // subject as Image M, …") and merged their URLs into `referenceImageUrls`.
    // Letting them through here would double-emit the URLs (and append a
    // second positional directive via the {image:N:label} path).
    const nonCharacterRefs = connectedReferences.filter(
      (r) => r.source !== "wired-character" && r.isExtraRef !== true,
    )

    // Identities = (used in prompt) ∪ (default label for refs with no mentions).
    // Indexing here is against the non-character ref list so {image:N} tokens
    // line up with `nonCharacterRefs[N-1]` for legacy positional mentions.
    const identities = collectIdentities(prompt, nonCharacterRefs, identityMeta)

    const directives = identities
      .map((id) => buildIdentityDirective(id))
      .filter((s) => s.length > 0)
      .join("\n")
    if (directives) {
      // "Use these references…" header + bulleted directives + the
      // "Compose them naturally…" prefix proved most reliable in user
      // testing. Numeric indices ("Image 1") match the user-typed
      // `@character:N` slug format so the literal prompt and the final
      // identity directive are visually linked.
      prompt = prompt
        ? `Use these references for the output image:\n${directives}\n\nCompose them naturally into a single image: ${prompt}`
        : `Use these references for the output image:\n${directives}`
    }

    const styleText = style?.trim()
    if (styleText) {
      const richHint = getStylePromptHint(styleText)
      prompt += `\nStyle: ${richHint || styleText}`
    }

    const negPrompt = negativePrompt?.trim()
    let nativeNegativePrompt: string | undefined
    if (negPrompt) {
      if (NATIVE_NEGATIVE_PROMPT_MODELS.has(provider)) {
        nativeNegativePrompt = negPrompt
      } else {
        prompt += `\nAvoid: ${negPrompt}`
      }
    }

    if (prompt.length > 2000) {
      prompt = prompt.slice(0, 1997) + "..."
    }

    // Resolve `{image:N:label}` → "the <label> from image N".
    // Bare `{image:N}` (no label) → "[reference image N]" (legacy fallback).
    prompt = expandImageRefTokens(prompt, nonCharacterRefs.length)

    // URLs: non-character refs auto-attach in their original order.
    // Character URLs (if any) come from Phase 0's `referenceImageUrls`
    // (only the mentioned variants).
    const nonCharacterUrls = nonCharacterRefs
      .map((r) => r.url)
      .filter((u): u is string => Boolean(u))
    const characterUrlsFromPhase0 = referenceImageUrls.filter(
      (u) => !nonCharacterUrls.includes(u),
    )
    const orderedUrls = [...nonCharacterUrls, ...characterUrlsFromPhase0]

    const supportsRefs = MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(provider)

    // Apply user-defined `referenceOrder` to the final URL list, with a
    // matching renumber of every `Image N` token in the prompt. Skipped when
    // the model doesn't support refs (refs will be dropped anyway) or when no
    // order was supplied (no-op contract).
    let finalUrls = orderedUrls
    let finalPrompt = prompt
    if (supportsRefs && referenceOrder.length > 0 && orderedUrls.length > 1) {
      const reordered = applyReferenceOrder(
        orderedUrls,
        prompt,
        connectedReferences,
        referenceOrder,
        sourceNodeIdById,
      )
      finalUrls = reordered.urls
      finalPrompt = reordered.prompt
    }

    const refsToSend = supportsRefs && finalUrls.length > 0 ? finalUrls : undefined

    return { prompt: finalPrompt, nativeNegativePrompt, referenceImageUrls: refsToSend }
  }

  // -------------------------------------------------------------------------
  // Legacy path — kept for callers that haven't migrated to connectedReferences.
  // -------------------------------------------------------------------------

  // Build character description lines
  const charDescs = characterDefs
    .filter((c) => c.type === "description" && c.description)
    .map((c) => {
      let templateKey: string
      switch (c.category) {
        case "face": templateKey = "face-description"; break
        case "location": templateKey = "location-description"; break
        case "object": templateKey = "object-description"; break
        default: templateKey = "character-description"; break
      }
      const template = resolveTemplate(templateKey, userTemplates, flowTemplates)
      return applyTemplate(template, {
        name: c.name,
        description: c.description || "",
      })
    })

  // Assemble prompt
  let prompt = config.prompt
  if (charDescs.length > 0) {
    const wrapperTemplate = resolveTemplate("generate-image-wrapper", userTemplates, flowTemplates)
    prompt = applyTemplate(wrapperTemplate, {
      userPrompt: prompt,
      assetDescriptions: charDescs.join(" "),
    })
  }

  // Append style — if the inline `style` is a known STYLES catalog id, inject
  // the richer promptHint; otherwise fall back to the raw text (covers custom
  // free-text styles that don't match a preset).
  const styleText = style?.trim()
  if (styleText) {
    const richHint = getStylePromptHint(styleText)
    prompt += `\nStyle: ${richHint || styleText}`
  }

  // Handle negative prompt: native support vs prompt-appended
  const negPrompt = negativePrompt?.trim()
  let nativeNegativePrompt: string | undefined
  if (negPrompt) {
    if (NATIVE_NEGATIVE_PROMPT_MODELS.has(provider)) {
      nativeNegativePrompt = negPrompt
    } else {
      prompt += `\nAvoid: ${negPrompt}`
    }
  }

  // Truncate
  if (prompt.length > 2000) {
    prompt = prompt.slice(0, 1997) + "..."
  }

  // Merge reference images: direct refs first, then ancestor fallback
  const allRefs = referenceImageUrls.length > 0 ? referenceImageUrls : ancestorRefs
  const supportsRefs = MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(provider)
  const refsToSend = supportsRefs && allRefs.length > 0 ? allRefs : undefined

  // Expand {image:N} position references in prompt (legacy: → "[reference image N]")
  prompt = expandImagePositionRefs(prompt, allRefs.length)

  return { prompt, nativeNegativePrompt, referenceImageUrls: refsToSend }
}

// ---------------------------------------------------------------------------
// Identity helpers (new system)
// ---------------------------------------------------------------------------

/** Sources whose default fidelity is "strict" — they carry strong identity. */
const STRICT_DEFAULT_SOURCES: ReadonlySet<ReferenceSource> = new Set([
  "wired-character",
  "wired-face",
  "wired-object",
  "wired-location",
])

/** Matches `{image:N}` and `{image:N:label}` tokens.
 *  Group 1 = position, group 2 = optional label. */
const IMAGE_TOKEN_PATTERN = /\{image:(\d+)(?::([a-zA-Z0-9_-]+))?\}/gi

interface ResolvedIdentity {
  imageIndex: number
  label: string                  // empty string = bare positional ref (no role)
  fidelity: IdentityFidelity
  customText?: string
  description?: string           // from upstream connected reference
}

function defaultFidelityForSource(source: ReferenceSource | undefined): IdentityFidelity {
  if (!source) return "balanced"
  return STRICT_DEFAULT_SOURCES.has(source) ? "strict" : "balanced"
}

/**
 * Return the unique set of identities to emit directives for: only the
 * `{image:N:label}` mentions actually present in the prompt.
 *
 * Connected references that the user hasn't mentioned still get sent to the
 * provider (via `referenceImageUrls`), but they get no auto-generated
 * directive — the user controls what's in the prompt by mentioning.
 */
function collectIdentities(
  prompt: string,
  refs: readonly ConnectedReference[],
  meta: readonly IdentityMeta[],
): ResolvedIdentity[] {
  const seen = new Set<string>()
  const mentions: Array<{ imageIndex: number; label: string }> = []
  for (const m of prompt.matchAll(IMAGE_TOKEN_PATTERN)) {
    const n = parseInt(m[1], 10)
    if (n < 1 || n > refs.length) continue
    const label = (m[2] ?? "").trim()
    if (!label) continue // bare {image:N} → no identity directive, just position
    const key = `${n}:${label}`
    if (seen.has(key)) continue
    seen.add(key)
    mentions.push({ imageIndex: n, label })
  }

  return mentions.map(({ imageIndex, label }) => {
    const ref = refs[imageIndex - 1]
    const m = meta.find((x) => x.imageIndex === imageIndex && x.label === label)
    return {
      imageIndex,
      label,
      fidelity: m?.fidelity ?? defaultFidelityForSource(ref?.source),
      customText: m?.customText?.trim() || undefined,
      description: ref?.description,
    }
  })
}

/** Labels that mean "use as scene/setting" — verb shifts away from "match". */
const BACKGROUND_LABELS: ReadonlySet<string> = new Set([
  "background", "setting", "scene", "environment", "location",
])
/** Labels that mean "apply this look/material" rather than "include this thing". */
const TEXTURE_LABELS: ReadonlySet<string> = new Set([
  "texture", "style", "pattern", "look", "material",
])

/**
 * Subject form for directive bullets: parenthetical label after the image
 * index so the model sees both the position binding and the role descriptor
 * in one tight phrase. Numeric indices ("Image 1") match the typed token
 * (e.g. `@kira:1:smile`) so users can trace the slug through to the final
 * assembled directive.
 *
 *  "dragon" + 1                       → "Image 1 (dragon)"
 *  "Danny"  + 2                       → "Image 2 (Danny)"
 *  "dragon" + 1 + desc "red scales"   → "Image 1 (dragon — red scales)"
 *  no label + 3                       → "Image 3"
 */
function formatDirectiveSubject(label: string, imageIndex: number, description?: string): string {
  if (!label && !description) return `Image ${imageIndex}`
  const inner = label && description
    ? `${label} — ${description}`
    : (label || description)!
  return `Image ${imageIndex} (${inner})`
}

/** Labels that mean "a person / character" — strengthen the directive so the
 *  model holds the face + body + distinctive features. Folds the
 *  identity-preservation language (previously appended as a trailing
 *  global clause via `collectIdentityLockClause`) directly into the per-image
 *  bullet so the model sees the identifier and the rule together. */
const PERSON_LABELS: ReadonlySet<string> = new Set([
  "person", "character", "face", "subject", "people",
])

function buildIdentityDirective(id: ResolvedIdentity): string {
  if (id.fidelity === "custom" && id.customText) {
    return `- ${id.customText}`
  }

  const subject = formatDirectiveSubject(id.label, id.imageIndex, id.description)
  const lower = id.label.toLowerCase()

  // Role-aware verbs — these read more naturally than "match exactly" for
  // background scenes or texture/style references.
  if (BACKGROUND_LABELS.has(lower)) {
    return `- ${subject} — use as the background/setting.`
  }
  if (TEXTURE_LABELS.has(lower)) {
    return `- ${subject} — apply this ${id.label}.`
  }

  // Person/character labels: strengthen the directive (regardless of fidelity)
  // so the global trailing identity-lock clause becomes redundant.
  // "loose" still gets the inspiration form so users can opt out.
  if (PERSON_LABELS.has(lower) && id.fidelity !== "loose") {
    return `- ${subject} — match exactly. Maintain perfect likeness (face, body proportions, distinctive features).`
  }

  switch (id.fidelity) {
    case "strict":
      return `- ${subject} — match exactly. Maintain perfect likeness.`
    case "loose":
      return `- ${subject} — use loosely as inspiration.`
    case "custom":  // custom without text falls through to balanced
    case "balanced":
    default:
      return `- ${subject} — match exactly.`
  }
}

/**
 * Replace `{image:N:label}` and `{image:N}` tokens with natural-language
 * phrases bound to a numbered image (Image 1 / 2 / 3 …).
 *
 * - `{image:N:label}`  → `Image {N} ({label})`
 * - `{image:N}`        → `Image {N}` (no role specified)
 *
 * Same parenthetical form as the directive subject so the model sees a
 * consistent identifier in both the bulleted list and the scene description.
 * Numeric indices match the user-typed slug format (`@kira:1:smile`).
 *
 * Out-of-range indices are left untouched so they're visible in the output.
 */
export function expandImageRefTokens(prompt: string, imageCount: number): string {
  return prompt.replace(IMAGE_TOKEN_PATTERN, (match, num, label) => {
    const n = parseInt(num, 10)
    if (n < 1 || n > imageCount) return match
    return label ? `Image ${n} (${label})` : `Image ${n}`
  })
}

/** Build the combined per-identity directive intro for previews.
 *  Each directive is emitted on its own line so the model (and the human
 *  reading the FinalPromptPreview) can see the structure clearly. */
export function buildIdentityDirectives(
  prompt: string,
  refs: readonly ConnectedReference[],
  meta: readonly IdentityMeta[] = [],
): string {
  return collectIdentities(prompt, refs, meta)
    .map((id) => buildIdentityDirective(id))
    .filter((s) => s.length > 0)
    .join("\n")
}

// ---------------------------------------------------------------------------
// Backward-compat shims — preview/test helpers used elsewhere still reference
// the old names. Keep thin wrappers so we don't break callers in this round.
// ---------------------------------------------------------------------------

/** @deprecated Use `expandImageRefTokens` (label-aware). */
export function expandImagePositionRefs(
  prompt: string,
  imageCount: number,
  names?: readonly string[],
): string {
  return prompt.replace(IMAGE_TOKEN_PATTERN, (match, num, label) => {
    const n = parseInt(num, 10)
    if (n < 1 || n > imageCount) return match
    if (label) return `Image ${n} (${label})`
    if (names && names[n - 1]) return names[n - 1]
    return `Image ${n}`
  })
}

/** @deprecated Use `buildIdentityDirectives(prompt, refs, meta)`. */
export function buildReferenceBlocks(
  refs: readonly ConnectedReference[],
  _meta: readonly IdentityMeta[] = [],
): string {
  // Legacy callers don't have prompt context — emit a default-label block per ref.
  const synthPrompt = ""
  return buildIdentityDirectives(synthPrompt, refs, _meta)
}

// ---------------------------------------------------------------------------
// Scene prompt builder — shared between frontend DAG executor and backend
// orchestrator.  Builds a rich image-generation prompt from SceneNodeData.
// ---------------------------------------------------------------------------

export const SCENE_PROMPT_MAX_LENGTH = 2000
const SCENE_PROMPT_SAFE_LENGTH = 1800

export const SHOT_LABELS: Record<string, string> = {
  "extreme-wide": "EXTREME WIDE SHOT",
  "wide": "WIDE SHOT",
  "medium-wide": "MEDIUM WIDE SHOT",
  "medium": "MEDIUM SHOT",
  "medium-close": "MEDIUM CLOSE-UP",
  "close-up": "CLOSE-UP",
  "extreme-close-up": "EXTREME CLOSE-UP",
}

export const ANGLE_LABELS: Record<string, string> = {
  "eye-level": "eye level",
  "low-angle": "low angle",
  "high-angle": "high angle",
  "birds-eye": "bird's eye view",
  "worms-eye": "worm's eye view",
  "dutch": "dutch angle",
}

export const ASPECT_RATIO_LABELS: Record<string, string> = {
  "16:9": "wide landscape composition",
  "9:16": "vertical portrait composition",
  "1:1": "square composition",
  "4:3": "classic frame composition",
  "21:9": "ultrawide cinematic composition",
  "4:5": "tall portrait composition",
}

export const MOVEMENT_LABELS: Record<string, string> = {
  static: "static camera",
  pan: "camera panning",
  tilt: "camera tilting",
  dolly: "dolly shot",
  tracking: "tracking shot",
  crane: "crane shot",
  handheld: "handheld camera",
  zoom: "zoom",
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + "..."
}

/**
 * Build a rich image-generation prompt from scene node data + character
 * definitions.  Used by both the frontend DAG executor and the backend
 * orchestrator so that scene prompts are identical regardless of
 * execution path.
 */
export function buildScenePrompt(
  data: SceneData,
  assets: readonly CharacterDef[],
  options?: { forDisplay?: boolean },
): string {
  const noTruncate = options?.forDisplay === true
  const t = noTruncate ? (text: string, _max: number) => text : truncateText
  const highParts: string[] = []
  const medParts: string[] = []
  const lowParts: string[] = []

  // Shot type and angle (high)
  const shot = SHOT_LABELS[data.shotType] ?? "MEDIUM SHOT"
  const angle = ANGLE_LABELS[data.cameraAngle] ?? "eye level"
  highParts.push(`${shot}, ${angle}`)

  // Aspect ratio composition hint (medium)
  if (data.aspectRatio && data.aspectRatio !== "16:9") {
    const ratioLabel = ASPECT_RATIO_LABELS[data.aspectRatio]
    if (ratioLabel) medParts.push(ratioLabel)
  }

  // Characters with mood and action (high, but truncate descriptions)
  if (data.characters.length > 0) {
    const maxDescLen = data.characters.length > 2 ? 80 : 150
    const charDescs = data.characters.map((entry) => {
      const asset = assets.find((a) => a.id === entry.assetId)
      const name = asset?.name ?? "a figure"
      const desc = asset?.description ? `, ${t(asset.description, maxDescLen)}` : ""
      const mood = entry.mood ? `, ${entry.mood}` : ""
      const action = entry.action ? ` ${entry.action}` : ""
      const pos = entry.positionInFrame ? ` (${entry.positionInFrame})` : ""
      return `${name}${desc}${mood}${action}${pos}`
    })
    highParts.push(`of ${charDescs.join(" and ")}`)
  }

  // Locations (high, but truncate names)
  if (data.locations && data.locations.length > 0) {
    const locDescs = data.locations.map((loc) => {
      const asset = assets.find((a) => a.id === loc.assetId)
      const rawName = loc.name ?? asset?.description ?? asset?.name ?? "location"
      const name = t(rawName, 120)
      const envParts: string[] = []
      const tod = loc.timeOfDay ?? data.timeOfDay
      const wth = loc.weather ?? data.weather
      const lit = loc.lighting ?? data.lighting
      if (tod !== "noon") envParts.push(`${tod} light`)
      if (wth !== "clear") envParts.push(wth)
      if (lit !== "natural") envParts.push(`${lit} lighting`)
      return envParts.length > 0 ? `${name} (${envParts.join(", ")})` : name
    })
    highParts.push(`in ${locDescs.join(" and ")}`)
  } else {
    const envParts: string[] = []
    if (data.timeOfDay !== "noon") envParts.push(`${data.timeOfDay} light`)
    if (data.weather !== "clear") envParts.push(data.weather)
    if (data.lighting !== "natural") envParts.push(`${data.lighting} lighting`)
    if (envParts.length > 0) highParts.push(envParts.join(", "))
  }

  // Objects (medium)
  if (data.objects.length > 0) {
    const objDescs = data.objects.map((o) => {
      const asset = assets.find((a) => a.id === o.assetId)
      return o.description ?? asset?.name ?? "object"
    })
    medParts.push(`with ${objDescs.join(", ")}`)
  }

  // Mood (medium)
  if (data.mood.length > 0) {
    medParts.push(`${data.mood.join(", ")} atmosphere`)
  }

  // Visual style (medium)
  if (data.visualStyle) {
    medParts.push(`${data.visualStyle} style`)
  }

  // Depth of field (low)
  if (data.depthOfField !== "medium") {
    lowParts.push(`${data.depthOfField} depth of field`)
  }

  // Lens (low)
  if (data.lensType !== "normal") {
    lowParts.push(`${data.lensType} lens`)
  }

  // Camera movement (medium)
  if (data.cameraMovement !== "static") {
    medParts.push(MOVEMENT_LABELS[data.cameraMovement] ?? data.cameraMovement)
  }

  // Color palette (low)
  if (data.colorPalette.length > 0) {
    lowParts.push(`${data.colorPalette.join(", ")} color palette`)
  }

  // Summary as additional context (medium, truncated)
  if (data.summary.trim()) {
    medParts.push(t(data.summary.trim(), 300))
  }

  // Dialogue context (low, truncated)
  if (data.dialogue && data.dialogue.length > 0) {
    const dialogueDesc = data.dialogue
      .filter((d) => d.text.trim())
      .map((d) => `${d.characterName}${d.emotion ? ` (${d.emotion})` : ""}: "${t(d.text.trim(), 80)}"`)
      .join("; ")
    if (dialogueDesc) lowParts.push(`dialogue: ${t(dialogueDesc, 250)}`)
  }

  // Director notes (low, truncated)
  if (data.directorNotes?.trim()) {
    lowParts.push(t(data.directorNotes.trim(), 200))
  }

  // Assemble with progressive dropping
  let result = [...highParts, ...medParts, ...lowParts].join(", ")

  if (!noTruncate) {
    if (result.length > SCENE_PROMPT_SAFE_LENGTH) {
      let dropCount = 0
      while (dropCount < lowParts.length && result.length > SCENE_PROMPT_SAFE_LENGTH) {
        dropCount++
        result = [...highParts, ...medParts, ...lowParts.slice(0, lowParts.length - dropCount)].join(", ")
      }
    }
    if (result.length > SCENE_PROMPT_SAFE_LENGTH) {
      const medRemaining = [...medParts]
      while (medRemaining.length > 0 && result.length > SCENE_PROMPT_SAFE_LENGTH) {
        medRemaining.pop()
        result = [...highParts, ...medRemaining].join(", ")
      }
    }
    if (result.length > SCENE_PROMPT_MAX_LENGTH) {
      result = result.slice(0, SCENE_PROMPT_MAX_LENGTH - 3) + "..."
    }
  }

  return result
}

