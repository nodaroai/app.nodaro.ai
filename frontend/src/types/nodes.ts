import type { Node, Edge } from "@xyflow/react"

export type NodeCategory = "input" | "parameter" | "ai" | "processing" | "output"

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

// --- AI Node Data ---

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
}

export type ImageToVideoData = {
  [key: string]: unknown
  label: string
  provider: "veo" | "kling" | "runway" | "pika"
  model: string
  duration: number
  motion: "subtle" | "moderate" | "dynamic"
  cameraMotion: "static" | "pan-left" | "pan-right" | "zoom-in" | "zoom-out"
}

export type TextToSpeechData = {
  [key: string]: unknown
  label: string
  provider: "elevenlabs" | "playht" | "azure"
  voiceId: string
  language: string
  speed: number
  pitch: number
}

export type QACheckData = {
  [key: string]: unknown
  label: string
  provider: "claude" | "gpt"
  checkType: "content" | "quality" | "consistency" | "safety"
  threshold: number
}

// --- Processing Node Data ---

export type CombineVideosData = {
  [key: string]: unknown
  label: string
  transition: "cut" | "fade" | "dissolve"
  transitionDuration: number
}

export type AddAudioData = {
  [key: string]: unknown
  label: string
  audioType: "voiceover" | "background" | "both"
  voiceoverVolume: number
  backgroundVolume: number
}

export type AddCaptionsData = {
  [key: string]: unknown
  label: string
  style: "subtitle" | "word-highlight" | "karaoke"
  position: "bottom" | "top" | "center"
  fontSize: number
  color: string
}

export type ResizeVideoData = {
  [key: string]: unknown
  label: string
  targetAspect: "1:1" | "16:9" | "9:16" | "4:5"
  method: "crop" | "pad" | "stretch"
  padColor: string
}

export type ExtractAudioData = {
  [key: string]: unknown
  label: string
  outputSilentVideo: boolean
  audioFormat: "mp3" | "wav" | "aac"
}

export type MixAudioData = {
  [key: string]: unknown
  label: string
  trackCount: number
}

export type AdjustVolumeData = {
  [key: string]: unknown
  label: string
  volume: number
  normalize: boolean
  fadeIn: number
  fadeOut: number
}

export type TrimVideoData = {
  [key: string]: unknown
  label: string
  startTime: number
  endTime: number
}

// --- Output Node Data ---

export type SaveToStorageData = {
  [key: string]: unknown
  label: string
  filename: string
  format: "mp4" | "webm" | "mov"
  quality: "draft" | "standard" | "high" | "4k"
}

export type WebhookOutputData = {
  [key: string]: unknown
  label: string
  webhookId: string
  includeAssetUrl: boolean
}

// --- Union Types ---

export type SceneNodeData =
  | TextPromptData
  | UploadImageData
  | UploadVideoData
  | RSSFeedData
  | ToneData
  | StyleGuideData
  | ProviderData
  | SceneCountData
  | DurationData
  | AspectRatioData
  | GenerateScriptData
  | GenerateImageData
  | ImageToVideoData
  | TextToSpeechData
  | QACheckData
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
  | "tone"
  | "style-guide"
  | "provider"
  | "scene-count"
  | "duration"
  | "aspect-ratio"
  | "generate-script"
  | "generate-image"
  | "image-to-video"
  | "text-to-speech"
  | "qa-check"
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
  // AI
  {
    type: "generate-script",
    label: "Generate Script",
    category: "ai",
    creditCost: 2,
    inputs: ["prompt"],
    outputs: ["scenes"],
    defaultData: { label: "Generate Script", provider: "gemini", model: "gemini-2.5-flash", sceneCount: 5, styleGuide: "", structure: "freeform", tone: "", targetLength: 60 },
  },
  {
    type: "generate-image",
    label: "Generate Image",
    category: "ai",
    creditCost: 5,
    inputs: ["prompt", "reference"],
    outputs: ["image"],
    defaultData: { label: "Generate Image", prompt: "", provider: "nano-banana", model: "gemini-2.5-flash-image", style: "", aspectRatio: "16:9", negativePrompt: "" },
  },
  {
    type: "image-to-video",
    label: "Image to Video",
    category: "ai",
    creditCost: 20,
    inputs: ["image", "motion-prompt"],
    outputs: ["video"],
    defaultData: { label: "Image to Video", provider: "veo", model: "veo-3.1", duration: 5, motion: "moderate", cameraMotion: "static" },
  },
  {
    type: "text-to-speech",
    label: "Text to Speech",
    category: "ai",
    creditCost: 3,
    inputs: ["text"],
    outputs: ["audio"],
    defaultData: { label: "Text to Speech", provider: "elevenlabs", voiceId: "", language: "en", speed: 1, pitch: 1 },
  },
  {
    type: "qa-check",
    label: "QA Check",
    category: "ai",
    creditCost: 1,
    inputs: ["content"],
    outputs: ["approved", "rejected"],
    defaultData: { label: "QA Check", provider: "claude", checkType: "quality", threshold: 0.8 },
  },
  // Processing
  {
    type: "combine-videos",
    label: "Combine Videos",
    category: "processing",
    creditCost: 2,
    inputs: ["videos"],
    outputs: ["video"],
    defaultData: { label: "Combine Videos", transition: "cut", transitionDuration: 0.5 },
  },
  {
    type: "add-audio",
    label: "Add Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["video", "audio"],
    outputs: ["video"],
    defaultData: { label: "Add Audio", audioType: "voiceover", voiceoverVolume: 100, backgroundVolume: 30 },
  },
  {
    type: "add-captions",
    label: "Add Captions",
    category: "processing",
    creditCost: 2,
    inputs: ["video", "transcript"],
    outputs: ["video"],
    defaultData: { label: "Add Captions", style: "subtitle", position: "bottom", fontSize: 24, color: "#ffffff" },
  },
  {
    type: "resize-video",
    label: "Resize Video",
    category: "processing",
    creditCost: 1,
    inputs: ["video"],
    outputs: ["video"],
    defaultData: { label: "Resize Video", targetAspect: "9:16", method: "crop", padColor: "#000000" },
  },
  {
    type: "extract-audio",
    label: "Extract Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["video"],
    outputs: ["audio", "silent-video"],
    defaultData: { label: "Extract Audio", outputSilentVideo: true, audioFormat: "mp3" },
  },
  {
    type: "mix-audio",
    label: "Mix Audio",
    category: "processing",
    creditCost: 1,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Mix Audio", trackCount: 2 },
  },
  {
    type: "adjust-volume",
    label: "Adjust Volume",
    category: "processing",
    creditCost: 0,
    inputs: ["audio"],
    outputs: ["audio"],
    defaultData: { label: "Adjust Volume", volume: 100, normalize: false, fadeIn: 0, fadeOut: 0 },
  },
  {
    type: "trim-video",
    label: "Trim Video",
    category: "processing",
    creditCost: 0,
    inputs: ["video"],
    outputs: ["video"],
    defaultData: { label: "Trim Video", startTime: 0, endTime: 0 },
  },
  // Output
  {
    type: "save-to-storage",
    label: "Save to Storage",
    category: "output",
    creditCost: 0,
    inputs: ["video"],
    outputs: ["asset"],
    defaultData: { label: "Save to Storage", filename: "", format: "mp4", quality: "standard" },
  },
  {
    type: "webhook-output",
    label: "Webhook Output",
    category: "output",
    creditCost: 0,
    inputs: ["data"],
    outputs: [],
    defaultData: { label: "Webhook Output", webhookId: "", includeAssetUrl: true },
  },
]
