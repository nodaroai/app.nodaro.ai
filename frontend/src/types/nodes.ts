import type { Node, Edge } from "@xyflow/react"

export type NodeCategory = "input" | "parameter" | "ai" | "processing" | "output" | "scene" | "character" | "face" | "object" | "location" | "utility"

export interface FieldMapping {
  readonly sourceNodeId: string
}

export type FieldMappings = Readonly<Record<string, FieldMapping>>

export interface GeneratedResult {
  readonly url: string
  readonly timestamp: string
  readonly jobId: string
}

// --- Input Node Data ---

export type TextPromptData = {
  [key: string]: unknown
  label: string
  text: string
  variables: Record<string, string>
}

export type ListNodeData = {
  [key: string]: unknown
  label: string
  items: string
  fieldMappings: Record<string, string>
}

export type UploadImageData = {
  [key: string]: unknown
  label: string
  assetId: string
  url: string
  r2Url: string
  thumbnailUrl: string
  filename: string
  fileSize: number
  mimeType: string
  externalUrl: string
  isUploading: boolean
  uploadError: string
  metadata: {
    width?: number
    height?: number
    format?: string
  }
}

export type UploadVideoData = {
  [key: string]: unknown
  label: string
  assetId: string
  url: string
  r2Url: string
  thumbnailUrl: string
  filename: string
  fileSize: number
  mimeType: string
  externalUrl: string
  isUploading: boolean
  uploadError: string
  metadata: {
    width?: number
    height?: number
    durationSeconds?: number
    codec?: string
  }
}

export type UploadAudioData = {
  [key: string]: unknown
  label: string
  assetId: string
  url: string
  r2Url: string
  filename: string
  fileSize: number
  mimeType: string
  externalUrl: string
  isUploading: boolean
  uploadError: string
  metadata: {
    durationSeconds?: number
    codec?: string
    sampleRate?: number
  }
}

export type RSSFeedData = {
  [key: string]: unknown
  label: string
  feedUrl: string
  itemIndex: number
  extractFields: string[]
}

export type YouTubeVideoData = {
  [key: string]: unknown
  label: string
  youtubeUrl: string
  videoId: string
  title: string
  thumbnailUrl: string
  downloadedVideoUrl?: string
  downloadedThumbnailUrl?: string
  downloadStatus?: "idle" | "downloading" | "completed" | "failed"
  downloadError?: string
  downloadPercent?: number
  downloadPhase?: "downloading" | "processing" | "uploading"
  downloadedAudioUrl?: string
  audioDownloadStatus?: "idle" | "downloading" | "completed" | "failed"
  audioDownloadError?: string
}

export type ReferenceAudioData = {
  [key: string]: unknown
  label: string
  sourceType: "youtube" | "upload" | "url"
  youtubeUrl: string
  uploadedFileUrl: string
  directUrl: string
  videoTitle: string
  videoThumbnail: string
  videoDuration: string
  extractedAudioUrl: string
  extractionStatus: "idle" | "extracting" | "ready" | "failed"
}

// --- Parameter Node Data ---

export type ToneData = {
  [key: string]: unknown
  label: string
  tone: string
}

export type StyleGuideData = {
  [key: string]: unknown
  label: string
  text: string
}

export type ProviderData = {
  [key: string]: unknown
  label: string
  category: "image" | "video" | "voice" | "script"
  provider: string
  model: string
}

export type SceneCountData = {
  [key: string]: unknown
  label: string
  count: number
}

export type DurationData = {
  [key: string]: unknown
  label: string
  seconds: number
}

export type AspectRatioData = {
  [key: string]: unknown
  label: string
  ratio: "1:1" | "16:9" | "9:16" | "4:3" | "4:5"
}

export type MotionData = {
  [key: string]: unknown
  label: string
  motion: "subtle" | "moderate" | "dynamic"
}

export type CameraMotionData = {
  [key: string]: unknown
  label: string
  cameraMotion: "static" | "pan-left" | "pan-right" | "zoom-in" | "zoom-out"
}

// --- AI Node Data ---

export interface SceneImageVersion {
  readonly url: string
  readonly timestamp: string
  readonly jobId: string
}

export interface ScriptSceneCharacter {
  readonly name: string
  readonly description: string
  readonly mood: string
  readonly action: string
  readonly position?: string
}

export interface ScriptSceneDialogue {
  readonly speaker: string
  readonly text: string
  readonly emotion?: string
}

export interface ScriptSceneLocation {
  readonly name: string
  readonly description: string
  readonly timeOfDay: string
  readonly weather?: string
  readonly lighting?: string
}

export interface ScriptSceneCinematography {
  readonly shotType: string
  readonly cameraAngle: string
  readonly cameraMovement?: string
}

export interface ScriptScene {
  readonly sceneNumber: number
  readonly sceneName?: string
  readonly visualDescription: string
  readonly action: string
  readonly mood: string | readonly string[]
  readonly durationHint: number
  readonly duration?: number
  readonly imagePrompt: string
  // Structured characters (new) - falls back to string[] for old scripts
  readonly characters?: readonly string[] | readonly ScriptSceneCharacter[]
  // New fields
  readonly dialogue?: readonly ScriptSceneDialogue[]
  readonly location?: ScriptSceneLocation
  readonly cinematography?: ScriptSceneCinematography
  readonly musicMood?: string
  readonly soundEffects?: readonly string[]
  // UI state (unchanged)
  readonly generatedImages?: readonly SceneImageVersion[]
  readonly activeImageIndex?: number
  readonly imageStatus?: "idle" | "running" | "completed" | "failed"
}

/** Extract character names from either string[] or ScriptSceneCharacter[] */
export function getSceneCharacterNames(characters: ScriptScene["characters"]): readonly string[] {
  if (!characters || characters.length === 0) return []
  if (typeof characters[0] === "string") return characters as readonly string[]
  return (characters as readonly ScriptSceneCharacter[]).map((c) => c.name)
}

/** Get mood as a display string regardless of format */
export function getSceneMoodDisplay(mood: ScriptScene["mood"]): string {
  if (Array.isArray(mood)) return mood.join(", ")
  return (mood as string) ?? ""
}

/** Map a ScriptScene to partial SceneNodeDataType fields for import/sync */
export function mapScriptSceneToNodeData(
  scene: ScriptScene,
): Partial<SceneNodeDataType> {
  const characters: SceneCharacterEntry[] = scene.characters
    ? (typeof scene.characters[0] === "string"
        ? (scene.characters as readonly string[]).map(() => ({
            assetId: "",
            mood: "",
            action: "",
          }))
        : (scene.characters as readonly ScriptSceneCharacter[]).map((c) => ({
            assetId: "",
            mood: c.mood ?? "",
            action: c.action ?? "",
            positionInFrame: (c.position as SceneCharacterEntry["positionInFrame"]) ?? undefined,
          })))
    : []

  const dialogue: SceneDialogueEntry[] = scene.dialogue
    ? scene.dialogue.map((d) => ({
        characterId: undefined,
        characterName: d.speaker ?? "",
        text: d.text ?? "",
        emotion: d.emotion ?? undefined,
      }))
    : []

  const locations: SceneLocationEntry[] = scene.location
    ? [{
        assetId: "",
        name: scene.location.name ?? "",
        isPrimary: true,
        timeOfDay: (scene.location.timeOfDay as SceneLocationEntry["timeOfDay"]) ?? undefined,
        weather: (scene.location.weather as SceneLocationEntry["weather"]) ?? undefined,
        lighting: (scene.location.lighting as SceneLocationEntry["lighting"]) ?? undefined,
      }]
    : []

  const mood: string[] = Array.isArray(scene.mood)
    ? [...scene.mood]
    : scene.mood ? [scene.mood as string] : []

  const result: Partial<SceneNodeDataType> = {
    sceneName: scene.sceneName ?? "",
    summary: scene.visualDescription ?? "",
    duration: scene.duration ?? scene.durationHint ?? 5,
    mood,
    musicMood: scene.musicMood ?? "",
    soundEffects: scene.soundEffects ? [...scene.soundEffects] : [],
    characters,
    dialogue,
    locations,
    generatedPrompt: scene.imagePrompt ?? "",
    narration: scene.action ?? "",
  }

  if (scene.cinematography) {
    const c = scene.cinematography
    if (c.shotType) result.shotType = c.shotType as SceneNodeDataType["shotType"]
    if (c.cameraAngle) result.cameraAngle = c.cameraAngle as SceneNodeDataType["cameraAngle"]
    if (c.cameraMovement) result.cameraMovement = c.cameraMovement as SceneNodeDataType["cameraMovement"]
  }

  if (scene.location?.timeOfDay) {
    result.timeOfDay = scene.location.timeOfDay as SceneNodeDataType["timeOfDay"]
  }
  if (scene.location?.weather) {
    result.weather = scene.location.weather as SceneNodeDataType["weather"]
  }
  if (scene.location?.lighting) {
    result.lighting = scene.location.lighting as SceneNodeDataType["lighting"]
  }

  // Carry over generated images if present
  if (scene.generatedImages && scene.generatedImages.length > 0) {
    const activeIdx = scene.activeImageIndex ?? 0
    const activeImg = scene.generatedImages[activeIdx]
    if (activeImg?.url) {
      result.generatedResults = scene.generatedImages.map((img) => ({
        url: img.url,
        timestamp: img.timestamp,
        jobId: img.jobId ?? "",
      }))
      result.activeResultIndex = activeIdx
      result.generatedImageUrl = activeImg.url
    }
  }

  return result
}

export interface ExtractedReference {
  readonly id: string
  readonly name: string
  readonly type: "character" | "location" | "object"
  readonly imageUrl: string
  readonly sourceSceneIndex: number
  readonly boundingBox: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

export interface CharacterDefinition {
  readonly id: string
  readonly name: string
  readonly type: "reference" | "description"
  readonly category?: "character" | "face" | "location" | "object"
  readonly referenceImageUrl?: string
  readonly description?: string
  readonly sourceSceneIndex?: number
  readonly importedFrom?: {
    readonly workflowId: string
    readonly workflowName: string
  }
}

export interface GeneratedScript {
  readonly title: string
  readonly totalDuration: number
  readonly scenes: readonly ScriptScene[]
  readonly extractedReferences?: readonly ExtractedReference[]
}

export interface GeneratedScriptResult {
  readonly script: GeneratedScript
  readonly timestamp: string
  readonly jobId: string
}

export type GenerateScriptData = {
  [key: string]: unknown
  label: string
  provider: "gemini" | "claude" | "gpt"
  model: string
  sceneCount: number
  styleGuide: string
  structure: "freeform" | "8-step" | "custom"
  tone: string
  targetLength: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedScript?: GeneratedScript
  generatedResults?: GeneratedScriptResult[]
  activeResultIndex?: number
}

// Image providers available on Replicate
export type ReplicateImageProvider = "nano-banana" | "flux" | "dalle"

// Additional image providers available only on KIE.ai
export type KieImageProvider =
  | "nano-banana" | "nano-banana-pro"
  | "flux" | "flux-i2i"
  | "grok" | "grok-i2i"
  | "gpt-image" | "gpt-image-i2i"

// All image providers (union of both)
export type ImageProvider = ReplicateImageProvider | KieImageProvider

export type GenerateImageData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: ImageProvider
  model: string
  style: string
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3"
  negativePrompt: string
  referenceImageUrl?: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  characterDefinitionIds?: readonly string[]
}

// Edit Image providers (KIE.ai only)
export type EditImageProvider = "recraft-upscale" | "recraft-remove-bg" | "nano-banana-edit"

export type EditImageData = {
  [key: string]: unknown
  label: string
  prompt: string  // Used for nano-banana-edit (edit instructions)
  provider: EditImageProvider
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

// Image-to-Image providers (transform source image with prompt)
export type ImageToImageProvider = "nano-banana" | "nano-banana-pro" | "flux-i2i" | "flux-pro-i2i" | "grok-i2i" | "gpt-image-i2i"

export type ImageToImageData = {
  [key: string]: unknown
  label: string
  prompt: string  // Transformation prompt
  provider: ImageToImageProvider
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type ImageToVideoData = {
  [key: string]: unknown
  label: string
  provider: "minimax" | "veo" | "veo3" | "veo3.1" | "kling" | "kling-3.0" | "runway" | "pika" | "kling-turbo" | "grok-i2v" | "sora2-pro"
  model: string
  duration: number
  motion: "subtle" | "moderate" | "dynamic"
  cameraMotion: "static" | "pan-left" | "pan-right" | "zoom-in" | "zoom-out"
  motionPrompt?: string  // Text description of desired motion/animation (required for Sora2)
  generateAudio?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  // Multi-input selection fields
  selectedStartFrameNodeId?: string  // ID of node selected for start frame
  selectedEndFrameNodeId?: string    // ID of node selected for end frame (optional)
  selectedAudioNodeId?: string       // ID of node selected for audio track (optional)
  // Progress tracking fields
  currentJobId?: string              // ID of the currently running job (for progress polling)
  currentJobProgress?: number        // Progress percentage from backend (0-100)
}

export type TextToSpeechData = {
  [key: string]: unknown
  label: string
  provider: "elevenlabs-turbo" | "elevenlabs-multilingual" | "elevenlabs"
  voiceId: string
  language: string
  speed: number
  stability: number
  similarityBoost: number
  style: number
  languageCode: string
  textSource: "connected" | "direct"
  directText: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type TextToVideoData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: "minimax" | "runway" | "pika" | "sora" | "veo" | "veo3" | "veo3.1" | "kling" | "kling-turbo" | "grok" | "sora2-pro"
  model: string
  duration: number
  aspectRatio: "16:9" | "9:16" | "1:1"
  negativePrompt: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  // Progress tracking fields
  currentJobId?: string              // ID of the currently running job (for progress polling)
  currentJobProgress?: number        // Progress percentage from backend (0-100)
}

export type VideoToVideoData = {
  [key: string]: unknown
  label: string
  prompt: string
  // V2V uses Wan 2.6 only via KIE.ai (Replicate doesn't support video input)
  // No provider selection - single provider (wan)
  duration: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  // Progress tracking fields
  currentJobId?: string              // ID of the currently running job (for progress polling)
  currentJobProgress?: number        // Progress percentage from backend (0-100)
}

export type LipSyncData = {
  [key: string]: unknown
  label: string
  provider: "kling-avatar" | "kling-avatar-pro" | "infinitalk"
  resolution: "480p" | "720p"
  prompt: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  // Multi-input selection fields
  selectedImageNodeId?: string   // ID of node selected for portrait/face image
  selectedAudioNodeId?: string   // ID of node selected for audio track
}

// Motion Transfer: Apply motion from video to image character
// KIE.ai model: kling-2.6/motion-control
export type MotionTransferData = {
  [key: string]: unknown
  label: string
  prompt: string // Optional, max 2500 chars
  characterOrientation: "image" | "video" // image = max 10s, video = max 30s
  resolution: "720p" | "1080p"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

// Video Upscale: Upscale video resolution using Topaz
// KIE.ai model: topaz/video-upscale
export type VideoUpscaleData = {
  [key: string]: unknown
  label: string
  upscaleFactor: "1" | "2" | "4"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type QACheckData = {
  [key: string]: unknown
  label: string
  provider: "claude" | "gpt"
  checkType: "content" | "quality" | "consistency" | "safety"
  threshold: number
  fieldMappings: FieldMappings
}

export type GenerateMusicData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: "musicgen" | "minimax" | "lyria" | "bark"
  duration: number
  genre: string
  mood: string
  instrumental: boolean
  lyrics: string
  referenceAudioUrl: string
  referenceYouTubeUrl: string
  referenceSource: "none" | "upload" | "youtube"
  modelVersion: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type TextToAudioData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: "tangoflux" | "elevenlabs-sfx"
  duration: number
  loop?: boolean
  promptInfluence?: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type SunoGenerateData = {
  [key: string]: unknown
  label: string
  prompt: string
  model: "V4" | "V4_5" | "V4_5PLUS" | "V4_5ALL" | "V5"
  lyrics?: string
  style?: string
  title?: string
  negativeStyle?: string
  vocalGender?: "male" | "female"
  styleWeight?: number
  weirdnessConstraint?: number
  audioWeight?: number
  customMode?: boolean
  instrumental?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type SunoCoverData = {
  [key: string]: unknown
  label: string
  prompt: string
  model: "V4" | "V4_5" | "V4_5PLUS" | "V4_5ALL" | "V5"
  uploadUrl?: string
  lyrics?: string
  style?: string
  title?: string
  negativeStyle?: string
  vocalGender?: "male" | "female"
  customMode?: boolean
  instrumental?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type SunoExtendData = {
  [key: string]: unknown
  label: string
  audioId: string
  defaultParamFlag: boolean
  prompt: string
  model: "V4" | "V4_5" | "V4_5PLUS" | "V4_5ALL" | "V5"
  style?: string
  title?: string
  continueAt?: number
  negativeStyle?: string
  vocalGender?: "male" | "female"
  styleWeight?: number
  weirdnessConstraint?: number
  audioWeight?: number
  instrumental?: boolean
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  fieldMappings?: FieldMappings
}

export type SunoLyricsData = {
  [key: string]: unknown
  label: string
  prompt: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedText?: string
  generatedTitle?: string
  generatedResults?: Array<{ text: string; title: string; jobId?: string }>
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  fieldMappings?: FieldMappings
}

export type SunoSeparateData = {
  [key: string]: unknown
  label: string
  type: "separate_vocal" | "split_stem"
  taskId: string
  audioId: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  vocalUrl?: string
  instrumentalUrl?: string
  stems?: Record<string, string>
  currentJobId?: string
  currentJobProgress?: number
  fieldMappings?: FieldMappings
}

export type SunoMusicVideoData = {
  [key: string]: unknown
  label: string
  taskId: string
  audioId: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  currentJobId?: string
  currentJobProgress?: number
  fieldMappings?: FieldMappings
}

export type TranscribeData = {
  [key: string]: unknown
  label: string
  provider: "whisper" | "incredibly-fast-whisper"
  language: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedText?: string
  generatedResults?: Array<{ text: string; language: string; jobId: string; timestamp: string }>
  activeResultIndex?: number
}

// --- Processing Node Data ---

export type CombineVideosData = {
  [key: string]: unknown
  label: string
  transition: "cut" | "fade" | "dissolve"
  transitionDuration: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export interface MergeAudioTrack {
  readonly id: string
  readonly sourceNodeId: string
  readonly sourceNodeLabel: string
  readonly sourceType: "audio" | "video"
  readonly role: "dialogue" | "background" | "effect" | "narration"
  readonly volume: number
  readonly startTime: number
}

export type MergeVideoAudioData = {
  [key: string]: unknown
  label: string
  // Main video's embedded audio
  keepOriginalAudio?: boolean
  originalAudioVolume?: number
  originalAudioRole?: "background" | "effect" | "narration"
  // Per-track settings keyed by source node ID
  trackSettings?: Record<string, { role: string; volume: number; startTime: number }>
  // Legacy fields (backward compat)
  audioType: "voiceover" | "background" | "both"
  voiceoverVolume: number
  backgroundVolume: number
  audioOffsets?: Record<string, number>
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type AddCaptionsData = {
  [key: string]: unknown
  label: string
  style: "subtitle" | "word-highlight" | "karaoke"
  position: "bottom" | "top" | "center"
  fontSize: number
  color: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type ResizeVideoData = {
  [key: string]: unknown
  label: string
  targetAspect: "1:1" | "16:9" | "9:16" | "4:5"
  method: "crop" | "pad" | "stretch"
  padColor: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type ExtractAudioData = {
  [key: string]: unknown
  label: string
  outputSilentVideo: boolean
  audioFormat: "mp3" | "wav" | "aac"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type MixAudioData = {
  [key: string]: unknown
  label: string
  trackCount: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type AdjustVolumeData = {
  [key: string]: unknown
  label: string
  volume: number
  normalize: boolean
  fadeIn: number
  fadeOut: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedVideoUrl?: string
  lastInputType?: "audio" | "video"
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type TrimVideoData = {
  [key: string]: unknown
  label: string
  startTime: number
  endTime: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

// --- Output Node Data ---

export type SaveToStorageData = {
  [key: string]: unknown
  label: string
  filename: string
  format: "mp4" | "webm" | "mov"
  quality: "draft" | "standard" | "high" | "4k"
  fieldMappings: FieldMappings
}

export type WebhookOutputData = {
  [key: string]: unknown
  label: string
  webhookId: string
  includeAssetUrl: boolean
  fieldMappings: FieldMappings
}

// --- Character Node Data ---

export interface CharacterSheet {
  readonly frontView: string
  readonly sideView: string
  readonly backView: string
  readonly combinedSheet: string
}

export interface CharacterAssetItem {
  readonly name: string
  readonly url: string
}

export type CharacterAssetType = "expressions" | "poses" | "lighting" | "angles" | "custom"

export type CharacterNodeData = {
  [key: string]: unknown
  label: string
  characterDbId: string
  characterName: string
  description: string
  sourceImageUrl: string
  gender: "male" | "female" | "other"
  style: "realistic" | "anime" | "3d-pixar" | "illustration"
  baseOutfit: string
  characterSheet: CharacterSheet | null
  projectId: string
  createdAt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  fieldMappings: FieldMappings
  // Asset sheets (combined grid images)
  expressionSheet: string
  poseSheet: string
  lightingSheet: string
  anglesSheet: string
  // Individual cropped images
  expressions: CharacterAssetItem[]
  poses: CharacterAssetItem[]
  lightingVariations: CharacterAssetItem[]
  angles: CharacterAssetItem[]
  // Asset generation status
  expressionStatus: "idle" | "running" | "completed" | "failed"
  poseStatus: "idle" | "running" | "completed" | "failed"
  lightingStatus: "idle" | "running" | "completed" | "failed"
  anglesStatus: "idle" | "running" | "completed" | "failed"
  // Custom variations
  customVariations: Array<{ prompt: string; url: string; createdAt: string }>
}

// --- Object Node Data ---

export interface ObjectAssetItem {
  readonly name: string
  readonly url: string
}

export type ObjectAssetType = "angles" | "materials" | "variations" | "custom"

export type ObjectNodeData = {
  [key: string]: unknown
  label: string
  objectDbId: string
  objectName: string
  description: string
  category: "furniture" | "vehicle" | "weapon" | "food" | "clothing" | "electronics" | "nature" | "tool" | "other"
  style: "realistic" | "anime" | "3d-pixar" | "illustration"
  sourceImageUrl: string
  projectId: string
  createdAt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  fieldMappings: FieldMappings
  // Individual asset images
  angles: ObjectAssetItem[]
  materials: ObjectAssetItem[]
  variations: ObjectAssetItem[]
  // Asset generation status
  anglesStatus: "idle" | "running" | "completed" | "failed"
  materialsStatus: "idle" | "running" | "completed" | "failed"
  variationsStatus: "idle" | "running" | "completed" | "failed"
  // Custom variations
  customVariations: Array<{ prompt: string; url: string; createdAt: string }>
}

// --- Location Node Data ---

export interface LocationAssetItem {
  readonly name: string
  readonly url: string
}

export type LocationAssetType = "timeOfDay" | "weather" | "angles" | "custom"

export type LocationNodeData = {
  [key: string]: unknown
  label: string
  locationDbId: string
  locationName: string
  description: string
  category: "indoor" | "outdoor" | "urban" | "nature" | "fantasy" | "sci-fi" | "historical" | "futuristic" | "other"
  style: "realistic" | "anime" | "3d-pixar" | "illustration"
  sourceImageUrl: string
  projectId: string
  createdAt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  fieldMappings: FieldMappings
  // Individual asset images
  timeOfDay: LocationAssetItem[]
  weather: LocationAssetItem[]
  angles: LocationAssetItem[]
  // Asset generation status
  timeOfDayStatus: "idle" | "running" | "completed" | "failed"
  weatherStatus: "idle" | "running" | "completed" | "failed"
  anglesStatus: "idle" | "running" | "completed" | "failed"
  // Custom variations
  customVariations: Array<{ prompt: string; url: string; createdAt: string }>
}

// --- Face Node Data ---

export type FaceNodeData = {
  [key: string]: unknown
  label: string
  faceDbId: string
  faceName: string
  description: string
  sourceImageUrl: string
  style: "realistic" | "anime" | "3d-pixar" | "illustration"
  projectId: string
  createdAt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  fieldMappings: FieldMappings
}

// --- AI Writer Node Data ---

export type AIWriterNodeData = {
  [key: string]: unknown
  label: string
  templateId: string
  systemPrompt: string
  userInput: string
  provider: "gemini" | "claude" | "gpt"
  model: string
  temperature: number
  maxTokens: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedText?: string
  generatedItems?: string[]
  generatedResults?: Array<{ text: string; jobId?: string; timestamp?: string }>
  activeResultIndex?: number
  createdNodeIds?: string[]
}

// --- Combine Text Node Data ---

export type CombineTextNodeData = {
  [key: string]: unknown
  label: string
  separator: "newline" | "comma" | "space" | "double-newline" | "custom"
  customSeparator: string
  combinedText: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
}

// --- Sticky Note Node Data ---

export type StickyNoteData = {
  [key: string]: unknown
  label: string
  text: string
  color: string // Background hex color (e.g., "#fef3c7")
  textColor: string // Text hex color (e.g., "#000000")
  width: number
  height: number
  fontSize: "sm" | "base" | "lg" | "xl"
  bold: boolean
  italic: boolean
  alignment: "left" | "center" | "right"
}

// --- Scene Node Data ---

export interface SceneCharacterEntry {
  readonly assetId: string
  readonly mood: string
  readonly action: string
  readonly positionInFrame?: "left" | "center" | "right" | "foreground" | "background"
}

export interface SceneObjectEntry {
  readonly assetId: string
  readonly description?: string
}

export interface DialogueAudioResult {
  readonly url: string
  readonly jobId: string
  readonly voiceId: string
  readonly createdAt: string
}

export interface SceneDialogueEntry {
  readonly characterId?: string
  readonly characterName: string
  readonly text: string
  readonly emotion?: string
  readonly voiceId?: string
  readonly generatedAudioResults?: readonly DialogueAudioResult[]
  readonly activeAudioIndex?: number
}

export interface AudioAssignment {
  readonly handleId: string
  readonly sourceNodeId?: string
  readonly dialogueIndex?: number
  readonly role?: "dialogue" | "narration" | "background" | "sfx"
}

export interface SceneLocationEntry {
  readonly assetId: string
  readonly name?: string
  readonly isPrimary?: boolean
  readonly timeOfDay?: "dawn" | "morning" | "noon" | "afternoon" | "sunset" | "evening" | "night"
  readonly weather?: "clear" | "cloudy" | "rainy" | "stormy" | "foggy" | "snowy"
  readonly lighting?: "natural" | "artificial" | "dramatic" | "soft" | "harsh" | "backlit"
}

export type SceneNodeDataType = {
  [key: string]: unknown
  label: string
  sceneName: string
  sceneNumber: number
  duration: number
  summary: string
  characters: SceneCharacterEntry[]
  dialogue: SceneDialogueEntry[]
  locations: SceneLocationEntry[]
  timeOfDay: "dawn" | "morning" | "noon" | "afternoon" | "sunset" | "evening" | "night"
  weather: "clear" | "cloudy" | "rainy" | "stormy" | "foggy" | "snowy"
  lighting: "natural" | "artificial" | "dramatic" | "soft" | "harsh" | "backlit"
  objects: SceneObjectEntry[]
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "21:9" | "4:5"
  shotType: "extreme-wide" | "wide" | "medium-wide" | "medium" | "medium-close" | "close-up" | "extreme-close-up"
  cameraAngle: "eye-level" | "low-angle" | "high-angle" | "birds-eye" | "worms-eye" | "dutch"
  cameraMovement: "static" | "pan" | "tilt" | "dolly" | "tracking" | "crane" | "handheld" | "zoom"
  depthOfField: "deep" | "medium" | "shallow"
  lensType: "wide" | "normal" | "telephoto"
  mood: string[]
  colorPalette: string[]
  visualStyle: "realistic" | "cinematic" | "anime" | "cartoon" | "noir" | "vintage" | "fantasy" | "sci-fi"
  narration: string
  musicMood: string
  soundEffects: string[]
  transitionIn: "cut" | "fade" | "dissolve" | "wipe"
  transitionOut: "cut" | "fade" | "dissolve" | "wipe"
  directorNotes: string
  referenceUrls: string[]
  generatedPrompt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  generatedImageUrl: string
  fieldMappings: FieldMappings
  sourceScriptNodeId: string
  sourceSceneIndex: number
  autoSyncWithScript: boolean
  audioAssignments: AudioAssignment[]
  videoProvider: "minimax" | "veo" | "veo3" | "veo3.1" | "kling" | "runway" | "pika"
  generatedVideoResults: GeneratedResult[]
  activeVideoResultIndex: number
  generatedVideoUrl: string
  videoExecutionStatus: "idle" | "running" | "completed" | "failed"
}

// --- Union Types ---

export type SceneNodeData =
  | TextPromptData
  | UploadImageData
  | UploadVideoData
  | UploadAudioData
  | RSSFeedData
  | YouTubeVideoData
  | ReferenceAudioData
  | ToneData
  | StyleGuideData
  | ProviderData
  | SceneCountData
  | DurationData
  | AspectRatioData
  | MotionData
  | CameraMotionData
  | GenerateScriptData
  | GenerateImageData
  | EditImageData
  | ImageToImageData
  | ImageToVideoData
  | VideoToVideoData
  | TextToVideoData
  | TextToSpeechData
  | QACheckData
  | GenerateMusicData
  | TextToAudioData
  | SunoGenerateData
  | SunoCoverData
  | SunoExtendData
  | SunoLyricsData
  | SunoSeparateData
  | SunoMusicVideoData
  | TranscribeData
  | CombineVideosData
  | MergeVideoAudioData
  | AddCaptionsData
  | ResizeVideoData
  | ExtractAudioData
  | MixAudioData
  | AdjustVolumeData
  | TrimVideoData
  | LipSyncData
  | MotionTransferData
  | VideoUpscaleData
  | SaveToStorageData
  | WebhookOutputData
  | SceneNodeDataType
  | CharacterNodeData
  | ObjectNodeData
  | LocationNodeData
  | FaceNodeData
  | AIWriterNodeData
  | ListNodeData
  | CombineTextNodeData
  | StickyNoteData

export type SceneNodeType =
  | "text-prompt"
  | "list"
  | "upload-image"
  | "upload-video"
  | "upload-audio"
  | "rss-feed"
  | "youtube-video"
  | "reference-audio"
  | "tone"
  | "style-guide"
  | "provider"
  | "scene-count"
  | "duration"
  | "aspect-ratio"
  | "motion"
  | "camera-motion"
  | "generate-script"
  | "generate-image"
  | "edit-image"
  | "image-to-image"
  | "image-to-video"
  | "video-to-video"
  | "text-to-video"
  | "text-to-speech"
  | "qa-check"
  | "generate-music"
  | "text-to-audio"
  | "suno-generate"
  | "suno-cover"
  | "suno-extend"
  | "suno-lyrics"
  | "suno-separate"
  | "suno-music-video"
  | "transcribe"
  | "combine-videos"
  | "merge-video-audio"
  | "add-captions"
  | "resize-video"
  | "extract-audio"
  | "mix-audio"
  | "adjust-volume"
  | "trim-video"
  | "lip-sync"
  | "motion-transfer"
  | "video-upscale"
  | "save-to-storage"
  | "webhook-output"
  | "scene"
  | "character"
  | "face"
  | "object"
  | "location"
  | "ai-writer"
  | "combine-text"
  | "sticky-note"

export type WorkflowNode = Node<SceneNodeData, SceneNodeType>
export type WorkflowEdge = Edge

export interface NodeTypeDefinition {
  readonly type: SceneNodeType
  readonly label: string
  readonly category: NodeCategory
  readonly creditCost: number
  readonly inputs: ReadonlyArray<string>
  readonly outputs: ReadonlyArray<string>
  readonly defaultData: SceneNodeData
}

export const NODE_DEFINITIONS: ReadonlyArray<NodeTypeDefinition> = [
  // Input
  {
    type: "text-prompt",
    label: "Text Prompt",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["prompt"],
    defaultData: { label: "Text Prompt", text: "", variables: {} },
  },
  {
    type: "list",
    label: "List",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["list"],
    defaultData: { label: "List", items: "", fieldMappings: {} },
  },
  {
    type: "upload-image",
    label: "Upload Image",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["image"],
    defaultData: { label: "Upload Image", assetId: "", url: "" } as unknown as SceneNodeData,
  },
  {
    type: "upload-video",
    label: "Upload Video",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["video"],
    defaultData: { label: "Upload Video", assetId: "", url: "" } as unknown as SceneNodeData,
  },
  {
    type: "upload-audio",
    label: "Upload Audio",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["audio"],
    defaultData: { label: "Upload Audio", assetId: "", url: "" } as unknown as SceneNodeData,
  },
  {
    type: "rss-feed",
    label: "RSS Feed",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["content"],
    defaultData: { label: "RSS Feed", feedUrl: "", itemIndex: 0, extractFields: ["title", "description"] },
  },
  {
    type: "youtube-video",
    label: "Video URL",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["video"],
    defaultData: { label: "Video URL", youtubeUrl: "", videoId: "", title: "", thumbnailUrl: "" },
  },
  {
    type: "reference-audio",
    label: "Reference Audio",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["audio"],
    defaultData: { label: "Reference Audio", sourceType: "youtube", youtubeUrl: "", uploadedFileUrl: "", directUrl: "", videoTitle: "", videoThumbnail: "", videoDuration: "", extractedAudioUrl: "", extractionStatus: "idle" },
  },
  // Parameter
  {
    type: "tone",
    label: "Tone",
    category: "parameter",
    creditCost: 0,
    inputs: [],
    outputs: ["tone"],
    defaultData: { label: "Tone", tone: "" },
  },
  {
    type: "style-guide",
    label: "Style Guide",
    category: "parameter",
    creditCost: 0,
    inputs: [],
    outputs: ["style_guide"],
    defaultData: { label: "Style Guide", text: "" },
  },
  {
    type: "provider",
    label: "Provider",
    category: "parameter",
    creditCost: 0,
    inputs: [],
    outputs: ["provider"],
    defaultData: { label: "Provider", category: "image", provider: "nano-banana", model: "" },
  },
  {
    type: "scene-count",
    label: "Scene Count",
    category: "parameter",
    creditCost: 0,
    inputs: [],
    outputs: ["scene_count"],
    defaultData: { label: "Scene Count", count: 5 },
  },
  {
    type: "duration",
    label: "Duration",
    category: "parameter",
    creditCost: 0,
    inputs: [],
    outputs: ["duration"],
    defaultData: { label: "Duration", seconds: 60 },
  },
  {
    type: "aspect-ratio",
    label: "Aspect Ratio",
    category: "parameter",
    creditCost: 0,
    inputs: [],
    outputs: ["aspect_ratio"],
    defaultData: { label: "Aspect Ratio", ratio: "16:9" },
  },
  {
    type: "motion",
    label: "Motion",
    category: "parameter",
    creditCost: 0,
    inputs: [],
    outputs: ["out"],
    defaultData: { label: "Motion", motion: "moderate" },
  },
  {
    type: "camera-motion",
    label: "Camera Motion",
    category: "parameter",
    creditCost: 0,
    inputs: [],
    outputs: ["out"],
    defaultData: { label: "Camera Motion", cameraMotion: "static" },
  },
  // AI
  {
    type: "generate-script",
    label: "Generate Script",
    category: "ai",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["scenes"],
    defaultData: { label: "Generate Script", provider: "gemini", model: "gemini-2.5-flash", sceneCount: 5, styleGuide: "", structure: "freeform", tone: "", targetLength: 60, fieldMappings: {} },
  },
  {
    type: "generate-image",
    label: "Generate Image",
    category: "ai",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["image"],
    defaultData: { label: "Generate Image", prompt: "", provider: "nano-banana-pro", model: "gemini-2.5-flash-image", style: "", aspectRatio: "16:9", negativePrompt: "", fieldMappings: {} },
  },
  {
    type: "edit-image",
    label: "Edit Image",
    category: "ai",
    creditCost: 3,
    inputs: ["image"],
    outputs: ["out"],
    defaultData: { label: "Edit Image", prompt: "", provider: "recraft-upscale", fieldMappings: {} },
  },
  {
    type: "image-to-image",
    label: "Image to Image",
    category: "ai",
    creditCost: 5,
    inputs: ["image"],
    outputs: ["out"],
    defaultData: { label: "Image to Image", prompt: "", provider: "nano-banana", fieldMappings: {} },
  },
  {
    type: "image-to-video",
    label: "Image to Video",
    category: "ai",
    creditCost: 20,
    inputs: ["startFrame", "endFrame", "audio"],
    outputs: ["video"],
    defaultData: { label: "Image to Video", provider: "veo3", model: "veo-3", duration: 5, motion: "moderate", cameraMotion: "static", fieldMappings: {} },
  },
  {
    type: "video-to-video",
    label: "Video to Video",
    category: "ai",
    creditCost: 25,
    inputs: ["in"],
    outputs: ["video"],
    // V2V uses Wan 2.6 only via KIE.ai (no provider selection needed)
    defaultData: { label: "Video to Video", prompt: "", duration: 5, fieldMappings: {} },
  },
  {
    type: "text-to-video",
    label: "Text to Video",
    category: "ai",
    creditCost: 25,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Text to Video", prompt: "", provider: "runway", model: "gen-3-alpha", duration: 5, aspectRatio: "16:9", negativePrompt: "", fieldMappings: {} },
  },
  {
    type: "text-to-speech",
    label: "Text to Speech",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Text to Speech", provider: "elevenlabs-turbo", voiceId: "Rachel", language: "en", speed: 1, stability: 0.5, similarityBoost: 0.75, style: 0, languageCode: "", textSource: "connected", directText: "", fieldMappings: {} },
  },
  {
    type: "qa-check",
    label: "QA Check",
    category: "ai",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["approved", "rejected"],
    defaultData: { label: "QA Check", provider: "claude", checkType: "quality", threshold: 0.8, fieldMappings: {} },
  },
  {
    type: "generate-music",
    label: "Generate Music",
    category: "ai",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Generate Music", prompt: "", provider: "musicgen", duration: 8, genre: "", mood: "", instrumental: true, lyrics: "", referenceAudioUrl: "", referenceYouTubeUrl: "", referenceSource: "none", modelVersion: "stereo-large", fieldMappings: {} },
  },
  {
    type: "text-to-audio",
    label: "Text to Audio",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Text to Audio", prompt: "", provider: "tangoflux", duration: 10, fieldMappings: {} },
  },
  {
    type: "suno-generate",
    label: "Suno Generate",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Suno Generate", prompt: "", model: "V5", lyrics: "", style: "", title: "", negativeStyle: "", fieldMappings: {} } as SunoGenerateData,
  },
  {
    type: "suno-cover",
    label: "Suno Cover",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Suno Cover", prompt: "", model: "V5", uploadUrl: "", lyrics: "", style: "", title: "", negativeStyle: "", fieldMappings: {} } as SunoCoverData,
  },
  {
    type: "suno-extend",
    label: "Suno Extend",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Suno Extend", audioId: "", defaultParamFlag: true, prompt: "", model: "V5", style: "", title: "", continueAt: 0, negativeStyle: "", fieldMappings: {} } as SunoExtendData,
  },
  {
    type: "suno-lyrics",
    label: "Suno Lyrics",
    category: "ai",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["text"],
    defaultData: { label: "Suno Lyrics", prompt: "", fieldMappings: {} } as SunoLyricsData,
  },
  {
    type: "suno-separate",
    label: "Suno Separate",
    category: "ai",
    creditCost: 2,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Separate", type: "separate_vocal", taskId: "", audioId: "", fieldMappings: {} } as SunoSeparateData,
  },
  {
    type: "suno-music-video",
    label: "Suno Music Video",
    category: "ai",
    creditCost: 1,
    inputs: ["audio"],
    outputs: ["video"],
    defaultData: { label: "Suno Music Video", taskId: "", audioId: "", fieldMappings: {} } as SunoMusicVideoData,
  },
  {
    type: "transcribe",
    label: "Transcribe",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["text"],
    defaultData: { label: "Transcribe", provider: "whisper", language: "auto", fieldMappings: {} },
  },
  // Processing
  {
    type: "combine-videos",
    label: "Combine Videos",
    category: "processing",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Combine Videos", transition: "cut", transitionDuration: 0.5, fieldMappings: {} },
  },
  {
    type: "merge-video-audio",
    label: "Merge Video & Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Merge Video & Audio", audioType: "voiceover", voiceoverVolume: 100, backgroundVolume: 30, keepOriginalAudio: true, originalAudioVolume: 30, originalAudioRole: "background", trackSettings: {}, fieldMappings: {} },
  },
  {
    type: "add-captions",
    label: "Add Captions",
    category: "processing",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Add Captions", style: "subtitle", position: "bottom", fontSize: 24, color: "#ffffff", fieldMappings: {} },
  },
  {
    type: "resize-video",
    label: "Resize Video",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Resize Video", targetAspect: "9:16", method: "crop", padColor: "#000000", fieldMappings: {} },
  },
  {
    type: "extract-audio",
    label: "Extract Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["audio", "silent-video"],
    defaultData: { label: "Extract Audio", outputSilentVideo: true, audioFormat: "mp3", fieldMappings: {} },
  },
  {
    type: "mix-audio",
    label: "Mix Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Mix Audio", trackCount: 2, fieldMappings: {} },
  },
  {
    type: "adjust-volume",
    label: "Adjust Volume",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Adjust Volume", volume: 100, normalize: false, fadeIn: 0, fadeOut: 0, fieldMappings: {} },
  },
  {
    type: "trim-video",
    label: "Trim Video",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Trim Video", startTime: 0, endTime: 0, fieldMappings: {} },
  },
  // Lip Sync / AI Avatar
  {
    type: "lip-sync",
    label: "Lip Sync",
    category: "ai",
    creditCost: 40,
    inputs: ["image", "audio"],
    outputs: ["video"],
    defaultData: {
      label: "Lip Sync",
      provider: "kling-avatar",
      resolution: "720p",
      prompt: "",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as LipSyncData,
  },
  // Motion Transfer (Kling 2.6 Motion Control)
  {
    type: "motion-transfer",
    label: "Motion Transfer",
    category: "ai",
    creditCost: 30,
    inputs: ["image", "video"],
    outputs: ["out"],
    defaultData: {
      label: "Motion Transfer",
      prompt: "",
      characterOrientation: "video",
      resolution: "720p",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as MotionTransferData,
  },
  // Video Upscale (Topaz)
  {
    type: "video-upscale",
    label: "Video Upscale",
    category: "processing",
    creditCost: 15,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: {
      label: "Video Upscale",
      upscaleFactor: "2",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as VideoUpscaleData,
  },
  // Output
  {
    type: "save-to-storage",
    label: "Save to Storage",
    category: "output",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["asset"],
    defaultData: { label: "Save to Storage", filename: "", format: "mp4", quality: "standard", fieldMappings: {} },
  },
  {
    type: "webhook-output",
    label: "Webhook Output",
    category: "output",
    creditCost: 0,
    inputs: ["in"],
    outputs: [],
    defaultData: { label: "Webhook Output", webhookId: "", includeAssetUrl: true, fieldMappings: {} },
  },
  // Character
  {
    type: "character",
    label: "Character",
    category: "character",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["characterRef"],
    defaultData: {
      label: "Character",
      characterDbId: "",
      characterName: "",
      description: "",
      sourceImageUrl: "",
      gender: "other",
      style: "realistic",
      baseOutfit: "",
      characterSheet: null,
      projectId: "",
      createdAt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      fieldMappings: {},
      expressionSheet: "",
      poseSheet: "",
      lightingSheet: "",
      anglesSheet: "",
      expressions: [],
      poses: [],
      lightingVariations: [],
      angles: [],
      expressionStatus: "idle",
      poseStatus: "idle",
      lightingStatus: "idle",
      anglesStatus: "idle",
      customVariations: [],
    } as CharacterNodeData,
  },
  // Face
  {
    type: "face",
    label: "Face",
    category: "face",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["faceRef"],
    defaultData: {
      label: "Face",
      faceDbId: "",
      faceName: "",
      description: "",
      sourceImageUrl: "",
      style: "realistic",
      projectId: "",
      createdAt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      fieldMappings: {},
    } as FaceNodeData,
  },
  // Object
  {
    type: "object",
    label: "Object",
    category: "object",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["objectRef"],
    defaultData: {
      label: "Object",
      objectDbId: "",
      objectName: "",
      description: "",
      category: "other",
      style: "realistic",
      sourceImageUrl: "",
      projectId: "",
      createdAt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      fieldMappings: {},
      angles: [],
      materials: [],
      variations: [],
      anglesStatus: "idle",
      materialsStatus: "idle",
      variationsStatus: "idle",
      customVariations: [],
    } as ObjectNodeData,
  },
  // Location
  {
    type: "location",
    label: "Location",
    category: "location",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["locationRef"],
    defaultData: {
      label: "Location",
      locationDbId: "",
      locationName: "",
      description: "",
      category: "other",
      style: "realistic",
      sourceImageUrl: "",
      projectId: "",
      createdAt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      fieldMappings: {},
      timeOfDay: [],
      weather: [],
      angles: [],
      timeOfDayStatus: "idle",
      weatherStatus: "idle",
      anglesStatus: "idle",
      customVariations: [],
    } as LocationNodeData,
  },
  // Scene
  {
    type: "scene",
    label: "Scene",
    category: "scene",
    creditCost: 0,
    inputs: ["in", "audio1", "audio2", "audio3", "audio4", "audio5"],
    outputs: ["prompt", "imageRefs", "narration", "dialogue", "duration"],
    defaultData: {
      label: "Scene",
      sceneName: "",
      sceneNumber: 1,
      duration: 5,
      summary: "",
      characters: [],
      dialogue: [],
      locations: [],
      timeOfDay: "noon",
      weather: "clear",
      lighting: "natural",
      objects: [],
      aspectRatio: "16:9",
      shotType: "medium",
      cameraAngle: "eye-level",
      cameraMovement: "static",
      depthOfField: "medium",
      lensType: "normal",
      mood: [],
      colorPalette: [],
      visualStyle: "cinematic",
      narration: "",
      musicMood: "",
      soundEffects: [],
      transitionIn: "cut",
      transitionOut: "cut",
      directorNotes: "",
      referenceUrls: [],
      generatedPrompt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      generatedImageUrl: "",
      fieldMappings: {},
      sourceScriptNodeId: "",
      sourceSceneIndex: -1,
      autoSyncWithScript: false,
      audioAssignments: [],
      videoProvider: "minimax",
      generatedVideoResults: [],
      activeVideoResultIndex: 0,
      generatedVideoUrl: "",
      videoExecutionStatus: "idle",
    } as SceneNodeDataType,
  },
  // AI Writer
  {
    type: "ai-writer",
    label: "AI Writer",
    category: "ai",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["text"],
    defaultData: {
      label: "AI Writer",
      templateId: "custom",
      systemPrompt: "",
      userInput: "",
      provider: "claude",
      model: "claude-sonnet-4-5-20250929",
      temperature: 0.7,
      maxTokens: 4096,
      fieldMappings: {},
    } as AIWriterNodeData,
  },
  // Utility
  {
    type: "combine-text",
    label: "Combine Text",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["text"],
    defaultData: {
      label: "Combine Text",
      separator: "newline",
      customSeparator: "",
      combinedText: "",
    } as CombineTextNodeData,
  },
  {
    type: "sticky-note",
    label: "Sticky Note",
    category: "utility",
    creditCost: 0,
    inputs: [],
    outputs: [],
    defaultData: {
      label: "Sticky Note",
      text: "I'm a note\nDouble click to customize",
      color: "#2d2d44", // Dark background
      textColor: "#ffffff", // White text
      width: 840,
      height: 540,
      fontSize: "base",
      bold: false,
      italic: false,
      alignment: "left",
    } as StickyNoteData,
  },
]
