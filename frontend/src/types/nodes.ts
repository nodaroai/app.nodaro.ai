import type { Node, Edge } from "@xyflow/react"
import type {
  ImageI2IProvider, ImageGenProvider, ImageEditProvider,
  ModifyImageProvider, UpscaleImageProvider,
  ImageToVideoProvider, TextToVideoProvider, VideoToVideoProvider,
  VideoUpscaleProvider, ExtendVideoProvider, TtsProvider,
  TextToAudioProvider, MusicProvider, TranscribeProvider,
  LipSyncProvider, ScriptProvider, AiWriterProvider, QaCheckProvider,
  SunoModel, VoiceDesignModel,
} from "@nodaro-shared/model-constants"
import { MODIFY_IMAGE_PROVIDERS, UPSCALE_IMAGE_PROVIDERS } from "@nodaro-shared/model-constants"
import type { ExposableField, ExposableOutput } from "@nodaro-shared/presentation-types"
import type { ComponentMetadata } from "@nodaro-shared/component-types"
import { IMAGE_STYLE_PRESETS } from "@/components/editor/config-panels/model-options"

export type NodeCategory = "input" | "parameter" | "ai" | "processing" | "output" | "scene" | "character" | "face" | "object" | "location" | "utility"

export interface FieldMapping {
  readonly sourceNodeId: string
}

export type FieldMappings = Readonly<Record<string, FieldMapping>>

export interface GeneratedResult {
  readonly url: string
  readonly thumbnailUrl?: string
  readonly timestamp: string
  readonly jobId: string
  readonly freecutProjectUrl?: string
  readonly filerobotDesignStateUrl?: string
}

export interface ManualReferenceImage {
  readonly id: string   // crypto.randomUUID()
  readonly url: string  // R2 URL
}

// --- Input Node Data ---

export type TextPromptData = {
  [key: string]: unknown
  label: string
  text: string
  variables: Record<string, string>
  color?: string
  textStyle?: string
  bold?: boolean
  italic?: boolean
  alignment?: string
  width?: number
  height?: number
}

export type ListNodeData = {
  [key: string]: unknown
  label: string
  items: string
  fieldMappings: Record<string, string>
  maxItems?: number
}

export interface LoopColumn {
  readonly id: string
  readonly name: string
  readonly handleId: string
  readonly type: "text" | "image-url" | "video-url" | "audio-url"
  readonly width?: number
  readonly splitDelimiter?: string
  readonly connectedSourceId?: string
  readonly connectedSourceHandle?: string
}

export const LOOP_COLUMN_TYPE_META: Record<LoopColumn["type"], { label: string; shortLabel: string; color: string }> = {
  text: { label: "Text", shortLabel: "TXT", color: "#38BDF8" },
  "image-url": { label: "Image", shortLabel: "IMG", color: "#F472B6" },
  "video-url": { label: "Video", shortLabel: "VID", color: "#818CF8" },
  "audio-url": { label: "Audio", shortLabel: "AUD", color: "#22c55e" },
}

/** Stable handle ID for the loop node's "quick-add column" target. */
export const LOOP_COL_ADD_HANDLE = "col_add"

/** Derive the target (input) handle ID for a loop column from its base handleId. */
export function loopColInputHandle(handleId: string): string {
  return `${handleId}_in`
}

/** Extract the base handleId from a loop column's target handle ID. */
export function loopColBaseHandle(inputHandle: string): string {
  return inputHandle.replace(/_in$/, "")
}

export interface PresentationDisplay {
  columns?: 1 | 2 | 3 | 4
  elementSize?: "sm" | "md" | "lg"
  viewMode?: string
  maxWidth?: number // 10-100 (percentage of container width)
  align?: "left" | "center" | "right"
}

export type InputMode = "prompt" | "multiline" | "oneline" | "inline"

export type LoopNodeData = {
  [key: string]: unknown
  label: string
  columns: LoopColumn[]
  rows: string[][]
  fieldMappings: Record<string, string>
  maxItems?: number
  minRows?: number
  defaultRows?: number
  thumbnailSize?: "sm" | "md" | "lg"
  galleryCols?: number
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
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
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
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
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
  provider: ScriptProvider
  model: string
  llmModel?: string
  sceneCount: number
  styleGuide: string
  structure: "freeform" | "8-step" | "custom"
  tone: string
  targetLength: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedScript?: GeneratedScript
  generatedResults?: GeneratedScriptResult[]
  activeResultIndex?: number
}

// All image providers (gen + i2i) — derived from shared single source of truth
export type ImageProvider = ImageGenProvider | ImageI2IProvider

export type GenerateImageData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: ImageProvider
  model: string
  style: string
  aspectRatio: string
  negativePrompt: string
  resolution?: string
  quality?: string
  seed?: number
  renderingSpeed?: string
  styleType?: string
  expandPrompt?: boolean
  referenceImageUrl?: string
  referenceImageUrls?: readonly ManualReferenceImage[]
  referenceImageOrder?: readonly string[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  characterDefinitionIds?: readonly string[]
}

// Edit Image providers (KIE.ai only)
export type EditImageProvider = ImageEditProvider

export type EditImageData = {
  [key: string]: unknown
  label: string
  prompt: string  // Used for nano-banana-edit (edit instructions)
  provider: EditImageProvider
  upscaleFactor?: string
  targetResolution?: "2K" | "4K" | "8K"
  aspectRatio?: string
  negativePrompt?: string
  style?: string
  seed?: number
  characterDefinitionIds?: readonly string[]
  connectedMediaOrder?: readonly string[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

// Image-to-Image providers (transform source image with prompt)
export type ImageToImageProvider = ImageI2IProvider

export type ImageToImageData = {
  [key: string]: unknown
  label: string
  prompt: string  // Transformation prompt
  provider: ImageToImageProvider
  style?: string
  strength?: number
  aspectRatio?: string
  resolution?: string
  quality?: string
  negativePrompt?: string
  seed?: number
  renderingSpeed?: string
  guidanceScale?: number
  referenceImageUrl?: string
  maskUrl?: string
  characterDefinitionIds?: readonly string[]
  connectedMediaOrder?: readonly string[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

// Modify Image providers (I2I + nano-banana-edit)
export type ModifyImageData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: ModifyImageProvider
  style?: string
  strength?: number
  aspectRatio?: string
  resolution?: string
  quality?: string
  negativePrompt?: string
  seed?: number
  renderingSpeed?: string
  guidanceScale?: number
  referenceImageUrl?: string
  maskUrl?: string
  characterDefinitionIds?: readonly string[]
  connectedMediaOrder?: readonly string[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type UpscaleImageData = {
  [key: string]: unknown
  label: string
  provider: UpscaleImageProvider
  upscaleFactor?: string
  targetResolution?: "2K" | "4K" | "8K"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type RemoveBackgroundData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type ImageToVideoData = {
  [key: string]: unknown
  label: string
  provider: ImageToVideoProvider
  model: string
  duration: number
  motion?: "subtle" | "moderate" | "dynamic"
  motionEnabled?: boolean
  cameraMotion?: "static" | "pan-left" | "pan-right" | "zoom-in" | "zoom-out"
  cameraMotionEnabled?: boolean
  prompt?: string  // Text description of desired motion/animation
  generateAudio?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  aspectRatio?: "16:9" | "9:16" | "1:1" | "21:9" | "Auto"
  multiShot?: boolean
  resolution?: string
  grokMode?: "fun" | "normal" | "spicy"
  videoSize?: "standard" | "high"
  seed?: number
  cameraFixed?: boolean
  shots?: Array<{ prompt: string; duration: number }>
  elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>
  // Multi-input selection fields
  selectedStartFrameNodeId?: string  // ID of node selected for start frame
  selectedEndFrameNodeId?: string    // ID of node selected for end frame (optional)
  selectedAudioNodeId?: string       // ID of node selected for audio track (optional)
  // Progress tracking fields
  currentJobId?: string              // ID of the currently running job (for progress polling)
  currentJobProgress?: number        // Progress percentage from backend (0-100)
  kieTaskId?: string                 // KIE task ID for extend/upscale operations (VEO, Runway)
  connectedImageOrder?: readonly string[]
  veoMode?: "frame-to-frame" | "reference"  // VEO 3/3.1: toggle between start+end frame and reference mode
}

export type TextToSpeechData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  provider: TtsProvider
  voiceId: string
  voiceLabel?: string
  voiceType: "premade" | "custom" | "library"
  voiceDisplayName: string
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
  provider: TextToVideoProvider
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
  seed?: number                      // VEO 3.1: reproducible generation (10000-99999)
  // Progress tracking fields
  currentJobId?: string              // ID of the currently running job (for progress polling)
  currentJobProgress?: number        // Progress percentage from backend (0-100)
  kieTaskId?: string                 // KIE task ID for extend/upscale operations (VEO, Runway)
}

export type VideoToVideoData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: VideoToVideoProvider
  duration: number
  fieldMappings: FieldMappings
  // Wan / Wan Flash params
  v2vDuration?: "5" | "10"
  v2vResolution?: "720p" | "1080p"
  // Wan Flash only
  audio?: boolean
  multiShots?: boolean
  // Runway Aleph params
  aspectRatio?: string
  seed?: number
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
  provider: LipSyncProvider
  resolution: "480p" | "720p"
  prompt: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  // Multi-input selection fields
  selectedImageNodeId?: string   // ID of node selected for portrait/face image
  selectedVideoNodeId?: string   // ID of node selected for video input
  selectedAudioNodeId?: string   // ID of node selected for audio track
  // LatentSync params
  guidanceScale?: number
  inferenceSteps?: number
  seed?: number
  // Wav2Lip params
  pads?: string
  smooth?: boolean
  fps?: number
  resizeFactor?: number
  // SadTalker params
  enhancer?: "gfpgan" | "RestoreFormer"
  preprocess?: "crop" | "resize" | "full"
  still?: boolean
  poseStyle?: number
  expressionScale?: number
}

export type SpeechToVideoData = {
  [key: string]: unknown
  label: string
  prompt: string
  resolution: "480p" | "580p" | "720p"
  negativePrompt?: string
  seed?: number
  numFrames?: number
  fps?: number
  inferenceSteps?: number
  guidanceScale?: number
  shift?: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

// Motion Transfer: Apply motion from video to image character
// KIE.ai models: kling-2.6/motion-control, kling-3.0/motion-control
export type MotionTransferData = {
  [key: string]: unknown
  label: string
  prompt: string // Optional, max 2500 chars
  characterOrientation: "image" | "video" // image = max 10s, video = max 30s
  resolution: "720p" | "1080p" | "480p" | "580p"
  provider?: "kling" | "kling-3.0" | "wan-animate-move" | "wan-animate-replace"
  backgroundSource?: "input_video" | "input_image"
  videoDuration?: number // Detected from connected video (seconds), used for per-second pricing
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

// Video Upscale: Upscale video resolution using Topaz or VEO
export type VideoUpscaleData = {
  [key: string]: unknown
  label: string
  provider: VideoUpscaleProvider
  upscaleFactor: "1" | "2" | "4"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  kieTaskId?: string              // KIE task ID from upstream VEO node (for VEO upscale providers)
}

// Extend Video: Continue a VEO or Runway video with a new prompt
export type ExtendVideoData = {
  [key: string]: unknown
  label: string
  provider: ExtendVideoProvider
  prompt: string
  model?: "fast" | "quality"      // VEO only
  seeds?: number                   // VEO only
  quality?: "720p" | "1080p"      // Runway only
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  kieTaskId?: string              // KIE task ID from upstream video node (required)
}

export type QACheckData = {
  [key: string]: unknown
  label: string
  provider: QaCheckProvider
  checkType: "content" | "quality" | "consistency" | "safety"
  threshold: number
  llmModel?: string
  fieldMappings: FieldMappings
  currentJobId?: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  score?: number
  approved?: boolean
  reason?: string
}

export type GenerateMusicData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  prompt: string
  provider: MusicProvider
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
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  prompt: string
  provider: TextToAudioProvider
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
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  prompt: string
  model: SunoModel
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
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  prompt: string
  model: SunoModel
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
  model: SunoModel
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
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
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
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
  fieldMappings?: FieldMappings
}

export type SunoMashupData = {
  [key: string]: unknown
  label: string
  model: SunoModel
  customMode: boolean
  style: string
  title: string
  negativeStyle: string
  vocalGender: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SunoReplaceSectionData = {
  [key: string]: unknown
  label: string
  infillStartS: number
  infillEndS: number
  prompt: string
  tags: string
  title: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SunoStyleBoostData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  content: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedText?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type SunoAddInstrumentalData = {
  [key: string]: unknown
  label: string
  model: "V4_5PLUS" | "V5"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SunoAddVocalsData = {
  [key: string]: unknown
  label: string
  model: "V4_5PLUS" | "V5"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SunoConvertWavData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SunoUploadExtendData = {
  [key: string]: unknown
  label: string
  prompt: string
  model: SunoModel
  style: string
  title: string
  negativeStyle: string
  vocalGender: string
  continueAt: number
  defaultParamFlag: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type AudioIsolationData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type TranscribeData = {
  [key: string]: unknown
  label: string
  provider: TranscribeProvider
  language: string
  diarize?: boolean
  tagAudioEvents?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedText?: string
  generatedResults?: Array<{ text: string; language: string; jobId: string; timestamp: string }>
  activeResultIndex?: number
}

export interface DialogueLine {
  readonly id: string
  readonly text: string
  readonly voice: string
  readonly voiceLabel?: string
}

export type TextToDialogueData = {
  [key: string]: unknown
  label: string
  dialogue: DialogueLine[]
  stability: number
  languageCode: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export interface AlignmentWord {
  readonly word: string
  readonly start: number
  readonly end: number
}

export type VoiceChangerData = {
  [key: string]: unknown
  label: string
  voiceId: string
  voiceLabel: string
  voiceType: "premade" | "custom" | "library"
  stability: number
  similarityBoost: number
  removeBackgroundNoise: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type DubbingData = {
  [key: string]: unknown
  label: string
  targetLanguage: string
  sourceLanguage?: string
  numSpeakers?: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type VoiceRemixData = {
  [key: string]: unknown
  label: string
  text: string
  voiceDescription: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type VoiceDesignData = {
  [key: string]: unknown
  label: string
  text: string
  voiceDescription: string
  model?: VoiceDesignModel
  loudness?: number
  guidanceScale?: number
  seed?: number
  quality?: number
  shouldEnhance?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedVoiceId?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type ForcedAlignmentData = {
  [key: string]: unknown
  label: string
  transcript: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  alignmentResults?: AlignmentWord[]
  currentJobId?: string
  currentJobProgress?: number
}

export type ImageToTextData = {
  [key: string]: unknown
  label: string
  detailLevel: "brief" | "detailed" | "structured"
  customPrompt: string
  llmModel?: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedText?: string
  generatedResults?: Array<{ text: string; jobId: string; timestamp: string }>
  activeResultIndex?: number
}

// --- Processing Node Data ---

export type CombineVideosData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  transition: "cut" | "fade" | "dissolve" | "dip-to-black" | "dip-to-white"
  transitionDuration: number
  audioMode: "keep" | "crossfade" | "remove"
  trimStartFrames?: number
  trimEndFrames?: number
  clipOrder?: string[]
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
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  // Main video's embedded audio
  keepOriginalAudio?: boolean
  originalAudioVolume?: number
  originalAudioRole?: "background" | "effect" | "narration"
  // Per-track settings keyed by source node ID
  trackSettings?: Record<string, { role: string; volume?: number; startTime?: number }>
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
  currentJobProgress?: number
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
  currentJobProgress?: number
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

export type SocialMediaFormatData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  platform: string
  contentType: string
  specKey: string
  method: "crop" | "pad" | "stretch"
  padColor: string
  formattedText: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type SocialPlatformType = "instagram" | "tiktok" | "youtube" | "linkedin" | "x" | "facebook" | "telegram"

export interface SocialConnection {
  id: string
  platform: string
  platform_user_id: string
  platform_username: string | null
  platform_avatar_url: string | null
  display_name: string | null
}

export type SocialPostData = {
  [key: string]: unknown
  label: string
  platform: SocialPlatformType
  action: string
  connectionId?: string
  caption: string
  title?: string
  description?: string
  tags?: string[]
  privacy?: string
  chatId?: string        // Telegram only
  parseMode?: string     // Telegram only
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  platformPostId?: string
  platformPostUrl?: string
  currentJobId?: string
  generatedResults?: readonly GeneratedResult[]
}

export type TrimAudioData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  audioFormat: "mp3" | "wav" | "aac"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type SplitMediaData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  chunkDuration: number
  audioFormat?: "mp3" | "wav" | "aac"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrls?: string[]
  generatedAudioUrls?: string[]
  selectedAudioChunks?: number[]
  selectedVideoChunks?: number[]
  outputChunkIndex?: number
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
}

export type MixAudioData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  trackCount: number
  trackVolumes: Record<string, number>
  trackOrder?: string[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedAudioUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type AdjustVolumeData = {
  currentJobProgress?: number
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
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  startTime: number
  endTime: number
  outputSilentVideo?: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedSilentVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type ExtractFrameData = {
  [key: string]: unknown
  label: string
  mode: "first" | "last" | "timestamp"
  timestamp: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  currentJobProgress?: number
}

export type VideoComposerData = {
  [key: string]: unknown
  label: string
  compositionPrompt: string
  sceneGraph?: Record<string, unknown>
  fps: number
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"
  durationSeconds: number
  backgroundColor: string
  assetOrder?: string[]
  llmModel?: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export type AfterEffectsData = {
  [key: string]: unknown
  label: string
  effectPrompt: string
  effectPlan?: Record<string, unknown>
  inputVideoUrl?: string
  width?: number
  height?: number
  llmModel?: string
  fps: number
  durationSeconds: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export type LottieOverlayData = {
  [key: string]: unknown
  label: string
  overlayPrompt: string
  overlayPlan?: Record<string, unknown>
  inputVideoUrl?: string
  width?: number
  height?: number
  lottieAssets?: Array<{ id: string; url: string; name: string; durationSeconds?: number }>
  llmModel?: string
  fps: number
  durationSeconds: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export type ThreeDTitleData = {
  [key: string]: unknown
  label: string
  titlePrompt: string
  titlePlan?: Record<string, unknown>
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"
  backgroundColor: string
  backgroundMediaUrl?: string
  llmModel?: string
  fps: number
  durationSeconds: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export type MotionGraphicsData = {
  [key: string]: unknown
  label: string
  motionPrompt: string
  motionPlan?: Record<string, unknown>
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"
  backgroundColor: string
  llmModel?: string
  fps: number
  durationSeconds: number
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export interface CompositeLayerConfig {
  id: string
  inputHandle: string      // "video1" | "video2" | "video3" | "video4"
  position: "fullscreen" | "positioned"
  x?: number
  y?: number
  width?: number
  height?: number
  startFrame?: number
  durationInFrames?: number
  opacity: number
  blendMode: "normal" | "multiply" | "screen" | "overlay"
  zIndex?: number
}

export type CompositeData = {
  [key: string]: unknown
  label: string
  layers: CompositeLayerConfig[]
  compositePlan?: Record<string, unknown>
  fps: number
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"
  durationSeconds: number
  backgroundColor: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
}

export type RenderVideoData = {
  [key: string]: unknown
  label: string
  fps: number
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5"
  durationSeconds: number
  backgroundColor: string
  assetOrder?: string[]
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  currentJobId?: string
  currentJobProgress?: number
}

export type SpeedRampData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  speed: number
  adjustAudio: boolean
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type LoopVideoData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  mode: "repeat" | "duration"
  repeatCount: number
  targetDuration: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type FadeVideoData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  fadeIn: boolean
  fadeInDuration: number
  fadeOut: boolean
  fadeOutDuration: number
  color: "black" | "white"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type TranscodeVideoData = {
  currentJobProgress?: number
  [key: string]: unknown
  label: string
  codec: "h264" | "h265"
  crf: number
  resolution: "original" | "1080p" | "720p" | "480p"
  audioBitrate: "128k" | "192k" | "256k" | "320k"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type ManualEditData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "awaiting-user" | "completed" | "failed"
  errorMessage?: string
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
  inputVideoUrl?: string
  isEditorOpen?: boolean
}

// --- Output Node Data ---

export type SaveToStorageData = {
  [key: string]: unknown
  label: string
  filename: string
  format: "mp4" | "webm" | "mov"
  quality: "draft" | "standard" | "high" | "4k"
  fieldMappings: FieldMappings
  currentJobId?: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  savedUrl?: string
  generatedResults?: readonly GeneratedResult[]
}

export type WebhookOutputData = {
  [key: string]: unknown
  label: string
  url: string
  params: WebhookParam[]
  currentJobId?: string
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  webhookSuccess?: boolean
  webhookStatusCode?: number
  webhookResponseBody?: string
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
  provider?: string
  characterSheet: CharacterSheet | null
  projectId: string
  createdAt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  fieldMappings: FieldMappings
  scriptCharacterIndex?: number
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
  provider?: string
  sourceImageUrl: string
  projectId: string
  createdAt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
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
  provider?: string
  sourceImageUrl: string
  projectId: string
  createdAt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  fieldMappings: FieldMappings
  scriptLocationIndex?: number
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
  provider?: string
  projectId: string
  createdAt: string
  executionStatus: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  fieldMappings: FieldMappings
}

// --- LLM Chat Node Data ---

export type LLMChatData = {
  [key: string]: unknown
  label: string
  systemPrompt: string
  userInput: string
  llmModel?: string
  temperature: number
  maxTokens: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedText?: string
  generatedResults?: Array<{ text: string; jobId?: string; timestamp?: string }>
  activeResultIndex?: number
}

// --- AI Writer Node Data ---

export type AIWriterNodeData = {
  [key: string]: unknown
  label: string
  templateId: string
  systemPrompt: string
  userInput: string
  provider: AiWriterProvider
  /** @deprecated Use llmModel instead. Kept optional for backward compat with saved workflows. */
  model?: string
  llmModel?: string
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

// --- Preview Node Data ---

export interface PreviewItem {
  readonly type: "text" | "image" | "video" | "audio" | "data"
  readonly value: string
  readonly sourceNodeId: string
  readonly sourceNodeLabel: string
  readonly visible: boolean
}

export type PreviewNodeData = {
  [key: string]: unknown
  label: string
  previewItems: PreviewItem[]
  /** Persisted ordering by sourceNodeId — survives re-execution */
  itemOrder: string[]
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
}

// --- Split Text Node Data ---

export type SplitTextData = {
  [key: string]: unknown
  label: string
  separator: string
  trimWhitespace: boolean
  removeEmpty: boolean
  splitResults?: string[]
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

// --- Teleporter Node Data ---

export const TELEPORTER_CHANNEL_COLORS = [
  "#f59e0b", // A = amber
  "#10b981", // B = emerald
  "#8b5cf6", // C = violet
  "#ef4444", // D = red
  "#06b6d4", // E = cyan
  "#ec4899", // F = pink
] as const

export type TeleportSendData = {
  [key: string]: unknown
  label: string
  channel: string
  channelColor: string
  result?: string
}

export type TeleportReceiveData = {
  [key: string]: unknown
  label: string
  channel: string
  channelColor: string
  result?: string
}

// --- Router Node Data ---

export type RouterNodeData = {
  [key: string]: unknown
  label: string
  mode: "radio" | "checkbox"
  routes: Array<{ id: string; name: string; active: boolean }>
  // Execution result fields
  activeRoutes?: string[]
  routeOutputs?: Record<string, string | undefined>
  executionStatus?: "idle" | "running" | "completed" | "failed"
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
  currentJobProgress?: number
  errorMessage?: string
  generatedResults: GeneratedResult[]
  activeResultIndex: number
  generatedImageUrl: string
  fieldMappings: FieldMappings
  sourceScriptNodeId: string
  sourceSceneIndex: number
  autoSyncWithScript: boolean
  audioAssignments: AudioAssignment[]
  videoProvider: string
  generatedVideoResults: GeneratedResult[]
  activeVideoResultIndex: number
  generatedVideoUrl: string
  videoExecutionStatus: "idle" | "running" | "completed" | "failed"
}

// --- Sub-Workflow Types ---

export interface SubWorkflowPort {
  readonly id: string
  readonly name: string
  readonly mediaType: "text" | "image" | "video" | "audio" | "any"
}

export type SubWorkflowInputData = {
  [key: string]: unknown
  label: string
  routeId: string
  ports: SubWorkflowPort[]
  /** Injected at runtime during sub-workflow execution — maps port ID to upstream output value */
  __injectedPortValues?: Record<string, string>
}

export type SubWorkflowOutputData = {
  [key: string]: unknown
  label: string
  routeId: string
  ports: SubWorkflowPort[]
  visibleOutputPortId: string
}

export interface SubWorkflowRouteSnapshot {
  readonly routeId: string
  readonly inputLabel: string
  readonly inputPorts: ReadonlyArray<SubWorkflowPort>
  readonly outputPorts: ReadonlyArray<SubWorkflowPort>
  readonly visibleOutputPortId: string
}

export type SubWorkflowData = {
  [key: string]: unknown
  label: string
  referencedWorkflowId: string
  referencedWorkflowName: string
  selectedRouteId: string
  routeSnapshot: SubWorkflowRouteSnapshot | null
  fieldMappings: Record<string, FieldMapping>
  executionStatus: "idle" | "running" | "completed" | "failed"
  currentJobProgress?: number
  errorMessage?: string
  outputResults?: Record<string, string>
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
  subWorkflowProgress?: { currentNode: string; completed: number; total: number }
}

export type ComponentNodeData = {
  [key: string]: unknown
  label: string
  appSlug: string
  appVersionId: string
  pinnedVersion: number
  componentMetadata: ComponentMetadata
  exposedSettings: Record<string, unknown>
  outputResults?: Record<string, string>
  creatorName: string
  creatorId: string
  estimatedCredits: number
  executionStatus: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

// --- Webhook Parameter Type (shared between trigger + output) ---

export type WebhookParam = {
  id: string
  name: string
  type: "text" | "imageUrl" | "videoUrl" | "audioUrl"
}

// --- Trigger Node Data Types ---

export type WebhookTriggerData = {
  [key: string]: unknown
  label: string
  webhookToken?: string
  webhookUrl?: string
  params: WebhookParam[]
}

export type ScheduleTriggerData = {
  [key: string]: unknown
  label: string
  cron?: string
  timezone?: string
  interval?: string
  maxExecutions?: number
}

export type TelegramTriggerData = {
  [key: string]: unknown
  label: string
  connectionId?: string
  chatIdFilter?: string
  messageTypeFilters?: string[]
  triggerId?: string
  isActive?: boolean
  executionStatus?: "idle" | "running" | "completed" | "failed"
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
  | ModifyImageData
  | UpscaleImageData
  | RemoveBackgroundData
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
  | SunoMashupData
  | SunoReplaceSectionData
  | SunoStyleBoostData
  | SunoAddInstrumentalData
  | SunoAddVocalsData
  | SunoConvertWavData
  | SunoUploadExtendData
  | TranscribeData
  | ImageToTextData
  | AudioIsolationData
  | TextToDialogueData
  | VoiceChangerData
  | DubbingData
  | VoiceRemixData
  | VoiceDesignData
  | ForcedAlignmentData
  | CombineVideosData
  | MergeVideoAudioData
  | AddCaptionsData
  | ResizeVideoData
  | SocialMediaFormatData
  | TrimAudioData
  | SplitMediaData
  | MixAudioData
  | AdjustVolumeData
  | TrimVideoData
  | ExtractFrameData
  | VideoComposerData
  | AfterEffectsData
  | LottieOverlayData
  | ThreeDTitleData
  | MotionGraphicsData
  | CompositeData
  | RenderVideoData
  | SpeedRampData
  | LoopVideoData
  | FadeVideoData
  | TranscodeVideoData
  | ManualEditData
  | LipSyncData
  | SpeechToVideoData
  | MotionTransferData
  | VideoUpscaleData
  | ExtendVideoData
  | SaveToStorageData
  | WebhookOutputData
  | SceneNodeDataType
  | CharacterNodeData
  | ObjectNodeData
  | LocationNodeData
  | FaceNodeData
  | LLMChatData
  | AIWriterNodeData
  | ListNodeData
  | LoopNodeData
  | CombineTextNodeData
  | SplitTextData
  | PreviewNodeData
  | StickyNoteData
  | TeleportSendData
  | TeleportReceiveData
  | RouterNodeData
  | SubWorkflowInputData
  | SubWorkflowOutputData
  | SubWorkflowData
  | ComponentNodeData
  | WebhookTriggerData
  | ScheduleTriggerData
  | TelegramTriggerData
  | SocialPostData

export type SceneNodeType =
  | "text-prompt"
  | "list"
  | "loop"
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
  | "modify-image"
  | "upscale-image"
  | "remove-background"
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
  | "suno-mashup"
  | "suno-replace-section"
  | "suno-style-boost"
  | "suno-add-instrumental"
  | "suno-add-vocals"
  | "suno-convert-wav"
  | "suno-upload-extend"
  | "transcribe"
  | "image-to-text"
  | "audio-isolation"
  | "text-to-dialogue"
  | "voice-changer"
  | "dubbing"
  | "voice-remix"
  | "voice-design"
  | "forced-alignment"
  | "combine-videos"
  | "merge-video-audio"
  | "add-captions"
  | "resize-video"
  | "social-media-format"
  | "trim-audio"
  | "split-media"
  | "mix-audio"
  | "adjust-volume"
  | "trim-video"
  | "extract-frame"
  | "video-composer"
  | "after-effects"
  | "lottie-overlay"
  | "3d-title"
  | "motion-graphics"
  | "composite"
  | "render-video"
  | "speed-ramp"
  | "loop-video"
  | "fade-video"
  | "transcode-video"
  | "manual-edit"
  | "lip-sync"
  | "speech-to-video"
  | "motion-transfer"
  | "video-upscale"
  | "extend-video"
  | "save-to-storage"
  | "webhook-output"
  | "scene"
  | "character"
  | "face"
  | "object"
  | "location"
  | "llm-chat"
  | "ai-writer"
  | "combine-text"
  | "split-text"
  | "preview"
  | "sticky-note"
  | "teleport-send"
  | "teleport-receive"
  | "router"
  | "sub-workflow-input"
  | "sub-workflow-output"
  | "sub-workflow"
  | "webhook-trigger"
  | "schedule-trigger"
  | "instagram-post"
  | "tiktok-post"
  | "youtube-upload"
  | "linkedin-post"
  | "x-post"
  | "facebook-post"
  | "telegram-post"
  | "telegram-trigger"
  | "component"

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
  readonly width?: number
  readonly height?: number
  readonly exposableFields?: ReadonlyArray<ExposableField>
  readonly exposableOutputs?: ReadonlyArray<ExposableOutput>
}

export const NODE_DEFINITIONS: ReadonlyArray<NodeTypeDefinition> = [
  // Input
  {
    type: "text-prompt",
    label: "Text Prompt",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["prompt"],
    defaultData: { label: "Text Prompt", text: "", variables: {} },
  },
  {
    type: "list",
    label: "List",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["list"],
    defaultData: { label: "List", items: "", fieldMappings: {} },
  },
  {
    type: "loop",
    label: "Table",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: [],
    defaultData: { label: "Table", columns: [], rows: [], fieldMappings: {} } as LoopNodeData,
  },
  {
    type: "upload-image",
    label: "Upload Image",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["image"],
    defaultData: { label: "Upload Image", assetId: "", url: "" } as unknown as SceneNodeData,
  },
  {
    type: "upload-video",
    label: "Upload Video",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Upload Video", assetId: "", url: "" } as unknown as SceneNodeData,
  },
  {
    type: "upload-audio",
    label: "Upload Audio",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Upload Audio", assetId: "", url: "" } as unknown as SceneNodeData,
  },
  {
    type: "rss-feed",
    label: "RSS Feed",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["content"],
    defaultData: { label: "RSS Feed", feedUrl: "", itemIndex: 0, extractFields: ["title", "description"] },
  },
  {
    type: "youtube-video",
    label: "Video URL",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Video URL", youtubeUrl: "", videoId: "", title: "", thumbnailUrl: "" },
  },
  {
    type: "reference-audio",
    label: "Reference Audio",
    category: "input",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Reference Audio", sourceType: "youtube", youtubeUrl: "", uploadedFileUrl: "", directUrl: "", videoTitle: "", videoThumbnail: "", videoDuration: "", extractedAudioUrl: "", extractionStatus: "idle" },
  },
  {
    type: "webhook-trigger",
    label: "Webhook Trigger",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["payload"],
    defaultData: { label: "Webhook Trigger", params: [] } as unknown as SceneNodeData,
  },
  {
    type: "schedule-trigger",
    label: "Schedule Trigger",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["payload"],
    defaultData: { label: "Schedule Trigger" } as unknown as SceneNodeData,
  },
  // Parameter
  {
    type: "tone",
    label: "Tone",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["tone"],
    defaultData: { label: "Tone", tone: "" },
  },
  {
    type: "style-guide",
    label: "Style Guide",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["style_guide"],
    defaultData: { label: "Style Guide", text: "" },
  },
  {
    type: "provider",
    label: "Provider",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["provider"],
    defaultData: { label: "Provider", category: "image", provider: "nano-banana", model: "" },
  },
  {
    type: "scene-count",
    label: "Scene Count",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["scene_count"],
    defaultData: { label: "Scene Count", count: 5 },
  },
  {
    type: "duration",
    label: "Duration",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["duration"],
    defaultData: { label: "Duration", seconds: 60 },
  },
  {
    type: "aspect-ratio",
    label: "Aspect Ratio",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["aspect_ratio"],
    defaultData: { label: "Aspect Ratio", ratio: "16:9" },
  },
  {
    type: "motion",
    label: "Motion",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: { label: "Motion", motion: "moderate" },
  },
  {
    type: "camera-motion",
    label: "Camera Motion",
    category: "parameter",
    creditCost: 0,
    inputs: ["in"],
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
    outputs: ["scenes", "images", "dialogue", "music", "sfx", "characters", "locations"],
    defaultData: { label: "Generate Script", provider: "gemini", model: "gemini-2.5-flash", sceneCount: 5, styleGuide: "", structure: "freeform", tone: "", targetLength: 60, fieldMappings: {} },
  },
  {
    type: "generate-image",
    label: "Generate Image",
    category: "ai",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["image"],
    width: 220,
    defaultData: { label: "Generate Image", prompt: "", provider: "nano-banana-pro", model: "gemini-2.5-flash-image", style: "", aspectRatio: "16:9", negativePrompt: "", fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "image" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "flux", label: "Flux" },
          { value: "flux-flex", label: "Flux Flex" },
          { value: "flux-kontext", label: "Flux Kontext" },
          { value: "flux-kontext-max", label: "Flux Kontext Max" },
          { value: "gpt-image", label: "GPT Image" },
          { value: "grok", label: "Grok" },
          { value: "ideogram-v3", label: "Ideogram V3" },
          { value: "imagen4", label: "Imagen 4" },
          { value: "imagen4-fast", label: "Imagen 4 Fast" },
          { value: "imagen4-ultra", label: "Imagen 4 Ultra" },
          { value: "nano-banana", label: "Nano Banana" },
          { value: "nano-banana-2", label: "Nano Banana 2" },
          { value: "nano-banana-pro", label: "Nano Banana Pro" },
          { value: "qwen", label: "Qwen" },
          { value: "seedream", label: "Seedream" },
          { value: "seedream-5-lite", label: "Seedream 5 Lite" },
          { value: "z-image", label: "Z-Image" },
        ],
      },
      {
        key: "aspectRatio", label: "Aspect Ratio", type: "aspect-ratio" as const,
        options: [
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
        ],
      },
      {
        key: "quality", label: "Quality", type: "select" as const,
        options: [
          { value: "medium", label: "Medium (Balanced)" },
          { value: "high", label: "High (Detailed)" },
          { value: "basic", label: "Basic (2K)" },
        ],
      },
      { key: "negativePrompt", label: "Negative Prompt", type: "text" as const },
      {
        key: "style", label: "Style", type: "select" as const,
        options: [{ value: "__none__", label: "None" }, ...IMAGE_STYLE_PRESETS.map(s => ({ value: s.value, label: s.label }))],
      },
    ],
  },
  {
    type: "modify-image",
    label: "Modify Image",
    category: "ai",
    creditCost: 2,
    inputs: ["image"],
    outputs: ["out"],
    width: 260,
    defaultData: {
      label: "Modify Image",
      prompt: "",
      provider: "nano-banana" as ModifyImageProvider,
      fieldMappings: {},
    },
    exposableOutputs: [{ key: "out", label: "Modified Image", outputType: "image" as const }],
    exposableFields: [
      { key: "provider", label: "Model", type: "select" as const, options: MODIFY_IMAGE_PROVIDERS.map(p => ({ value: p, label: p })) },
    ],
  },
  {
    type: "upscale-image",
    label: "Upscale Image",
    category: "ai",
    creditCost: 1,
    inputs: ["image"],
    outputs: ["out"],
    width: 220,
    defaultData: {
      label: "Upscale Image",
      provider: "recraft-upscale" as UpscaleImageProvider,
      fieldMappings: {},
    },
    exposableOutputs: [{ key: "out", label: "Upscaled Image", outputType: "image" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const, options: [
          { value: "recraft-upscale", label: "Recraft Upscale" },
          { value: "topaz-image-upscale", label: "Topaz Upscale" },
        ],
      },
    ],
  },
  {
    type: "remove-background",
    label: "Remove Background",
    category: "ai",
    creditCost: 1,
    inputs: ["image"],
    outputs: ["out"],
    width: 220,
    defaultData: {
      label: "Remove Background",
      fieldMappings: {},
    },
    exposableOutputs: [{ key: "out", label: "Image (No BG)", outputType: "image" as const }],
  },
  {
    type: "image-to-video",
    label: "Image to Video",
    category: "ai",
    creditCost: 20,
    width: 220,
    inputs: ["startFrame", "endFrame", "audio"],
    outputs: ["video"],
    defaultData: { label: "Image to Video", provider: "veo3", model: "veo-3", duration: 5, fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "video" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "bytedance-lite", label: "Bytedance Lite" },
          { value: "bytedance-pro", label: "Bytedance Pro" },
          { value: "bytedance-pro-fast", label: "Bytedance Pro Fast" },
          { value: "grok-i2v", label: "Grok" },
          { value: "hailuo-2.3", label: "Hailuo 2.3" },
          { value: "hailuo-2.3-pro", label: "Hailuo 2.3 Pro" },
          { value: "hailuo-standard", label: "Hailuo Standard" },
          { value: "kling", label: "Kling" },
          { value: "kling-3.0", label: "Kling 3.0" },
          { value: "kling-master", label: "Kling Master" },
          { value: "kling-turbo", label: "Kling Turbo" },
          { value: "minimax", label: "MiniMax" },
          { value: "runway-kie", label: "Runway (KIE)" },
          { value: "seedance", label: "Seedance" },
          { value: "veo3", label: "VEO 3.1 (Quality)" },
          { value: "veo3.1", label: "VEO 3.1 (Fast)" },
          { value: "wan-i2v", label: "Wan 2.6" },
          { value: "wan-turbo", label: "Wan Turbo" },
        ],
      },
    ],
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
    defaultData: { label: "Text to Video", prompt: "", provider: "minimax", duration: 5, aspectRatio: "16:9", negativePrompt: "", fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "video" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "bytedance-lite", label: "Bytedance Lite" },
          { value: "bytedance-pro", label: "Bytedance Pro" },
          { value: "grok", label: "Grok" },
          { value: "kling", label: "Kling" },
          { value: "kling-3.0", label: "Kling 3.0" },
          { value: "kling-turbo", label: "Kling Turbo" },
          { value: "minimax", label: "MiniMax" },
          { value: "hailuo-standard", label: "MiniMax Standard" },
          { value: "runway-kie", label: "Runway (KIE)" },
          { value: "seedance", label: "Seedance 1.5" },
          { value: "veo3", label: "VEO 3.1 (Quality)" },
          { value: "veo3.1", label: "VEO 3.1 (Fast)" },
          { value: "wan", label: "Wan 2.6" },
          { value: "wan-turbo", label: "Wan Turbo" },
        ],
      },
      {
        key: "aspectRatio", label: "Aspect Ratio", type: "aspect-ratio" as const,
        options: [
          { value: "16:9", label: "16:9 (Landscape)" },
          { value: "9:16", label: "9:16 (Portrait)" },
          { value: "1:1", label: "1:1 (Square)" },
        ],
      },
      { key: "motion", label: "Motion", type: "slider" as const, min: 1, max: 255, step: 1 },
      { key: "generateAudio", label: "Generate Audio", type: "toggle" as const },
    ],
  },
  {
    type: "text-to-speech",
    label: "Text to Speech",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Text to Speech", provider: "elevenlabs-v3", voiceId: "Rachel", voiceType: "premade", voiceDisplayName: "Rachel", language: "en", speed: 1, stability: 0.5, similarityBoost: 0.75, style: 0, languageCode: "", textSource: "connected", directText: "", fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "audio" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "elevenlabs-v3", label: "ElevenLabs v3 (recommended)" },
          { value: "elevenlabs-turbo", label: "ElevenLabs Turbo v2.5 (fast)" },
          { value: "elevenlabs-multilingual", label: "ElevenLabs Multilingual v2" },
        ],
      },
      { key: "stability", label: "Stability", type: "slider" as const, min: 0, max: 1, step: 0.05 },
      { key: "similarity", label: "Similarity", type: "slider" as const, min: 0, max: 1, step: 0.05 },
    ],
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
    defaultData: { label: "Generate Music", prompt: "", provider: "suno", duration: 8, genre: "", mood: "", instrumental: true, lyrics: "", referenceAudioUrl: "", referenceYouTubeUrl: "", referenceSource: "none", modelVersion: "stereo-large", fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "audio" as const }],
    exposableFields: [
      { key: "duration", label: "Duration (s)", type: "slider" as const, min: 1, max: 60, step: 1 },
      { key: "instrumental", label: "Instrumental", type: "toggle" as const },
    ],
  },
  {
    type: "text-to-audio",
    label: "Text to Audio",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Text to Audio", prompt: "", provider: "elevenlabs-sfx", duration: 10, fieldMappings: {} },
    exposableOutputs: [{ key: "result", label: "Result", outputType: "audio" as const }],
    exposableFields: [
      { key: "duration", label: "Duration (s)", type: "slider" as const, min: 1, max: 22, step: 0.5 },
    ],
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
    label: "Music Video",
    category: "ai",
    creditCost: 1,
    inputs: ["audio"],
    outputs: ["video"],
    defaultData: { label: "Music Video", taskId: "", audioId: "", fieldMappings: {} } as SunoMusicVideoData,
  },
  {
    type: "suno-mashup",
    label: "Suno Mashup",
    category: "ai",
    creditCost: 4,
    inputs: ["audio1", "audio2"],
    outputs: ["audio"],
    defaultData: { label: "Suno Mashup", model: "V5", customMode: false, style: "", title: "", negativeStyle: "", vocalGender: "", fieldMappings: {} } as SunoMashupData,
  },
  {
    type: "suno-replace-section",
    label: "Suno Replace Section",
    category: "ai",
    creditCost: 2,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Replace Section", infillStartS: 0, infillEndS: 30, prompt: "", tags: "", title: "", fieldMappings: {} } as SunoReplaceSectionData,
  },
  {
    type: "suno-style-boost",
    label: "Suno Style Boost",
    category: "ai",
    creditCost: 1,
    inputs: ["text"],
    outputs: ["text"],
    defaultData: { label: "Suno Style Boost", content: "", fieldMappings: {} } as SunoStyleBoostData,
  },
  {
    type: "suno-add-instrumental",
    label: "Suno Add Instrumental",
    category: "ai",
    creditCost: 4,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Add Instrumental", model: "V5", fieldMappings: {} } as SunoAddInstrumentalData,
  },
  {
    type: "suno-add-vocals",
    label: "Suno Add Vocals",
    category: "ai",
    creditCost: 4,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Add Vocals", model: "V5", fieldMappings: {} } as SunoAddVocalsData,
  },
  {
    type: "suno-convert-wav",
    label: "Suno Convert WAV",
    category: "ai",
    creditCost: 1,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Convert WAV", fieldMappings: {} } as SunoConvertWavData,
  },
  {
    type: "suno-upload-extend",
    label: "Suno Upload Extend",
    category: "ai",
    creditCost: 4,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Suno Upload Extend", prompt: "", model: "V5", style: "", title: "", negativeStyle: "", vocalGender: "", continueAt: 0, defaultParamFlag: true, fieldMappings: {} } as SunoUploadExtendData,
  },
  {
    type: "transcribe",
    label: "Transcribe",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["text"],
    defaultData: { label: "Transcribe", provider: "elevenlabs-stt", language: "auto", fieldMappings: {} },
  },
  {
    type: "image-to-text",
    label: "Describe Image",
    category: "ai",
    creditCost: 1,
    inputs: ["image"],
    outputs: ["text"],
    defaultData: { label: "Describe Image", detailLevel: "detailed", customPrompt: "", fieldMappings: {} } as ImageToTextData,
  },
  {
    type: "audio-isolation",
    label: "Voice Extractor",
    category: "ai",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: {
      label: "Voice Extractor",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as AudioIsolationData,
  },
  {
    type: "text-to-dialogue",
    label: "Text to Dialogue",
    category: "ai",
    creditCost: 4,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: {
      label: "Text to Dialogue",
      dialogue: [{ id: "1", text: "", voice: "Sarah" }],
      stability: 0.5,
      languageCode: "",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as TextToDialogueData,
  },
  {
    type: "voice-changer",
    label: "Voice Changer",
    category: "ai",
    creditCost: 4,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: {
      label: "Voice Changer",
      voiceId: "",
      voiceLabel: "",
      voiceType: "premade",
      stability: 0.5,
      similarityBoost: 0.75,
      removeBackgroundNoise: false,
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as VoiceChangerData,
  },
  {
    type: "dubbing",
    label: "Dubbing",
    category: "ai",
    creditCost: 8,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: {
      label: "Dubbing",
      targetLanguage: "es",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as DubbingData,
  },
  {
    type: "voice-remix",
    label: "Voice Remix",
    category: "ai",
    creditCost: 4,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: {
      label: "Voice Remix",
      text: "",
      voiceDescription: "",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as VoiceRemixData,
  },
  {
    type: "voice-design",
    label: "Voice Design",
    category: "ai",
    creditCost: 5,
    inputs: ["in"],
    outputs: ["audio", "voiceId"],
    defaultData: {
      label: "Voice Design",
      text: "",
      voiceDescription: "",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as VoiceDesignData,
    exposableOutputs: [
      { key: "audio", label: "Audio", outputType: "audio" as const },
      { key: "voiceId", label: "Voice ID", outputType: "data" as const },
    ],
    exposableFields: [
      {
        key: "model", label: "Model", type: "select" as const,
        options: [
          { value: "eleven_ttv_v3", label: "ElevenLabs v3 (recommended)" },
          { value: "eleven_multilingual_ttv_v2", label: "ElevenLabs Multilingual v2" },
        ],
      },
      { key: "loudness", label: "Loudness", type: "slider" as const, min: -1, max: 1, step: 0.1 },
    ],
  },
  {
    type: "forced-alignment",
    label: "Forced Alignment",
    category: "ai",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["data"],
    defaultData: {
      label: "Forced Alignment",
      transcript: "",
      fieldMappings: {},
      executionStatus: "idle",
      alignmentResults: [],
    } as ForcedAlignmentData,
  },
  // Processing
  {
    type: "combine-videos",
    label: "Combine Videos",
    category: "processing",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Combine Videos", transition: "cut", transitionDuration: 0.5, audioMode: "crossfade", fieldMappings: {} },
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
    type: "social-media-format",
    label: "Social Media Format",
    category: "processing",
    creditCost: 0,
    inputs: ["media", "text"],
    outputs: ["media", "text"],
    defaultData: {
      label: "Social Media Format",
      platform: "instagram",
      contentType: "feed-square",
      specKey: "instagram:feed-square",
      method: "pad",
      padColor: "#000000",
      formattedText: "",
      fieldMappings: {},
    } as SocialMediaFormatData,
  },
  {
    type: "trim-audio",
    label: "Trim Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Trim Audio", audioFormat: "mp3", fieldMappings: {} },
  },
  {
    type: "split-media",
    label: "Split Media",
    category: "processing",
    creditCost: 2,
    inputs: ["video-in", "audio-in"],
    outputs: ["video-out", "audio-out"],
    defaultData: { label: "Split Media", chunkDuration: 10, audioFormat: "mp3", fieldMappings: {} },
  },
  {
    type: "mix-audio",
    label: "Mix Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["audio"],
    defaultData: { label: "Mix Audio", trackCount: 2, trackVolumes: {}, fieldMappings: {} },
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
  {
    type: "extract-frame",
    label: "Extract Frame",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["image"],
    defaultData: {
      label: "Extract Frame",
      mode: "first",
      timestamp: 0,
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as ExtractFrameData,
  },
  {
    type: "video-composer",
    label: "Compose Video",
    category: "processing",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["composition"],
    defaultData: {
      label: "Compose Video",
      compositionPrompt: "",
      fps: 30,
      aspectRatio: "16:9",
      durationSeconds: 30,
      backgroundColor: "#000000",
      fieldMappings: {},
      executionStatus: "idle",
    } as VideoComposerData,
  },
  {
    type: "after-effects",
    label: "After Effects",
    category: "processing",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["composition"],
    defaultData: {
      label: "After Effects",
      effectPrompt: "",
      fps: 30,
      durationSeconds: 10,
      fieldMappings: {},
      executionStatus: "idle",
    } as AfterEffectsData,
  },
  {
    type: "lottie-overlay",
    label: "Lottie Overlay",
    category: "processing",
    creditCost: 2,
    inputs: ["in", "lottie"],
    outputs: ["composition"],
    defaultData: {
      label: "Lottie Overlay",
      overlayPrompt: "",
      fps: 30,
      durationSeconds: 10,
      fieldMappings: {},
      executionStatus: "idle",
    } as LottieOverlayData,
  },
  {
    type: "3d-title",
    label: "3D Title",
    category: "ai",
    creditCost: 3,
    inputs: ["background"],
    outputs: ["composition"],
    defaultData: {
      label: "3D Title",
      titlePrompt: "",
      aspectRatio: "16:9",
      backgroundColor: "#000000",
      fps: 30,
      durationSeconds: 10,
      fieldMappings: {},
      executionStatus: "idle",
    } as ThreeDTitleData,
  },
  {
    type: "motion-graphics",
    label: "Motion Graphics",
    category: "ai",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["composition"],
    defaultData: {
      label: "Motion Graphics",
      motionPrompt: "",
      aspectRatio: "16:9",
      backgroundColor: "#00000000",
      fps: 30,
      durationSeconds: 5,
      fieldMappings: {},
      executionStatus: "idle",
    } as MotionGraphicsData,
  },
  {
    type: "composite",
    label: "Composite",
    category: "processing",
    creditCost: 0,
    inputs: ["video1", "video2", "video3", "video4"],
    outputs: ["composition"],
    defaultData: {
      label: "Composite",
      layers: [],
      fps: 30,
      aspectRatio: "16:9",
      durationSeconds: 10,
      backgroundColor: "#000000",
      executionStatus: "idle",
    } as CompositeData,
  },
  {
    type: "render-video",
    label: "Render Video",
    category: "processing",
    creditCost: 3,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: {
      label: "Render Video",
      fps: 30,
      aspectRatio: "16:9",
      durationSeconds: 30,
      backgroundColor: "#000000",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as RenderVideoData,
  },
  {
    type: "speed-ramp",
    label: "Adjust Speed",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Adjust Speed", speed: 1.0, adjustAudio: true, fieldMappings: {} },
  },
  {
    type: "loop-video",
    label: "Loop Video",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Loop Video", mode: "repeat", repeatCount: 2, targetDuration: 10, fieldMappings: {} },
  },
  {
    type: "fade-video",
    label: "Fade In/Out",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Fade In/Out", fadeIn: true, fadeInDuration: 0.5, fadeOut: true, fadeOutDuration: 0.5, color: "black", fieldMappings: {} },
  },
  {
    type: "transcode-video",
    label: "Transcode Video",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Transcode Video", codec: "h264", crf: 23, resolution: "original", audioBitrate: "128k", fieldMappings: {} },
  },
  {
    type: "manual-edit",
    label: "Manual Edit",
    category: "processing",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Manual Edit", fieldMappings: {} },
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
    exposableOutputs: [{ key: "result", label: "Result", outputType: "video" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "kling-avatar", label: "Kling Avatar" },
          { value: "kling-avatar-pro", label: "Kling Avatar Pro" },
          { value: "infinitalk", label: "InfiniTalk" },
        ],
      },
      {
        key: "resolution", label: "Resolution", type: "select" as const,
        options: [
          { value: "720p", label: "720p" },
          { value: "1080p", label: "1080p" },
        ],
      },
    ],
  },
  // Speech-to-Video (Wan 2.2 S2V)
  {
    type: "speech-to-video",
    label: "Speech to Video",
    category: "ai",
    creditCost: 4,
    inputs: ["image", "audio", "prompt"],
    outputs: ["video"],
    defaultData: {
      label: "Speech to Video",
      prompt: "A person speaking naturally",
      resolution: "480p",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as SpeechToVideoData,
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
  // Upscale Video (Topaz)
  {
    type: "video-upscale",
    label: "Upscale Video",
    category: "processing",
    creditCost: 15,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: {
      label: "Upscale Video",
      provider: "topaz",
      upscaleFactor: "2",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as VideoUpscaleData,
  },
  {
    type: "extend-video",
    label: "Extend Video",
    category: "ai",
    creditCost: 40,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: {
      label: "Extend Video",
      provider: "veo-extend",
      prompt: "",
      fieldMappings: {},
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
    } as ExtendVideoData,
    exposableOutputs: [{ key: "result", label: "Result", outputType: "video" as const }],
    exposableFields: [
      {
        key: "provider", label: "Model", type: "select" as const,
        options: [
          { value: "veo-extend", label: "VEO Extend" },
          { value: "runway-extend", label: "Runway Extend" },
        ],
      },
    ],
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
    defaultData: { label: "Webhook Output", url: "", params: [] },
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
  // LLM Chat
  {
    type: "llm-chat",
    label: "LLM Chat",
    category: "ai",
    creditCost: 3,
    inputs: ["prompt", "references", "system-prompt"],
    outputs: ["text"],
    defaultData: {
      label: "LLM Chat",
      systemPrompt: "",
      userInput: "",
      temperature: 0.7,
      maxTokens: 2048,
      fieldMappings: {},
    } as LLMChatData,
    exposableOutputs: [{ key: "result", label: "Result", outputType: "text" as const }],
    exposableFields: [
      { key: "systemPrompt", label: "System Prompt", type: "text" as const },
      { key: "userInput", label: "User Prompt", type: "text" as const },
      { key: "temperature", label: "Temperature", type: "slider" as const, min: 0, max: 2, step: 0.1 },
      { key: "maxTokens", label: "Max Tokens", type: "slider" as const, min: 256, max: 16384, step: 256 },
    ],
  },
  // AI Agent
  {
    type: "ai-writer",
    label: "AI Agent",
    category: "ai",
    creditCost: 2,
    inputs: ["in"],
    outputs: ["text"],
    defaultData: {
      label: "AI Agent",
      templateId: "custom",
      systemPrompt: "",
      userInput: "",
      provider: "claude",
      temperature: 0.7,
      maxTokens: 4096,
      fieldMappings: {},
    } as AIWriterNodeData,
    exposableOutputs: [{ key: "result", label: "Result", outputType: "text" as const }],
    exposableFields: [
      { key: "temperature", label: "Temperature", type: "slider" as const, min: 0, max: 1, step: 0.1 },
      { key: "maxTokens", label: "Max Tokens", type: "slider" as const, min: 256, max: 16384, step: 256 },
    ],
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
    type: "split-text",
    label: "Split Text",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: {
      label: "Split Text",
      separator: "===NEXT===",
      trimWhitespace: true,
      removeEmpty: true,
    } as SplitTextData,
  },
  {
    type: "preview",
    label: "Preview",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: {
      label: "Preview",
      previewItems: [],
      itemOrder: [],
    } as PreviewNodeData,
  },
  {
    type: "router",
    label: "Router",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["route_a", "route_b"],
    defaultData: {
      label: "Router",
      mode: "radio" as const,
      routes: [
        { id: "default_a", name: "Route A", active: true },
        { id: "default_b", name: "Route B", active: false },
      ],
    } as RouterNodeData,
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
  {
    type: "teleport-send",
    label: "Teleport Send",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: {
      label: "Send",
      channel: "A",
      channelColor: "#f59e0b",
    } as TeleportSendData,
    width: 150,
  },
  {
    type: "teleport-receive",
    label: "Teleport Receive",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: {
      label: "Receive",
      channel: "A",
      channelColor: "#f59e0b",
    } as TeleportReceiveData,
    width: 150,
  },
  // Sub-Workflow
  {
    type: "sub-workflow-input",
    label: "Sub-Workflow Input",
    category: "utility",
    creditCost: 0,
    inputs: [],
    outputs: ["out"],
    defaultData: {
      label: "Sub-Workflow Input",
      routeId: "",
      ports: [{ id: "", name: "Input", mediaType: "any" }],
    } as SubWorkflowInputData,
  },
  {
    type: "sub-workflow-output",
    label: "Sub-Workflow Output",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "Sub-Workflow Output",
      routeId: "",
      ports: [{ id: "", name: "Output", mediaType: "any" }],
      visibleOutputPortId: "",
    } as SubWorkflowOutputData,
  },
  {
    type: "sub-workflow",
    label: "Sub-Workflow",
    category: "utility",
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: {
      label: "Sub-Workflow",
      referencedWorkflowId: "",
      referencedWorkflowName: "",
      selectedRouteId: "",
      routeSnapshot: null,
      fieldMappings: {},
      executionStatus: "idle",
    } as SubWorkflowData,
  },
  // Social Media
  {
    type: "instagram-post",
    label: "Instagram Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "Instagram Post",
      platform: "instagram",
      action: "post-image",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "tiktok-post",
    label: "TikTok Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "TikTok Post",
      platform: "tiktok",
      action: "post-video",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "youtube-upload",
    label: "YouTube Upload",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "YouTube Upload",
      platform: "youtube",
      action: "upload-video",
      caption: "",
      title: "",
      description: "",
      tags: [],
      privacy: "private",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "linkedin-post",
    label: "LinkedIn Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "LinkedIn Post",
      platform: "linkedin",
      action: "post-image",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "x-post",
    label: "X Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "X Post",
      platform: "x",
      action: "post-tweet",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "facebook-post",
    label: "Facebook Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "Facebook Post",
      platform: "facebook",
      action: "post-image",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "telegram-post",
    label: "Telegram Post",
    category: "output",
    creditCost: 1,
    inputs: ["in"],
    outputs: [],
    defaultData: {
      label: "Telegram Post",
      platform: "telegram",
      action: "send-message",
      caption: "",
      fieldMappings: {},
    } as SocialPostData,
  },
  {
    type: "telegram-trigger",
    label: "Telegram Trigger",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["text", "imageUrl", "videoUrl", "audioUrl", "chatId", "messageId"],
    defaultData: {
      label: "Telegram Trigger",
      messageTypeFilters: ["text", "photo", "video", "audio", "document"],
    } as TelegramTriggerData,
  },
  // Components
  {
    type: "component",
    label: "Component",
    category: "utility" as const,
    creditCost: 0,
    inputs: ["in"],
    outputs: ["out"],
    defaultData: {
      label: "Component",
      appSlug: "",
      appVersionId: "",
      pinnedVersion: 0,
      componentMetadata: { inputs: [], outputs: [], exposedSettings: [] },
      exposedSettings: {},
      creatorName: "",
      creatorId: "",
      estimatedCredits: 0,
      executionStatus: "idle",
    } as ComponentNodeData,
  },
]

export const NODE_DEF_MAP: ReadonlyMap<string, NodeTypeDefinition> = new Map(NODE_DEFINITIONS.map((d) => [d.type, d]))
