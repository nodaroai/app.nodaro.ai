/**
 * Prompt Wizard — shared types, category definitions, and provider capabilities.
 *
 * Used by the backend (system prompt building) and frontend (type-checking, UI).
 */

// ── Types ──

export interface WizardCategory {
  readonly key: string
  readonly label: string
  readonly optional?: boolean
}

export interface WizardQuestion {
  category: string
  label: string
  options: WizardOption[]
  selected: string | string[] | null
  allowCustom: boolean
  multi?: boolean
}

export interface WizardOption {
  value: string
  label: string
  description?: string
}

export interface WizardSelection {
  category: string
  value: string
  isCustom: boolean
}

export interface RecommendedModel {
  provider: string
  field: string
  label: string
  reason: string
}

export interface ModelChange {
  field: string
  value: string
}

// ── Category Definitions ──

// ── Image (generate-image, image-to-image) ──
export const IMAGE_WIZARD_CATEGORIES: readonly WizardCategory[] = [
  { key: "subject", label: "Subject" },
  { key: "environment", label: "Environment / Setting" },
  { key: "lighting", label: "Lighting" },
  { key: "camera-composition", label: "Camera & Composition" },
  { key: "style-medium", label: "Style / Medium" },
  { key: "mood-tone", label: "Mood & Tone" },
  { key: "details-texture", label: "Details / Texture", optional: true },
  { key: "what-to-avoid", label: "What to Avoid", optional: true },
]

// ── Video (text-to-video, image-to-video, video-to-video, motion-transfer, extend-video, speech-to-video) ──
export const VIDEO_WIZARD_CATEGORIES: readonly WizardCategory[] = [
  { key: "subject-action", label: "Subject & Action" },
  { key: "environment", label: "Environment / Setting" },
  { key: "camera-movement", label: "Camera Movement" },
  { key: "pacing-speed", label: "Pacing / Speed" },
  { key: "style-look", label: "Style / Look" },
  { key: "mood-tone", label: "Mood & Tone" },
]

// ── Music (generate-music, suno-generate) ──
export const MUSIC_WIZARD_CATEGORIES: readonly WizardCategory[] = [
  { key: "genre-style", label: "Genre / Style" },
  { key: "mood-energy", label: "Mood & Energy" },
  { key: "instruments", label: "Instruments" },
  { key: "tempo", label: "Tempo" },
  { key: "vocals", label: "Vocals" },
  { key: "production-style", label: "Production Style" },
]

// ── Audio / SFX (text-to-audio) ──
export const AUDIO_WIZARD_CATEGORIES: readonly WizardCategory[] = [
  { key: "sound-type", label: "Sound Type" },
  { key: "environment", label: "Environment" },
  { key: "intensity", label: "Intensity" },
  { key: "texture-quality", label: "Texture / Quality" },
]

// ── Text / General (text-prompt) ──
export const TEXT_WIZARD_CATEGORIES: readonly WizardCategory[] = [
  { key: "purpose-intent", label: "Purpose / Intent" },
  { key: "tone-voice", label: "Tone / Voice" },
  { key: "audience", label: "Audience" },
  { key: "length-format", label: "Length / Format" },
]

// ── LLM Chat (llm-chat) ──
export const LLM_CHAT_WIZARD_CATEGORIES: readonly WizardCategory[] = [
  { key: "task", label: "Task / Goal" },
  { key: "tone", label: "Tone & Style" },
  { key: "format", label: "Output Format" },
  { key: "constraints", label: "Constraints" },
]

// ── Node Type Mapping ──

const NODE_TYPE_TO_CATEGORIES: Record<string, readonly WizardCategory[]> = {
  "llm-chat": LLM_CHAT_WIZARD_CATEGORIES,
  "generate-image": IMAGE_WIZARD_CATEGORIES,
  "image-to-image": IMAGE_WIZARD_CATEGORIES,
  "modify-image": IMAGE_WIZARD_CATEGORIES,
  "text-to-video": VIDEO_WIZARD_CATEGORIES,
  "image-to-video": VIDEO_WIZARD_CATEGORIES,
  "video-to-video": VIDEO_WIZARD_CATEGORIES,
  "motion-transfer": VIDEO_WIZARD_CATEGORIES,
  "extend-video": VIDEO_WIZARD_CATEGORIES,
  "speech-to-video": VIDEO_WIZARD_CATEGORIES,
  "generate-music": MUSIC_WIZARD_CATEGORIES,
  "suno-generate": MUSIC_WIZARD_CATEGORIES,
  "text-to-audio": AUDIO_WIZARD_CATEGORIES,
  "text-prompt": TEXT_WIZARD_CATEGORIES,
}

export function getCategoriesForNodeType(nodeType: string): readonly WizardCategory[] | undefined {
  return NODE_TYPE_TO_CATEGORIES[nodeType]
}

/** Node types that support the wizard (excludes edit-image, text-to-speech, lip-sync) */
export function isWizardSupported(nodeType: string): boolean {
  return nodeType in NODE_TYPE_TO_CATEGORIES
}

// ── Provider Capabilities (for model recommendation) ──
// Must be updated when providers are added (see Provider Enum Sync in CLAUDE.md)

export const PROVIDER_CAPABILITIES: Record<string, Record<string, string>> = {
  "generate-image": {
    "flux": "Photorealistic, highly detailed, best overall quality",
    "flux-flex": "Fast Flux variant, good quality at lower cost",
    "flux-kontext": "Character consistency, reference-image-aware generation",
    "flux-kontext-max": "Premium character consistency with highest detail",
    "nano-banana": "Fast generation, style flexibility, reference image support",
    "nano-banana-pro": "Higher quality Nano Banana with better detail",
    "nano-banana-2": "Latest Nano Banana with resolution options (1K/2K/4K)",
    "gpt-image": "Creative concepts, illustration, variable quality tiers",
    "gpt-image-2": "Latest GPT Image — sharp text, photorealism, 1K/2K/4K resolution",
    "grok": "General purpose, good text understanding",
    "imagen4": "Google's latest, strong photorealism and text rendering",
    "imagen4-fast": "Faster Imagen 4 variant",
    "imagen4-ultra": "Highest quality Imagen 4",
    "ideogram-v3": "Best for typography, text-in-image, logos, reference images",
    "qwen": "Versatile, good prompt adherence",
    "seedream": "Artistic, painterly styles, creative interpretation",
    "seedream-5-lite": "Lighter Seedream, faster artistic generation",
    "z-image": "Experimental, novel generation approaches",
  },
  "image-to-image": {
    "nano-banana": "Fast style transfer and transformation",
    "nano-banana-pro": "Higher quality transformations",
    "grok-i2i": "General purpose image transformation",
    "flux-i2i": "High quality image-to-image with strong prompt adherence",
    "flux-pro-i2i": "Premium Flux transformation",
    "gpt-image-i2i": "Creative reinterpretation of source images",
    "gpt-image-2-i2i": "Latest GPT Image — pixel-level edits with original lighting/texture preservation, up to 4K",
    "ideogram-edit": "Instruction-based editing with text preservation",
    "ideogram-remix": "Style remixing while preserving structure",
    "ideogram-reframe": "Aspect ratio changes with AI fill",
    "qwen-i2i": "Versatile transformation",
    "qwen-edit": "Instruction-based editing",
    "seedream-edit": "Artistic style editing",
    "seedream-5-lite-i2i": "Light artistic transformation",
    "flux-kontext": "Character-consistent edits with reference awareness",
    "flux-kontext-max": "Premium character-consistent editing",
  },
  "modify-image": {
    "nano-banana": "Fast style transfer and transformation",
    "nano-banana-pro": "Higher quality transformations",
    "nano-banana-edit": "AI-powered image editing with instructions",
    "grok-i2i": "General purpose image transformation",
    "flux-i2i": "High quality image-to-image with strong prompt adherence",
    "flux-pro-i2i": "Premium Flux transformation",
    "gpt-image-i2i": "Creative reinterpretation of source images",
    "gpt-image-2-i2i": "Latest GPT Image — pixel-level edits with original lighting/texture preservation, up to 4K",
    "ideogram-edit": "Instruction-based editing with text preservation",
    "ideogram-remix": "Style remixing while preserving structure",
    "ideogram-reframe": "Aspect ratio changes with AI fill",
    "qwen-i2i": "Versatile transformation",
    "qwen-edit": "Instruction-based editing",
    "seedream-edit": "Artistic style editing",
    "seedream-5-lite-i2i": "Light artistic transformation",
    "flux-kontext": "Character-consistent edits with reference awareness",
    "flux-kontext-max": "Premium character-consistent editing",
  },
  "text-to-video": {
    "minimax": "Versatile, good motion quality, reliable",
    "veo3": "Google's latest, photorealistic, audio generation support",
    "veo3.1": "Enhanced VEO with improved motion",
    "kling": "Cinematic, precise camera control, high motion quality",
    "kling-turbo": "Faster Kling generation",
    "kling-3.0": "Latest Kling with motion control and multi-shot",
    "grok": "General purpose video generation",
    "seedance": "Dance and movement specialization",
    "seedance-2": "Seedance 2.0 — multimodal references (images, videos, audio), 4-15s",
    "seedance-2-fast": "Seedance 2.0 Fast — cheaper/quicker multimodal variant",
    "wan": "Versatile, good for animations and transformations",
    "wan-turbo": "Faster Wan generation",
    "hailuo-standard": "Standard quality, cost-effective",
    "bytedance-lite": "Fast, lightweight generation",
    "bytedance-pro": "Higher quality ByteDance",
    "runway-kie": "Runway via KIE, strong cinematic quality",
  },
  "image-to-video": {
    "minimax": "Versatile animation from still images",
    "veo3": "Photorealistic animation with audio",
    "veo3.1": "Enhanced image animation",
    "kling": "Precise motion from stills, camera control",
    "kling-turbo": "Faster Kling animation",
    "kling-3.0": "Latest Kling with advanced motion",
    "kling-master": "Highest quality Kling",
    "seedance": "Dance/movement from still images",
    "seedance-2": "Seedance 2.0 — start/end frame + multimodal refs, 4-15s",
    "seedance-2-fast": "Seedance 2.0 Fast — cheaper/quicker multimodal variant",
    "hailuo-2.3-pro": "Premium Hailuo animation",
    "hailuo-2.3": "Standard Hailuo animation",
    "hailuo-standard": "Cost-effective animation",
    "wan-i2v": "Versatile image-to-video",
    "wan-turbo": "Fast image animation",
    "bytedance-lite": "Fast, lightweight",
    "bytedance-pro": "Higher quality ByteDance",
    "bytedance-pro-fast": "Fast premium ByteDance",
    "grok-i2v": "General purpose animation",
    "runway-kie": "Cinematic image animation",
  },
  "video-to-video": {
    "wan": "Style transfer and video transformation",
    "luma-modify": "Video modification preserving structure",
    "runway-aleph": "Advanced video transformation",
  },
  "motion-transfer": {
    "kling": "Motion transfer with camera control",
    "kling-3.0": "Advanced motion transfer",
    "wan-animate-move": "Movement-based motion transfer",
    "wan-animate-replace": "Subject replacement with motion preservation",
  },
  "extend-video": {
    "veo-extend": "Extend VEO-generated videos",
    "runway-extend": "Extend Runway-generated videos",
  },
  "speech-to-video": {
    "wan-speech": "Wan 2.2 speech-driven video generation",
  },
  "generate-music": {
    "minimax": "General music generation, multiple genres",
  },
  "suno-generate": {
    "V4": "Standard Suno generation",
    "V4_5": "Improved quality and coherence",
    "V4_5PLUS": "Enhanced V4.5 with better production",
    "V4_5ALL": "Full-featured V4.5",
    "V5": "Latest Suno with highest quality",
  },
  "text-to-audio": {
    "elevenlabs-sfx": "High quality sound effects and ambient audio",
  },
  "text-prompt": {},
}

/** Reference image role options (for multi-select) */
export const REFERENCE_IMAGE_ROLES: readonly WizardOption[] = [
  { value: "character", label: "Character reference", description: "Preserve identity, face, clothing exactly" },
  { value: "style-mood", label: "Style / mood reference", description: "Apply lighting, color palette, atmosphere only" },
  { value: "composition", label: "Composition reference", description: "Follow layout and framing" },
  { value: "scene-background", label: "Scene / background reference", description: "Use as environment, ignore subjects" },
  { value: "texture-material", label: "Texture / material reference", description: "Apply surface details and textures" },
]
