// Result types
export interface ProviderResult {
  url: string
  /** Additional result URLs from the same job — variants Grok / Suno / Imagen
   *  etc. return alongside the primary. Workers upload all to R2; frontends
   *  surface them as alternates in the version pill. Empty/undefined when the
   *  provider returns a single result. */
  extraUrls?: readonly string[]
  cost: number | null // null if cost unknown
  kieTaskId?: string  // KIE task ID for extend/upscale operations (VEO, Runway)
  /** Provider-reported seed VEO actually used. Captured even when no seed
   *  was supplied — KIE returns it. Used by perfect-loop component to pin
   *  a winning roll for reruns. Currently only VEO surfaces this. */
  seed?: number
  /** Whether KIE silently swapped to its deprecated fallback model.
   *  When true, output is forced to 720p / 16:9 and cannot be upgraded
   *  via /get-1080p-video. VEO only. */
  fallbackFlag?: boolean
  /** Provider-side generation duration in milliseconds. For VEO this is
   *  KIE's completeTime − createTime; for standard KIE it's `costTime`
   *  (which is in seconds, converted to ms). Useful for telemetry and
   *  separating provider time from our orchestration overhead. */
  providerMs?: number
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
  motionPrompt?: string   // Motion prompt — replaces prompt in single-shot Kling 3.0
  cfgScale?: number       // CFG scale 0-1 (Kling Turbo / Kling Master)
  aspectRatio?: string
  multiShots?: boolean
  multiPrompt?: Array<{ prompt: string; duration: number }>
  klingElements?: Array<{ name: string; description: string; element_input_urls?: string[]; element_input_video_urls?: string[] }>
  // Per-model video params
  resolution?: string      // Video resolution (e.g. "480p", "720p", "1080p", "768P", "1080P")
  grokMode?: string        // Grok I2V mode: "fun" | "normal" | "spicy"
  seed?: number            // Seed for deterministic generation (Wan Turbo, Bytedance)
  cameraFixed?: boolean    // Camera fixed / fixed_lens (Bytedance, Seedance)
  generateAudio?: boolean  // Generate audio track (Seedance)
  acceleration?: boolean   // Wan Turbo acceleration
  enablePromptExpansion?: boolean // Wan Turbo prompt expansion
  promptOptimizer?: boolean // Hailuo prompt optimizer
  referenceImageUrls?: string[] // Reference images for generation (e.g., VEO 3 reference-to-video, Seedance 2 max 9)
  referenceVideoUrls?: string[] // Reference videos for generation (Seedance 2, max 3)
  referenceAudioUrls?: string[] // Reference audio tracks for generation (Seedance 2, max 3)
  webSearch?: boolean      // Enable online search capability (Seedance 2, required field)
  nsfwChecker?: boolean    // Toggle NSFW content filter (Seedance 2)
  generationType?: string // Generation type (e.g., "TEXT_2_VIDEO", "FIRST_AND_LAST_FRAMES_2_VIDEO", "REFERENCE_2_VIDEO")
  // VEO 3.x: opt out of KIE's auto-translate-to-English. Default upstream
  // is true; set false to keep prompts (e.g. the perfect-loop seal phrase)
  // verbatim. Has no effect on non-VEO providers.
  enableTranslation?: boolean
  // V2V-specific
  referenceImageUrl?: string // Runway Aleph style reference image
  audio?: boolean            // Wan Flash: generate with audio (affects pricing)
  duration?: string          // Wan V2V duration: "5" or "10" seconds
  // Wan 2.7 VideoEdit params
  audioSetting?: "auto" | "origin" // How to handle source audio
  promptExtend?: boolean           // AI-enhanced prompt expansion
  videoEditDuration?: string       // "0" = auto, "5", "10" (seconds)
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
    model?: string,
    extraParams?: Record<string, unknown>
  ): Promise<ProviderResult>
}

export interface ImageToVideoProvider {
  imageToVideo(
    imageUrl: string | undefined,
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
      resolution?: "480p" | "580p" | "720p" | "1080p"
      provider?: string
      backgroundSource?: "input_video" | "input_image"
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
    resolution?: string,
    audioDurationSec?: number
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
