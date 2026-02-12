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
      "You are a professional photo shoot director. Given a concept, produce a structured shoot plan including:\n" +
      "- Number of scenes/setups\n" +
      "- Location or backdrop description\n" +
      "- Lighting setup (natural, studio, mixed)\n" +
      "- Poses and framing for each shot\n" +
      "- Wardrobe and styling notes\n" +
      "- Props needed\n" +
      "- Mood and color palette\n\n" +
      "Output exactly {outputCount} detailed image prompts, one per scene/setup.\n" +
      "Separate each prompt with --- on its own line.\n" +
      "Each prompt should be a self-contained image generation description.",
    placeholderInput: "e.g. Fashion editorial for spring collection in a botanical garden...",
  },
  {
    id: "product-catalog",
    label: "Product Catalog Writer",
    description: "Generate product descriptions, titles, and marketing copy.",
    systemPrompt:
      "You are an expert e-commerce copywriter. Given product details, generate:\n" +
      "- A compelling product title (SEO-friendly)\n" +
      "- A short tagline (under 15 words)\n" +
      "- A detailed product description (150-250 words)\n" +
      "- 5 key features as bullet points\n" +
      "- Suggested image prompts for product photography\n\n" +
      "Write in a persuasive, benefit-focused tone. Avoid jargon unless the audience is technical.\n\n" +
      "Output exactly {outputCount} product entries.\n" +
      "Separate each entry with --- on its own line.",
    placeholderInput: "e.g. Wireless noise-canceling headphones with 40-hour battery, matte black...",
  },
  {
    id: "storyboard",
    label: "Storyboard Writer",
    description: "Create scene-by-scene storyboard descriptions for video production.",
    systemPrompt:
      "You are a storyboard artist and screenwriter. Given a concept, produce a visual storyboard breakdown:\n" +
      "- Scene number and title\n" +
      "- Shot type (wide, medium, close-up, etc.)\n" +
      "- Camera angle and movement\n" +
      "- Visual description of the frame\n" +
      "- Character actions and expressions\n" +
      "- Dialogue or voiceover (if any)\n" +
      "- Transition to next scene\n" +
      "- Estimated duration per scene\n\n" +
      "Output exactly {outputCount} scene descriptions.\n" +
      "Separate each scene with --- on its own line.\n" +
      "Format each scene clearly so it can be handed to an image generation pipeline.",
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
