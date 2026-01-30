import { TextPromptNode } from "./text-prompt-node"
import { GenerateScriptNode } from "./generate-script-node"
import { GenerateImageNode } from "./generate-image-node"
import { ImageToVideoNode } from "./image-to-video-node"
import { CombineVideosNode } from "./combine-videos-node"
import type { SceneNodeType } from "@/types/nodes"

export const nodeTypes: Record<SceneNodeType, React.ComponentType<any>> = {
  "text-prompt": TextPromptNode,
  "generate-script": GenerateScriptNode,
  "generate-image": GenerateImageNode,
  "image-to-video": ImageToVideoNode,
  "combine-videos": CombineVideosNode,
}
