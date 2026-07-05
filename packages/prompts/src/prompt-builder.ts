/**
 * Image prompt assembly logic shared between frontend and backend.
 * Handles character description expansion, style appending, negative prompt routing,
 * provider-aware prompt truncation (default 5000 chars), and reference image filtering by model support.
 */

import { resolveTemplate, applyTemplate } from "./prompt-templates.js"
import { NATIVE_NEGATIVE_PROMPT_MODELS, MODELS_WITH_REFERENCE_IMAGE_SUPPORT, imageReferenceLimit, getMaxImagePromptChars, getMaxNegativePromptChars } from "@nodaro/shared"
import { getStylePromptHint } from "./style.js"
import { findCharacterMentionTokens, type CharacterMentionTokenInfo } from "@nodaro/shared"
import { usageModeDirective, DEFAULT_USAGE_MODE, type UsageMode } from "@nodaro/shared"
import { roleToPhrase, defaultRoleForSource, REFERENCE_ROLE_PRESETS, normalizeRoleSlug, resolveDefaultRole } from "@nodaro/shared"
import { buildIdentityLockLine, withForcedIdentityLock } from "./identity-lock.js"
import { findLocationMentionTokens, DEFAULT_LOCATION_USAGE_MODE, type LocationMentionTokenInfo, type LocationUsageMode } from "@nodaro/shared"
import type { CharacterDef, ConnectedReference, IdentityFidelity, IdentityMeta, ReferenceSource, SceneData } from "@nodaro/shared"
import { locationReferencePhotoKindLabel, type LocationReferencePhotoKind } from "@nodaro/shared"

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
 * Compose the descriptive body of a character identity bullet:
 *   `${subject} — ${canonicalDesc?}. ${elementInjection?}`  (parts joined by ". ")
 *
 * Either part may be absent. `canonicalDesc` is mode-gated by the caller (pass
 * `undefined` to omit it for non-identity modes); `elementInjection` is the
 * mode-INDEPENDENT scene-composition fragment wired into the character node's
 * Assets/Prompt handle (held-prop / styling / text). When BOTH are absent the
 * bullet collapses to the bare `subject` — byte-identical to the
 * pre-elementInjection output, which the parity tests pin.
 */
function composeIdentityDescPart(
  subject: string,
  canonicalDesc: string | null | undefined,
  elementInjection: string | null | undefined,
): string {
  const parts: string[] = []
  const c = canonicalDesc?.trim()
  if (c) parts.push(c)
  const e = elementInjection?.trim()
  if (e) parts.push(e)
  return parts.length > 0 ? `${subject} — ${parts.join(". ")}` : subject
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
      // Canonical desc is mode-gated; the character's wired elements
      // (held-prop / styling / text) ride the bullet in every mode that emits
      // one. Byte-identical to the old `${subject} — ${canonical}` form when no
      // injection is present.
      const descPart = composeIdentityDescPart(
        subject,
        includeCanonicalDesc ? match.characterCanonicalDescription : undefined,
        match.elementInjection,
      )
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

interface ResolveCharacterMentionsHybridResult {
  /** Body with each `@`-mention replaced INLINE by its role phrase
   *  ("the {role} from reference image {LETTER}"). No directive block. */
  prompt: string
  /** Matched character URLs in mention order (deduped by the caller). */
  additionalUrls: string[]
  /** Slugs that had at least one resolved mention. */
  mentionedCharacterSlugs: Set<string>
  /** Per-reference identity-lock lines (non-null, deduped per URL). Caller
   *  prepends them as ONE block. */
  lockLines: string[]
  /** Non-empty `elementInjection` fragments (deduped per URL). Caller appends
   *  them as trailing scene directives. */
  elementDirectives: string[]
}

/**
 * HYBRID-mode character mention convergence (Unified Reference Roles, Phase A).
 *
 * Where `resolveCharacterMentions` (above) prepends the legacy
 * `"Use these characters:"` bullet block + replaces tokens with bare display
 * names — and is shared VERBATIM with the video resolver, so its contract must
 * NOT change — this renders each `@`-mention as the inline role phrase
 * `"the {role} from reference image {LETTER}"` and surfaces the optional
 * identity-lock + wired `elementInjection` SEPARATELY (the caller prepends one
 * lock block and appends element directives). No directive block is produced.
 *
 * Slot/letter: a character URL's 1-based position in
 * `dedup([...existingUrls, ...mentionUrls])`. The caller appends non-character
 * URLs AFTER this list when it builds `finalIndexByUrl`, so these letters are
 * byte-identical to that canonical map for every character URL.
 *
 * Role: the mention's role/usage-mode 3rd segment — `face`/`pose`/`style` parse
 * as usage modes, `person`/`clothes`/`hair`/`expression` parse as variant slugs
 * but are curated roles. Either way it's reused when present in
 * `REFERENCE_ROLE_PRESETS["wired-character"]`, else falls back to the source
 * default (`"person"`). `identical`/`face-pose`/`emotion`/`name`/`none` (and a
 * real variant slug like `smile`) are not curated roles → `"person"`.
 *
 * Matching: variant-first, canonical-fallback — so a role-word 3rd segment that
 * parsed as a variant slug (e.g. `@kira:1:person`) still attaches the canonical
 * reference instead of being dropped (the legacy resolver skips variant misses).
 */
function resolveCharacterMentionsHybrid(
  prompt: string,
  tokens: readonly CharacterMentionTokenInfo[],
  refs: readonly ConnectedReference[],
  existingUrls: readonly string[],
): ResolveCharacterMentionsHybridResult {
  const bySlug = new Map<string, ConnectedReference>()
  const byVariant = new Map<string, ConnectedReference>()
  for (const r of refs) {
    if (!r.characterSlug) continue
    if (!r.variantSlug) bySlug.set(r.characterSlug, r)
    else byVariant.set(`${r.characterSlug}:${r.variantSlug}`, r)
  }

  const presets = REFERENCE_ROLE_PRESETS["wired-character"]

  const additionalUrls: string[] = []
  const mentionedCharacterSlugs = new Set<string>()
  const refByUrl = new Map<string, ConnectedReference>()
  // Per-mention `~lock` / `~nolock` (Task 4 + F4): the tri-state lock OVERRIDE
  // per attached URL — `true` (force on) / `false` (force off) / absent
  // (inherit the ref default). The lock loop below feeds this to
  // `withForcedIdentityLock` before `buildIdentityLockLine`. Only tokens that
  // carried a sentinel write here (last sentinel wins); a sentinel-less mention
  // never overwrites, so a `~lock` upstream survives a later plain mention.
  const lockOverrideByUrl = new Map<string, boolean>()
  const matched: Array<{ token: string; offset: number; url: string; role: string }> = []

  for (const t of tokens) {
    // Variant-first, canonical-fallback. `variantMatch` (a REAL matched variant
    // URL) doubles as the signal that the 3rd segment SELECTED a variant rather
    // than acting as a role — see the role derivation below.
    const variantMatch = t.variantSlug
      ? byVariant.get(`${t.characterSlug}:${t.variantSlug}`)
      : undefined
    const match = variantMatch ?? bySlug.get(t.characterSlug)
    if (!match || !match.url) continue
    additionalUrls.push(match.url)
    mentionedCharacterSlugs.add(t.characterSlug)
    refByUrl.set(match.url, match)
    if (t.lock !== undefined) lockOverrideByUrl.set(match.url, t.lock)
    const segment = (t.usageMode ?? t.variantSlug ?? "").trim()
    // Custom roles survive VERBATIM (Unified Reference Roles, Phase D). A
    // non-empty segment is the role when it is a curated preset (face/pose/style
    // modes, person/clothes/… role-slugs) OR a free-form value typed in the
    // variant/role slot that did NOT resolve to a real matched variant URL (e.g.
    // `earrings`) — i.e. it's acting as a role, not selecting a variant. A real
    // variant slug (`smile`) and the directive-only usage modes (identical/
    // face-pose/emotion/name/none) fall back to the NODE default: the character
    // node's `defaultRole` (hybrid dropdown pick, verbatim) → its
    // `defaultUsageMode`-derived role → the source default ("person") — via
    // `resolveDefaultRole` (Character Node Role+Lock). Precedence: per-mention
    // token role → node defaultRole → defaultUsageMode-derived → source default.
    const role =
      segment && (presets.includes(segment) || (t.usageMode == null && !variantMatch))
        ? segment
        : resolveDefaultRole(match.defaultRole, match.defaultUsageMode, "wired-character")
    matched.push({ token: t.token, offset: t.offset, url: match.url, role })
  }

  // Slot letters from the deduped [existing, mention] URL list — the prefix of
  // the caller's `finalIndexByUrl`, so the letters agree.
  const slotByUrl = new Map<string, number>()
  for (const u of [...existingUrls, ...additionalUrls]) {
    if (!slotByUrl.has(u)) slotByUrl.set(u, slotByUrl.size + 1)
  }
  const bindingFor = (url: string): string => {
    const slot = slotByUrl.get(url)
    return slot ? `reference image ${slotToLetter(slot)}` : "the reference image"
  }

  // Replace mention tokens right-to-left so earlier offsets stay valid.
  let resolvedPrompt = prompt
  for (const m of [...matched].sort((a, b) => b.offset - a.offset)) {
    const phrase = roleToPhrase(m.role, bindingFor(m.url))
    resolvedPrompt =
      resolvedPrompt.slice(0, m.offset) + phrase + resolvedPrompt.slice(m.offset + m.token.length)
  }

  // One identity-lock + one element directive per UNIQUE attached URL (a
  // character mentioned N times attaches one URL → one lock / element line).
  const lockLines: string[] = []
  const elementDirectives: string[] = []
  const seenUrls = new Set<string>()
  for (const m of matched) {
    if (seenUrls.has(m.url)) continue
    seenUrls.add(m.url)
    const ref = refByUrl.get(m.url)
    if (!ref) continue
    const binding = bindingFor(m.url)
    const lock = buildIdentityLockLine(withForcedIdentityLock(ref, lockOverrideByUrl.get(m.url)), binding)
    if (lock) lockLines.push(lock)
    const inject = ref.elementInjection?.trim()
    if (inject) elementDirectives.push(inject)
  }

  return { prompt: resolvedPrompt, additionalUrls, mentionedCharacterSlugs, lockLines, elementDirectives }
}

export interface ResolveLocationMentionsResult {
  /** Prompt with `@location:N` tokens replaced by display names + a
   *  "Use these locations:" directive prepended when at least one bullet
   *  fires. */
  prompt: string
  /** Resolved URLs from matched mention tokens, in mention order. Caller
   *  is responsible for deduping against the existing URL list (the same
   *  contract as `resolveCharacterMentions.additionalUrls`). */
  additionalUrls: string[]
  /** Set of location slugs that had at least one resolved mention. Callers
   *  use this to gate "no mention → canonical fallback" behavior (mirrors
   *  the character flow — Phase 2 #1 attached the canonical URL via
   *  `expandWiredLocationRefs` directly, but a future fallback path may
   *  use this set to suppress the canonical URL once the user has explicitly
   *  pinned a variant via @-mention). */
  mentionedLocationSlugs: Set<string>
}

/**
 * Per-mode directive text for a location bullet. Mirrors `usageModeDirective`
 * for characters but with the 4-mode location enum:
 *   - identical: lock the scene to this exact image (used as background)
 *   - style:     borrow the look/mood/color palette
 *   - layout:    borrow the compositional layout / camera framing
 *   - none:      no bullet emitted (caller handles)
 */
function locationModeDirective(mode: LocationUsageMode): string | null {
  switch (mode) {
    case "identical":
      return "use as the background/setting — match the location exactly."
    case "style":
      return "use as a style / mood reference — borrow color, lighting, and atmosphere."
    case "layout":
      return "use as a compositional layout / camera framing reference."
    case "none":
      return null
  }
}

/**
 * Map a location usage-mode to its HYBRID reference role — the vocabulary
 * `roleToPhrase` renders into "the {role} from reference image {LETTER}". The
 * location analog of the character mention's role segment, for the 4-mode
 * location enum:
 *   - identical → "background"  (lock the scene to this image)
 *   - style     → "style"       (borrow look / mood / palette)
 *   - layout    → "layout"      (borrow compositional framing)
 *   - none / undefined / anything else → the source default (`"background"`).
 *
 * Accepts a loose `string` so a `ConnectedReference.defaultUsageMode` (typed as
 * the CHARACTER `UsageMode`, which can't express `"layout"`) flows in without a
 * cast — unknown / non-location modes fall through to the safe source default
 * instead of throwing. The three real roles are members of
 * `REFERENCE_ROLE_PRESETS["wired-location"]`, so the phrasing stays curated.
 */
function locationModeToRole(mode: string | null | undefined): string {
  switch (mode) {
    case "identical":
      return "background"
    case "style":
      return "style"
    case "layout":
      return "layout"
    default:
      return defaultRoleForSource("wired-location")
  }
}

/**
 * Resolve `@oldlibrary:1:weather/rain` mentions in the prompt against the
 * pre-expanded `wired-location` ConnectedReferences (from
 * `expandWiredLocationRefs` / `expandLocationNodeIntoRefs`). Mirrors
 * `resolveCharacterMentions` shape:
 *
 *   1. Look up the matching ref by `(locationSlug, bucket, variantSlug)`.
 *   2. Append its URL to `additionalUrls`.
 *   3. Substitute the inline token with the location's display name (or
 *      `Image N` for "none" mode — image attached without textual bias).
 *   4. Emit a directive bullet under "Use these locations:" header, with
 *      mode-specific verb. "none" mode suppresses the bullet (just like
 *      character "none").
 *
 * Per-location single-bullet rule: each location emits AT MOST ONE bullet
 * (the first non-none mention "claims" the slot). Subsequent mentions of the
 * same location still produce inline substitution + URL but no additional
 * bullet, mirroring `resolveCharacterMentions.firstBulletEmittedFor`.
 *
 * Returns `additionalUrls` deduplication is the caller's responsibility,
 * matching the character contract.
 */
export function resolveLocationMentions(
  prompt: string,
  tokens: readonly LocationMentionTokenInfo[],
  refs: readonly ConnectedReference[],
): ResolveLocationMentionsResult {
  // Build lookup maps: canonical (no variant) and per-(bucket/variant).
  const bySlug = new Map<string, ConnectedReference>()
  const byVariant = new Map<string, ConnectedReference>()
  for (const r of refs) {
    if (!r.locationSlug) continue
    if (!r.locationVariantBucket || !r.locationVariantSlug) {
      bySlug.set(r.locationSlug, r)
    } else {
      byVariant.set(
        `${r.locationSlug}:${r.locationVariantBucket}/${r.locationVariantSlug}`,
        r,
      )
    }
  }

  const additionalUrls: string[] = []
  const mentionedLocationSlugs = new Set<string>()
  const firstBulletEmittedFor = new Set<string>()
  const directiveLines: string[] = []
  const replacements: Array<{ token: string; offset: number; replacement: string }> = []

  for (const t of tokens) {
    // Bare-slug ROLE tokens (Unified Reference Roles, Phase D — e.g.
    // `@old-library:1:background` / `:atmosphere` / `:as-is` /
    // `:empty-background` / `:lighting`) are a HYBRID-only construct. The
    // additive parser now PARSES them (with `t.role` set, no bucket/variant),
    // but in the LEGACY path they must stay literal text exactly as they did
    // pre-Phase-D, when the parser returned null and the token fell through
    // untouched. Skipping here guarantees byte-identical legacy output: NO
    // inline replacement, NO bullet, NO attached URL, and crucially the slug is
    // NOT added to `mentionedLocationSlugs` — so a wired location still
    // auto-attaches via the unchanged non-character canonical path, just as
    // before. Role resolution lives in `resolveLocationMentionsHybrid`, which is
    // untouched. (`layout`/`style` set `usageMode`, not `role`, so they were
    // always modes and are unaffected.)
    if (t.role) continue

    const match = t.bucket && t.variant
      ? byVariant.get(`${t.locationSlug}:${t.bucket}/${t.variant}`)
      : bySlug.get(t.locationSlug)
    if (!match) continue

    additionalUrls.push(match.url)
    mentionedLocationSlugs.add(t.locationSlug)

    // Per-mention effective mode. Resolution order: per-mention slug override
    // → location node default (not yet plumbed; reserved for future) → global
    // DEFAULT_LOCATION_USAGE_MODE.
    const effectiveMode: LocationUsageMode =
      t.usageMode ?? DEFAULT_LOCATION_USAGE_MODE

    // Inline replacement of `@oldlibrary:1:weather/rain` in the user's
    // prompt. For "none" we substitute the bare positional reference so the
    // user's sentence reads "set in Image 1" — the image is attached, the
    // model sees the position label, but no name biases the textual prompt.
    // Every other mode keeps the location display name for natural prose.
    const displayName = bySlug.get(t.locationSlug)?.defaultName ?? t.locationSlug
    const replacement = effectiveMode === "none" ? `Image ${t.imageIndex}` : displayName
    replacements.push({ token: t.token, offset: t.offset, replacement })

    // Bullet emission. "none" skips entirely; other modes emit one bullet
    // per location on the first non-none mention.
    if (effectiveMode === "none") {
      continue
    }
    const isFirstBullet = !firstBulletEmittedFor.has(t.locationSlug)
    if (!isFirstBullet) continue
    firstBulletEmittedFor.add(t.locationSlug)

    const directive = locationModeDirective(effectiveMode)
    const subject = `Image ${t.imageIndex} (${displayName})`
    // Canonical-description injection. Mirrors the Phase 2 #1 behavior in
    // `buildIdentityDirective` — only emit for the "identical" mode where
    // the description (env, materials, mood) is on-task; "style" / "layout"
    // modes are about the look/composition and don't need the full
    // description noise.
    const includeCanonicalDesc = effectiveMode === "identical"
    const canonicalDesc = match.locationCanonicalDescription?.trim()
    const descPart = includeCanonicalDesc && canonicalDesc
      ? `${subject} — ${canonicalDesc}`
      : subject
    directiveLines.push(`- ${descPart}.${directive ? ` ${directive}` : ""}`)

    // Variant display-name sub-line: only when the user pinned a specific
    // variant. Distinct from `description` (the user-typed text on the
    // location node) — locationVariantDisplayName is the raw bucket name
    // like "rain" or "neon".
    if (
      t.bucket
      && t.variant
      && match.locationVariantDisplayName
      && match.locationVariantDisplayName !== "canonical"
    ) {
      directiveLines.push(`  (in this image: ${match.locationVariantDisplayName})`)
    }
  }

  // Apply replacements right-to-left so offsets stay valid.
  let resolvedPrompt = prompt
  for (const r of [...replacements].sort((a, b) => b.offset - a.offset)) {
    resolvedPrompt = resolvedPrompt.slice(0, r.offset)
      + r.replacement
      + resolvedPrompt.slice(r.offset + r.token.length)
  }

  if (directiveLines.length > 0) {
    resolvedPrompt = `Use these locations:\n${directiveLines.join("\n")}\n\n${resolvedPrompt}`
  }

  return { prompt: resolvedPrompt, additionalUrls, mentionedLocationSlugs }
}

interface ResolveLocationMentionsHybridResult {
  /** Body with each `@location` mention replaced INLINE by its role phrase
   *  ("the {role} from reference image {LETTER}"). No directive block. */
  prompt: string
  /** Matched location URLs in mention order (deduped by the caller). */
  additionalUrls: string[]
  /** Slugs that had at least one resolved mention. */
  mentionedLocationSlugs: Set<string>
  /** Per-reference opt-in identity-lock lines (deduped per URL). Locks are OFF
   *  for locations by default — `buildIdentityLockLine` returns null unless the
   *  ref sets `identityLock.enabled === true` with custom text (there is no
   *  built-in wired-location lock wording). Caller prepends them as ONE block. */
  lockLines: string[]
  /** Non-empty `elementInjection` fragments (deduped per URL). Caller appends
   *  them as trailing scene directives. */
  elementDirectives: string[]
}

/**
 * HYBRID-mode location mention convergence (Unified Reference Roles, Phase C).
 *
 * The location analog of `resolveCharacterMentionsHybrid`. Where the LEGACY
 * `resolveLocationMentions` (above) prepends a `"Use these locations:"` bullet
 * block + replaces `@location` tokens with display names, this renders each
 * mention as the inline role phrase `"the {role} from reference image {LETTER}"`
 * and surfaces the optional opt-in identity-lock + wired `elementInjection`
 * SEPARATELY (caller prepends one lock block, appends element directives). No
 * directive block is produced.
 *
 * MATCHING is byte-identical to the legacy resolver (variant-first, NO canonical
 * fallback on a variant miss) so the set of attached URLs / matched tokens never
 * diverges between formats — only the rendered phrasing differs.
 *
 * ROLE is `locationModeToRole(mode)` with `mode = perMentionOverride ?? the
 * location node's defaultUsageMode ?? DEFAULT_LOCATION_USAGE_MODE` — so a node
 * whose default is "style" renders "the style from …" for a bare `@old-library:1`.
 *
 * SLOT/LETTER: a URL's 1-based position in `dedup([...existingUrls,
 * ...mentionUrls])`. The caller passes `existingUrls = [base refs, resolved
 * character mentions]` (location mentions are merged AFTER character mentions and
 * BEFORE the character canonical/extra URLs), so these letters are a prefix of —
 * and byte-identical to — the caller's final `finalIndexByUrl` for every location
 * URL.
 */
function resolveLocationMentionsHybrid(
  prompt: string,
  tokens: readonly LocationMentionTokenInfo[],
  refs: readonly ConnectedReference[],
  existingUrls: readonly string[],
): ResolveLocationMentionsHybridResult {
  const bySlug = new Map<string, ConnectedReference>()
  const byVariant = new Map<string, ConnectedReference>()
  for (const r of refs) {
    if (!r.locationSlug) continue
    if (!r.locationVariantBucket || !r.locationVariantSlug) {
      bySlug.set(r.locationSlug, r)
    } else {
      byVariant.set(`${r.locationSlug}:${r.locationVariantBucket}/${r.locationVariantSlug}`, r)
    }
  }

  const additionalUrls: string[] = []
  const mentionedLocationSlugs = new Set<string>()
  const refByUrl = new Map<string, ConnectedReference>()
  // Per-mention `~lock` / `~nolock` (Task 4 + F4): the tri-state lock OVERRIDE
  // per attached URL — `true` (force on, so a location lock line appears even
  // though location locks default OFF) / `false` (force off, suppressing a
  // ref-level enabled lock) / absent (inherit). Fed to `withForcedIdentityLock`
  // below. Only sentinel-bearing mentions write here (last sentinel wins).
  const lockOverrideByUrl = new Map<string, boolean>()
  const matched: Array<{ token: string; offset: number; url: string; role: string }> = []

  for (const t of tokens) {
    // Variant-first, canonical-fallback-FREE (ternary, NOT `??`) — identical to
    // the legacy resolver so the matched URL set never diverges between formats.
    const match = t.bucket && t.variant
      ? byVariant.get(`${t.locationSlug}:${t.bucket}/${t.variant}`)
      : bySlug.get(t.locationSlug)
    if (!match || !match.url) continue
    additionalUrls.push(match.url)
    mentionedLocationSlugs.add(t.locationSlug)
    refByUrl.set(match.url, match)
    if (t.lock !== undefined) lockOverrideByUrl.set(match.url, t.lock)
    const mode = t.usageMode ?? match.defaultUsageMode ?? DEFAULT_LOCATION_USAGE_MODE
    // A bare-slug ROLE (Unified Reference Roles, Phase D — e.g. `background`,
    // `empty-background`, `as-is`, or a curated custom role) is used VERBATIM:
    // it's acting as a role, not selecting a bucket/variant. `t.role` is the
    // token slug; map it back to the phrase key so `roleToPhrase` hits the
    // non-noun specials (`empty-background` → `empty background`). With no role
    // segment, derive the role from the usage mode (mode-aware default) —
    // byte-identical to the prior behavior for every non-role mention.
    const role = t.role ? normalizeRoleSlug(t.role) : locationModeToRole(mode)
    matched.push({ token: t.token, offset: t.offset, url: match.url, role })
  }

  // Slot letters from the deduped [existing, mention] URL list — the prefix of
  // the caller's `finalIndexByUrl`, so the letters agree.
  const slotByUrl = new Map<string, number>()
  for (const u of [...existingUrls, ...additionalUrls]) {
    if (!slotByUrl.has(u)) slotByUrl.set(u, slotByUrl.size + 1)
  }
  const bindingFor = (url: string): string => {
    const slot = slotByUrl.get(url)
    return slot ? `reference image ${slotToLetter(slot)}` : "the reference image"
  }

  // Replace mention tokens right-to-left so earlier offsets stay valid.
  let resolvedPrompt = prompt
  for (const m of [...matched].sort((a, b) => b.offset - a.offset)) {
    const phrase = roleToPhrase(m.role, bindingFor(m.url))
    resolvedPrompt =
      resolvedPrompt.slice(0, m.offset) + phrase + resolvedPrompt.slice(m.offset + m.token.length)
  }

  // One opt-in lock + one element directive per UNIQUE attached URL.
  const lockLines: string[] = []
  const elementDirectives: string[] = []
  const seenUrls = new Set<string>()
  for (const m of matched) {
    if (seenUrls.has(m.url)) continue
    seenUrls.add(m.url)
    const ref = refByUrl.get(m.url)
    if (!ref) continue
    const binding = bindingFor(m.url)
    const lock = buildIdentityLockLine(withForcedIdentityLock(ref, lockOverrideByUrl.get(m.url)), binding)
    if (lock) lockLines.push(lock)
    const inject = ref.elementInjection?.trim()
    if (inject) elementDirectives.push(inject)
  }

  return { prompt: resolvedPrompt, additionalUrls, mentionedLocationSlugs, lockLines, elementDirectives }
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
    // Wired elements (held-prop / styling / text) ride this bullet alongside
    // the (mode-gated) canonical description. This is the reported path — a
    // character wired with no @-mention — so a composed character surfaces its
    // elements wherever it's used downstream.
    const descPart = composeIdentityDescPart(
      subject,
      includeCanonicalDesc ? r.characterCanonicalDescription : undefined,
      r.elementInjection,
    )
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
        // typed in the extra-ref row, so it always wins. The character's wired
        // elements (held-prop / styling) ride alongside whichever wins.
        const chosenDesc = description
          ? description
          : (includeCanonicalDesc ? canonicalDesc : undefined)
        const descPart = composeIdentityDescPart(subject, chosenDesc, r.elementInjection)
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

// ---------------------------------------------------------------------------
// HYBRID variants of the canonical-fallback + extra-ref directives (Unified
// Reference Roles, Phase A — Task 4). Where the LEGACY builders above prepend a
// "Use these characters:" bullet block with numeric "Image N" addressing, these
// attach the SAME reference URLs but render each entry as an inline, lowercase
// role phrase / pair-back directive bound to a lettered slot ("reference image
// A"). Letters come from the caller's unified slot map (the same
// `finalIndexByUrl` order as the rest of the hybrid path), so the numbering
// agrees byte-for-byte. The legacy builders stay untouched.
// ---------------------------------------------------------------------------

/**
 * Select the unmentioned wired-character refs that contribute a canonical
 * fallback URL in hybrid mode. SELECTION ONLY — identical filtering to
 * `buildCanonicalFallback` (canonical entry only, deduped per `characterSlug`,
 * skipping @-mentioned slugs) so the two paths never disagree on WHICH
 * characters auto-attach; rendering happens in `renderCanonicalFallbackHybrid`
 * once the slot letters are known. Keep this filter in sync with
 * `buildCanonicalFallback`.
 */
function selectCanonicalFallbackRefs(
  refs: readonly ConnectedReference[],
  mentionedSlugs: ReadonlySet<string>,
): ConnectedReference[] {
  const out: ConnectedReference[] = []
  const seenSlugs = new Set<string>()
  for (const r of refs) {
    if (r.source !== "wired-character") continue
    if (!r.characterSlug) continue
    if (mentionedSlugs.has(r.characterSlug)) continue
    if (seenSlugs.has(r.characterSlug)) continue
    if (r.variantSlug) continue // never auto-attach a variant for an unmentioned char
    if (!r.url) continue
    seenSlugs.add(r.characterSlug)
    out.push(r)
  }
  return out
}

/**
 * Render the hybrid canonical fallback: each unmentioned wired character →
 * the inline role phrase `roleToPhrase(defaultRoleForSource(source), binding)`
 * (the caller appends these to the body as trailing scene directives) + its
 * opt-in identity-lock line (null by default — emitted only when the ref sets
 * `identityLock.enabled === true`) + its wired `elementInjection` (held-prop /
 * styling / text) as a trailing scene directive. `letterForUrl` maps the ref's
 * already-attached URL to its slot letter.
 *
 * `elementInjection` must NOT be silently dropped for an unmentioned character:
 * the legacy `buildCanonicalFallback` folds it into the bullet via
 * `composeIdentityDescPart`, and the hybrid MENTION path surfaces it via
 * `resolveCharacterMentionsHybrid`'s `elementDirectives`. We mirror the latter's
 * shape exactly (raw trimmed injection string, surfaced as its own trailing
 * line) so mentioned and unmentioned characters stay consistent in hybrid mode.
 */
function renderCanonicalFallbackHybrid(
  refs: readonly ConnectedReference[],
  letterForUrl: (url: string) => string,
): { phrases: string[]; lockLines: string[]; elementDirectives: string[] } {
  const phrases: string[] = []
  const lockLines: string[] = []
  const elementDirectives: string[] = []
  for (const r of refs) {
    const binding = `reference image ${letterForUrl(r.url)}`
    // Node-default role chain (Character Node Role+Lock): the character node's
    // `defaultRole` (hybrid dropdown pick, verbatim — Custom survives) → its
    // `defaultUsageMode`-derived role → the source default ("person"). This is
    // the MOST COMMON wiring (wired, not @-mentioned), which previously
    // hardcoded the source default and ignored the node entirely.
    phrases.push(roleToPhrase(resolveDefaultRole(r.defaultRole, r.defaultUsageMode, r.source), binding))
    const lock = buildIdentityLockLine(r, binding)
    if (lock) lockLines.push(lock)
    const inject = r.elementInjection?.trim()
    if (inject) elementDirectives.push(inject)
  }
  return { phrases, lockLines, elementDirectives }
}

/**
 * Render the hybrid extra-ref directives. Mirrors `buildExtraRefDirectives`'s
 * manual-vs-pair-back SHAPES, but with lettered bindings + lowercase phrasing
 * instead of "Image N":
 *   - manual extra (with description)  → "<description> (reference image L)."
 *   - character extra, earlier sibling → "reference image L is the same subject
 *                                         as reference image M[, <desc>]."
 *   - character extra, first sight     → role phrase [+ ", <desc>"] + opt-in lock
 *                                         + wired `elementInjection` (surfaced as
 *                                         a SEPARATE trailing directive, mirroring
 *                                         `renderCanonicalFallbackHybrid`).
 * `seedLetterByChar` carries each character's FIRST emitted letter from the
 * mention / canonical-fallback pass, so a picked-variant extra pairs back to the
 * earlier reference; first-sight extras record their own letter for any later
 * same-character extras. A description-less manual extra attaches its URL with
 * no directive (nothing to surface).
 *
 * `elementInjection` must NOT be silently dropped for a first-sight extra-ref
 * character: the legacy `buildExtraRefDirectives` folds it into the first-sight
 * bullet via `composeIdentityDescPart`, so the hybrid path surfaces the trimmed
 * injection as its own trailing line (same shape as the canonical / mention
 * paths). Only the FIRST-SIGHT branch attaches it — a pair-back extra references
 * an earlier image whose element directive was already emitted there.
 */
function renderExtraRefsHybrid(
  extraRefs: readonly ConnectedReference[],
  letterForUrl: (url: string) => string,
  seedLetterByChar: ReadonlyMap<string, string>,
): { bodyLines: string[]; lockLines: string[]; elementDirectives: string[] } {
  const bodyLines: string[] = []
  const lockLines: string[] = []
  const elementDirectives: string[] = []
  const firstLetterByChar = new Map(seedLetterByChar)
  for (const r of extraRefs) {
    if (!r.url) continue
    const letter = letterForUrl(r.url)
    const binding = `reference image ${letter}`
    const description = (r.description ?? r.variantDescription ?? "").trim()
    if (r.source === "wired-character" && r.characterSlug) {
      const earlier = firstLetterByChar.get(r.characterSlug)
      if (earlier !== undefined && earlier !== letter) {
        const tail = description ? `, ${description}` : ""
        bodyLines.push(`${binding} is the same subject as reference image ${earlier}${tail}.`)
      } else {
        // Role chain (Character Node Role+Lock): the node's `defaultRole`
        // (hybrid dropdown pick, VERBATIM — Custom survives; the expander only
        // stamps it when the extra carries no per-ref usageMode override) → the
        // COALESCED `defaultUsageMode`-derived role → the source default — via
        // the shared `resolveDefaultRole` helper.
        //
        // `defaultUsageMode` here is COALESCED (`expandExtraRefsToConnected-
        // References` folds per-ref `usageMode` → char-node default →
        // "identical"), so a character extra always carries a defined mode.
        // The VIDEO extras path (`video-reference-resolver.ts`) feeds the same
        // helper its own coalesced `effectiveMode` + `meta.defaultRole` — image
        // and video are fully converged (same helper, same precedence); pinned
        // by `character-convergence-image.test.ts`.
        const role = resolveDefaultRole(r.defaultRole, r.defaultUsageMode, r.source)
        const phrase = roleToPhrase(role, binding)
        bodyLines.push(description ? `${phrase}, ${description}.` : `${phrase}.`)
        const lock = buildIdentityLockLine(r, binding)
        if (lock) lockLines.push(lock)
        const inject = r.elementInjection?.trim()
        if (inject) elementDirectives.push(inject)
        firstLetterByChar.set(r.characterSlug, letter)
      }
    } else if (description) {
      bodyLines.push(`${description} (${binding}).`)
    }
  }
  return { bodyLines, lockLines, elementDirectives }
}

/**
 * Render the hybrid canonical convergence for UNMENTIONED wired locations (the
 * location analog of `renderCanonicalFallbackHybrid`). Each unmentioned
 * `wired-location` ref → the inline role phrase
 * `roleToPhrase(locationModeToRole(defaultUsageMode), binding)` (the caller
 * appends these as trailing scene directives) + its opt-in identity-lock line
 * (null unless the ref enables one — locations have no built-in lock wording) +
 * its wired `elementInjection` as a trailing directive.
 *
 * Unlike characters — whose canonical URLs are merged in Phase 0 — unmentioned
 * locations flow through the New path's `nonCharacterRefs` / `finalIndexByUrl`,
 * so the slot letter is read straight from `finalIndexByUrl` (the single source
 * of truth for the assembled URL order). MENTIONED locations were already
 * converged inline in Phase 0 and filtered out of `nonCharacterRefs`, so they
 * never reach here. Deduped per URL to mirror `buildNonCharacterDirectives`'s
 * per-URL `coveredUrls` guard (a location wired twice → one phrase).
 *
 * `coveredUrls` is the set of URLs ALREADY expanded inline by an `{image:N}`
 * token in this hybrid scene (derived exactly as the legacy builder does — see
 * the call site). A location that is BOTH unmentioned AND `{image:N}`-token-
 * referenced is rendered ONCE (inline, via the scene); we `continue` here so it
 * is not ALSO emitted as a trailing canonical phrase (the C1 review Minor).
 */
function renderLocationCanonicalHybrid(
  nonCharacterRefs: readonly ConnectedReference[],
  finalIndexByUrl: ReadonlyMap<string, number>,
  coveredUrls: ReadonlySet<string>,
): { phrases: string[]; lockLines: string[]; elementDirectives: string[] } {
  const phrases: string[] = []
  const lockLines: string[] = []
  const elementDirectives: string[] = []
  const seenUrls = new Set<string>()
  for (const r of nonCharacterRefs) {
    if (r.source !== "wired-location") continue
    if (!r.url || seenUrls.has(r.url) || coveredUrls.has(r.url)) continue
    const slot = finalIndexByUrl.get(r.url)
    if (!slot) continue
    seenUrls.add(r.url)
    const binding = `reference image ${slotToLetter(slot)}`
    phrases.push(roleToPhrase(locationModeToRole(r.defaultUsageMode), binding))
    const lock = buildIdentityLockLine(r, binding)
    if (lock) lockLines.push(lock)
    const inject = r.elementInjection?.trim()
    if (inject) elementDirectives.push(inject)
  }
  return { phrases, lockLines, elementDirectives }
}

/**
 * Render the hybrid canonical convergence for UNMENTIONED wired objects /
 * creatures (the object/creature analog of `renderLocationCanonicalHybrid`).
 * Each unmentioned `wired-object` ref → "the object from reference image
 * {LETTER}"; each `wired-creature` → "the creature from reference image
 * {LETTER}" — via `roleToPhrase(defaultRoleForSource(source), binding)` (the
 * source-default role, mirroring `renderCanonicalFallbackHybrid` for characters,
 * not the location's mode-aware role) + its opt-in identity-lock line (null by
 * default — `wired-object` has no built-in lock wording at all; `wired-creature`
 * has wording but it is OFF unless `identityLock.enabled === true`, per Plan A's
 * default-off flip) + its wired `elementInjection` as a trailing directive.
 *
 * Objects/creatures have NO `@-mention` path, so the ONLY way one renders inline
 * is an `{image:N}` token. `coveredUrls` (the URLs already expanded by such a
 * token in this scene) is threaded in so a wired object/creature that is BOTH
 * unmentioned AND `{image:N}`-referenced renders ONCE (inline), never also as a
 * trailing canonical phrase. Deduped per URL (an object wired twice → one phrase).
 */
function renderObjectCreatureCanonicalHybrid(
  nonCharacterRefs: readonly ConnectedReference[],
  finalIndexByUrl: ReadonlyMap<string, number>,
  coveredUrls: ReadonlySet<string>,
): { phrases: string[]; lockLines: string[]; elementDirectives: string[] } {
  const phrases: string[] = []
  const lockLines: string[] = []
  const elementDirectives: string[] = []
  const seenUrls = new Set<string>()
  for (const r of nonCharacterRefs) {
    if (r.source !== "wired-object" && r.source !== "wired-creature") continue
    if (!r.url || seenUrls.has(r.url) || coveredUrls.has(r.url)) continue
    const slot = finalIndexByUrl.get(r.url)
    if (!slot) continue
    seenUrls.add(r.url)
    const binding = `reference image ${slotToLetter(slot)}`
    phrases.push(roleToPhrase(defaultRoleForSource(r.source), binding))
    const lock = buildIdentityLockLine(r, binding)
    if (lock) lockLines.push(lock)
    const inject = r.elementInjection?.trim()
    if (inject) elementDirectives.push(inject)
  }
  return { phrases, lockLines, elementDirectives }
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
  /**
   * Number of LEADING reference images (e.g. plain image-refs that precede the
   * asset URLs in the unified `@image_N` numbering — see
   * `resolveVideoReferenceCore`'s `leadingRefUrls`). `urls` here are the ASSET
   * URLs only; their prompt ordinals are `ordinalOffset + 1 …`, so the renumber
   * remap is keyed by the offset ordinal and leading ordinals (`1 … offset`)
   * pass through untouched. Defaults to 0 → behaviour unchanged.
   */
  ordinalOffset = 0,
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
    ordinalOffset,
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
  ordinalOffset = 0,
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
  // Build orig-1based-pos → new-1based-pos map for prompt renumbering. Offset by
  // `ordinalOffset` so when `urls` are the ASSET tail of a unified list (leading
  // image-refs occupy `1 … ordinalOffset`), the asset ordinals `ordinalOffset+1 …`
  // remap among themselves and the leading ordinals are never matched (their keys
  // aren't in `remap`, so the regex leaves them untouched).
  const remap = new Map<number, number>()
  for (let newPos = 0; newPos < newOrderIndices.length; newPos++) {
    remap.set(ordinalOffset + newOrderIndices[newPos] + 1, ordinalOffset + newPos + 1)
  }
  // Replace every positional ordinal (1-3 digit, word-boundary) substring,
  // preserving its prefix: image prompts use `Image N`, video prompts use the
  // `@image_N` binding form (REF_BINDING.ordinal). The alternation is
  // case-exact (no `i` flag) so each form re-emits with the SAME prefix.
  // Negative lookahead on digits guards against `Image 12` → `Image 32` when
  // remapping 1 → 3. The lookbehind prevents catching `XImage 1` / `foo@image_1`.
  const renumbered = prompt.replace(/(?<![A-Za-z])(@image_|Image )(\d{1,3})(?!\d)/g, (whole, prefix, n) => {
    const orig = parseInt(n, 10)
    const next = remap.get(orig)
    if (next === undefined || next === orig) return whole
    return `${prefix}${next}`
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
   * Reference-prompt assembly format for the `{image:N:label}` connected-
   * reference (non-character) path. Additive + opt-in:
   *   - "legacy" (default): the "Use these references:/Compose them naturally:"
   *     wrap with numeric `Image N` directives — unchanged behavior.
   *   - "hybrid": token expansion only — every `{image:N:label}` token → "the
   *     <label> from reference image <LETTER>". NO lock snippet is auto-injected
   *     (authors prepend their own). Images-only for now; characters/objects/
   *     locations still render legacy. v1 skips `referenceOrder` renumbering.
   */
  referenceFormat?: "legacy" | "hybrid"
  /**
   * OPTIONAL reference-lock snippet to prepend ahead of the hybrid scene. Only
   * used when `referenceFormat === "hybrid"`. Nothing is prepended by default —
   * authors include their own lock snippet in the prompt text. Provide this only
   * if a caller wants to auto-prepend a lock.
   */
  referenceLockSnippet?: string
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
   * Location slugs (or DB ids) whose canonical-fallback the user has hidden
   * via the × button. Mirrors `suppressedCanonicalCharacterIds`: the upstream
   * `wired-location` ref still attaches, but the canonical establishing-shot
   * URL is dropped from the injected reference list.
   *
   * NOTE (Phase 1A): the location canonical-fallback path is wired up in a
   * follow-up PR (`injected-reference-helpers.ts`). Until then, this
   * parameter is accepted but inert — callers can pass it through without
   * any behavior change. Once the canonical-fallback logic lands, the
   * builder will filter `connectedReferences` with `source === "wired-location"`
   * and a matching slug, exactly like the character path does.
   */
  suppressedCanonicalLocationIds?: readonly string[]
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

export type PromptSegmentOrigin =
  | "user"      // typed by the user
  | "variable"  // resolved {Node Label} value
  | "picker"    // parameter-picker / cinematography fragment
  | "mention"   // identity/reference directive block
  | "style"     // auto-appended Style suffix
  | "negative"  // auto-appended Avoid suffix

export interface PromptSegment {
  readonly text: string
  readonly origin: PromptSegmentOrigin
}

export interface BuildImagePromptSegmentsResult extends BuildImagePromptResult {
  /** Origin-tagged decomposition of `prompt`. INVARIANT (tested):
   *  segments.map(s => s.text).join("") === prompt. */
  segments: PromptSegment[]
}

/**
 * Internal capture surface for `buildImagePromptSegments`. `buildImagePrompt`
 * itself never passes this — its output is byte-identical with or without it.
 * Each field records a span produced during final assembly so the segment
 * decomposition can be reconstructed without re-deriving the string:
 *   - `directivesPrefix`: the directive block PREPENDED ahead of the user body
 *     (connectedReferences path, "Use these references…/Compose them…" wrap).
 *     Empty when the directive block was spliced mid-string into a Phase-0
 *     "Use these characters:" block (documented degradation → body collapses).
 *   - `bodyBeforeSuffixes`: the prompt string captured immediately BEFORE the
 *     style/avoid suffixes were appended (covers the common no-truncation case).
 *   - `styleSuffix` / `avoidSuffix`: the `\nStyle: …` / `\nAvoid: …` strings.
 */
interface AssemblyMarks {
  directivesPrefix: string
  bodyBeforeSuffixes: string
  styleSuffix: string
  avoidSuffix: string
}

/** Keep `bodySegments` when the assembled body still equals their join;
 *  otherwise collapse to one `user` segment (assembly rewrote the body —
 *  mention replacement, {image:N} expansion, truncation, or reorder). */
function reconcileBodySegments(body: string, bodySegments: readonly PromptSegment[] | undefined): PromptSegment[] {
  if (!body) return []
  if (bodySegments && bodySegments.map((s) => s.text).join("") === body) {
    return [...bodySegments]
  }
  return [{ text: body, origin: "user" }]
}

/**
 * Build the final image generation prompt from config.
 * Handles character description wrapping, style appending, negative prompt routing,
 * truncation, and reference image filtering.
 *
 * Thin passthrough over `buildImagePromptInternal` — byte-identical behavior,
 * no marks captured. Use `buildImagePromptSegments` when you also need the
 * origin-tagged decomposition.
 */
export function buildImagePrompt(config: BuildImagePromptConfig): BuildImagePromptResult {
  return buildImagePromptInternal(config)
}

/**
 * Shared assembly body for `buildImagePrompt` + `buildImagePromptSegments`.
 * When `marks` is provided, records the directive-prefix / body / suffix spans
 * (guarded by `if (marks)`) so callers can reconstruct an origin-tagged
 * decomposition. The string output is identical regardless of `marks`.
 */
function buildImagePromptInternal(config: BuildImagePromptConfig, marks?: AssemblyMarks): BuildImagePromptResult {
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
  const suppressedCanonicalLocationIds = config.suppressedCanonicalLocationIds ?? []
  // `referenceFormat` is preserved across the Phase-0 `config = {...config}`
  // reassignment, so computing this once up front is stable. Gates the hybrid
  // character convergence (Phase 0) and the non-capitalizing scene render below.
  const isHybrid = config.referenceFormat === "hybrid"
  // Set when Phase 0 converged character OR location @-mentions into inline
  // hybrid role phrases (+ identity-lock + element directives). Tells the hybrid
  // scene render to expand any remaining {image:N} tokens WITHOUT capitalizing
  // line-initials (which would corrupt "the face from reference image A" → "The
  // face …" / "the style from reference image A" → "The style …").
  let hybridBodyConverged = false

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

  // Cap structured references to the provider's image-reference limit — the SAME
  // cap the canvas enforces via handle-limits. Applied UP FRONT (like the
  // suppression filter above) so the direct API / MCP / SDK path can't send more
  // references than the provider accepts and leave an `Image N` directive
  // pointing at a slot the provider silently drops. Flat `referenceImageUrls` are
  // numbered first, so they consume the budget. Only ref-capable providers
  // (refCap > 0) cap here; non-ref providers drop all URLs via `supportsRefs`.
  if (connectedReferences && connectedReferences.length > 0) {
    const refCap = imageReferenceLimit(provider)
    if (refCap > 0) {
      const structuredBudget = Math.max(0, refCap - referenceImageUrls.length)
      if (connectedReferences.length > structuredBudget) {
        connectedReferences = connectedReferences.slice(0, structuredBudget)
      }
    }
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
    // Known location slugs (Phase 2 #2) — separate from character slugs.
    // Each location row contributes a canonical entry + per-variant entries,
    // all sharing the same `locationSlug`; we want the unique set for finder.
    const knownLocationSlugs = Array.from(
      new Set(
        connectedReferences
          .map((r) => r.locationSlug)
          .filter((s): s is string => typeof s === "string" && s.length > 0)
      )
    )
    if (knownCharacterSlugs.length > 0 || hasExtraRefs || knownLocationSlugs.length > 0) {
      const mentionTokens = knownCharacterSlugs.length > 0
        ? findCharacterMentionTokens(config.prompt, knownCharacterSlugs)
        : []
      // Character @-mention resolution. HYBRID (Unified Reference Roles,
      // Phase A): each mention becomes the inline role phrase "the {role} from
      // reference image {LETTER}" with the optional identity-lock + wired
      // elementInjection surfaced SEPARATELY, and NO "Use these characters:"
      // block. LEGACY keeps the bullet block (and is shared verbatim with the
      // video resolver — untouched here).
      let hybridLockLines: string[] = []
      let hybridElementDirectives: string[] = []
      let resolved: ResolveCharacterMentionsResult
      if (isHybrid && mentionTokens.length > 0) {
        const h = resolveCharacterMentionsHybrid(
          config.prompt,
          mentionTokens,
          connectedReferences,
          referenceImageUrls,
        )
        resolved = {
          prompt: h.prompt,
          additionalUrls: h.additionalUrls,
          mentionedCharacterSlugs: h.mentionedCharacterSlugs,
        }
        hybridLockLines = h.lockLines
        hybridElementDirectives = h.elementDirectives
        hybridBodyConverged = true
      } else {
        resolved = mentionTokens.length > 0
          ? resolveCharacterMentions(config.prompt, mentionTokens, connectedReferences)
          : { prompt: config.prompt, additionalUrls: [], mentionedCharacterSlugs: new Set<string>() }
      }

      // Phase 2 #2: resolve `@oldlibrary:1:weather/rain` location mentions on
      // the post-character-resolution prompt. Character resolution may have
      // already swapped its own @-tokens for display names; location tokens
      // (different slug namespace) remain intact for this pass.
      const locationTokens = knownLocationSlugs.length > 0
        ? findLocationMentionTokens(resolved.prompt, knownLocationSlugs)
        : []
      // Location mention convergence. HYBRID (Unified Reference Roles, Phase C):
      // each `@location` mention becomes the inline role phrase "the {role} from
      // reference image {LETTER}" (role from the location node's usage mode) with
      // the opt-in lock + wired elementInjection surfaced SEPARATELY, and NO "Use
      // these locations:" block. LEGACY keeps the bullet block. `existingUrls` =
      // [base refs, resolved CHARACTER mentions] so location slot letters are a
      // prefix of the final `finalIndexByUrl` (location URLs merge after character
      // mentions, before the character canonical/extra URLs).
      let hybridLocationLockLines: string[] = []
      let hybridLocationElementDirectives: string[] = []
      let locationResolved: ResolveLocationMentionsResult
      if (isHybrid && locationTokens.length > 0) {
        const hl = resolveLocationMentionsHybrid(
          resolved.prompt,
          locationTokens,
          connectedReferences,
          [...(referenceImageUrls || []), ...resolved.additionalUrls],
        )
        locationResolved = {
          prompt: hl.prompt,
          additionalUrls: hl.additionalUrls,
          mentionedLocationSlugs: hl.mentionedLocationSlugs,
        }
        hybridLocationLockLines = hl.lockLines
        hybridLocationElementDirectives = hl.elementDirectives
        // Inline role phrases now live in the body → skip line-initial
        // capitalization. Only when a mention actually matched + was replaced.
        if (hl.additionalUrls.length > 0) hybridBodyConverged = true
      } else {
        locationResolved = locationTokens.length > 0
          ? resolveLocationMentions(resolved.prompt, locationTokens, connectedReferences)
          : { prompt: resolved.prompt, additionalUrls: [] as string[], mentionedLocationSlugs: new Set<string>() }
      }
      // Merge location's resolved prompt + URLs back into `resolved` so the
      // rest of the pipeline (fallback, extras, urlsByOrder) doesn't need
      // separate plumbing.
      resolved.prompt = locationResolved.prompt
      resolved.additionalUrls = [...resolved.additionalUrls, ...locationResolved.additionalUrls]
      // Per-variant location refs are mention-only — they were already
      // attached via `additionalUrls` when matched, and should NEVER
      // auto-attach via the non-character ref path below (line 1112).
      // Canonical refs whose slug was mentioned are also handled by the
      // resolver — drop to avoid double-attaching the canonical URL when the
      // user explicitly pinned a variant via `@-mention`.
      const mentionedLocationSlugs = locationResolved.mentionedLocationSlugs
      connectedReferences = connectedReferences.filter((r) => {
        if (r.source !== "wired-location") return true
        if (!r.locationSlug) return true
        if (r.locationVariantBucket) return false
        return !mentionedLocationSlugs.has(r.locationSlug)
      })
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
      // Canonical fallback (unmentioned wired character → auto-attached URL).
      // LEGACY emits the "Use these characters:" bullet block; HYBRID (Task 4)
      // attaches the SAME canonical URLs but renders each as an inline role
      // phrase + opt-in lock below (once the slot letters are known). Selection
      // is shared so both paths auto-attach the same characters.
      const canonicalFallbackRefs = isHybrid
        ? selectCanonicalFallbackRefs(connectedReferences, resolved.mentionedCharacterSlugs)
        : []
      const fallback = isHybrid
        ? { directiveLines: [] as string[], urls: canonicalFallbackRefs.map((r) => r.url) }
        : buildCanonicalFallback(
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
      // Extra-refs (manual uploads + picked character variants). LEGACY emits
      // "Image N" bullets in the "Use these characters:" block; HYBRID (Task 4)
      // attaches the SAME URLs but renders manual / pair-back directives with
      // lettered bindings below. Filter shared so both paths attach the same URLs.
      const extraRefsHybrid = isHybrid
        ? connectedReferences.filter((r) => r.isExtraRef === true && Boolean(r.url))
        : []
      const extras = isHybrid
        ? { directiveLines: [] as string[], urls: extraRefsHybrid.map((r) => r.url) }
        : buildExtraRefDirectives(
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

      // Hybrid assembly. Prepend ONE identity-lock block (mention + canonical
      // fallback + first-sight extra locks) and append the trailing scene
      // directives (mention element injections + canonical role phrases +
      // canonical element injections + extra-ref directives + extra-ref element
      // injections) — never the legacy "Use these characters:" block.
      if (isHybrid) {
        // Unified slot map over the final hybrid URL order
        // [base, mentions, canonical, extras] — the exact prefix of the "New
        // path" `finalIndexByUrl`, so every lettered binding agrees byte-for-byte.
        const slotByUrl = new Map<string, number>()
        finalMergedUrls.forEach((u, i) => {
          if (!slotByUrl.has(u)) slotByUrl.set(u, i + 1)
        })
        const letterForUrl = (url: string): string => slotToLetter(slotByUrl.get(url) ?? 0)

        // (A) canonical fallback → role phrases + opt-in locks.
        const canonical = renderCanonicalFallbackHybrid(canonicalFallbackRefs, letterForUrl)
        // (B) extra-refs → manual / pair-back directives + first-sight locks.
        // Seed the pair-back lookup with each character's FIRST emitted letter
        // (mention / canonical fallback), converted from its mergedUrls position.
        const seedLetterByChar = new Map<string, string>()
        for (const [slug, pos] of characterPositions) {
          seedLetterByChar.set(slug, slotToLetter(pos))
        }
        const extrasRendered = renderExtraRefsHybrid(extraRefsHybrid, letterForUrl, seedLetterByChar)

        // Role phrases are intentionally lowercase ("the person from reference
        // image A"); flag the converged state so the scene render below skips
        // line-initial capitalization (which would corrupt them).
        if (canonical.phrases.length > 0 || extrasRendered.bodyLines.length > 0) {
          hybridBodyConverged = true
        }

        // Location MENTION locks/elements (the role phrases themselves are
        // already inline in `promptForNext`). Mentioned-location URLs sit
        // between the character mentions and the character canonical/extras in
        // `finalMergedUrls`, so their letters were computed against the matching
        // prefix in `resolveLocationMentionsHybrid` and need no re-derivation here.
        // Set-dedup: a reference can be locked via more than one path (e.g. an
        // extra whose URL equals the wired canonical is routed to first-sight
        // by the pair-back letter gate) — identical lock lines say nothing new
        // to the model, so emit each exact line once. Line texts are
        // {ref}-bound, so distinct references never collapse.
        const allLockLines = [...new Set([
          ...hybridLockLines,
          ...hybridLocationLockLines,
          ...canonical.lockLines,
          ...extrasRendered.lockLines,
        ])]
        const trailingLines = [
          ...hybridElementDirectives,
          ...hybridLocationElementDirectives,
          ...canonical.phrases,
          ...canonical.elementDirectives,
          ...extrasRendered.bodyLines,
          ...extrasRendered.elementDirectives,
        ]
        const lockBlock = allLockLines.length > 0 ? `${allLockLines.join("\n")}\n\n` : ""
        const trailingBlock = trailingLines.length > 0 ? `\n${trailingLines.join("\n")}` : ""
        promptForNext = `${lockBlock}${promptForNext}${trailingBlock}`
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
  // zero URLs and zero directives here. Non-character refs (manual, wired-creature,
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

    // -----------------------------------------------------------------------
    // Single source of truth for positional numbering.
    //
    // Phase 0 already numbered the character / extra directives against the
    // order [referenceImageUrls, mentions, canonical-fallback, extras] and
    // wrote both the bullets and the URLs into `referenceImageUrls`. We APPEND
    // the non-character URLs after that list (never prepend) so those Phase-0
    // numbers stay valid, then derive EVERY non-character directive's `Image N`
    // from this one final ordered list via a `url → index` map.
    //
    // The old code prepended `nonCharacterUrls` ahead of the Phase-0 list,
    // which shifted every character/extra `Image N` by `nonCharacterUrls.length`
    // while their directive text was already baked — the root cause of the
    // off-by-(non-char-count) desync. Appending is byte-identical to the old
    // prepend whenever a non-char URL already lives in `referenceImageUrls`
    // (dedup keeps its existing slot); it only differs for the genuinely-new
    // location/object URLs that the prepend mis-slotted.
    // -----------------------------------------------------------------------
    const nonCharacterUrls = nonCharacterRefs
      .map((r) => r.url)
      .filter((u): u is string => Boolean(u))
    const assembledUrls = [...referenceImageUrls, ...nonCharacterUrls]
      .filter((u, i, a) => a.indexOf(u) === i)
    const finalIndexByUrl = new Map<string, number>()
    assembledUrls.forEach((u, i) => {
      if (!finalIndexByUrl.has(u)) finalIndexByUrl.set(u, i + 1)
    })

    // Non-character directives — `{image:N}` identities (renumbered to their
    // final slot) + the location/object canonical fallback — all numbered
    // against the unified `finalIndexByUrl`.
    const directives = buildNonCharacterDirectives(
      prompt,
      nonCharacterRefs,
      identityMeta,
      finalIndexByUrl,
      suppressedCanonicalLocationIds,
    )
    if (isHybrid) {
      // Hybrid reference format (images-only, flag-gated): TOKEN EXPANSION ONLY.
      // Every {image:N:label} token becomes "the <label> from reference image
      // <LETTER>". NO reference-lock snippet is auto-injected — authors prepend
      // their own lock (default-deny / likeness / compose / extract / ghost-
      // mannequin, per goal) in the prompt text, and it passes through here
      // untouched. A caller MAY still opt to prepend one via
      // `config.referenceLockSnippet`, but nothing is added by default.
      // Replaces the legacy "Use these references:/Compose:" wrap + numeric
      // token expansion. Objects stay legacy; CHARACTERS were already converged
      // in Phase 0 (role phrases + identity-lock + element directives), and
      // LOCATIONS converge here too — mentioned ones inline in Phase 0, the
      // unmentioned canonical ones as the trailing role phrases appended below.
      //
      // When Phase 0 converged a character OR location mention, the body is final
      // and intentionally lowercase ("the face from reference image A") — expand
      // any remaining {image:N} tokens but DON'T capitalize line-initials (which
      // would corrupt those phrases). Otherwise render the user scene as before
      // (capitalized line-initials); appended canonical phrases stay lowercase
      // because they're added AFTER this capitalizing pass.
      const scene = hybridBodyConverged
        ? prompt
            .split("\n")
            .map((line) => expandImageRefTokensHybrid(line, nonCharacterRefs, finalIndexByUrl))
            .join("\n")
        : buildHybridScene(prompt, nonCharacterRefs, finalIndexByUrl)
      // URLs already expanded inline by an `{image:N}` token in this scene.
      // Derived EXACTLY as the legacy `buildNonCharacterDirectives` derives its
      // `coveredUrls` — via `collectIdentities` (labeled `{image:N:label}`
      // tokens present in the prompt, indexing `nonCharacterRefs[N-1]`) — so the
      // hybrid and legacy notions of "token-covered" share one source of truth
      // and never drift. Threaded into both canonical renders so an unmentioned
      // wired object / creature / location that is ALSO `{image:N}`-referenced
      // renders ONCE (inline), never also as a trailing canonical phrase.
      const tokenCoveredUrls = new Set<string>()
      for (const id of collectIdentities(prompt, nonCharacterRefs, identityMeta)) {
        const coveredUrl = nonCharacterRefs[id.imageIndex - 1]?.url
        if (coveredUrl) tokenCoveredUrls.add(coveredUrl)
      }
      // Unmentioned wired-location / -object / -creature canonical convergence
      // (Phase C): each → the trailing role phrase "the {role} from reference
      // image {LETTER}" + opt-in lock + wired elementInjection, numbered against
      // `finalIndexByUrl`. Mentioned locations were converged inline in Phase 0
      // and filtered out of `nonCharacterRefs`; objects/creatures have no mention
      // path, so their only inline route is an `{image:N}` token (guarded above).
      const locCanon = renderLocationCanonicalHybrid(nonCharacterRefs, finalIndexByUrl, tokenCoveredUrls)
      const objCanon = renderObjectCreatureCanonicalHybrid(nonCharacterRefs, finalIndexByUrl, tokenCoveredUrls)
      const canonLockLines = [...locCanon.lockLines, ...objCanon.lockLines]
      const canonLockBlock = canonLockLines.length > 0 ? `${canonLockLines.join("\n")}\n\n` : ""
      const canonTrailingLines = [
        ...locCanon.phrases, ...objCanon.phrases,
        ...locCanon.elementDirectives, ...objCanon.elementDirectives,
      ]
      const canonTrailingBlock = canonTrailingLines.length > 0 ? `\n${canonTrailingLines.join("\n")}` : ""
      const composedScene = `${canonLockBlock}${scene}${canonTrailingBlock}`
      prompt = config.referenceLockSnippet
        ? `${config.referenceLockSnippet}\n${composedScene}`
        : composedScene
      // The hybrid token rewrite can't be modeled by the segment marks → the
      // join-mismatch fallback in buildImagePromptSegments collapses to a single
      // segment (documented degradation, same as the Phase-0 splice branch).
      if (marks) marks.directivesPrefix = ""
    } else if (directives) {
      // Capture the prompt state across the splice so the segment builder can
      // isolate what the directive block contributed as a PREFIX. Only the
      // prepend branch yields a clean prefix; the Phase-0 consolidation branch
      // splices mid-string (no prefix) → marks.directivesPrefix stays "" and
      // the body collapses via the join fallback (documented degradation).
      const beforeDirectives = prompt
      if (prompt.startsWith("Use these characters:\n")) {
        // Consolidate into the existing Phase-0 directive block (the same splice
        // pattern Phase 0 uses for fallback / extras) instead of wrapping it in
        // a second "Use these references…/Compose them naturally" layer.
        const splitIdx = prompt.indexOf("\n\n")
        if (splitIdx !== -1) {
          prompt = prompt.slice(0, splitIdx) + "\n" + directives + prompt.slice(splitIdx)
        } else {
          prompt = `${prompt}\n${directives}`
        }
      } else {
        // "Use these references…" header + bulleted directives + the
        // "Compose them naturally…" prefix proved most reliable in user
        // testing. Numeric indices ("Image 1") match the user-typed
        // `@character:N` slug format so the literal prompt and the final
        // identity directive are visually linked.
        prompt = prompt
          ? `Use these references for the output image:\n${directives}\n\nCompose them naturally into a single image: ${prompt}`
          : `Use these references for the output image:\n${directives}`
        // Prepend case: the new string ends with `beforeDirectives` (or is the
        // whole prefix when the body was empty). Everything before that tail is
        // the directive prefix.
        if (marks) {
          marks.directivesPrefix = prompt.slice(0, prompt.length - beforeDirectives.length)
        }
      }
    }

    const styleText = style?.trim()
    const styleSuffix = styleText ? `\nStyle: ${getStylePromptHint(styleText) || styleText}` : ""

    const negPrompt = negativePrompt?.trim()
    let nativeNegativePrompt: string | undefined
    let avoidSuffix = ""
    if (negPrompt) {
      if (NATIVE_NEGATIVE_PROMPT_MODELS.has(provider)) {
        // Clamp native negatives to the provider's verified cap (e.g. ideogram /
        // qwen = 500) so an over-long negative can't trigger a provider reject.
        nativeNegativePrompt = negPrompt.slice(0, getMaxNegativePromptChars(provider))
      } else {
        avoidSuffix = `\nAvoid: ${negPrompt}`
      }
    }
    if (marks) {
      marks.styleSuffix = styleSuffix
      marks.avoidSuffix = avoidSuffix
    }

    // Cap the assembled prompt at the PROVIDER's max (default IMAGE_PROMPT_MAX =
    // 5000, what the image routes already accept) — never the old hardcoded
    // 2000, which silently severed the appended cinematography/picker hints +
    // the `Avoid:` negative whenever the body was long. The style/avoid suffixes
    // are RESERVED first so a long body can never drop them (the control text is
    // the most important to keep). Truncate the BODY, THEN append the suffixes.
    const maxLen = getMaxImagePromptChars(provider)
    const reserved = styleSuffix.length + avoidSuffix.length
    if (prompt.length + reserved > maxLen) {
      prompt = prompt.slice(0, Math.max(0, maxLen - reserved - 3)) + "..."
    }
    // Body span = everything after the captured directive prefix, taken from the
    // possibly-truncated body so the segment join still reconstructs (empty in the
    // Phase-0 consolidation branch → collapses via the fallback, the documented
    // degradation).
    if (marks) marks.bodyBeforeSuffixes = prompt.slice(marks.directivesPrefix.length)
    prompt = prompt + styleSuffix + avoidSuffix
    // Safety clamp for a pathological native-less negative that alone overflows.
    if (prompt.length > maxLen) {
      prompt = prompt.slice(0, maxLen - 3) + "..."
    }

    // Resolve `{image:N:label}` → "Image <finalSlot> (label)". The token's N
    // indexes `nonCharacterRefs`; we rewrite it to the ref's FINAL slot so the
    // body text agrees with the directive numbering above. (The hybrid format
    // already expanded tokens to lettered role phrases in buildHybridScene.)
    if (!isHybrid) {
      prompt = expandImageRefTokensForRefs(prompt, nonCharacterRefs, finalIndexByUrl)
    }

    const supportsRefs = MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(provider)

    // Apply user-defined `referenceOrder` to the final URL list, with a
    // matching renumber of every `Image N` token in the prompt. Skipped when
    // the model doesn't support refs (refs will be dropped anyway) or when no
    // order was supplied (no-op contract).
    let finalUrls = assembledUrls
    let finalPrompt = prompt
    // v1: the hybrid format skips referenceOrder renumbering (its tokens are
    // already expanded to fixed letters). Reorder support is a follow-up.
    if (!isHybrid && supportsRefs && referenceOrder.length > 0 && assembledUrls.length > 1) {
      const reordered = applyReferenceOrder(
        assembledUrls,
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
  const styleSuffix = styleText ? `\nStyle: ${getStylePromptHint(styleText) || styleText}` : ""

  // Handle negative prompt: native support vs prompt-appended
  const negPrompt = negativePrompt?.trim()
  let nativeNegativePrompt: string | undefined
  let avoidSuffix = ""
  if (negPrompt) {
    if (NATIVE_NEGATIVE_PROMPT_MODELS.has(provider)) {
      nativeNegativePrompt = negPrompt.slice(0, getMaxNegativePromptChars(provider))
    } else {
      avoidSuffix = `\nAvoid: ${negPrompt}`
    }
  }
  if (marks) {
    marks.styleSuffix = styleSuffix
    marks.avoidSuffix = avoidSuffix
  }

  // Cap at the provider max (default IMAGE_PROMPT_MAX = 5000), reserving the
  // style/avoid suffixes so a long body never severs the appended control text
  // (was a hardcoded 2000 tail-cut that dropped the negative). Truncate the
  // BODY, THEN append the suffixes.
  const maxLen = getMaxImagePromptChars(provider)
  const reserved = styleSuffix.length + avoidSuffix.length
  if (prompt.length + reserved > maxLen) {
    prompt = prompt.slice(0, Math.max(0, maxLen - reserved - 3)) + "..."
  }
  // Legacy path has no directive prefix; the body is the char-desc-wrapped
  // (possibly-truncated) prompt right before the style/avoid suffixes.
  if (marks) marks.bodyBeforeSuffixes = prompt
  prompt = prompt + styleSuffix + avoidSuffix
  // Safety clamp for a pathological native-less negative that alone overflows.
  if (prompt.length > maxLen) {
    prompt = prompt.slice(0, maxLen - 3) + "..."
  }

  // Merge reference images: direct refs first, then ancestor fallback
  const allRefs = referenceImageUrls.length > 0 ? referenceImageUrls : ancestorRefs
  const supportsRefs = MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(provider)
  const refsToSend = supportsRefs && allRefs.length > 0 ? allRefs : undefined

  // Expand {image:N} position references in prompt (legacy: → "[reference image N]")
  prompt = expandImagePositionRefs(prompt, allRefs.length)

  return { prompt, nativeNegativePrompt, referenceImageUrls: refsToSend }
}

/**
 * `buildImagePrompt` plus an origin-tagged decomposition of the assembled
 * `prompt`. The string output (and all other fields) is byte-identical to
 * `buildImagePrompt` — the segments are derived from assembly marks recorded
 * during the same pass.
 *
 * ABSOLUTE INVARIANT (tested): `segments.map(s => s.text).join("") === prompt`.
 * Anything the marks can't model — `{image:N}` token expansion, `referenceOrder`
 * renumbering, mid-string Phase-0 directive splicing, truncation — breaks the
 * join, and we collapse to a single `user` segment rather than ship a wrong
 * decomposition. Callers pass `bodySegments` (origins user/variable/picker/…)
 * for the body text; they survive only when the assembly didn't rewrite the
 * body string.
 */
export function buildImagePromptSegments(
  config: BuildImagePromptConfig,
  bodySegments?: readonly PromptSegment[],
): BuildImagePromptSegmentsResult {
  const marks: AssemblyMarks = {
    directivesPrefix: "",
    bodyBeforeSuffixes: "",
    styleSuffix: "",
    avoidSuffix: "",
  }

  const result = buildImagePromptInternal(config, marks)

  let segments: PromptSegment[] = [
    ...(marks.directivesPrefix ? [{ text: marks.directivesPrefix, origin: "mention" as const }] : []),
    ...reconcileBodySegments(marks.bodyBeforeSuffixes, bodySegments),
    ...(marks.styleSuffix ? [{ text: marks.styleSuffix, origin: "style" as const }] : []),
    ...(marks.avoidSuffix ? [{ text: marks.avoidSuffix, origin: "negative" as const }] : []),
  ]
  // Absolute invariant: join === prompt. Any assembly step we didn't model
  // (truncation, token expansion, reorder renumbering, Phase-0 mid-string
  // splice) breaks the join — detect against the FINAL returned prompt and
  // fall back rather than ship a wrong decomposition.
  if (segments.map((s) => s.text).join("") !== result.prompt) {
    segments = result.prompt ? [{ text: result.prompt, origin: "user" }] : []
  }
  return { ...result, segments }
}

// ---------------------------------------------------------------------------
// Identity helpers (new system)
// ---------------------------------------------------------------------------

/** Sources whose default fidelity is "strict" — they carry strong identity. */
const STRICT_DEFAULT_SOURCES: ReadonlySet<ReferenceSource> = new Set([
  "wired-character",
  "wired-face",
  "wired-object",
  "wired-creature",
  "wired-location",
])

/** Matches `{image:N}` and `{image:N:label}` tokens.
 *  Group 1 = position, group 2 = optional label. */
// Label allows spaces (multi-word labels like "clothes and shoes") but never a
// newline or `}` so the match can't run away across lines / token boundaries.
const IMAGE_TOKEN_PATTERN = /\{image:(\d+)(?::([^}\n]+))?\}/gi

interface ResolvedIdentity {
  imageIndex: number
  label: string                  // empty string = bare positional ref (no role)
  fidelity: IdentityFidelity
  customText?: string
  description?: string           // from upstream connected reference
  /** `source` from the upstream ConnectedReference — used to opt the directive
   *  builder into source-aware behavior (e.g. appending location canonical
   *  description to wired-location bullets). Mirrors the character pattern
   *  where `characterCanonicalDescription` is used by the Phase 0 mention
   *  resolver, but for locations the consumer is the directive builder. */
  source?: ReferenceSource
  /** Location's canonical description, propagated from the wired-location
   *  ConnectedReference. The directive builder appends this to the bullet
   *  when source === "wired-location" AND the location's slug is NOT in
   *  `suppressedCanonicalLocationIds`. */
  locationCanonicalDescription?: string | null
  /** Slug for the location source, used by `suppressedCanonicalLocationIds`
   *  filtering. */
  locationSlug?: string
  /** Mirrors ConnectedReference.locationReferencePhotoKind — propagated so
   *  `buildIdentityDirective` can annotate the subject line. */
  locationReferencePhotoKind?: string
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
      source: ref?.source,
      locationCanonicalDescription: ref?.locationCanonicalDescription,
      locationSlug: ref?.locationSlug,
      locationReferencePhotoKind: ref?.locationReferencePhotoKind,
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

/** Labels that mean "a creature / animal subject" — the animal analog of
 *  PERSON_LABELS. A bound creature is a LIVING subject with its own identity
 *  (a specific cat, dragon, beast), so the directive locks anatomy, markings,
 *  coloration, and distinctive features instead of the person face/body
 *  phrasing — and instead of the generic prop "match exactly" verb a
 *  `wired-object` gets. */
const CREATURE_LABELS: ReadonlySet<string> = new Set([
  "creature", "animal", "pet", "beast", "monster",
])

function buildIdentityDirective(
  id: ResolvedIdentity,
  suppressedCanonicalLocationIds?: readonly string[],
): string {
  if (id.fidelity === "custom" && id.customText) {
    return `- ${id.customText}`
  }

  // Location canonical-description injection (Phase 2 #1). Mirrors the
  // character canonical-description pattern (see `characterCanonicalDescription`
  // in the Phase 0 mention resolver above). When a wired-location ref has
  // canonical text AND the user hasn't suppressed it via the × button on the
  // Injected References list, the canonical description gets folded into the
  // directive subject so the model sees "Image N (location — <canonical
  // description>)" without the user typing it. Per-ref description (from the
  // user-typed Description field on the location node) still wins when present.
  let effectiveDescription = id.description
  if (
    !effectiveDescription
    && id.source === "wired-location"
    && id.locationCanonicalDescription
    && !(id.locationSlug && suppressedCanonicalLocationIds?.includes(id.locationSlug))
  ) {
    effectiveDescription = id.locationCanonicalDescription.trim() || undefined
  }

  // Phase 2 #3: kind-tagged reference-photo annotation. When the ref carries
  // a `locationReferencePhotoKind`, fold its human-friendly label into the
  // subject's parenthetical so the model sees the photo's role inline with
  // the location name (e.g. "Image 1 (Old Library — wide-angle reference)").
  // The annotation rides on the LABEL (not the description) so it survives
  // the description-overrides-canonical precedence above.
  let effectiveLabel = id.label
  if (id.locationReferencePhotoKind && effectiveLabel) {
    effectiveLabel = `${effectiveLabel} — ${locationReferencePhotoKindLabel(id.locationReferencePhotoKind as LocationReferencePhotoKind)}`
  }

  const subject = formatDirectiveSubject(effectiveLabel, id.imageIndex, effectiveDescription)
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

  // Creature/animal labels: the same identity-lock strength as a person, with
  // animal-subject phrasing — anatomy/markings/coloration are what make THIS
  // cat this cat. "loose" still opts out to the inspiration form below.
  if (CREATURE_LABELS.has(lower) && id.fidelity !== "loose") {
    return `- ${subject} — this is a creature/animal subject: match it exactly. Maintain perfect likeness (anatomy, markings, coloration, distinctive features).`
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
 * Build the non-character directive block for `buildImagePrompt`'s
 * connectedReferences path:
 *   1. `{image:N:label}` identity directives (legacy positional mentions), in
 *      prompt-mention order, renumbered from their `nonCharacterRefs` index to
 *      the ref's FINAL slot.
 *   2. Canonical-style fallback directives for `wired-location` / `wired-object`
 *      / `wired-creature` refs that are present but neither `{image:N}`-referenced
 *      nor @-mentioned (@-mentioned locations were already filtered out of
 *      connectedReferences in Phase 0). Mirrors the character canonical fallback
 *      so a wired setting / object / creature gets a directive with zero typing
 *      required. Scoped to those three sources — opaque `manual` / `wired-image`
 *      uploads carry no metadata to describe and keep their (intentional)
 *      directive-free behavior.
 *
 * Every directive's `Image N` is numbered against `finalIndexByUrl` (the single
 * source of truth for the assembled URL order), so the index always matches the
 * URL slot. `coveredUrls` prevents a URL emitted via a token from being
 * re-emitted by the fallback AND dedupes a location/object wired twice.
 */
function buildNonCharacterDirectives(
  prompt: string,
  nonCharacterRefs: readonly ConnectedReference[],
  identityMeta: readonly IdentityMeta[],
  finalIndexByUrl: ReadonlyMap<string, number>,
  suppressedCanonicalLocationIds: readonly string[],
): string {
  const lines: string[] = []
  const coveredUrls = new Set<string>()

  for (const id of collectIdentities(prompt, nonCharacterRefs, identityMeta)) {
    const ref = nonCharacterRefs[id.imageIndex - 1]
    const finalIdx = ref?.url ? finalIndexByUrl.get(ref.url) : undefined
    const line = buildIdentityDirective(
      finalIdx ? { ...id, imageIndex: finalIdx } : id,
      suppressedCanonicalLocationIds,
    )
    if (line.length > 0) lines.push(line)
    if (ref?.url) coveredUrls.add(ref.url)
  }

  for (const ref of nonCharacterRefs) {
    if (ref.source !== "wired-location" && ref.source !== "wired-object" && ref.source !== "wired-creature") continue
    if (!ref.url || coveredUrls.has(ref.url)) continue
    const finalIdx = finalIndexByUrl.get(ref.url)
    if (!finalIdx) continue
    coveredUrls.add(ref.url)
    const line = buildIdentityDirective(
      {
        imageIndex: finalIdx,
        // A background label routes wired-location through the
        // "use as the background/setting" verb (and folds
        // locationCanonicalDescription); wired-creature routes through the
        // creature/animal-subject identity lock (CREATURE_LABELS);
        // wired-object falls through to the strict "match exactly" verb.
        label: ref.source === "wired-location"
          ? "location"
          : ref.source === "wired-creature"
            ? "creature"
            : "object",
        fidelity: defaultFidelityForSource(ref.source),
        description: ref.description?.trim() || undefined,
        source: ref.source,
        locationCanonicalDescription: ref.locationCanonicalDescription,
        locationSlug: ref.locationSlug,
        locationReferencePhotoKind: ref.locationReferencePhotoKind,
      },
      suppressedCanonicalLocationIds,
    )
    if (line.length > 0) lines.push(line)
  }

  return lines.join("\n")
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

/**
 * Like `expandImageRefTokens`, but remaps each `{image:N}` token from its index
 * in `refs` (the non-character ref list the token was authored against) to the
 * ref's FINAL 1-based slot in the assembled URL list. Used by
 * `buildImagePrompt`'s connectedReferences path so body-text `Image N` markers
 * agree with the directive numbering after non-character URLs are appended.
 *
 * When the final slot equals the token index (no Phase-0 prefix shifting the
 * positions), the output is byte-identical to `expandImageRefTokens`.
 * Out-of-range tokens (or refs without a URL) are left untouched, matching the
 * "visible so the author can fix it" contract.
 */
function expandImageRefTokensForRefs(
  prompt: string,
  refs: readonly ConnectedReference[],
  finalIndexByUrl: ReadonlyMap<string, number>,
): string {
  return prompt.replace(IMAGE_TOKEN_PATTERN, (match, num, label) => {
    const n = parseInt(num, 10)
    const ref = refs[n - 1]
    const finalIdx = ref?.url ? finalIndexByUrl.get(ref.url) : undefined
    if (!finalIdx) return match
    return label ? `Image ${finalIdx} (${label})` : `Image ${finalIdx}`
  })
}

// ---------------------------------------------------------------------------
// Hybrid reference format (images-only, flag-gated via
// `BuildImagePromptConfig.referenceFormat === "hybrid"`). TOKEN EXPANSION ONLY:
// every {image:N:label} token → "the <label> from reference image <LETTER>"
// (letters map the FINAL 1-based slot, 1→A). NO reference-lock snippet is
// auto-injected — authors prepend their own lock in the prompt text (it passes
// through untouched); a caller may optionally prepend one via
// `config.referenceLockSnippet`. Scope is the `{image:N:label}` non-character
// path — characters/objects/locations still use the legacy wrap.
// ---------------------------------------------------------------------------

/** Map a 1-based reference slot to a letter (1→A, 2→B …). Slots beyond 26 fall
 *  back to the numeric slot so we never emit a non-letter control character. */
function slotToLetter(slot: number): string {
  return slot >= 1 && slot <= 26 ? String.fromCharCode(64 + slot) : String(slot)
}

/** Hybrid inline phrase for a `{image:N:label}` token bound to a lettered slot.
 *  Uniform: "the <label> from reference image <letter>" — the label is used
 *  verbatim (the global identity directive handles subject preservation, so no
 *  per-role branching is needed). A label-less token → "reference image <letter>". */
function hybridRolePhrase(label: string, letter: string): string {
  if (!label) return `reference image ${letter}`
  return `the ${label} from reference image ${letter}`
}

/** Like `expandImageRefTokensForRefs`, but emits the hybrid lettered phrase
 *  ("the subject from reference image A") instead of the legacy "Image N
 *  (label)". Out-of-range tokens / URL-less refs are left untouched. */
function expandImageRefTokensHybrid(
  prompt: string,
  refs: readonly ConnectedReference[],
  finalIndexByUrl: ReadonlyMap<string, number>,
): string {
  return prompt.replace(IMAGE_TOKEN_PATTERN, (match, num, label) => {
    const n = parseInt(num, 10)
    const ref = refs[n - 1]
    const finalIdx = ref?.url ? finalIndexByUrl.get(ref.url) : undefined
    if (!finalIdx) return match
    return hybridRolePhrase((label ?? "").trim(), slotToLetter(finalIdx))
  })
}

/** Capitalize the first alphabetic character of a string (line-initial). */
function capitalizeLineInitial(line: string): string {
  return line.replace(/[a-zA-Z]/, (c) => c.toUpperCase())
}

/** Render the user prompt as the hybrid scene: each `{image:N:label}` token
 *  expanded to its uniform lettered phrase, each line's first letter
 *  capitalized. No per-role special-casing — the label drives the phrase. */
function buildHybridScene(
  prompt: string,
  refs: readonly ConnectedReference[],
  finalIndexByUrl: ReadonlyMap<string, number>,
): string {
  return prompt
    .split("\n")
    .map((line) => capitalizeLineInitial(expandImageRefTokensHybrid(line, refs, finalIndexByUrl)))
    .join("\n")
}

/** Build the combined per-identity directive intro for previews.
 *  Each directive is emitted on its own line so the model (and the human
 *  reading the FinalPromptPreview) can see the structure clearly. */
export function buildIdentityDirectives(
  prompt: string,
  refs: readonly ConnectedReference[],
  meta: readonly IdentityMeta[] = [],
  suppressedCanonicalLocationIds?: readonly string[],
): string {
  return collectIdentities(prompt, refs, meta)
    .map((id) => buildIdentityDirective(id, suppressedCanonicalLocationIds))
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

