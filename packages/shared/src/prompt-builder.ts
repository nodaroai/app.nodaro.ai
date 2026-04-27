/**
 * Image prompt assembly logic shared between frontend and backend.
 * Handles character description expansion, style appending, negative prompt routing,
 * 2000-char truncation, and reference image filtering by model support.
 */

import { resolveTemplate, applyTemplate } from "./prompt-templates.js"
import { NATIVE_NEGATIVE_PROMPT_MODELS, MODELS_WITH_REFERENCE_IMAGE_SUPPORT } from "./model-constants.js"
import { getStylePromptHint } from "./style.js"
import type {
  CharacterDef,
  ConnectedReference,
  IdentityFidelity,
  IdentityMeta,
  ReferenceSource,
  SceneData,
} from "./types.js"

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
  const {
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
  // New path: rich `connectedReferences` provided. Per-identity directives
  // are emitted at the top, `{image:N:label}` tokens expand to natural-
  // language phrases, and URLs are sent in connectedReferences order.
  // -------------------------------------------------------------------------
  if (connectedReferences) {
    let prompt = config.prompt

    // Identities = (used in prompt) ∪ (default label for refs with no mentions).
    const identities = collectIdentities(prompt, connectedReferences, identityMeta)

    const directives = identities
      .map((id) => buildIdentityDirective(id))
      .filter((s) => s.length > 0)
      .join("\n")
    if (directives) {
      // "Use these references…" header + bulleted directives + the
      // "Compose them naturally…" prefix proved most reliable in user
      // testing. Letters (Image A/B/…) outperform digits for the model.
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
    prompt = expandImageRefTokens(prompt, connectedReferences.length)

    const supportsRefs = MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(provider)
    const orderedUrls = connectedReferences.map((r) => r.url).filter((u): u is string => Boolean(u))
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
 * Convert 1-based position to a letter identifier (A, B, ..., Z, AA, AB, ...).
 * Letter naming consistently outperformed digit naming in user testing for
 * multi-reference compositions — the model parses "Image A" / "Image B" as
 * distinct identifiers more reliably than "image 1" / "image 2".
 */
function indexToLetter(n: number): string {
  if (n < 1) return String(n)
  let s = ""
  let m = n
  while (m > 0) {
    const rem = (m - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    m = Math.floor((m - 1) / 26)
  }
  return s
}

/**
 * Subject form for directive bullets: parenthetical label after the image
 * letter so the model sees both the position binding and the role descriptor
 * in one tight phrase. Matches Google's "Image A (ceramic mug)" pattern and
 * the variant that user testing landed on as most reliable.
 *
 *  "dragon" + 1                       → "Image A (dragon)"
 *  "Danny"  + 2                       → "Image B (Danny)"
 *  "dragon" + 1 + desc "red scales"   → "Image A (dragon — red scales)"
 *  no label + 3                       → "Image C"
 */
function formatDirectiveSubject(label: string, imageIndex: number, description?: string): string {
  const letter = indexToLetter(imageIndex)
  if (!label && !description) return `Image ${letter}`
  const inner = label && description
    ? `${label} — ${description}`
    : (label || description)!
  return `Image ${letter} (${inner})`
}

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
 * phrases bound to a letter-named image (Image A / B / C …).
 *
 * - `{image:N:label}`  → `Image {Letter} ({label})`
 * - `{image:N}`        → `Image {Letter}` (no role specified)
 *
 * Same parenthetical form as the directive subject so the model sees a
 * consistent identifier in both the bulleted list and the scene description.
 *
 * Out-of-range indices are left untouched so they're visible in the output.
 */
export function expandImageRefTokens(prompt: string, imageCount: number): string {
  return prompt.replace(IMAGE_TOKEN_PATTERN, (match, num, label) => {
    const n = parseInt(num, 10)
    if (n < 1 || n > imageCount) return match
    const letter = indexToLetter(n)
    return label ? `Image ${letter} (${label})` : `Image ${letter}`
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
    const letter = indexToLetter(n)
    if (label) return `Image ${letter} (${label})`
    if (names && names[n - 1]) return names[n - 1]
    return `Image ${letter}`
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

