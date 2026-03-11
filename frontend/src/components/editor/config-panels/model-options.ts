import type { ImageGenProvider, ImageI2IProvider, ImageToVideoProvider, TextToVideoProvider, VideoToVideoProvider } from "@nodaro-shared/model-constants"

export const IMAGE_GEN_MODELS: readonly { value: ImageGenProvider; label: string; desc: string }[] = [
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
  { value: "ideogram-v3", label: "Ideogram V3", desc: "Fast text-to-image, affordable" },
  { value: "qwen", label: "Qwen", desc: "Versatile, good at diverse styles" },
  { value: "seedream", label: "Seedream", desc: "Photorealistic, high detail" },
  { value: "seedream-5-lite", label: "Seedream 5 Lite", desc: "Latest Seedream, fast and sharp" },
  { value: "nano-banana-2", label: "Nano Banana 2", desc: "Updated Nano Banana with web grounding" },
  { value: "flux-kontext", label: "Flux Kontext", desc: "Context-aware generation and editing" },
  { value: "flux-kontext-max", label: "Flux Kontext Max", desc: "Highest quality Kontext generation" },
  { value: "z-image", label: "Z-Image", desc: "Fast, lightweight generation" },
]

export const IMAGE_I2I_MODELS: readonly { value: ImageI2IProvider; label: string; desc: string }[] = [
  { value: "nano-banana", label: "Nano Banana", desc: "Fast iteration, quick transforms" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production images" },
  { value: "grok-i2i", label: "Grok", desc: "Creative and stylized imagery" },
  { value: "flux-i2i", label: "Flux-2", desc: "Style-faithful transformations" },
  { value: "flux-pro-i2i", label: "Flux-2 Pro", desc: "Premium quality image transforms" },
  { value: "gpt-image-i2i", label: "GPT Image", desc: "Text rendering, complex compositions" },
  { value: "ideogram-edit", label: "Ideogram Edit", desc: "AI-guided image editing" },
  { value: "ideogram-remix", label: "Ideogram Remix", desc: "Restyle with character consistency" },
  { value: "ideogram-reframe", label: "Ideogram Reframe", desc: "Change aspect ratio intelligently" },
  { value: "qwen-i2i", label: "Qwen", desc: "Versatile image transformation" },
  { value: "qwen-edit", label: "Qwen Edit", desc: "Targeted image editing" },
  { value: "seedream-edit", label: "Seedream Edit", desc: "Photorealistic image editing" },
  { value: "seedream-5-lite-i2i", label: "Seedream 5 Lite", desc: "Latest Seedream image-to-image" },
  { value: "flux-kontext", label: "Flux Kontext", desc: "Context-aware editing via Kontext" },
  { value: "flux-kontext-max", label: "Flux Kontext Max", desc: "Highest quality Kontext editing" },
]

export const IMAGE_EDIT_MODELS = [
  { value: "recraft-upscale", label: "Recraft Upscale", desc: "AI-powered upscaling and enhancement" },
  { value: "topaz-image-upscale", label: "Topaz Upscale", desc: "Advanced upscaling with configurable factor" },
  { value: "recraft-remove-bg", label: "Recraft Remove BG", desc: "Remove background, transparent PNG output" },
  { value: "nano-banana-edit", label: "Nano Banana Edit", desc: "Context-aware image editing with prompt" },
] as const

export const VIDEO_I2V_MODELS = [
  { value: "minimax", label: "MiniMax", desc: "Fast, reliable 5s clips" },
  { value: "veo3", label: "VEO 3", desc: "Top quality, 8s with audio" },
  { value: "veo3.1", label: "VEO 3.1 (Fast)", desc: "Fast VEO, 8s with audio" },
  { value: "kling", label: "Kling", desc: "Versatile, 5-10s clips" },
  { value: "kling-turbo", label: "Kling Turbo", desc: "Fast generation, end frame support" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Latest Kling, 3-15s variable duration" },
  { value: "kling-master", label: "Kling Master", desc: "Kling V2.1 Master, high quality" },
  { value: "seedance", label: "Seedance", desc: "Bytedance, 4-12s, audio generation" },
  { value: "hailuo-2.3-pro", label: "Hailuo 2.3 Pro", desc: "Latest Hailuo, 6-10s pro quality" },
  { value: "hailuo-2.3", label: "Hailuo 2.3", desc: "Latest Hailuo, 6-10s standard" },
  { value: "hailuo-standard", label: "Hailuo Standard", desc: "Hailuo 02, end frame support" },
  { value: "sora2-pro", label: "Sora 2 Pro", desc: "Cinematic, high fidelity" },
  { value: "sora2", label: "Sora 2", desc: "Sora standard, 5-10s" },
  { value: "wan-i2v", label: "Wan 2.6", desc: "Wan I2V, 5-15s, resolution options" },
  { value: "wan-turbo", label: "Wan Turbo", desc: "Fast Wan, 5s clips" },
  { value: "bytedance-lite", label: "Bytedance Lite", desc: "Light, fast, end frame support" },
  { value: "bytedance-pro", label: "Bytedance Pro", desc: "Higher quality Bytedance" },
  { value: "bytedance-pro-fast", label: "Bytedance Pro Fast", desc: "Fast pro generation" },
  { value: "grok-i2v", label: "Grok", desc: "Creative, stylized motion" },
  { value: "veo", label: "VEO 2", desc: "Previous gen VEO" },
  { value: "runway-kie", label: "Runway (KIE)", desc: "Runway Gen-3, 5-10s, 720p/1080p" },
  { value: "runway", label: "Runway", desc: "Smooth motion, via Replicate" },
  { value: "pika", label: "Pika", desc: "Stylized animation, via Replicate" },
  { value: "sora", label: "Sora", desc: "Legacy Sora, via Replicate" },
]

export const VIDEO_T2V_MODELS: readonly { value: TextToVideoProvider; label: string; desc: string }[] = [
  { value: "minimax", label: "MiniMax", desc: "Fast, reliable 5s clips" },
  { value: "veo3", label: "VEO 3", desc: "Top quality, 8s with audio" },
  { value: "kling", label: "Kling", desc: "Versatile, 5-10s clips" },
  { value: "kling-turbo", label: "Kling Turbo", desc: "Fast generation, 5-10s" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Latest Kling, 3-15s variable duration" },
  { value: "veo", label: "VEO 2", desc: "Previous gen VEO" },
  { value: "grok", label: "Grok", desc: "Creative, stylized motion" },
  { value: "sora2-pro", label: "Sora 2 Pro", desc: "Cinematic, high fidelity" },
  { value: "seedance", label: "Seedance 1.5", desc: "Bytedance, 4-12s with audio option" },
  { value: "wan", label: "Wan 2.6", desc: "High quality, 5-15s, 1080p" },
  { value: "sora2", label: "Sora 2", desc: "Cinematic, 5-10s" },
  { value: "hailuo-standard", label: "MiniMax Standard", desc: "Budget Hailuo, 6-10s" },
  { value: "bytedance-lite", label: "Bytedance Lite", desc: "Fast, 5-10s" },
  { value: "bytedance-pro", label: "Bytedance Pro", desc: "High quality, 5-10s" },
  { value: "wan-turbo", label: "Wan Turbo", desc: "Fast generation, 5s clips" },
  { value: "runway-kie", label: "Runway (KIE)", desc: "Runway Gen-3, 5-10s, 720p/1080p" },
  { value: "runway", label: "Runway", desc: "Smooth motion, via Replicate" },
  { value: "pika", label: "Pika", desc: "Stylized animation, via Replicate" },
  { value: "sora", label: "Sora", desc: "Legacy Sora, via Replicate" },
]

export const VIDEO_V2V_MODELS: readonly { value: VideoToVideoProvider; label: string; desc: string }[] = [
  { value: "wan", label: "Wan 2.6", desc: "High quality video-to-video" },
  { value: "luma-modify", label: "Luma Modify", desc: "Luma video modification" },
  { value: "runway-aleph", label: "Runway Aleph", desc: "Runway AI video-to-video conversion" },
]

// =============================================================================
// VARIABLE CREDIT RANGES — for displaying price ranges in model dropdowns
// Models with variable pricing (quality/resolution) show "min-max CR" instead of a single value.
// =============================================================================

export const MODEL_CREDIT_RANGES: Record<string, { min: number; max: number }> = {
  "gpt-image": { min: 2, max: 7 },
  "gpt-image-i2i": { min: 2, max: 7 },
  "nano-banana-pro": { min: 6, max: 8 },
  "flux": { min: 2, max: 3 },
  "flux-flex": { min: 5, max: 8 },
  "flux-i2i": { min: 5, max: 8 },
  "flux-pro-i2i": { min: 2, max: 3 },
  "ideogram": { min: 4, max: 8 },
  "ideogram-edit": { min: 4, max: 8 },
  "ideogram-remix": { min: 4, max: 8 },
  "ideogram-reframe": { min: 4, max: 8 },
  "ideogram-v3": { min: 1, max: 3 },
  "nano-banana-2": { min: 2, max: 5 },
  "seedream": { min: 3, max: 4 },
  "seedream-edit": { min: 3, max: 4 },
  "seedream-5-lite": { min: 3, max: 5 },
  "seedream-5-lite-i2i": { min: 3, max: 5 },
  "topaz-image-upscale": { min: 4, max: 13 },
}

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

// Flux Kontext: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16
const KONTEXT_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "21:9", label: "21:9 (Ultra-wide)" },
] as const

export const IMAGE_ASPECT_RATIOS: Record<string, readonly { value: string; label: string }[]> = {
  "nano-banana": NANO_BANANA_RATIOS,
  "nano-banana-pro": NANO_BANANA_RATIOS,
  "flux": FLUX_RATIOS,
  "flux-flex": FLUX_RATIOS,
  "flux-i2i": FLUX_RATIOS,
  "flux-pro-i2i": FLUX_RATIOS,
  "flux-kontext": KONTEXT_RATIOS,
  "flux-kontext-max": KONTEXT_RATIOS,
  "grok": GROK_RATIOS,
  "gpt-image": GPT_IMAGE_RATIOS,
  "gpt-image-i2i": GPT_IMAGE_RATIOS,
  "imagen4": IMAGEN4_RATIOS,
  "imagen4-fast": IMAGEN4_RATIOS,
  "imagen4-ultra": IMAGEN4_RATIOS,
  "ideogram": IDEOGRAM_RATIOS,
  "ideogram-v3": IDEOGRAM_RATIOS,
  "ideogram-remix": IDEOGRAM_RATIOS,
  "ideogram-reframe": IDEOGRAM_RATIOS,
  "qwen": IDEOGRAM_RATIOS,
  "qwen-i2i": IDEOGRAM_RATIOS,
  "qwen-edit": IDEOGRAM_RATIOS,
  "seedream": SEEDREAM_RATIOS,
  "seedream-edit": SEEDREAM_RATIOS,
  "seedream-5-lite": SEEDREAM_RATIOS,
  "seedream-5-lite-i2i": SEEDREAM_RATIOS,
  "nano-banana-2": NANO_BANANA_RATIOS,
  "nano-banana-edit": NANO_BANANA_RATIOS,
  "z-image": Z_IMAGE_RATIOS,
}

export function getAspectRatiosForModel(provider: string): readonly { value: string; label: string }[] {
  return IMAGE_ASPECT_RATIOS[provider] ?? DEFAULT_RATIOS
}

// Models that support resolution selection
// Note: Base Nano Banana does NOT support resolution. Nano Banana Pro and v2 DO (1K/2K/4K).
const NANO_BANANA_RESOLUTIONS = [
  { value: "1K", label: "1K (Standard)" },
  { value: "2K", label: "2K (High)" },
  { value: "4K", label: "4K (Ultra)" },
] as const

const FLUX_RESOLUTIONS = [
  { value: "1K", label: "1K (Standard)" },
  { value: "2K", label: "2K (High)" },
] as const

export const TOPAZ_IMAGE_RESOLUTIONS = [
  { value: "2K", label: "2K (Standard)" },
  { value: "4K", label: "4K (High)" },
  { value: "8K", label: "8K (Ultra)" },
] as const

export const IMAGE_RESOLUTION_OPTIONS: Record<string, readonly { value: string; label: string }[]> = {
  "nano-banana-pro": NANO_BANANA_RESOLUTIONS,
  "nano-banana-2": NANO_BANANA_RESOLUTIONS,
  "flux": FLUX_RESOLUTIONS,
  "flux-flex": FLUX_RESOLUTIONS,
  "flux-i2i": FLUX_RESOLUTIONS,
  "flux-pro-i2i": FLUX_RESOLUTIONS,
}

// Models that support quality selection
const GPT_IMAGE_QUALITY = [
  { value: "medium", label: "Medium (Balanced)" },
  { value: "high", label: "High (Detailed)" },
] as const

const SEEDREAM_QUALITY = [
  { value: "basic", label: "Basic (2K)" },
  { value: "high", label: "High (4K)" },
] as const

export const IMAGE_QUALITY_OPTIONS: Record<string, readonly { value: string; label: string }[]> = {
  "gpt-image": GPT_IMAGE_QUALITY,
  "gpt-image-i2i": GPT_IMAGE_QUALITY,
  "seedream": SEEDREAM_QUALITY,
  "seedream-edit": SEEDREAM_QUALITY,
  "seedream-5-lite": SEEDREAM_QUALITY,
  "seedream-5-lite-i2i": SEEDREAM_QUALITY,
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
  "kling-master": [5, 10],
  "grok-i2v": [6, 10],
  "sora2-pro": [5, 10],
  "sora2": [5, 10],
  "seedance": [4, 8, 12],
  "wan-i2v": [5, 10, 15],
  "wan-turbo": [5],
  "hailuo-2.3-pro": [6, 10],
  "hailuo-2.3": [6, 10],
  "hailuo-standard": [6, 10],
  "bytedance-lite": [5, 10],
  "bytedance-pro": [5, 10],
  "bytedance-pro-fast": [5, 10],
  "runway-kie": [5, 10],
}

// Model capability constants — re-exported from shared package (single source of truth)
export {
  MODELS_WITH_REFERENCE_IMAGE_SUPPORT,
  NATIVE_NEGATIVE_PROMPT_MODELS,
  I2I_STRENGTH_SUPPORT,
  SEED_SUPPORT,
  RENDERING_SPEED_SUPPORT,
  GUIDANCE_SCALE_SUPPORT,
} from "@nodaro-shared/model-constants"

// Predefined style presets for image generation
export const IMAGE_STYLE_PRESETS = [
  { value: "photorealistic", label: "Photorealistic" },
  { value: "cinematic", label: "Cinematic" },
  { value: "anime", label: "Anime" },
  { value: "digital-art", label: "Digital Art" },
  { value: "oil-painting", label: "Oil Painting" },
  { value: "watercolor", label: "Watercolor" },
  { value: "children-book", label: "Children's Book" },
  { value: "comic-book", label: "Comic Book" },
  { value: "pixel-art", label: "Pixel Art" },
  { value: "3d-render", label: "3D Render" },
  { value: "pencil-sketch", label: "Pencil Sketch" },
  { value: "pop-art", label: "Pop Art" },
  { value: "minimalist", label: "Minimalist" },
  { value: "retro-vintage", label: "Retro / Vintage" },
  { value: "fantasy", label: "Fantasy" },
  { value: "noir", label: "Noir" },
] as const

// Providers that support start + end frame (2 images -> video)
export const PROVIDERS_WITH_END_FRAME: string[] = [
  "minimax",
  "veo3",
  "veo3.1",
  "kling-turbo",
  "kling-3.0",
  "hailuo-standard",
  "bytedance-lite",
  "runway",
  "pika",
]

// KIE.ai allowed durations per text-to-video provider
export const KIE_T2V_DURATIONS: Record<string, number[]> = {
  "minimax": [5],
  "veo3": [8],
  "kling": [5, 10],
  "kling-turbo": [5, 10],
  "grok": [6, 10],
  "sora2-pro": [5, 10],
  "kling-3.0": KLING3_DURATIONS,
  "seedance": [4, 8, 12],
  "wan": [5, 10, 15],
  "sora2": [5, 10],
  "hailuo-standard": [6, 10],
  "bytedance-lite": [5, 10],
  "bytedance-pro": [5, 10],
  "wan-turbo": [5],
  "runway-kie": [5, 10],
}
