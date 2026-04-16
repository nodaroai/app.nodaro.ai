import { TextPromptNode } from "./text-prompt-node";
import { LoopNode } from "./loop-node";
import { UploadImageNode } from "./upload-image-node";
import { UploadVideoNode } from "./upload-video-node";
import { UploadAudioNode } from "./upload-audio-node";
import { RSSFeedNode } from "./rss-feed-node";
import { YouTubeVideoNode } from "./youtube-video-node";
import { WebScrapeNode } from "./web-scrape-node";
import { ToneNode } from "./tone-node";
import { StyleGuideNode } from "./style-guide-node";
import { ProviderNode } from "./provider-node";
import { SceneCountNode } from "./scene-count-node";
import { DurationNode } from "./duration-node";
import { AspectRatioNode } from "./aspect-ratio-node";
import { MotionNode } from "./motion-node";
import { CameraMotionNode } from "./camera-motion-node";
import { ReferenceAudioNode } from "./reference-audio-node";
import { GenerateScriptNode } from "./generate-script-node";
import { GenerateImageNode } from "./generate-image-node";
import { ModifyImageNode } from "./modify-image-node";
import { UpscaleImageNode } from "./upscale-image-node";
import { RemoveBackgroundNode } from "./remove-background-node";
import { ImageToVideoNode } from "./image-to-video-node";
import { VideoToVideoNode } from "./video-to-video-node";
import { TextToVideoNode } from "./text-to-video-node";
import { TextToSpeechNode } from "./text-to-speech-node";
import { QACheckNode } from "./qa-check-node";
import { GenerateMusicNode } from "./generate-music-node";
import { TextToAudioNode } from "./text-to-audio-node";
import { SunoGenerateNode } from "./suno-generate-node";
import { SunoCoverNode } from "./suno-cover-node";
import { SunoExtendNode } from "./suno-extend-node";
import { SunoLyricsNode } from "./suno-lyrics-node";
import { SunoSeparateNode } from "./suno-separate-node";
import { SunoMusicVideoNode } from "./suno-music-video-node";
import { SunoMashupNode } from "./suno-mashup-node";
import { SunoReplaceSectionNode } from "./suno-replace-section-node";
import { SunoStyleBoostNode } from "./suno-style-boost-node";
import { SunoAddInstrumentalNode } from "./suno-add-instrumental-node";
import { SunoAddVocalsNode } from "./suno-add-vocals-node";
import { SunoConvertWavNode } from "./suno-convert-wav-node";
import { SunoUploadExtendNode } from "./suno-upload-extend-node";
import { TranscribeNode } from "./transcribe-node";
import { AudioIsolationNode } from "./audio-isolation-node"
import { TextToDialogueNode } from "./text-to-dialogue-node"
import { VoiceChangerNode } from "./voice-changer-node"
import { DubbingNode } from "./dubbing-node"
import { VoiceRemixNode } from "./voice-remix-node"
import { VoiceDesignNode } from "./voice-design-node"
import { ForcedAlignmentNode } from "./forced-alignment-node"
import { ImageToTextNode } from "./image-to-text-node";
import { LLMChatNode } from "./llm-chat-node";
import { AIWriterNode } from "./ai-writer-node";
import { CombineVideosNode } from "./combine-videos-node";
import { MergeVideoAudioNode } from "./merge-video-audio-node";
import { AddCaptionsNode } from "./add-captions-node";
import { ResizeVideoNode } from "./resize-video-node";
import { SocialMediaFormatNode } from "./social-media-format-node";
import { TrimAudioNode } from "./trim-audio-node";
import { SplitMediaNode } from "./split-media-node";
import { MixAudioNode } from "./mix-audio-node";
import { CombineAudioNode } from "./combine-audio-node";
import { AdjustVolumeNode } from "./adjust-volume-node";
import { TrimVideoNode } from "./trim-video-node";
import { ExtractFrameNode } from "./extract-frame-node";
import { ExtractFieldNode } from "./extract-field-node";
import { VideoComposerNode } from "./video-composer-node";
import { AfterEffectsNode } from "./after-effects-node";
import { LottieOverlayNode } from "./lottie-overlay-node";
import { ThreeDTitleNode } from "./three-d-title-node";
import { MotionGraphicsNode } from "./motion-graphics-node";
import { CompositeNode } from "./composite-node";
import { RenderVideoNode } from "./render-video-node";
import { SpeedRampNode } from "./speed-ramp-node";
import { LoopVideoNode } from "./loop-video-node";
import { FadeVideoNode } from "./fade-video-node";
import { TranscodeVideoNode } from "./transcode-video-node";
import { ManualEditNode } from "./manual-edit-node";
import { LipSyncNode } from "./lip-sync-node";
import { SpeechToVideoNode } from "./speech-to-video-node";
import { MotionTransferNode } from "./motion-transfer-node";
import { VideoUpscaleNode } from "./video-upscale-node";
import { ExtendVideoNode } from "./extend-video-node";
import { SaveToStorageNode } from "./save-to-storage-node";
import { WebhookOutputNode } from "./webhook-output-node";
import { SceneNode } from "./scene-node";
import { CharacterNode } from "./character-node";
import { FaceNode } from "./face-node";
import { ObjectNode } from "./object-node";
import { LocationNode } from "./location-node";
import { CombineTextNode } from "./combine-text-node";
import { SplitTextNode } from "./split-text-node";
import { PreviewNode } from "./preview-node";
import { StickyNoteNode } from "./sticky-note-node";
import { RouterNode } from "./router-node";
import { TeleportSendNode, TeleportReceiveNode } from "./teleport-node-shell";
import { SubWorkflowInputNode } from "./sub-workflow-input-node";
import { SubWorkflowOutputNode } from "./sub-workflow-output-node";
import { SubWorkflowNode } from "./sub-workflow-node";
import { ComponentNode } from "./component-node";
import { WebhookTriggerNode } from "./webhook-trigger-node";
import { ScheduleTriggerNode } from "./schedule-trigger-node";
import { SocialNode } from "./social-node";
import { TelegramTriggerNode } from "./telegram-trigger-node";
import type { SceneNodeType } from "@/types/nodes";

export const nodeTypes: Record<SceneNodeType, React.ComponentType<any>> = {
  // Input
  "text-prompt": TextPromptNode,
  list: LoopNode,
  loop: LoopNode,
  "upload-image": UploadImageNode,
  "upload-video": UploadVideoNode,
  "upload-audio": UploadAudioNode,
  "rss-feed": RSSFeedNode,
  "youtube-video": YouTubeVideoNode,
  "web-scrape": WebScrapeNode,
  "webhook-trigger": WebhookTriggerNode,
  "schedule-trigger": ScheduleTriggerNode,
  // Parameter
  tone: ToneNode,
  "style-guide": StyleGuideNode,
  provider: ProviderNode,
  "scene-count": SceneCountNode,
  duration: DurationNode,
  "aspect-ratio": AspectRatioNode,
  motion: MotionNode,
  "camera-motion": CameraMotionNode,
  "reference-audio": ReferenceAudioNode,
  // AI
  "generate-script": GenerateScriptNode,
  "generate-image": GenerateImageNode,
  "modify-image": ModifyImageNode,
  "upscale-image": UpscaleImageNode,
  "remove-background": RemoveBackgroundNode,
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
  "suno-mashup": SunoMashupNode,
  "suno-replace-section": SunoReplaceSectionNode,
  "suno-style-boost": SunoStyleBoostNode,
  "suno-add-instrumental": SunoAddInstrumentalNode,
  "suno-add-vocals": SunoAddVocalsNode,
  "suno-convert-wav": SunoConvertWavNode,
  "suno-upload-extend": SunoUploadExtendNode,
  "lip-sync": LipSyncNode,
  "speech-to-video": SpeechToVideoNode,
  "motion-transfer": MotionTransferNode,
  transcribe: TranscribeNode,
  "image-to-text": ImageToTextNode,
  "audio-isolation": AudioIsolationNode,
  "text-to-dialogue": TextToDialogueNode,
  "voice-changer": VoiceChangerNode,
  "dubbing": DubbingNode,
  "voice-remix": VoiceRemixNode,
  "voice-design": VoiceDesignNode,
  "forced-alignment": ForcedAlignmentNode,
  "llm-chat": LLMChatNode,
  "ai-writer": AIWriterNode,
  // Processing
  "combine-videos": CombineVideosNode,
  "merge-video-audio": MergeVideoAudioNode,
  "add-captions": AddCaptionsNode,
  "resize-video": ResizeVideoNode,
  "social-media-format": SocialMediaFormatNode,
  "trim-audio": TrimAudioNode,
  "split-media": SplitMediaNode,
  "mix-audio": MixAudioNode,
  "combine-audio": CombineAudioNode,
  "adjust-volume": AdjustVolumeNode,
  "trim-video": TrimVideoNode,
  "extract-frame": ExtractFrameNode,
  "video-composer": VideoComposerNode,
  "after-effects": AfterEffectsNode,
  "lottie-overlay": LottieOverlayNode,
  "3d-title": ThreeDTitleNode,
  "motion-graphics": MotionGraphicsNode,
  "composite": CompositeNode,
  "render-video": RenderVideoNode,
  "speed-ramp": SpeedRampNode,
  "loop-video": LoopVideoNode,
  "fade-video": FadeVideoNode,
  "transcode-video": TranscodeVideoNode,
  "manual-edit": ManualEditNode,
  "video-upscale": VideoUpscaleNode,
  "extend-video": ExtendVideoNode,
  // Output
  "save-to-storage": SaveToStorageNode,
  "webhook-output": WebhookOutputNode,
  // Scene
  scene: SceneNode,
  // Character
  character: CharacterNode,
  // Face
  face: FaceNode,
  // Object
  object: ObjectNode,
  // Location
  location: LocationNode,
  // Utility
  "combine-text": CombineTextNode,
  "split-text": SplitTextNode,
  "extract-field": ExtractFieldNode,
  "preview": PreviewNode,
  "sticky-note": StickyNoteNode,
  "router": RouterNode,
  "teleport-send": TeleportSendNode,
  "teleport-receive": TeleportReceiveNode,
  // Sub-Workflow
  "sub-workflow-input": SubWorkflowInputNode,
  "sub-workflow-output": SubWorkflowOutputNode,
  "sub-workflow": SubWorkflowNode,
  // Component
  "component": ComponentNode,
  // Social Media
  "instagram-post": SocialNode,
  "tiktok-post": SocialNode,
  "youtube-upload": SocialNode,
  "linkedin-post": SocialNode,
  "x-post": SocialNode,
  "facebook-post": SocialNode,
  "telegram-post": SocialNode,
  "telegram-trigger": TelegramTriggerNode,
};
