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
  "ideogram",
])

// Variable pricing: which setting type affects cost per provider
export const VARIABLE_PRICING_MODELS: Record<string, "quality" | "resolution"> = {
  "gpt-image": "quality",
  "gpt-image-i2i": "quality",
  "nano-banana-pro": "resolution",
  "flux": "resolution",
  "flux-flex": "resolution",
  "flux-i2i": "resolution",
  "flux-pro-i2i": "resolution",
}

// For resolution-based variable pricing, only these values trigger a different cost.
export const VARIABLE_PRICING_RESOLUTION_TRIGGERS: Record<string, string[]> = {
  "nano-banana-pro": ["4K"],
  "flux": ["2K"],
  "flux-flex": ["2K"],
  "flux-i2i": ["2K"],
  "flux-pro-i2i": ["2K"],
}

// For quality-based variable pricing, only these values trigger a different cost.
export const VARIABLE_PRICING_QUALITY_TRIGGERS: Record<string, string[]> = {
  "gpt-image": ["high"],
  "gpt-image-i2i": ["high"],
}

// Models where quality=high triggers composite credit identifier
export const HIGH_QUALITY_PROVIDERS = new Set(["gpt-image", "gpt-image-i2i", "seedream"])

// Models where resolution=2K triggers composite credit identifier
export const TWO_K_RESOLUTION_PROVIDERS = new Set(["flux", "flux-pro-i2i", "flux-flex", "flux-i2i"])

// Ideogram family models with TURBO/QUALITY pricing variants
export const IDEOGRAM_PROVIDERS = new Set(["ideogram", "ideogram-edit", "ideogram-remix", "ideogram-reframe"])
