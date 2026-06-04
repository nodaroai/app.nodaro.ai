import "./sub-workflow-views/register-defaults";
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
import { CameraMotionNode } from "./camera-motion-node"
import { TransitionNode } from "./transition-node";
import { CharacterFxNode } from "./character-fx-node";
import { FramingNode } from "./framing-node";
import { LensNode } from "./lens-node";
import { CameraFormatNode } from "./camera-format-node";
import { LightingNode } from "./lighting-node";
import { ColorLookNode } from "./color-look-node";
import { AtmosphereNode } from "./atmosphere-node";
import { ActionFxNode } from "./action-fx-node";
import { StyleNode } from "./style-node";
import { SettingNode } from "./setting-node";
import { LoopSubjectNode } from "./loop-subject-node";
import { MusicGenreNode } from "./music-genre-node";
import { MusicMoodNode } from "./music-mood-node";
import { InstrumentationNode } from "./instrumentation-node";
import { VoiceCharacterNode } from "./voice-character-node";
import { VoiceDeliveryNode } from "./voice-delivery-node";
import { PersonNode } from "./person-node";
import { MoodNode } from "./mood-node";
import { PhotographerNode } from "./photographer-node";
import { AestheticNode } from "./aesthetic-node";
import { EraNode } from "./era-node";
import { PoseNode } from "./pose-node";
import { StylingNode } from "./styling-node";
import { MaterialNode } from "./material-node";
import { AnimalNode } from "./animal-node";
import { VehicleNode } from "./vehicle-node";
import { WeaponNode } from "./weapon-node";
import { FurnitureNode } from "./furniture-node";
import { PhotoGenreNode } from "./photo-genre-node";
import { BackdropNode } from "./backdrop-node";
import { HeldPropNode } from "./held-prop-node";
import { TemporalNode } from "./temporal-node";
import { ExposureSettingsNode } from "./exposure-settings-node";
import { RenderQualityNode } from "./render-quality-node";
import { CompositionEffectsNode } from "./composition-effects-node";
import { PostProcessEffectsNode } from "./post-process-effects-node";
import { ReferenceAudioNode } from "./reference-audio-node";
import { GenerateScriptNode } from "./generate-script-node";
import { GenerateImageNode } from "./generate-image-node";
import { GenerateMaskNode } from "./generate-mask-node";
import { ModifyImageNode } from "./modify-image-node";
import { UpscaleImageNode } from "./upscale-image-node";
import { RemoveBackgroundNode } from "./remove-background-node";
// The unified `GenerateVideoNode` handles `image-to-video`, `text-to-video`,
// and `generate-video` via the aliases below. The legacy component files
// (`image-to-video-node.tsx`, `text-to-video-node.tsx`) were deleted in
// Task 13.2 after staging verified migration parity.
import { VideoToVideoNode } from "./video-to-video-node";
import { GenerateVideoNode } from "./generate-video-node";
import { VideoRetakeNode } from "./video-retake-node";
import { VideoSfxNode } from "./video-sfx-node";
import { TextToSpeechNode } from "./text-to-speech-node";
import { QACheckNode } from "./qa-check-node";
import { ImageCriticNode } from "./image-critic-node";
import { GenerateMusicNode } from "./generate-music-node";
import { TextToAudioNode } from "./text-to-audio-node";
import { SunoVoiceNode } from "./suno-voice-node";
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
import { CombineVideosNode } from "./combine-videos-node";
import { MergeVideoAudioNode } from "./merge-video-audio-node";
import { AddCaptionsNode } from "./add-captions-node";
import { ResizeVideoNode } from "./resize-video-node";
import { SocialMediaFormatNode } from "./social-media-format-node";
import { TrimAudioNode } from "./trim-audio-node";
import { SplitMediaNode } from "./split-media-node";
import { ExtractAudioNode } from "./extract-audio-node";
import { RemoveAudioNode } from "./remove-audio-node";
import { MixAudioNode } from "./mix-audio-node";
import { CombineAudioNode } from "./combine-audio-node";
import { AdjustVolumeNode } from "./adjust-volume-node";
import { TrimVideoNode } from "./trim-video-node";
import { ExtractFrameNode } from "./extract-frame-node";
import { ExtractFieldNode } from "./extract-field-node";
import { JsonProcessNode } from "./json-process-node";
import { FilterListNode } from "./filter-list-node";
import { DeduplicateNode } from "./deduplicate-node";
import { MergeListsNode } from "./merge-lists-node";
import { SortListNode } from "./sort-list-node";
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
import { AiAvatarNode } from "./ai-avatar-node";
import { MotionTransferNode } from "./motion-transfer-node";
import { VideoUpscaleNode } from "./video-upscale-node";
import { ExtendVideoNode } from "./extend-video-node";
import { FaceSwapNode } from "./face-swap-node";
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
import { ReduceNode } from "./reduce-node";
import { TeleportSendNode, TeleportReceiveNode } from "./teleport-node-shell";
import { SubWorkflowInputNode } from "./sub-workflow-input-node";
import { SubWorkflowOutputNode } from "./sub-workflow-output-node";
import { SubWorkflowNode } from "./sub-workflow-node";
import { ComponentNode } from "./component-node";
import { WebhookTriggerNode } from "./webhook-trigger-node";
import { ScheduleTriggerNode } from "./schedule-trigger-node";
import { SocialNode } from "./social-node";
import { TelegramTriggerNode } from "./telegram-trigger-node";
import { GenerativePipelineNode } from "./generative-pipeline-node";
import { GroupNode } from "./group-node";
import { CollectNode } from "./collect-node";
import { SelectorNode } from "./selector-node";
import type { SceneNodeType } from "@/types/nodes";

export const nodeTypes: Record<SceneNodeType, React.ComponentType<any>> = {
  // Input
  "text-prompt": TextPromptNode,
  list: LoopNode,
  loop: LoopNode, // @deprecated legacy alias — migrated to "list" on load (list-loop-migration.ts); kept so a stray un-migrated node still renders
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
  "transition": TransitionNode,
  "character-fx": CharacterFxNode,
  "framing": FramingNode,
  "lens": LensNode,
  "camera-format": CameraFormatNode,
  "lighting": LightingNode,
  "color-look": ColorLookNode,
  "atmosphere": AtmosphereNode,
  "action-fx": ActionFxNode,
  "style": StyleNode,
  "setting": SettingNode,
  "loop-subject": LoopSubjectNode,
  "music-genre": MusicGenreNode,
  "music-mood": MusicMoodNode,
  "instrumentation": InstrumentationNode,
  "voice-character": VoiceCharacterNode,
  "voice-delivery": VoiceDeliveryNode,
  "person": PersonNode,
  "mood": MoodNode,
  "photographer": PhotographerNode,
  "aesthetic": AestheticNode,
  "era": EraNode,
  "pose": PoseNode,
  "styling": StylingNode,
  "material": MaterialNode,
  "animal": AnimalNode,
  "vehicle": VehicleNode,
  "weapon": WeaponNode,
  "furniture": FurnitureNode,
  "photo-genre": PhotoGenreNode,
  "backdrop": BackdropNode,
  "held-prop": HeldPropNode,
  "temporal": TemporalNode,
  "exposure-settings": ExposureSettingsNode,
  "render-quality": RenderQualityNode,
  "composition-effects": CompositionEffectsNode,
  "post-process-effects": PostProcessEffectsNode,
  "reference-audio": ReferenceAudioNode,
  // AI
  "generate-script": GenerateScriptNode,
  "generate-image": GenerateImageNode,
  "generate-mask": GenerateMaskNode,
  "modify-image": ModifyImageNode,
  "upscale-image": UpscaleImageNode,
  "remove-background": RemoveBackgroundNode,
  // The legacy i2v + t2v entries alias to GenerateVideoNode — load-time
  // migration (see `generate-video-handle-migration.ts`) rewrites their data
  // to a strict subset of GenerateVideoNodeData, so the unified renderer
  // produces identical output. Task 13.2 will delete the legacy component
  // files once staging confirms parity.
  "image-to-video": GenerateVideoNode,
  "video-to-video": VideoToVideoNode,
  "text-to-video": GenerateVideoNode,
  "generate-video": GenerateVideoNode,
  "video-retake": VideoRetakeNode,
  "video-sfx": VideoSfxNode,
  "text-to-speech": TextToSpeechNode,
  "qa-check": QACheckNode,
  "image-critic": ImageCriticNode,
  "generate-music": GenerateMusicNode,
  "text-to-audio": TextToAudioNode,
  "suno-voice": SunoVoiceNode,
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
  "ai-avatar": AiAvatarNode,
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
  // Processing
  "combine-videos": CombineVideosNode,
  "merge-video-audio": MergeVideoAudioNode,
  "add-captions": AddCaptionsNode,
  "resize-video": ResizeVideoNode,
  "social-media-format": SocialMediaFormatNode,
  "trim-audio": TrimAudioNode,
  "split-media": SplitMediaNode,
  "extract-audio": ExtractAudioNode,
  "remove-audio": RemoveAudioNode,
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
  "face-swap": FaceSwapNode,
  // Output
  "save-to-storage": SaveToStorageNode,
  "webhook-output": WebhookOutputNode,
  // Scene (Phase 1B.2 pipeline SceneNode — replaces legacy scene component)
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
  "json-process": JsonProcessNode,
  "filter-list": FilterListNode,
  "deduplicate": DeduplicateNode,
  "merge-lists": MergeListsNode,
  "sort-list": SortListNode,
  "selector": SelectorNode,
  "preview": PreviewNode,
  "sticky-note": StickyNoteNode,
  "router": RouterNode,
  "reduce": ReduceNode,
  "teleport-send": TeleportSendNode,
  "teleport-receive": TeleportReceiveNode,
  // Group / Collect — non-executable aggregators (resolved at field-resolution time)
  group: GroupNode,
  collect: CollectNode,
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
  // Generative Pipeline
  "generative-pipeline": GenerativePipelineNode,
};
