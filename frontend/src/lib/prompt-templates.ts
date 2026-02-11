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
      "Create a professional close-up face portrait headshot of the person in the reference image. Looking directly at camera, sharp focus on facial features, clean background, studio lighting, high resolution. Maintain exact facial identity and features.",
    variables: [],
  },
  "generate-image-wrapper": {
    label: "Generate Image Wrapper",
    description:
      "How the final prompt is assembled. {userPrompt} is what the user typed, {assetDescriptions} is the combined asset texts.",
    template: "{userPrompt}\n{assetDescriptions}",
    variables: ["userPrompt", "assetDescriptions"],
  },
}

export const ASSET_DESCRIPTION_KEYS = [
  "character-description",
  "object-description",
  "location-description",
  "face-description",
  "generate-image-wrapper",
] as const

export const ASSET_GENERATION_KEYS = [
  "character-generation",
  "object-generation",
  "location-generation",
  "face-generation",
] as const

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
    flowTemplates?.[key] ??
    userTemplates?.[key] ??
    SYSTEM_PROMPT_TEMPLATES[key]?.template ??
    ""
  )
}
