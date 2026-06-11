// backend/src/prompts/prompt-wizard-system.ts

import {
  getCategoriesForNodeType,
  getPromptDoctrine,
  PROVIDER_CAPABILITIES,
  REFERENCE_IMAGE_ROLES,
} from "@nodaro/shared"

interface WizardAnalyzeContext {
  nodeType: string
  provider?: string
  style?: string
  aspectRatio?: string
  duration?: number
  nodeContext?: {
    connectedInputTypes?: string[]
    referenceImageCount?: number
    hasSourceVideo?: boolean
  }
  userPreference?: string
}

interface WizardGenerateContext {
  nodeType: string
  provider?: string
  style?: string
  aspectRatio?: string
  duration?: number
  selections: Array<{ category: string; value: string; isCustom: boolean }>
  originalPrompt?: string
  nodeContext?: {
    connectedInputTypes?: string[]
    referenceImageCount?: number
    hasSourceVideo?: boolean
  }
  userPreference?: string
}

const NODE_CATEGORY_MAP: Record<string, string> = {
  "generate-image": "image",
  "image-to-image": "image",
  "text-to-video": "video",
  "image-to-video": "video",
  "generate-video": "video",
  "video-to-video": "video",
  "motion-transfer": "video",
  "extend-video": "video",
  "speech-to-video": "video",
  "generate-music": "music",
  "suno-generate": "music",
  "text-to-audio": "audio",
  "text-prompt": "text",
}

const PERSONA: Record<string, string> = {
  image: "You are a visual design expert specializing in AI image generation. You understand composition, lighting, color theory, and how different AI models interpret prompts.",
  video: "You are a cinematography and motion design expert specializing in AI video generation. You understand camera movement, pacing, visual storytelling, and how different AI video models work.",
  music: "You are a music production expert specializing in AI music generation. You understand genre conventions, instrumentation, arrangement, and how to describe music for AI models.",
  audio: "You are a sound design expert specializing in AI audio/SFX generation. You understand acoustics, layering, environmental audio, and how to describe sounds precisely.",
  text: "You are an expert creative writer and prompt engineer. You understand narrative structure, tone, audience targeting, and how to craft clear, effective text for any purpose.",
}

export function buildWizardAnalyzeSystem(ctx: WizardAnalyzeContext): string {
  const contentCategory = NODE_CATEGORY_MAP[ctx.nodeType] ?? "image"
  const persona = PERSONA[contentCategory] ?? PERSONA.image
  const categories = getCategoriesForNodeType(ctx.nodeType)
  if (!categories) throw new Error(`No wizard categories for node type: ${ctx.nodeType}`)

  const categoryList = categories
    .map((c) => `- ${c.key}: "${c.label}"${c.optional ? " (optional — include only if relevant)" : ""}`)
    .join("\n")

  let contextBlock = ""
  if (ctx.provider) contextBlock += `\n- Current provider/model: ${ctx.provider}`
  if (ctx.style) contextBlock += `\n- Style preset already selected: "${ctx.style}" — still include the style category but pre-select the matching option`
  if (ctx.aspectRatio) contextBlock += `\n- Aspect ratio: ${ctx.aspectRatio}`
  if (ctx.duration) contextBlock += `\n- Duration: ${ctx.duration} seconds`

  let connectedBlock = ""
  if (ctx.nodeContext?.connectedInputTypes?.length) {
    connectedBlock += `\n- Connected inputs: ${ctx.nodeContext.connectedInputTypes.join(", ")} — skip categories already covered (e.g., if "character" is connected, skip subject)`
  }
  if (ctx.nodeContext?.hasSourceVideo) {
    connectedBlock += `\n- Source video connected — adapt for transformation rather than generation from scratch`
  }

  let referenceBlock = ""
  const refCount = ctx.nodeContext?.referenceImageCount ?? 0
  if (refCount > 0) {
    const roleOptions = REFERENCE_IMAGE_ROLES.map((r) => `  - "${r.value}": ${r.label} — ${r.description}`).join("\n")
    referenceBlock = `

## Reference Images
${refCount} reference image(s) connected. They are delivered to the provider as an ordered array — Image 1 carries the most weight. For EACH reference image, add a question with:
- category: "reference-role-1", "reference-role-2", etc.
- multi: true (user can select multiple roles per image)
- Use these role options:
${roleOptions}

These reference-role questions are IN ADDITION to the standard 3-5 category questions.`
  }

  return `${persona}

## Task
Analyze the user's prompt idea and generate a structured form of questions to help build a high-quality ${contentCategory} generation prompt.

## Available Categories
${categoryList}

## Node Context${contextBlock}${connectedBlock}
${referenceBlock}
${contentCategory === "image" ? `## Style-Specific Vocabulary

When the user's input suggests PHOTOREALISM or CINEMATIC REALISM:
- Camera & Composition: use precise photography terms — "shot on a 35mm lens", "50mm f/1.8", "85mm portrait lens", "DSLR photography", "mirrorless camera", "shallow depth of field", "natural bokeh", "rule of thirds"
- Lighting: use real-world lighting — "natural daylight", "soft window light", "golden hour sunlight", "overcast daylight", "studio softbox", "practical lighting", "subtle rim light". Avoid fantasy/neon unless requested
- Details / Texture: ALWAYS include this category for photorealism — offer "visible skin pores", "fabric grain", "natural imperfections", "dust and scratches", "micro-details", "tactile materials". Imperfections are critical to break the AI plastic look
- What to Avoid: include this category for photorealism — offer "CGI / 3D render look", "plastic skin", "oversaturated colors", "cartoon style", "unrealistic lighting", "overly polished / airbrushed"
- Color: use restrained photographic language — "natural color grading", "muted tones", "earthy palette", "cinematic color balance", "realistic contrast"

When the user's input suggests ARTISTIC styles (anime, watercolor, pixel art, etc.):
- Camera: swap lens/camera options for composition terms — "centered", "rule of thirds", "dynamic diagonal", "scattered", "symmetrical"
- Details: offer style-specific textures — "brush strokes", "cell shading", "pixel-perfect edges", "ink outlines"
- Skip "What to Avoid" unless user mentions quality concerns

` : ""}${ctx.userPreference ? `## User Preference\nThe user has set a general preference for this wizard. Follow it:\n"${ctx.userPreference}"\n\n` : ""}## Rules
1. Pick 3-5 categories from the available set that would MOST improve the prompt.
2. Skip categories the user has already clearly specified in their text.
3. If the prompt is empty (build from scratch), pick up to 5 key categories with "selected": null.
4. For each chosen category, generate 4-6 contextually relevant options.
5. Pre-select the best option based on the user's description.
6. LANGUAGE: write "label" and "description" fields in the USER'S language (mirror the language of their input — they are UI text). Every "value" string MUST be in ENGLISH regardless of the input language — values are prompt fragments fed verbatim to generation models, which perform best in English.
7. Output ONLY valid JSON matching this exact schema — no markdown, no explanations, no wrapping:

{
  "questions": [
    {
      "category": "string",
      "label": "string (a short question)",
      "options": [
        { "value": "string", "label": "string", "description": "string (optional, 1 sentence)" }
      ],
      "selected": "string | null",
      "allowCustom": true,
      "multi": false
    }
  ]
}`
}

function buildProviderBlock(nodeType: string, provider?: string): string {
  const providerCaps = PROVIDER_CAPABILITIES[nodeType]
  let block = ""
  if (providerCaps && Object.keys(providerCaps).length > 1) {
    const entries = Object.entries(providerCaps)
      .map(([p, desc]) => `- ${p}: ${desc}`)
      .join("\n")
    block += `

## Available Providers
${entries}

If a particular provider would excel at this content, include "recommendedModel" in your response.
For suno-generate nodes, use field: "model" instead of field: "provider".`
  }
  // Model-family-specific prompting rules for the CURRENT provider — the
  // registry lives in @nodaro/shared so the wizard, gen-skills docs, and
  // list_models promptTips can never drift apart.
  const doctrine = provider ? getPromptDoctrine(provider) : undefined
  if (doctrine) {
    block += `

## Provider Prompting Doctrine — ${doctrine.heading}
The CURRENT provider is ${provider}. Apply this model-specific doctrine when writing the prompt:

${doctrine.doctrine}`
  }
  return block
}

function buildContextBlock(ctx: { provider?: string; style?: string; aspectRatio?: string; duration?: number }): string {
  let block = ""
  if (ctx.provider) block += `\n- Current provider: ${ctx.provider}`
  if (ctx.style) block += `\n- Style preset: "${ctx.style}"`
  if (ctx.aspectRatio) block += `\n- Aspect ratio: ${ctx.aspectRatio}`
  if (ctx.duration) block += `\n- Duration: ${ctx.duration}s`
  return block
}

export function buildWizardGenerateSystem(ctx: WizardGenerateContext): string {
  const contentCategory = NODE_CATEGORY_MAP[ctx.nodeType] ?? "image"
  const persona = PERSONA[contentCategory] ?? PERSONA.image

  const selectionsBlock = ctx.selections
    .map((s) => `- ${s.category}: ${s.value}${s.isCustom ? " (custom)" : ""}`)
    .join("\n")

  const providerBlock = buildProviderBlock(ctx.nodeType, ctx.provider)
  const contextBlock = buildContextBlock(ctx)

  return `${persona}

## Task
Build a natural-language ${contentCategory} generation prompt from the user's selections.

## User's Selections
${selectionsBlock}
${ctx.originalPrompt ? `\n## Original Prompt\n${ctx.originalPrompt}` : ""}
## Node Context${contextBlock}
${providerBlock}
${ctx.userPreference ? `## User Preference\nThe user has set a general preference. Follow it:\n"${ctx.userPreference}"\n` : ""}## Rules
1. Weave all selections into one concise, natural-language prompt — under 500 characters.
2. Preserve the user's original intent and details. If the original text is not in English, TRANSLATE it into English — the final prompt MUST be entirely in English (generation models perform best in English).
3. Weave style, mood, lighting naturally — do not keyword-stuff.
4. For reference-role selections, include explicit per-image role instructions bound by ordinal (e.g., "Image 1 defines the character — preserve identity exactly. Image 2 defines the mood and lighting.").
5. If "what-to-avoid" selections are present, append them as a negative instruction at the end of the prompt (e.g., "Avoid: CGI look, plastic skin, oversaturated colors").
6. Output ONLY valid JSON — no markdown, no wrapping:

{
  "prompt": "the generated prompt text",
  "recommendedModel": {
    "provider": "provider-key",
    "field": "provider",
    "label": "Display Name",
    "reason": "One sentence why"
  }
}

The "recommendedModel" field is optional — omit it if no strong recommendation.`
}

interface WizardEnhanceContext {
  nodeType: string
  provider?: string
  style?: string
  aspectRatio?: string
  duration?: number
  nodeContext?: { referenceImageCount?: number }
  userPreference?: string
}

export function buildWizardEnhanceSystem(ctx: WizardEnhanceContext): string {
  const contentCategory = NODE_CATEGORY_MAP[ctx.nodeType] ?? "image"
  const persona = PERSONA[contentCategory] ?? PERSONA.image

  const providerBlock = buildProviderBlock(ctx.nodeType, ctx.provider)
  const contextBlock = buildContextBlock(ctx)

  const refCount = ctx.nodeContext?.referenceImageCount ?? 0
  // References are sent to providers as an ordered array; "Image N" is the
  // platform-wide ordinal convention (and official Seedance syntax), so the
  // rewritten prompt should bind subjects to ordinals explicitly.
  const referenceBlock = refCount > 0
    ? `\n- ${refCount} reference image(s) are attached in a FIXED order: Image 1 … Image ${refCount}.` +
      `\n- Bind each subject/element to its reference by ordinal — e.g. "the woman from Image 1", ` +
      `"the scene style from Image 2" — so every reference has an explicit job. ` +
      `Earlier references carry more weight.`
    : ""

  const imageVocab = contentCategory === "image"
    ? `## Style Vocabulary
For PHOTOREALISM: precise camera/lens terms ("shot on 50mm f/1.8", "shallow depth of field"), real-world lighting ("golden hour", "soft window light"), tactile detail ("visible skin pores", "fabric grain"), and an explicit negative ("avoid CGI/plastic look").
For ARTISTIC styles (anime, watercolor, pixel art): composition terms ("rule of thirds", "dynamic diagonal") and style textures ("brush strokes", "cell shading", "ink outlines").

`
    : ""

  return `${persona}

## Task
Take the user's rough ${contentCategory} idea and rewrite it into ONE high-quality, optimized ${contentCategory} generation prompt. Make the expert creative choices yourself — subject, composition, lighting, mood, style, and what to avoid — based on best practices. Do NOT ask questions.

## Node Context${contextBlock}${referenceBlock}
${providerBlock}
${imageVocab}${ctx.userPreference ? `## User Preference\nThe user has set a general preference. Follow it:\n"${ctx.userPreference}"\n\n` : ""}## Rules
1. Output a single concise, natural-language prompt — under 500 characters.
2. Preserve the user's intent; expand and refine, do not replace it. If the user's text is not in English, TRANSLATE it — the output prompt MUST be entirely in English (generation models perform best in English).
3. Weave style, mood, and lighting naturally — do not keyword-stuff.
4. If the content calls for it, append negatives as "Avoid: ..." at the end.
5. Output ONLY valid JSON — no markdown, no wrapping:

{
  "prompt": "the optimized prompt text",
  "recommendedModel": {
    "provider": "provider-key",
    "field": "provider",
    "label": "Display Name",
    "reason": "One sentence why"
  }
}

The "recommendedModel" field is optional — omit it if no strong recommendation.`
}
