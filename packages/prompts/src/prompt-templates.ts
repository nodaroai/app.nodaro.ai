/**
 * Default prompt templates and template resolution/application functions.
 * Shared between frontend and backend.
 */

export const DEFAULT_TEMPLATES: Record<string, string> = {
  "character-description": "Include character '{name}': {description}.",
  "object-description": "Include object '{name}': {description}.",
  "location-description": "Include location '{name}': {description}.",
  "face-description":
    "Include the exact face and facial features of '{name}' from the reference image. Maintain perfect likeness and facial identity.",
  // `-generation` templates drive standalone entity generation routes
  // (`/v1/generate-character`, `/v1/generate-face`, etc.). Duplicated between
  // frontend and backend historically; consolidated here so the backend DAG
  // orchestrator produces the same prompt as a single-node HTTP call.
  "character-generation":
    "Create a full-body character portrait: {description}. Style: {style}. Gender: {gender}. High quality, detailed, consistent lighting, neutral background.",
  "object-generation":
    "Create a product photo of: {description}. Category: {category}. Clean background, professional studio lighting, high detail.",
  "location-generation":
    "Create a cinematic scene of: {description}. Category: {category}. Atmospheric lighting, high detail, wide angle.",
  "face-generation":
    "Create a professional close-up face portrait headshot: {description}. Style: {style}. Looking directly at camera, sharp focus on facial features, clean background, studio lighting, high resolution. Maintain exact facial identity and features from the reference image.",
  "generate-image-wrapper": "{userPrompt}\n{assetDescriptions}",
}

/**
 * Resolve a template by key, checking flow-level overrides, then user overrides,
 * then the system defaults.
 */
export function resolveTemplate(
  key: string,
  userTemplates?: Record<string, string>,
  flowTemplates?: Record<string, string>,
): string {
  return flowTemplates?.[key] ?? userTemplates?.[key] ?? DEFAULT_TEMPLATES[key] ?? ""
}

/**
 * Replace `{varName}` placeholders in a template string with values from vars.
 */
export function applyTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value || ""),
    template,
  )
}
