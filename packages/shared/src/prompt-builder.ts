/**
 * Image prompt assembly logic shared between frontend and backend.
 * Handles character description expansion, style appending, negative prompt routing,
 * 2000-char truncation, and reference image filtering by model support.
 */

import { resolveTemplate, applyTemplate } from "./prompt-templates.js"
import { NATIVE_NEGATIVE_PROMPT_MODELS, MODELS_WITH_REFERENCE_IMAGE_SUPPORT } from "./model-constants.js"
import { getStylePromptHint } from "./style.js"
import { findCharacterMentionTokens, type CharacterMentionTokenInfo } from "./character-mention-slug.js"
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
  const charactersSeen = new Set<string>()
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

    const isFirstMention = !charactersSeen.has(t.characterSlug)
    charactersSeen.add(t.characterSlug)

    const displayName = bySlug.get(t.characterSlug)?.defaultName ?? t.characterSlug
    replacements.push({ token: t.token, offset: t.offset, replacement: displayName })

    if (isFirstMention) {
      // Strengthened character directive — folds identity-preservation
      // language directly into the bullet so the model holds face / body /
      // distinctive features. Replaces the redundant global trailing
      // identity-lock clause we used to append from `collectIdentityLockClause`.
      // The leading `Image N (Name)` numeric index comes straight from the
      // user-typed token so the literal slug `@kira:1:smile` and the final
      // identity directive `Image 1 (Kira)` line up.
      const subject = `Image ${t.imageIndex} (${displayName})`
      const descPart = match.characterCanonicalDescription
        ? `${subject} — ${match.characterCanonicalDescription.trim()}`
        : subject
      directiveLines.push(`- ${descPart}. Match exactly. Maintain perfect likeness (face, body proportions, distinctive features).`)
    }
    if (t.variantSlug && match.variantDescription) {
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
 */
function buildCanonicalFallback(
  refs: readonly ConnectedReference[],
  mentionedSlugs: ReadonlySet<string>,
): { directiveLines: string[]; urls: string[] } {
  const directiveLines: string[] = []
  const urls: string[] = []
  const seenSlugs = new Set<string>()
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
    // Unmentioned canonical falls outside the user-typed prompt, so it has
    // no `imageIndex` from the user. The wired-character canonical is a
    // background hint, so we emit a strong directive (matching the legacy
    // identity-lock clause strength) without a numeric index in front —
    // numeric indices are reserved for explicit user-typed mentions.
    const descPart = r.characterCanonicalDescription
      ? `${displayName} — ${r.characterCanonicalDescription.trim()}`
      : displayName
    directiveLines.push(`- ${descPart}. Match exactly. Maintain perfect likeness (face, body proportions, distinctive features).`)
  }
  return { directiveLines, urls }
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
    if (knownCharacterSlugs.length > 0) {
      const mentionTokens = findCharacterMentionTokens(config.prompt, knownCharacterSlugs)
      const resolved = mentionTokens.length > 0
        ? resolveCharacterMentions(config.prompt, mentionTokens, connectedReferences)
        : { prompt: config.prompt, additionalUrls: [], mentionedCharacterSlugs: new Set<string>() }
      // Default-fallback canonical URLs + directives for any wired character
      // that has zero mentions in the prompt. Mirrors the legacy behavior the
      // mention feature replaced — wire a character with no typing required.
      const fallback = buildCanonicalFallback(
        connectedReferences,
        resolved.mentionedCharacterSlugs,
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
      // Mutate the config locals (NOT the original passed config).
      config = {
        ...config,
        prompt: promptForNext,
        referenceImageUrls: mergedUrls,
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
    // "Use these characters…" directive block.
    const nonCharacterRefs = connectedReferences.filter(
      (r) => r.source !== "wired-character",
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
    const refsToSend = supportsRefs && orderedUrls.length > 0 ? orderedUrls : undefined

    return { prompt, nativeNegativePrompt, referenceImageUrls: refsToSend }
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

