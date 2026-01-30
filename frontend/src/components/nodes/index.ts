import { TextPromptNode } from "./text-prompt-node"
import { GenerateImageNode } from "./generate-image-node"
import { ImageToVideoNode } from "./image-to-video-node"
import { CombineVideosNode } from "./combine-videos-node"
import type { SceneNodeType } from "@/types/nodes"

export const nodeTypes: Record<SceneNodeType, React.ComponentType<any>> = {
  "text-prompt": TextPromptNode,
  "generate-image": GenerateImageNode,
  "image-to-video": ImageToVideoNode,
  "combine-videos": CombineVideosNode,
}
