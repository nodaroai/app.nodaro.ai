import type { Node, Edge } from "@xyflow/react"

export type NodeCategory = "input" | "ai" | "processing" | "output"

export type TextPromptData = {
  [key: string]: unknown
  label: string
  text: string
  variables: Record<string, string>
}

export type GenerateImageData = {
  [key: string]: unknown
  label: string
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

export type CombineVideosData = {
  [key: string]: unknown
  label: string
  transition: "cut" | "fade" | "dissolve"
  transitionDuration: number
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
}

export type SceneNodeData =
  | TextPromptData
  | GenerateScriptData
  | GenerateImageData
  | ImageToVideoData
  | CombineVideosData

export type SceneNodeType =
  | "text-prompt"
  | "generate-script"
  | "generate-image"
  | "image-to-video"
  | "combine-videos"

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
  {
    type: "text-prompt",
    label: "Text Prompt",
    category: "input",
    creditCost: 0,
    inputs: [],
    outputs: ["prompt"],
    defaultData: {
      label: "Text Prompt",
      text: "",
      variables: {},
    },
  },
  {
    type: "generate-script",
    label: "Generate Script",
    category: "ai",
    creditCost: 2,
    inputs: ["prompt"],
    outputs: ["scenes"],
    defaultData: {
      label: "Generate Script",
      provider: "gemini",
      model: "gemini-2.5-flash",
      sceneCount: 5,
      styleGuide: "",
      structure: "freeform",
      tone: "",
      targetLength: 60,
    },
  },
  {
    type: "generate-image",
    label: "Generate Image",
    category: "ai",
    creditCost: 5,
    inputs: ["prompt", "reference"],
    outputs: ["image"],
    defaultData: {
      label: "Generate Image",
      provider: "nano-banana",
      model: "gemini-2.5-flash-image",
      style: "",
      aspectRatio: "16:9",
      negativePrompt: "",
    },
  },
  {
    type: "image-to-video",
    label: "Image to Video",
    category: "ai",
    creditCost: 20,
    inputs: ["image", "motion-prompt"],
    outputs: ["video"],
    defaultData: {
      label: "Image to Video",
      provider: "veo",
      model: "veo-3.1",
      duration: 5,
      motion: "moderate",
      cameraMotion: "static",
    },
  },
  {
    type: "combine-videos",
    label: "Combine Videos",
    category: "processing",
    creditCost: 2,
    inputs: ["videos"],
    outputs: ["video"],
    defaultData: {
      label: "Combine Videos",
      transition: "cut",
      transitionDuration: 0.5,
    },
  },
]
