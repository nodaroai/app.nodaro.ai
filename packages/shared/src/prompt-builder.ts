/**
 * Image prompt assembly logic shared between frontend and backend.
 * Handles character description expansion, style appending, negative prompt routing,
 * 2000-char truncation, and reference image filtering by model support.
 */

import { resolveTemplate, applyTemplate } from "./prompt-templates.js"
import { NATIVE_NEGATIVE_PROMPT_MODELS, MODELS_WITH_REFERENCE_IMAGE_SUPPORT } from "./model-constants.js"
import type { CharacterDef, SceneData } from "./types.js"

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
  } = config

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

  // Append style
  const styleText = style?.trim()
  if (styleText) {
    prompt += `\nStyle: ${styleText}`
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

  // Expand {image:N} position references in prompt
  prompt = expandImagePositionRefs(prompt, allRefs.length)

  return { prompt, nativeNegativePrompt, referenceImageUrls: refsToSend }
}

/**
 * Replace {image:N} tokens with descriptive text.
 * e.g. {image:1} -> [reference image 1]
 */
export function expandImagePositionRefs(prompt: string, imageCount: number): string {
  return prompt.replace(/\{image:(\d+)\}/gi, (match, num) => {
    const n = parseInt(num, 10)
    if (n < 1 || n > imageCount) return match
    return `[reference image ${n}]`
  })
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

