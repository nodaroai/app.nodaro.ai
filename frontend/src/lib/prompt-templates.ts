// Core template functions — re-exported from shared package (single source of truth)
export { applyTemplate } from "@nodaro-shared/prompt-templates"
import { resolveTemplate as sharedResolveTemplate } from "@nodaro-shared/prompt-templates"

export interface PromptTemplateInfo {
  readonly label: string
  readonly template: string
  readonly variables: readonly string[]
  readonly description: string
}

export const SYSTEM_PROMPT_TEMPLATES: Record<string, PromptTemplateInfo> = {
  "character-description": {
    label: "Character Description",
    description:
      "Text appended to prompt when a Character asset is connected to Generate Image",
    template: "Include character '{name}': {description}.",
    variables: ["name", "description"],
  },
  "object-description": {
    label: "Object Description",
    description:
      "Text appended to prompt when an Object asset is connected to Generate Image",
    template: "Include object '{name}': {description}.",
    variables: ["name", "description"],
  },
  "location-description": {
    label: "Location Description",
    description:
      "Text appended to prompt when a Location asset is connected to Generate Image",
    template: "Include location '{name}': {description}.",
    variables: ["name", "description"],
  },
  "face-description": {
    label: "Face Description",
    description:
      "Text appended to prompt when a Face asset is connected to Generate Image",
    template:
      "Include the exact face and facial features of '{name}' from the reference image. Maintain perfect likeness and facial identity.",
    variables: ["name"],
  },
  "character-generation": {
    label: "Character Generation",
    description:
      "Prompt used when generating a character image from a Character node",
    template:
      "Create a full-body character portrait: {description}. Style: {style}. Gender: {gender}. High quality, detailed, consistent lighting, neutral background.",
    variables: ["description", "style", "gender"],
  },
  "object-generation": {
    label: "Object Generation",
    description:
      "Prompt used when generating an object image from an Object node",
    template:
      "Create a product photo of: {description}. Category: {category}. Clean background, professional studio lighting, high detail.",
    variables: ["description", "category"],
  },
  "location-generation": {
    label: "Location Generation",
    description:
      "Prompt used when generating a location image from a Location node",
    template:
      "Create a cinematic scene of: {description}. Category: {category}. Atmospheric lighting, high detail, wide angle.",
    variables: ["description", "category"],
  },
  "face-generation": {
    label: "Face Generation",
    description: "Prompt used when generating a headshot from a Face node",
    template:
      "Create a professional close-up face portrait headshot: {description}. Style: {style}. Looking directly at camera, sharp focus on facial features, clean background, studio lighting, high resolution. Maintain exact facial identity and features from the reference image.",
    variables: ["description", "style"],
  },
  "generate-image-wrapper": {
    label: "Generate Image Wrapper",
    description:
      "How the final prompt is assembled. {userPrompt} is what the user typed, {assetDescriptions} is the combined asset texts.",
    template: "{userPrompt}\n{assetDescriptions}",
    variables: ["userPrompt", "assetDescriptions"],
  },
}

export interface TemplateGroup {
  readonly name: string
  readonly descriptionKey: string
  readonly generationKey: string
}

export const TEMPLATE_GROUPS: readonly TemplateGroup[] = [
  { name: "Character", descriptionKey: "character-description", generationKey: "character-generation" },
  { name: "Object", descriptionKey: "object-description", generationKey: "object-generation" },
  { name: "Location", descriptionKey: "location-description", generationKey: "location-generation" },
  { name: "Face", descriptionKey: "face-description", generationKey: "face-generation" },
]

export const WRAPPER_TEMPLATE_KEY = "generate-image-wrapper"

/**
 * Resolve a template by key. Falls back through: flowTemplates → userTemplates →
 * SYSTEM_PROMPT_TEMPLATES (includes frontend-only generation templates).
 */
export function resolveTemplate(
  key: string,
  userTemplates?: Record<string, string>,
  flowTemplates?: Record<string, string>,
): string {
  // Try shared defaults first (covers the common description + wrapper templates)
  const shared = sharedResolveTemplate(key, userTemplates, flowTemplates)
  if (shared) return shared
  // Fall back to frontend-only templates (generation templates)
  return SYSTEM_PROMPT_TEMPLATES[key]?.template ?? ""
}
