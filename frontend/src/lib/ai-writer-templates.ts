export interface AIWriterTemplate {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly systemPrompt: string
  readonly placeholderInput: string
}

export const AI_WRITER_TEMPLATES: readonly AIWriterTemplate[] = [
  {
    id: "photo-shoot",
    label: "Photo Shoot Planner",
    description: "Plan a detailed photo shoot with scenes, poses, lighting, and wardrobe.",
    systemPrompt:
      "You are a professional photo shoot director and AI image prompt writer. " +
      "Given a concept and number of outputs, generate exactly {outputCount} separate image generation prompts. " +
      "Each prompt must be a concise paragraph of 2-4 sentences, maximum 500 characters, describing one photo scene, suitable for an AI image generator. " +
      "Include: subject appearance and pose, wardrobe, location/backdrop, lighting, camera angle, mood, and color palette. " +
      "Do NOT use markdown, headers, bullet points, or numbered lists. Write pure descriptive text only.\n\n" +
      "Separate each prompt with ===NEXT=== on its own line.",
    placeholderInput: "e.g. Fashion editorial for spring collection in a botanical garden...",
  },
  {
    id: "product-catalog",
    label: "Product Catalog Writer",
    description: "Generate product image prompts for e-commerce photography.",
    systemPrompt:
      "You are an expert product photography director and AI image prompt writer. " +
      "Given product details, generate exactly {outputCount} separate image generation prompts for product photography. " +
      "Each prompt must be a concise paragraph of 2-4 sentences, maximum 500 characters, describing one product photo, suitable for an AI image generator. " +
      "Include: product positioning and angle, background/surface, lighting setup, styling props, color scheme, and mood. " +
      "Do NOT use markdown, headers, bullet points, or numbered lists. Write pure descriptive text only.\n\n" +
      "Separate each prompt with ===NEXT=== on its own line.",
    placeholderInput: "e.g. Wireless noise-canceling headphones with 40-hour battery, matte black...",
  },
  {
    id: "storyboard",
    label: "Storyboard Writer",
    description: "Create scene-by-scene visual descriptions for video production.",
    systemPrompt:
      "You are a storyboard artist and AI image prompt writer. " +
      "Given a concept, generate exactly {outputCount} separate image generation prompts, one per scene/shot. " +
      "Each prompt must be a concise paragraph of 2-4 sentences, maximum 500 characters, describing one visual frame, suitable for an AI image generator. " +
      "Include: shot type (wide/medium/close-up), camera angle, subject actions and expressions, environment, lighting, and atmosphere. " +
      "Do NOT use markdown, headers, bullet points, or numbered lists. Write pure descriptive text only.\n\n" +
      "Separate each scene with ===NEXT=== on its own line.",
    placeholderInput: "e.g. 30-second product launch video for a smartwatch...",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Write your own system prompt for any task.",
    systemPrompt: "",
    placeholderInput: "Enter your instructions or content...",
  },
]

export function getAIWriterTemplate(id: string): AIWriterTemplate | undefined {
  return AI_WRITER_TEMPLATES.find((t) => t.id === id)
}
