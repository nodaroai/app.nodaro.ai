import { TextPromptNode } from "./text-prompt-node"
import { ListNode } from "./list-node"
import { LoopNode } from "./loop-node"
import { UploadImageNode } from "./upload-image-node"
import { UploadVideoNode } from "./upload-video-node"
import { UploadAudioNode } from "./upload-audio-node"
import { RSSFeedNode } from "./rss-feed-node"
import { YouTubeVideoNode } from "./youtube-video-node"
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
import { EditImageNode } from "./edit-image-node"
import { ImageToImageNode } from "./image-to-image-node"
import { ImageToVideoNode } from "./image-to-video-node"
import { VideoToVideoNode } from "./video-to-video-node"
import { TextToVideoNode } from "./text-to-video-node"
import { TextToSpeechNode } from "./text-to-speech-node"
import { QACheckNode } from "./qa-check-node"
import { GenerateMusicNode } from "./generate-music-node"
import { TextToAudioNode } from "./text-to-audio-node"
import { SunoGenerateNode } from "./suno-generate-node"
import { SunoCoverNode } from "./suno-cover-node"
import { SunoExtendNode } from "./suno-extend-node"
import { SunoLyricsNode } from "./suno-lyrics-node"
import { SunoSeparateNode } from "./suno-separate-node"
import { SunoMusicVideoNode } from "./suno-music-video-node"
import { TranscribeNode } from "./transcribe-node"
import { AIWriterNode } from "./ai-writer-node"
import { CombineVideosNode } from "./combine-videos-node"
import { MergeVideoAudioNode } from "./merge-video-audio-node"
import { AddCaptionsNode } from "./add-captions-node"
import { ResizeVideoNode } from "./resize-video-node"
import { ExtractAudioNode } from "./extract-audio-node"
import { MixAudioNode } from "./mix-audio-node"
import { AdjustVolumeNode } from "./adjust-volume-node"
import { TrimVideoNode } from "./trim-video-node"
import { LipSyncNode } from "./lip-sync-node"
import { MotionTransferNode } from "./motion-transfer-node"
import { VideoUpscaleNode } from "./video-upscale-node"
import { SaveToStorageNode } from "./save-to-storage-node"
import { WebhookOutputNode } from "./webhook-output-node"
import { SceneNode } from "./scene-node"
import { CharacterNode } from "./character-node"
import { FaceNode } from "./face-node"
import { ObjectNode } from "./object-node"
import { LocationNode } from "./location-node"
import { CombineTextNode } from "./combine-text-node"
import { StickyNoteNode } from "./sticky-note-node"
import type { SceneNodeType } from "@/types/nodes"

export const nodeTypes: Record<SceneNodeType, React.ComponentType<any>> = {
  // Input
  "text-prompt": TextPromptNode,
  "list": ListNode,
  "loop": LoopNode,
  "upload-image": UploadImageNode,
  "upload-video": UploadVideoNode,
  "upload-audio": UploadAudioNode,
  "rss-feed": RSSFeedNode,
  "youtube-video": YouTubeVideoNode,
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
  "edit-image": EditImageNode,
  "image-to-image": ImageToImageNode,
  "image-to-video": ImageToVideoNode,
  "video-to-video": VideoToVideoNode,
  "text-to-video": TextToVideoNode,
  "text-to-speech": TextToSpeechNode,
  "qa-check": QACheckNode,
  "generate-music": GenerateMusicNode,
  "text-to-audio": TextToAudioNode,
  "suno-generate": SunoGenerateNode,
  "suno-cover": SunoCoverNode,
  "suno-extend": SunoExtendNode,
  "suno-lyrics": SunoLyricsNode,
  "suno-separate": SunoSeparateNode,
  "suno-music-video": SunoMusicVideoNode,
  "lip-sync": LipSyncNode,
  "motion-transfer": MotionTransferNode,
  "transcribe": TranscribeNode,
  "ai-writer": AIWriterNode,
  // Processing
  "combine-videos": CombineVideosNode,
  "merge-video-audio": MergeVideoAudioNode,
  "add-captions": AddCaptionsNode,
  "resize-video": ResizeVideoNode,
  "extract-audio": ExtractAudioNode,
  "mix-audio": MixAudioNode,
  "adjust-volume": AdjustVolumeNode,
  "trim-video": TrimVideoNode,
  "video-upscale": VideoUpscaleNode,
  // Output
  "save-to-storage": SaveToStorageNode,
  "webhook-output": WebhookOutputNode,
  // Scene
  "scene": SceneNode,
  // Character
  "character": CharacterNode,
  // Face
  "face": FaceNode,
  // Object
  "object": ObjectNode,
  // Location
  "location": LocationNode,
  // Utility
  "combine-text": CombineTextNode,
  "sticky-note": StickyNoteNode,
}
