/**
 * Model constants shared between frontend and backend.
 * Single source of truth for model capability sets and variable pricing rules.
 */

// Models that accept negative_prompt as a native API parameter.
// All other models get negative prompt appended to the prompt text as "Avoid: ...".
export const NATIVE_NEGATIVE_PROMPT_MODELS = new Set([
  "imagen4", "imagen4-fast", "imagen4-ultra",
  "ideogram", "ideogram-remix",
  "qwen", "qwen-edit",
])

// Text-to-image models that accept reference images via their API.
// All other T2I models silently ignore reference images.
export const MODELS_WITH_REFERENCE_IMAGE_SUPPORT = new Set([
  "nano-banana",
  "nano-banana-pro",
  "nano-banana-2",
  "ideogram",
])

// Variable pricing: which setting type affects cost per provider
export const VARIABLE_PRICING_MODELS: Record<string, "quality" | "resolution"> = {
  "gpt-image": "quality",
  "gpt-image-i2i": "quality",
  "nano-banana-pro": "resolution",
  "nano-banana-2": "resolution",
  "flux": "resolution",
  "flux-flex": "resolution",
  "flux-i2i": "resolution",
  "flux-pro-i2i": "resolution",
  "seedream-5-lite": "quality",
  "seedream-5-lite-i2i": "quality",
}


// Models where quality=high triggers composite credit identifier
export const HIGH_QUALITY_PROVIDERS = new Set(["gpt-image", "gpt-image-i2i", "seedream", "seedream-5-lite", "seedream-5-lite-i2i"])

// Models where resolution=2K triggers composite credit identifier
export const TWO_K_RESOLUTION_PROVIDERS = new Set(["flux", "flux-pro-i2i", "flux-flex", "flux-i2i"])

// Ideogram family models with TURBO/QUALITY pricing variants
export const IDEOGRAM_PROVIDERS = new Set(["ideogram", "ideogram-edit", "ideogram-remix", "ideogram-reframe"])

// =====================================================================
// Provider arrays (single source of truth for route Zod validation)
// =====================================================================

/** Text-to-image providers (no input image required) */
export const IMAGE_GEN_PROVIDERS = [
  "nano-banana",
  "flux",
  "nano-banana-pro",
  "nano-banana-2",
  "grok",
  "gpt-image",
  "imagen4",
  "imagen4-fast",
  "imagen4-ultra",
  "ideogram",
  "qwen",
  "seedream",
  "seedream-5-lite",
  "flux-flex",
  "flux-kontext",
  "flux-kontext-max",
  "z-image",
] as const

/** Image-to-image providers (require input image) */
export const IMAGE_I2I_PROVIDERS = [
  "nano-banana",
  "nano-banana-pro",
  "grok-i2i",
  "flux-i2i",
  "flux-pro-i2i",
  "gpt-image-i2i",
  "ideogram-remix",
  "ideogram-reframe",
  "qwen-i2i",
  "qwen-edit",
  "seedream-edit",
  "seedream-5-lite-i2i",
  "flux-kontext",
  "flux-kontext-max",
] as const

/** Image editing providers (upscale, remove bg, etc.) */
export const IMAGE_EDIT_PROVIDERS = [
  "recraft-upscale",
  "recraft-remove-bg",
  "nano-banana-edit",
  "topaz-image-upscale",
] as const

/** I2I providers that support a strength/denoising parameter */
export const I2I_STRENGTH_SUPPORT: Record<string, { min: number; max: number; step: number; default: number }> = {
  "ideogram-remix": { min: 0.01, max: 1, step: 0.01, default: 0.8 },
  "qwen-i2i": { min: 0, max: 1, step: 0.01, default: 0.8 },
}

/** Models that accept a seed parameter for reproducible generation */
export const SEED_SUPPORT = new Set([
  "ideogram", "ideogram-remix", "ideogram-reframe",
  "qwen", "qwen-i2i", "qwen-edit",
  "flux", "flux-flex", "flux-i2i", "flux-pro-i2i", "flux-kontext", "flux-kontext-max",
])

/** Ideogram models that support rendering_speed selection (TURBO/BALANCED/QUALITY) */
export const RENDERING_SPEED_SUPPORT = new Set([
  "ideogram", "ideogram-remix", "ideogram-reframe",
])

/** Models that accept guidance_scale for controlling prompt adherence */
export const GUIDANCE_SCALE_SUPPORT: Record<string, { min: number; max: number; step: number; default: number }> = {
  "qwen-i2i": { min: 1, max: 20, step: 0.5, default: 7 },
  "qwen-edit": { min: 1, max: 20, step: 0.5, default: 7 },
}
