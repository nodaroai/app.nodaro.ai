// Result types
export interface ProviderResult {
  url: string
  cost: number | null // null if cost unknown
}

// Capabilities a provider can support
export type ProviderCapability =
  | "image-generation" // text/reference -> image
  | "image-editing" // image + prompt -> edited image
  | "image-to-video" // image -> video
  | "text-to-video" // text -> video
  | "video-to-video" // video + prompt -> video
  | "motion-transfer" // image + video -> motion-applied video
  | "video-upscale" // video -> upscaled video
  | "lip-sync" // image + audio -> talking video
  | "music-generation" // text -> music
  | "text-to-speech" // text -> speech audio
  | "sound-effect" // text -> sound effect audio
  | "audio-isolation" // audio -> isolated voice audio
  | "transcription" // audio -> text
  | "dialogue" // multi-speaker text -> dialogue audio

// Progress callback for long-running tasks
export type ProgressCallback = (progress: number) => Promise<void>

// Standard options passed to all operations
export interface ProviderOptions {
  onProgress?: ProgressCallback
  mode?: string   // Provider-specific quality mode (e.g. "pro" | "std" for Kling 3.0)
  sound?: boolean // Enable sound effects (Kling 2.6 / 3.0)
  negativePrompt?: string // Negative prompt (Kling Turbo / Kling Master)
  cfgScale?: number       // CFG scale 0-1 (Kling Turbo / Kling Master)
  aspectRatio?: string
  multiShots?: boolean
  multiPrompt?: Array<{ prompt: string; duration: number }>
  klingElements?: Array<{ name: string; description: string; element_input_urls?: string[]; element_input_video_urls?: string[] }>
  // Per-model video params
  resolution?: string      // Video resolution (e.g. "480p", "720p", "1080p", "768P", "1080P")
  grokMode?: string        // Grok I2V mode: "fun" | "normal" | "spicy"
  videoSize?: string       // Sora2 Pro size: "standard" | "high"
  seed?: number            // Seed for deterministic generation (Wan Turbo, Bytedance)
  cameraFixed?: boolean    // Camera fixed / fixed_lens (Bytedance, Seedance)
  generateAudio?: boolean  // Generate audio track (Seedance)
  acceleration?: boolean   // Wan Turbo acceleration
  enablePromptExpansion?: boolean // Wan Turbo prompt expansion
  promptOptimizer?: boolean // Hailuo prompt optimizer
}

// Each provider implements the capabilities it supports
// Methods return ProviderResult or throw errors
export interface ImageGenerationProvider {
  generateImage(
    prompt: string,
    referenceImageUrls?: string[],
    model?: string,
    extraParams?: Record<string, unknown>
  ): Promise<ProviderResult>
}

export interface ImageEditingProvider {
  editImage(
    imageUrl: string,
    prompt?: string,
    model?: string
  ): Promise<ProviderResult>
}

export interface ImageToVideoProvider {
  imageToVideo(
    imageUrl: string,
    prompt?: string,
    model?: string,
    duration?: number,
    endFrameUrl?: string,
    options?: ProviderOptions
  ): Promise<ProviderResult>
}

export interface TextToVideoProvider {
  textToVideo(
    prompt: string,
    model?: string,
    duration?: number,
    aspectRatio?: string,
    options?: ProviderOptions
  ): Promise<ProviderResult>
}

export interface VideoToVideoProvider {
  videoToVideo(
    videoUrl: string,
    prompt?: string,
    model?: string,
    options?: ProviderOptions
  ): Promise<ProviderResult>
}

export interface MotionTransferProvider {
  motionTransfer(
    imageUrl: string,
    videoUrl: string,
    prompt?: string,
    options?: ProviderOptions & {
      characterOrientation?: "image" | "video"
      resolution?: "720p" | "1080p"
    }
  ): Promise<ProviderResult>
}

export interface VideoUpscaleProvider {
  videoUpscale(
    videoUrl: string,
    upscaleFactor?: "1" | "2" | "4",
    options?: ProviderOptions
  ): Promise<ProviderResult>
}

export interface LipSyncProvider {
  lipSync(
    imageUrl: string,
    audioUrl: string,
    prompt?: string,
    model?: string,
    resolution?: string
  ): Promise<ProviderResult>
}

export interface MusicGenerationProvider {
  generateMusic(
    prompt: string,
    model?: string,
    duration?: number,
    lyrics?: string
  ): Promise<ProviderResult>
}

export interface TextToSpeechOptions {
  stability?: number       // 0-1
  similarityBoost?: number // 0-1
  style?: number           // 0-1
  speed?: number           // 0.7-1.2
  languageCode?: string    // e.g. "en", "he", "es"
}

export interface TextToSpeechProvider {
  textToSpeech(
    text: string,
    voice?: string,
    model?: string,
    options?: TextToSpeechOptions
  ): Promise<ProviderResult>
}

export interface TranscriptionProvider {
  transcribe(
    audioUrl: string,
    language?: string
  ): Promise<{
    text: string
    segments?: Array<{ start: number; end: number; text: string }>
    cost: number | null
  }>
}

// Provider metadata
export interface ProviderInfo {
  id: string // "kie", "replicate", "runway", etc.
  name: string // "KIE.ai", "Replicate", "Runway ML"
  capabilities: ProviderCapability[]
  supportedModels: Record<ProviderCapability, string[]> // capability -> list of model names
}
