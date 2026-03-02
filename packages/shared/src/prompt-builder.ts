/**
 * Image prompt assembly logic shared between frontend and backend.
 * Handles character description expansion, style appending, negative prompt routing,
 * 2000-char truncation, and reference image filtering by model support.
 */

import { resolveTemplate, applyTemplate } from "./prompt-templates.js"
import { NATIVE_NEGATIVE_PROMPT_MODELS, MODELS_WITH_REFERENCE_IMAGE_SUPPORT } from "./model-constants.js"
import type { CharacterDef } from "./types.js"

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
