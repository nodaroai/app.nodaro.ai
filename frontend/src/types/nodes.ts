import type { Node, Edge } from "@xyflow/react"

export type NodeCategory = "input" | "parameter" | "ai" | "processing" | "output"

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

export type UploadImageData = {
  [key: string]: unknown
  label: string
  assetId: string
  url: string
}

export type UploadVideoData = {
  [key: string]: unknown
  label: string
  assetId: string
  url: string
}

export type RSSFeedData = {
  [key: string]: unknown
  label: string
  feedUrl: string
  itemIndex: number
  extractFields: string[]
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

export interface ScriptScene {
  readonly sceneNumber: number
  readonly visualDescription: string
  readonly action: string
  readonly mood: string
  readonly durationHint: number
  readonly imagePrompt: string
  readonly generatedImages?: readonly SceneImageVersion[]
  readonly activeImageIndex?: number
  readonly imageStatus?: "idle" | "running" | "completed" | "failed"
}

export interface GeneratedScript {
  readonly title: string
  readonly totalDuration: number
  readonly scenes: readonly ScriptScene[]
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
  generatedScript?: GeneratedScript
  generatedResults?: GeneratedScriptResult[]
  activeResultIndex?: number
}

export type GenerateImageData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: "nano-banana" | "flux" | "dalle"
  model: string
  style: string
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3"
  negativePrompt: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  generatedImageUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type ImageToVideoData = {
  [key: string]: unknown
  label: string
  provider: "veo" | "kling" | "runway" | "pika"
  model: string
  duration: number
  motion: "subtle" | "moderate" | "dynamic"
  cameraMotion: "static" | "pan-left" | "pan-right" | "zoom-in" | "zoom-out"
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type TextToSpeechData = {
  [key: string]: unknown
  label: string
  provider: "elevenlabs" | "playht" | "azure"
  voiceId: string
  language: string
  speed: number
  pitch: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type TextToVideoData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: "runway" | "pika" | "sora" | "veo" | "kling"
  model: string
  duration: number
  aspectRatio: "16:9" | "9:16" | "1:1"
  negativePrompt: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type VideoToVideoData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: "veo" | "kling" | "runway" | "pika"
  model: string
  duration: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  generatedVideoUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
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
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
  activeResultIndex?: number
}

export type TextToAudioData = {
  [key: string]: unknown
  label: string
  prompt: string
  provider: "tangoflux" | "tango" | "audioldm" | "bark"
  duration: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  generatedAudioUrl?: string
  generatedResults?: GeneratedResult[]
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
  generatedVideoUrl?: string
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

export type AddAudioData = {
  [key: string]: unknown
  label: string
  audioType: "voiceover" | "background" | "both"
  voiceoverVolume: number
  backgroundVolume: number
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
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
  generatedAudioUrl?: string
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

// --- Union Types ---

export type SceneNodeData =
  | TextPromptData
  | UploadImageData
  | UploadVideoData
  | RSSFeedData
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
  | ImageToVideoData
  | VideoToVideoData
  | TextToVideoData
  | TextToSpeechData
  | QACheckData
  | GenerateMusicData
  | TextToAudioData
  | CombineVideosData
  | AddAudioData
  | AddCaptionsData
  | ResizeVideoData
  | ExtractAudioData
  | MixAudioData
  | AdjustVolumeData
  | TrimVideoData
  | SaveToStorageData
  | WebhookOutputData

export type SceneNodeType =
  | "text-prompt"
  | "upload-image"
  | "upload-video"
  | "rss-feed"
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
  | "image-to-video"
  | "video-to-video"
  | "text-to-video"
  | "text-to-speech"
  | "qa-check"
  | "generate-music"
  | "text-to-audio"
  | "combine-videos"
  | "add-audio"
  | "add-captions"
  | "resize-video"
  | "extract-audio"
  | "mix-audio"
  | "adjust-volume"
  | "trim-video"
  | "save-to-storage"
  | "webhook-output"

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
    type: "upload-image",
    label: "Upload Image",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["image"],
    defaultData: { label: "Upload Image", assetId: "", url: "" },
  },
  {
    type: "upload-video",
    label: "Upload Video",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["video"],
    defaultData: { label: "Upload Video", assetId: "", url: "" },
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
    defaultData: { label: "Generate Image", prompt: "", provider: "nano-banana", model: "gemini-2.5-flash-image", style: "", aspectRatio: "16:9", negativePrompt: "", fieldMappings: {} },
  },
  {
    type: "image-to-video",
    label: "Image to Video",
    category: "ai",
    creditCost: 20,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Image to Video", provider: "veo", model: "veo-3.1", duration: 5, motion: "moderate", cameraMotion: "static", fieldMappings: {} },
  },
  {
    type: "video-to-video",
    label: "Video to Video",
    category: "ai",
    creditCost: 25,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Video to Video", prompt: "", provider: "runway", model: "gen-3-alpha", duration: 5, fieldMappings: {} },
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
    defaultData: { label: "Text to Speech", provider: "elevenlabs", voiceId: "Rachel", language: "en", speed: 1, pitch: 1, fieldMappings: {} },
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
    type: "add-audio",
    label: "Add Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["in"],
    outputs: ["video"],
    defaultData: { label: "Add Audio", audioType: "voiceover", voiceoverVolume: 100, backgroundVolume: 30, fieldMappings: {} },
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
]
