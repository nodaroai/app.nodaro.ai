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
  | "transcription" // audio -> text

// Progress callback for long-running tasks
export type ProgressCallback = (progress: number) => Promise<void>

// Standard options passed to all operations
export interface ProviderOptions {
  onProgress?: ProgressCallback
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
    aspectRatio?: string
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

export interface TextToSpeechProvider {
  textToSpeech(
    text: string,
    voice?: string,
    model?: string
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
