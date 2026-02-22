export const IMAGE_GEN_MODELS = [
  { value: "nano-banana", label: "Nano Banana", desc: "Fast drafts, iteration, storyboards" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production-ready images" },
  { value: "grok", label: "Grok", desc: "Creative and stylized imagery" },
  { value: "flux", label: "Flux", desc: "Photorealistic, highest quality output" },
  { value: "flux-flex", label: "Flux Flex", desc: "Flexible Flux, fast generation" },
  { value: "gpt-image", label: "GPT Image", desc: "Text rendering, complex compositions" },
  { value: "imagen4", label: "Imagen 4", desc: "Google's latest, strong prompt adherence" },
  { value: "imagen4-fast", label: "Imagen 4 Fast", desc: "Fast Imagen, lower latency" },
  { value: "imagen4-ultra", label: "Imagen 4 Ultra", desc: "Highest quality Google image gen" },
  { value: "ideogram", label: "Ideogram", desc: "Excellent text rendering, character consistency" },
  { value: "qwen", label: "Qwen", desc: "Versatile, good at diverse styles" },
  { value: "seedream", label: "Seedream", desc: "Photorealistic, high detail" },
  { value: "z-image", label: "Z-Image", desc: "Fast, lightweight generation" },
] as const

export const IMAGE_I2I_MODELS = [
  { value: "nano-banana", label: "Nano Banana", desc: "Fast iteration, quick transforms" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production images" },
  { value: "grok-i2i", label: "Grok", desc: "Creative and stylized imagery" },
  { value: "flux-i2i", label: "Flux-2", desc: "Style-faithful transformations" },
  { value: "flux-pro-i2i", label: "Flux-2 Pro", desc: "Premium quality image transforms" },
  { value: "gpt-image-i2i", label: "GPT Image", desc: "Text rendering, complex compositions" },
  { value: "ideogram-remix", label: "Ideogram Remix", desc: "Restyle with character consistency" },
  { value: "ideogram-reframe", label: "Ideogram Reframe", desc: "Change aspect ratio intelligently" },
  { value: "qwen-i2i", label: "Qwen", desc: "Versatile image transformation" },
  { value: "qwen-edit", label: "Qwen Edit", desc: "Targeted image editing" },
  { value: "seedream-edit", label: "Seedream Edit", desc: "Photorealistic image editing" },
] as const

export const VIDEO_I2V_MODELS = [
  { value: "minimax", label: "MiniMax", desc: "Fast, reliable 5s clips" },
  { value: "veo3", label: "VEO 3", desc: "Top quality, 8s with audio" },
  { value: "veo3.1", label: "VEO 3.1 (Fast)", desc: "Fast VEO, 8s with audio" },
  { value: "kling", label: "Kling", desc: "Versatile, 5-10s clips" },
  { value: "kling-turbo", label: "Kling Turbo", desc: "Fast generation, end frame support" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Latest Kling, 3-15s variable duration" },
  { value: "veo", label: "VEO 2", desc: "Previous gen VEO" },
  { value: "grok-i2v", label: "Grok", desc: "Creative, stylized motion" },
  { value: "sora2-pro", label: "Sora 2 Pro", desc: "Cinematic, high fidelity" },
  { value: "runway", label: "Runway", desc: "Smooth motion, via Replicate" },
  { value: "pika", label: "Pika", desc: "Stylized animation, via Replicate" },
  { value: "sora", label: "Sora", desc: "Legacy Sora, via Replicate" },
] as const

export const VIDEO_T2V_MODELS = [
  { value: "minimax", label: "MiniMax", desc: "Fast, reliable 5s clips" },
  { value: "veo3", label: "VEO 3", desc: "Top quality, 8s with audio" },
  { value: "kling", label: "Kling", desc: "Versatile, 5-10s clips" },
  { value: "kling-turbo", label: "Kling Turbo", desc: "Fast generation, 5-10s" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Latest Kling, 3-15s variable duration" },
  { value: "veo", label: "VEO 2", desc: "Previous gen VEO" },
  { value: "grok", label: "Grok", desc: "Creative, stylized motion" },
  { value: "sora2-pro", label: "Sora 2 Pro", desc: "Cinematic, high fidelity" },
  { value: "runway", label: "Runway", desc: "Smooth motion, via Replicate" },
  { value: "pika", label: "Pika", desc: "Stylized animation, via Replicate" },
  { value: "sora", label: "Sora", desc: "Legacy Sora, via Replicate" },
] as const

// =============================================================================
// IMAGE MODEL ASPECT RATIOS (per KIE.ai API docs)
// =============================================================================
const NANO_BANANA_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "5:4", label: "5:4" },
  { value: "4:5", label: "4:5" },
  { value: "21:9", label: "21:9 (Ultra-wide)" },
] as const

const FLUX_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
] as const

const GROK_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
] as const

// GPT Image only supports these 3 aspect ratios (NOT 16:9, 9:16, or 4:3)
const GPT_IMAGE_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "3:2", label: "3:2 (Landscape)" },
  { value: "2:3", label: "2:3 (Portrait)" },
] as const

const DEFAULT_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
] as const

// Imagen4 family: 1:1, 16:9, 9:16, 3:4, 4:3
const IMAGEN4_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
] as const

// Ideogram/Qwen: uses named sizes, but we display as ratios (backend converts)
const IDEOGRAM_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
] as const

// Seedream 4.5: 1:1, 4:3, 3:4, 16:9, 9:16, 2:3, 3:2, 21:9
const SEEDREAM_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "21:9", label: "21:9 (Ultra-wide)" },
] as const

// Z-Image: 1:1, 4:3, 3:4, 16:9, 9:16
const Z_IMAGE_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
] as const

export const IMAGE_ASPECT_RATIOS: Record<string, readonly { value: string; label: string }[]> = {
  "nano-banana": NANO_BANANA_RATIOS,
  "nano-banana-pro": NANO_BANANA_RATIOS,
  "flux": FLUX_RATIOS,
  "flux-flex": FLUX_RATIOS,
  "flux-i2i": FLUX_RATIOS,
  "flux-pro-i2i": FLUX_RATIOS,
  "grok": GROK_RATIOS,
  "gpt-image": GPT_IMAGE_RATIOS,
  "gpt-image-i2i": GPT_IMAGE_RATIOS,
  "imagen4": IMAGEN4_RATIOS,
  "imagen4-fast": IMAGEN4_RATIOS,
  "imagen4-ultra": IMAGEN4_RATIOS,
  "ideogram": IDEOGRAM_RATIOS,
  "ideogram-remix": IDEOGRAM_RATIOS,
  "ideogram-reframe": IDEOGRAM_RATIOS,
  "qwen": IDEOGRAM_RATIOS,
  "qwen-i2i": IDEOGRAM_RATIOS,
  "qwen-edit": IDEOGRAM_RATIOS,
  "seedream": SEEDREAM_RATIOS,
  "seedream-edit": SEEDREAM_RATIOS,
  "z-image": Z_IMAGE_RATIOS,
}

export function getAspectRatiosForModel(provider: string): readonly { value: string; label: string }[] {
  return IMAGE_ASPECT_RATIOS[provider] ?? DEFAULT_RATIOS
}

// Models that support resolution selection
// Note: Base Nano Banana does NOT support resolution. Nano Banana Pro DOES (1K/2K/4K).
export const IMAGE_RESOLUTION_OPTIONS: Record<string, { value: string; label: string }[]> = {
  "nano-banana-pro": [
    { value: "1K", label: "1K (Standard)" },
    { value: "2K", label: "2K (High)" },
    { value: "4K", label: "4K (Ultra)" },
  ],
  "flux": [
    { value: "1K", label: "1K (Standard)" },
    { value: "2K", label: "2K (High)" },
  ],
  "flux-flex": [
    { value: "1K", label: "1K (Standard)" },
    { value: "2K", label: "2K (High)" },
  ],
  "flux-i2i": [
    { value: "1K", label: "1K (Standard)" },
    { value: "2K", label: "2K (High)" },
  ],
  "flux-pro-i2i": [
    { value: "1K", label: "1K (Standard)" },
    { value: "2K", label: "2K (High)" },
  ],
}

// Models that support quality selection
export const IMAGE_QUALITY_OPTIONS: Record<string, { value: string; label: string }[]> = {
  "gpt-image": [
    { value: "medium", label: "Medium (Balanced)" },
    { value: "high", label: "High (Detailed)" },
  ],
  "gpt-image-i2i": [
    { value: "medium", label: "Medium (Balanced)" },
    { value: "high", label: "High (Detailed)" },
  ],
  "seedream": [
    { value: "basic", label: "Basic (2K)" },
    { value: "high", label: "High (4K)" },
  ],
  "seedream-edit": [
    { value: "basic", label: "Basic (2K)" },
    { value: "high", label: "High (4K)" },
  ],
}

// Kling 3.0 supports continuous durations from 3s to 15s
export const KLING3_DURATIONS = Array.from({ length: 13 }, (_, i) => i + 3)

// KIE.ai allowed durations per video provider
export const KIE_VIDEO_DURATIONS: Record<string, number[]> = {
  "minimax": [5],
  "veo3": [8],
  "veo3.1": [8],
  "kling": [5, 10],
  "kling-turbo": [5, 10],
  "kling-3.0": KLING3_DURATIONS,
  "grok-i2v": [10],
  "sora2-pro": [5, 10],
}

// Models that accept negative_prompt as a native API parameter.
// All other models get negative prompt appended to the prompt text as "Avoid: ...".
// Keep in sync with backend/src/providers/kie/image.ts NATIVE_NEGATIVE_PROMPT_MODELS.
export const NATIVE_NEGATIVE_PROMPT_MODELS = new Set([
  "imagen4", "imagen4-fast", "imagen4-ultra",  // up to 5000 chars
  "ideogram", "ideogram-remix",                 // up to 500 chars
  "qwen", "qwen-edit",                          // up to 500 chars
])

// Providers that support start + end frame (2 images -> video)
export const PROVIDERS_WITH_END_FRAME: string[] = [
  "minimax",
  "veo3",
  "veo3.1",
  "kling-turbo",
  "kling-3.0",
  "runway",
  "pika",
]

// KIE.ai allowed durations per text-to-video provider
export const KIE_T2V_DURATIONS: Record<string, number[]> = {
  "minimax": [5],
  "veo3": [8],
  "kling": [5, 10],
  "kling-turbo": [5, 10],
  "grok": [10],
  "sora2-pro": [5, 10],
  "kling-3.0": KLING3_DURATIONS,
}
