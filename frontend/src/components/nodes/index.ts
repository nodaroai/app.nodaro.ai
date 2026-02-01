import { TextPromptNode } from "./text-prompt-node"
import { UploadImageNode } from "./upload-image-node"
import { UploadVideoNode } from "./upload-video-node"
import { RSSFeedNode } from "./rss-feed-node"
import { ToneNode } from "./tone-node"
import { StyleGuideNode } from "./style-guide-node"
import { ProviderNode } from "./provider-node"
import { SceneCountNode } from "./scene-count-node"
import { DurationNode } from "./duration-node"
import { AspectRatioNode } from "./aspect-ratio-node"
import { MotionNode } from "./motion-node"
import { CameraMotionNode } from "./camera-motion-node"
import { ReferenceAudioNode } from "./reference-audio-node"
import { GenerateScriptNode } from "./generate-script-node"
import { GenerateImageNode } from "./generate-image-node"
import { ImageToVideoNode } from "./image-to-video-node"
import { VideoToVideoNode } from "./video-to-video-node"
import { TextToVideoNode } from "./text-to-video-node"
import { TextToSpeechNode } from "./text-to-speech-node"
import { QACheckNode } from "./qa-check-node"
import { GenerateMusicNode } from "./generate-music-node"
import { TextToAudioNode } from "./text-to-audio-node"
import { CombineVideosNode } from "./combine-videos-node"
import { AddAudioNode } from "./add-audio-node"
import { AddCaptionsNode } from "./add-captions-node"
import { ResizeVideoNode } from "./resize-video-node"
import { ExtractAudioNode } from "./extract-audio-node"
import { MixAudioNode } from "./mix-audio-node"
import { AdjustVolumeNode } from "./adjust-volume-node"
import { TrimVideoNode } from "./trim-video-node"
import { SaveToStorageNode } from "./save-to-storage-node"
import { WebhookOutputNode } from "./webhook-output-node"
import type { SceneNodeType } from "@/types/nodes"

export const nodeTypes: Record<SceneNodeType, React.ComponentType<any>> = {
  // Input
  "text-prompt": TextPromptNode,
  "upload-image": UploadImageNode,
  "upload-video": UploadVideoNode,
  "rss-feed": RSSFeedNode,
  // Parameter
  "tone": ToneNode,
  "style-guide": StyleGuideNode,
  "provider": ProviderNode,
  "scene-count": SceneCountNode,
  "duration": DurationNode,
  "aspect-ratio": AspectRatioNode,
  "motion": MotionNode,
  "camera-motion": CameraMotionNode,
  "reference-audio": ReferenceAudioNode,
  // AI
  "generate-script": GenerateScriptNode,
  "generate-image": GenerateImageNode,
  "image-to-video": ImageToVideoNode,
  "video-to-video": VideoToVideoNode,
  "text-to-video": TextToVideoNode,
  "text-to-speech": TextToSpeechNode,
  "qa-check": QACheckNode,
  "generate-music": GenerateMusicNode,
  "text-to-audio": TextToAudioNode,
  // Processing
  "combine-videos": CombineVideosNode,
  "add-audio": AddAudioNode,
  "add-captions": AddCaptionsNode,
  "resize-video": ResizeVideoNode,
  "extract-audio": ExtractAudioNode,
  "mix-audio": MixAudioNode,
  "adjust-volume": AdjustVolumeNode,
  "trim-video": TrimVideoNode,
  // Output
  "save-to-storage": SaveToStorageNode,
  "webhook-output": WebhookOutputNode,
}
