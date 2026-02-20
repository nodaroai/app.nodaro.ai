export const IMAGE_GEN_MODELS = [
  { value: "nano-banana", label: "Nano Banana", desc: "Fast drafts, iteration, storyboards" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production-ready images" },
  { value: "grok", label: "Grok", desc: "Creative and stylized imagery" },
  { value: "flux", label: "Flux", desc: "Photorealistic, highest quality output" },
  { value: "gpt-image", label: "GPT Image", desc: "Text rendering, complex compositions" },
] as const

export const IMAGE_I2I_MODELS = [
  { value: "nano-banana", label: "Nano Banana", desc: "Fast iteration, quick transforms" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production images" },
  { value: "grok-i2i", label: "Grok", desc: "Creative and stylized imagery" },
  { value: "flux-i2i", label: "Flux-2", desc: "Style-faithful transformations" },
  { value: "flux-pro-i2i", label: "Flux-2 Pro", desc: "Premium quality image transforms" },
  { value: "gpt-image-i2i", label: "GPT Image", desc: "Text rendering, complex compositions" },
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
