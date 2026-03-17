/**
 * System prompt template for the Prompt Helper feature.
 * Generates optimized prompts based on node type, model, and user context.
 */

interface PromptHelperContext {
  nodeType: string
  provider?: string
  model?: string
  style?: string
  aspectRatio?: string
  duration?: number
}

const NODE_CATEGORY_MAP: Record<string, string> = {
  "generate-image": "image",
  "edit-image": "image",
  "image-to-image": "image",
  "text-to-video": "video",
  "image-to-video": "video",
  "video-to-video": "video",
  "generate-music": "music",
  "text-to-audio": "audio",
  "suno-generate": "music",
  "text-to-speech": "speech",
  "lip-sync": "video",
  "speech-to-video": "video",
  "motion-transfer": "video",
  "extend-video": "video",
}

const NODE_DESCRIPTIONS: Record<string, string> = {
  "generate-image": "Generates an image from a text description.",
  "edit-image": "Edits an existing image based on instructions.",
  "image-to-image": "Transforms an existing image based on a text prompt.",
  "text-to-video": "Generates a video clip from a text description.",
  "image-to-video": "Animates a still image into a video clip based on motion/scene description.",
  "video-to-video": "Transforms an existing video based on a text prompt (style transfer, modifications).",
  "generate-music": "Generates a music track from a description of mood, genre, and instruments.",
  "text-to-audio": "Generates a sound effect from a description.",
  "suno-generate": "Generates a full song with lyrics and vocals using Suno AI.",
  "text-to-speech": "Converts text to spoken audio.",
  "lip-sync": "Animates a face to match audio.",
  "speech-to-video": "Generates a video from speech audio.",
  "motion-transfer": "Transfers motion from one video to another.",
  "extend-video": "Extends a video clip to be longer.",
}

const IMAGE_GUIDELINES = `
- Include specific details: subject, composition, lighting, camera angle, color palette, mood
- Use photographic/artistic terminology the model responds to (e.g., "golden hour lighting", "shallow depth of field", "rule of thirds")
- Specify medium if relevant (photograph, illustration, painting, 3D render, etc.)
- Include texture and material details for realism
- Describe background/environment context`

const VIDEO_GUIDELINES = `
- Describe motion and camera movement explicitly (pan, zoom, dolly, tracking shot, static)
- Include temporal pacing (slow, fast, gradual, sudden)
- Specify scene transitions if applicable
- Describe character actions step by step
- Include ambient details (wind, particles, atmosphere)
- Keep descriptions focused on a single coherent scene for short clips`

const MUSIC_GUIDELINES = `
- Specify genre, sub-genre, tempo (BPM range or descriptive: upbeat, slow, moderate)
- Describe instrumentation (guitar, synth, piano, drums, strings, etc.)
- Include mood/energy descriptors (melancholic, energetic, dreamy, aggressive)
- Mention production style (lo-fi, polished, raw, ambient)
- Reference similar artists/styles if helpful (without naming copyrighted works)`

const AUDIO_GUIDELINES = `
- Be specific about the sound: source, environment, intensity, duration
- Include spatial/environmental context (indoor, outdoor, large room, close-up)
- Describe layering if multiple sounds (background + foreground)
- Use onomatopoeia when helpful
- Specify realism level (realistic, stylized, cartoon, sci-fi)`

const CATEGORY_GUIDELINES: Record<string, string> = {
  image: IMAGE_GUIDELINES,
  video: VIDEO_GUIDELINES,
  music: MUSIC_GUIDELINES,
  audio: AUDIO_GUIDELINES,
  speech: "", // TTS doesn't need style guidelines
}

export function buildPromptHelperSystem(ctx: PromptHelperContext): string {
  const category = NODE_CATEGORY_MAP[ctx.nodeType] ?? "image"
  const nodeDesc = NODE_DESCRIPTIONS[ctx.nodeType] ?? "Generates content from a text prompt."
  const guidelines = CATEGORY_GUIDELINES[category] ?? ""

  let modelInfo = ""
  if (ctx.provider) {
    modelInfo += `\n- AI Provider/Model: ${ctx.provider}`
  }
  if (ctx.model) {
    modelInfo += ` (${ctx.model})`
  }

  let contextInfo = ""
  if (ctx.aspectRatio) {
    contextInfo += `\n- Aspect ratio: ${ctx.aspectRatio}`
  }
  if (ctx.duration) {
    contextInfo += `\n- Duration: ${ctx.duration} seconds`
  }

  return `You are an expert AI prompt engineer. Your task is to enhance and optimize prompts for AI ${category} generation.

## Target System
- Node: ${ctx.nodeType} — ${nodeDesc}${modelInfo}${contextInfo}

## Style Direction
${ctx.style ? `Apply this style: "${ctx.style}". Weave it naturally into the prompt without just prepending it.` : "No specific style selected. Focus on clarity and detail."}

## Guidelines
${guidelines}

## Rules
1. Output ONLY the enhanced prompt text. No explanations, no JSON, no markdown formatting, no quotes around it.
2. Preserve the user's core subject and intent completely.
3. Add specificity, detail, and richness that improves generation quality.
4. Keep the prompt concise but descriptive — under 500 characters for ${category === "image" ? "images" : category === "video" ? "video" : "audio"}.
5. Do not add unrelated concepts the user didn't mention.
6. Use natural language, not keyword lists.
7. If the user's prompt is already detailed, refine rather than rewrite.`
}
