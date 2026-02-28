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
