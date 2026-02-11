export const SYSTEM_PROMPT_TEMPLATES: Record<string, string> = {
  "character-description": "Include character '{name}': {description}.",
  "object-description": "Include object '{name}': {description}.",
  "location-description": "Include location '{name}': {description}.",
  "face-description":
    "Include the exact face and facial features of '{name}' from the reference image. Maintain perfect likeness and facial identity.",
  "character-generation":
    "Create a full-body character portrait: {description}. Style: {style}. Gender: {gender}. High quality, detailed, consistent lighting, neutral background.",
  "object-generation":
    "Create a product photo of: {description}. Category: {category}. Clean background, professional studio lighting, high detail.",
  "location-generation":
    "Create a cinematic scene of: {description}. Category: {category}. Atmospheric lighting, high detail, wide angle.",
  "face-generation":
    "Create a professional close-up face portrait headshot of the person in the reference image. Looking directly at camera, sharp focus on facial features, clean background, studio lighting, high resolution. Maintain exact facial identity and features.",
  "generate-image-wrapper": "{userPrompt}\n{assetDescriptions}",
}

export function applyTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value || ""),
    template,
  )
}

export function resolveTemplate(
  key: string,
  userTemplates?: Record<string, string>,
  flowTemplates?: Record<string, string>,
): string {
  return (
    flowTemplates?.[key] ?? userTemplates?.[key] ?? SYSTEM_PROMPT_TEMPLATES[key] ?? ""
  )
}
