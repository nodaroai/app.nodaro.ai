"use client"

import { useMemo, useCallback, useState, useRef, useEffect, Suspense, type TouchEvent as ReactTouchEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { X, Play, Maximize2, Minimize2, Loader2, FastForward } from "lucide-react"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
const Kling3DirectorModal = lazy(() => import("@/components/editor/kling3-director-modal").then(m => ({ default: m.Kling3DirectorModal })))
import { GenerateButton } from "@/ee/components/credits/GenerateButton"
import { RUN_BUTTON_CLASS } from "@/lib/run-button-style"
import { useProvidersCreditsSum } from "@/ee/hooks/use-providers-credits-sum"
import { createClient } from "@/lib/supabase"
import { pipelinesApi } from "@/lib/pipelines-api"
import {
  NODE_DEFINITIONS,
  type TextToVideoData,
  type GenerateVideoNodeData,
  type FieldMappings,
  type PresentationDisplay,
} from "@/types/nodes"
import { PresentationDisplayConfig } from "./config-panels/presentation-display-config"
import { PresetDropdown } from "./config-panels/node-preset-dropdown"
// Phase 1B.2: SceneConfig now ships from `./config-panels/scene-configs`.
// Legacy `./scene-config` + `./scene-editor-modal` are dead code pending cleanup.
import { IterationResultsPanel } from "./iteration-results-panel"
import { getUpstreamNodes, buildNodeRefMap } from "@/lib/node-refs"
import { isTileGridPickerType } from "@/lib/picker-handles"
import { REPEATABLE_NODE_TYPES, getEffectiveRepeatCount } from "@nodaro/shared"
import {
  getConnectedSources,
  getModelIdentifier,
  type SourceNodeInfo,
  TextPromptConfig,
  ListConfig,
  LoopConfig,
  UploadImageConfig,
  UploadVideoConfig,
  UploadAudioConfig,
  RSSFeedConfig,
  YouTubeVideoConfig,
  ReferenceAudioConfig,
  ToneConfig,
  StyleGuideConfig,
  ProviderConfig,
  SceneCountConfig,
  DurationConfig,
  AspectRatioConfig,
  MotionConfig,
  CameraMotionConfig,
  FramingConfig,
  LensConfig,
  CameraFormatConfig,
  LightingConfig,
  ColorLookConfig,
  AtmosphereConfig,
  ActionFxConfig,
  StyleConfig,
  SettingConfig,
  LoopSubjectConfig,
  PersonConfig,
  MoodConfig,
  PhotographerConfig,
  AestheticConfig,
  EraConfig,
  PoseConfig,
  StylingConfig,
  MaterialConfig,
  AnimalConfig,
  VehicleConfig,
  WeaponConfig,
  PhotoGenreConfig,
  BackdropConfig,
  HeldPropConfig,
  TemporalConfig,
  ExposureSettingsConfig,
  RenderQualityConfig,
  CompositionEffectsConfig,
  PostProcessEffectsConfig,
  TransitionConfig,
  CharacterFxConfig,
  GenerateScriptConfig,
  QACheckConfig,
  ImageCriticConfig,
  GenerateImageConfig,
  ModifyImageConfig,
  UpscaleImageConfig,
  RemoveBackgroundConfig,
  GenerateMaskConfig,
  ImageToVideoConfig,
  VideoToVideoConfig,
  MotionTransferConfig,
  VideoUpscaleConfig,
  ExtendVideoConfig,
  SpeechToVideoConfig,
  FaceSwapConfig,
  VideoRetakeConfig,
  TextToVideoConfig,
  GenerateVideoConfig,
  VideoSfxConfig,
  TextToSpeechConfig,
  TextToAudioConfig,
  AudioIsolationConfig,
  TextToDialogueConfig,
  VoiceChangerConfig,
  DubbingConfig,
  VoiceRemixConfig,
  VoiceDesignConfig,
  ForcedAlignmentConfig,
  SunoVoiceConfig,
  SunoGenerateConfig,
  SunoCoverConfig,
  SunoExtendConfig,
  SunoLyricsConfig,
  SunoSeparateConfig,
  SunoMusicVideoConfig,
  SunoMashupConfig,
  SunoReplaceSectionConfig,
  SunoStyleBoostConfig,
  SunoAddInstrumentalConfig,
  SunoAddVocalsConfig,
  SunoConvertWavConfig,
  SunoUploadExtendConfig,
  TranscribeConfig,
  ImageToTextConfig,
  LipSyncConfig,
  GenerateMusicConfig,
  CombineVideosConfig,
  AddCaptionsConfig,
  ResizeVideoConfig,
  SocialMediaFormatConfig,
  TrimAudioConfig,
  SplitMediaConfig,
  ExtractAudioConfig,
  RemoveAudioConfig,
  MixAudioConfig,
  CombineAudioConfig,
  AdjustVolumeConfig,
  TrimVideoConfig,
  ExtractFrameConfig,
  SpeedRampConfig,
  LoopVideoConfig,
  FadeVideoConfig,
  TranscodeVideoConfig,
  ManualEditConfig,
  VideoComposerConfig,
  AfterEffectsConfig,
  LottieOverlayConfig,
  ThreeDTitleConfig,
  MotionGraphicsConfig,
  CompositeConfig,
  RenderVideoConfig,
  MergeVideoAudioConfig,
  CharacterConfig,
  FaceConfig,
  ObjectConfig,
  CreatureConfig,
  LocationConfig,
  LLMChatConfig,
  WebScrapeConfig,
  CombineTextConfig,
  SaveToStorageConfig,
  WebhookOutputConfig,
  SplitTextConfig,
  ExtractFieldConfig,
  JsonProcessConfig,
  FilterListConfig,
  DeduplicateConfig,
  MergeListsConfig,
  SortListConfig,
  PreviewConfig,
  TeleporterConfig,
  RouterConfig,
  SubWorkflowInputConfig,
  SubWorkflowOutputConfig,
  SubWorkflowConfig,
  ComponentConfig,
  WebhookTriggerConfig,
  ScheduleTriggerConfig,
  TelegramTriggerConfig,
  InstagramPostConfig,
  TiktokPostConfig,
  YoutubeUploadConfig,
  LinkedinPostConfig,
  XPostConfig,
  FacebookPostConfig,
  TelegramPostConfig,
  MusicGenreConfig,
  MusicMoodConfig,
  InstrumentationConfig,
  VoiceCharacterConfig,
  VoiceDeliveryConfig,
  GenerativePipelineConfig,
  SceneConfig,
  CollectConfig,
  ReduceConfig,
  SelectorConfig,
  ReferenceSheetConfig,
  ResultsGallery,
  AiAvatarConfig,
  CinematicAvatarConfig,
} from "./config-panels"
import { TileCommitContext } from "./config-panels/dimension-tile-grid"

const LIBRARY_VIDEO_TYPES = new Set(["image-to-video", "video-to-video", "text-to-video", "generate-video", "video-upscale", "extend-video", "motion-transfer", "lip-sync", "speech-to-video", "face-swap", "video-sfx", "ai-avatar", "cinematic-avatar"])
const LIBRARY_AUDIO_TYPES = new Set(["text-to-speech", "generate-music", "text-to-audio", "audio-isolation", "text-to-dialogue", "voice-changer", "dubbing", "voice-remix", "voice-design", "suno-generate", "suno-cover", "suno-extend", "suno-separate", "suno-mashup", "suno-replace-section", "suno-add-instrumental", "suno-add-vocals", "suno-convert-wav", "suno-upload-extend"])

const NODE_TYPE_DISPLAY_NAMES: Record<string, string> = {
  "text-prompt": "Text",
  "upload-image": "Upload Image",
  "upload-video": "Upload Video",
  "upload-audio": "Upload Audio",
  "rss-feed": "RSS Feed",
  "youtube-video": "Video URL",
  "web-scrape": "Web Scrape",
  "reference-audio": "Reference Audio",
  "tone": "Tone",
  "style-guide": "Style Guide",
  "provider": "Provider",
  "scene-count": "Scene Count",
  "duration": "Duration",
  "aspect-ratio": "Aspect Ratio",
  "motion": "Motion",
  "camera-motion": "Camera Motion",
  "music-genre": "Music Genre",
  "music-mood": "Music Mood",
  "instrumentation": "Instrumentation",
  "voice-character": "Voice Character",
  "voice-delivery": "Voice Delivery",
  "framing": "Framing",
  "lens": "Lens",
  "camera-format": "Camera / Film Stock",
  "lighting": "Lighting",
  "color-look": "Color / Look",
  "atmosphere": "Atmosphere",
  "action-fx": "Action FX",
  "style": "Style",
  "setting": "Setting",
  "loop-subject": "Loop Subject",
  "person": "Person",
  "mood": "Mood",
  "photographer": "Photographer / Artist Style",
  "aesthetic": "Aesthetic / Microtrend",
  "era": "Era / Period",
  "pose": "Pose",
  "styling": "Styling",
  "material": "Material",
  "animal": "Animal",
  "vehicle": "Vehicle",
  "weapon": "Weapon",
  "photo-genre": "Photo Genre",
  "backdrop": "Backdrop",
  "held-prop": "Held Prop",
  "temporal": "Temporal",
  "exposure-settings": "Exposure Settings",
  "render-quality": "Render Quality",
  "composition-effects": "Composition Effects",
  "post-process-effects": "Post-Process Effects",
  "transition": "Transition",
  "character-fx": "Character FX",
  "generate-script": "Generate Script",
  "generate-image": "Generate Image",
  "modify-image": "Modify Image",
  "upscale-image": "Upscale Image",
  "remove-background": "Remove Background",
  "generate-mask": "Generate Mask",
  "image-to-video": "Image to Video",
  "video-to-video": "Video to Video",
  "text-to-video": "Text to Video",
  "generate-video": "Generate Video",
  "text-to-speech": "Text to Speech",
  "qa-check": "QA Check",
  "image-critic": "Image Critic",
  "generate-music": "Generate Music",
  "text-to-audio": "Text to Audio",
  "audio-isolation": "Voice Extractor",
  "text-to-dialogue": "Text to Dialogue",
  "voice-changer": "Voice Changer",
  "dubbing": "Dubbing",
  "voice-remix": "Voice Remix",
  "voice-design": "Voice Design",
  "forced-alignment": "Forced Alignment",
  "suno-voice": "Suno Voice",
  "suno-generate": "Suno Generate",
  "suno-cover": "Suno Cover",
  "suno-extend": "Suno Extend",
  "suno-lyrics": "Suno Lyrics",
  "suno-separate": "Suno Separate",
  "suno-music-video": "Music Video",
  "suno-mashup": "Suno Mashup",
  "suno-replace-section": "Suno Replace Section",
  "suno-style-boost": "Suno Style Boost",
  "suno-add-instrumental": "Suno Add Instrumental",
  "suno-add-vocals": "Suno Add Vocals",
  "suno-convert-wav": "Suno Convert WAV",
  "suno-upload-extend": "Suno Upload Extend",
  "transcribe": "Transcribe",
  "image-to-text": "Describe Image",
  "llm-chat": "Generate Text",
  "combine-videos": "Combine Videos",
  "merge-video-audio": "Merge Video & Audio",
  "add-captions": "Add Captions",
  "resize-video": "Resize Video",
  "social-media-format": "Social Media Format",
  "trim-audio": "Trim Audio",
  "split-media": "Split into Chunks",
  "extract-audio": "Extract Audio",
  "remove-audio": "Remove Audio",
  "mix-audio": "Mix Audio",
  "combine-audio": "Combine Audio",
  "adjust-volume": "Adjust Volume",
  "trim-video": "Trim Video",
  "extract-frame": "Extract Frame",
  "speed-ramp": "Adjust Speed",
  "loop-video": "Loop Video",
  "fade-video": "Fade In/Out",
  "transcode-video": "Transcode Video",
  "manual-edit": "Manual Edit",
  "extend-video": "Extend Video",
  "video-retake": "Retake Video",
  "face-swap": "Face Swap",
  "video-sfx": "Video SFX",
  "speech-to-video": "Speech to Video",
  "ai-avatar": "AI Avatar",
  "cinematic-avatar": "Cinematic Avatar",
  "video-upscale": "Upscale Video",
  "combine-text": "Combine Text",
  "split-text": "Split Text",
  "extract-field": "Extract Field",
  "json-process": "JSON Process",
  "filter-list": "Filter List",
  "deduplicate": "Remove Duplicates",
  "merge-lists": "Merge Lists",
  "sort-list": "Sort List",
  "selector": "Selector",
  "reference-sheet": "Reference Sheet",
  "preview": "Preview",
  "save-to-storage": "Save to Storage",
  "webhook-output": "Webhook Output",
  "character": "Character",
  "object": "Object",
  "creature": "Animal/Creature",
  "location": "Location",
  "scene": "Scene",
  "sub-workflow-input": "Sub-Workflow Input",
  "sub-workflow-output": "Sub-Workflow Output",
  "sub-workflow": "Sub-Workflow",
  "component": "Component",
  "webhook-trigger": "Webhook Trigger",
  "schedule-trigger": "Schedule Trigger",
  "instagram-post": "Instagram Post",
  "tiktok-post": "TikTok Post",
  "youtube-upload": "YouTube Upload",
  "linkedin-post": "LinkedIn Post",
  "x-post": "X Post",
  "facebook-post": "Facebook Post",
  "telegram-post": "Telegram Post",
  "telegram-trigger": "Telegram Trigger",
  "teleport-send": "Teleport Send",
  "teleport-receive": "Teleport Receive",
  "router": "Router",
  "reduce": "Reduce",
  "generative-pipeline": "Story → Video",
  "group": "Group",
  "collect": "Collect",
}

export function getNodeTypeDisplayName(type: string): string {
  return NODE_TYPE_DISPLAY_NAMES[type] || type.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

export const GENERATE_BUTTON_TYPES = new Set([
  "generate-script", "generate-image", "modify-image", "upscale-image", "remove-background", "generate-mask", "reference-sheet",
  "image-to-video", "video-to-video", "text-to-video", "generate-video", "text-to-speech",
  "text-to-audio", "audio-isolation", "text-to-dialogue", "voice-changer", "dubbing", "voice-remix", "voice-design", "forced-alignment", "generate-music", "motion-transfer", "lip-sync", "speech-to-video",
  "video-upscale", "extend-video", "video-retake", "face-swap", "video-sfx", "ai-avatar", "cinematic-avatar", "suno-generate", "suno-cover", "suno-extend",
  "suno-lyrics", "suno-separate", "suno-music-video",
  "suno-mashup", "suno-replace-section", "suno-style-boost", "suno-add-instrumental", "suno-add-vocals", "suno-convert-wav", "suno-upload-extend",
  "llm-chat", "web-scrape",
  "video-composer", "after-effects", "lottie-overlay", "3d-title", "motion-graphics",
  "image-to-text", "qa-check", "transcribe",
  "render-video",
  "instagram-post", "tiktok-post", "youtube-upload", "linkedin-post", "x-post", "facebook-post", "telegram-post",
  "component",
  // FFmpeg processing (tiered credits)
  "merge-video-audio", "combine-videos", "trim-audio", "split-media", "extract-audio", "remove-audio", "trim-video", "extract-frame",
  "speed-ramp", "loop-video", "fade-video", "transcode-video", "resize-video", "social-media-format", "adjust-volume",
  "add-captions", "mix-audio", "combine-audio",
])

export const RUN_BUTTON_TYPES = new Set([
  "manual-edit", "composite",
  "sub-workflow", "router", "reduce",
])

/** Nodes that show "Run from here" as primary action instead of "Run". */
const RUN_FROM_HERE_TYPES: Set<string> = new Set([
  ...NODE_DEFINITIONS.filter((d) => d.autoExecute).map((d) => d.type),
  "preview", "list",
])

const KLING3_DIRECTOR_TYPES = new Set(["image-to-video", "text-to-video", "generate-video"])

// Node types that produce media results (excludes text-only nodes like combine-text, split-text, extract-field, sub-workflow, social posts)
const RESULT_PRODUCING_TYPES = new Set([
  ...GENERATE_BUTTON_TYPES,
  ...RUN_BUTTON_TYPES,
].filter(t =>
  t !== "combine-text" && t !== "split-text" && t !== "extract-field" && t !== "json-process" &&
  t !== "filter-list" && t !== "deduplicate" && t !== "merge-lists" && t !== "sort-list" &&
  t !== "preview" && t !== "sub-workflow" &&
  t !== "instagram-post" && t !== "tiktok-post" && t !== "youtube-upload" &&
  t !== "linkedin-post" && t !== "x-post" && t !== "facebook-post" && t !== "telegram-post" &&
  t !== "image-to-text" && t !== "qa-check" && t !== "transcribe" && t !== "llm-chat"
))

/** Extracted to isolate type checking scope — TS JSX children inference limit */
function NodeTypeConfig({ nodeType, nodeData, configProps, updateNodeData, onExpandDirector, update, selectedNodeId }: {
  nodeType: string
  nodeData: Record<string, unknown>
  configProps: any
  updateNodeData: (id: string, data: Record<string, unknown>) => void
  onExpandDirector: () => void
  update: (data: Record<string, unknown>) => void
  selectedNodeId: string | undefined
}) {
  // Phase 1D.1 — Stage 6 (scene_images) query for match-cut verdict display.
  // Runs only when a scene node is selected and its data carries pipeline_id.
  // Polls at 5 s intervals while the panel is open (same cadence as the
  // pipeline-panel's script-stage query). Stops polling once the stage reaches
  // "approved" (verdicts are immutable after that).
  const scenePipelineId = nodeType === "scene" ? (nodeData.pipeline_id as string | undefined) : undefined
  const { data: sceneImagesStage } = useQuery({
    queryKey: ["pipeline-stage", scenePipelineId, "scene_images"],
    queryFn: () => pipelinesApi.getStage(scenePipelineId!, "scene_images"),
    enabled: Boolean(scenePipelineId),
    refetchInterval: (q) => (q.state.data?.status === "approved" ? false : 5000),
    retry: false,
  })

  switch (nodeType) {
    case "text-prompt": return <TextPromptConfig {...configProps} />
    case "list":
      return <LoopConfig {...configProps} nodeId={selectedNodeId} />
    case "upload-image": return <UploadImageConfig {...configProps} />
    case "upload-video": return <UploadVideoConfig {...configProps} />
    case "upload-audio": return <UploadAudioConfig {...configProps} />
    case "rss-feed": return <RSSFeedConfig {...configProps} />
    case "youtube-video": return <YouTubeVideoConfig {...configProps} />
    case "web-scrape": return <WebScrapeConfig {...configProps} />
    case "reference-audio": return <ReferenceAudioConfig {...configProps} />
    case "webhook-trigger": return <WebhookTriggerConfig {...configProps} />
    case "schedule-trigger": return <ScheduleTriggerConfig {...configProps} />
    case "tone": return <ToneConfig {...configProps} />
    case "style-guide": return <StyleGuideConfig {...configProps} />
    case "provider": return <ProviderConfig {...configProps} />
    case "scene-count": return <SceneCountConfig {...configProps} />
    case "duration": return <DurationConfig {...configProps} />
    case "aspect-ratio": return <AspectRatioConfig {...configProps} />
    case "motion": return <MotionConfig {...configProps} />
    case "camera-motion": return <CameraMotionConfig {...configProps} nodeId={selectedNodeId} />
    case "music-genre": return <MusicGenreConfig {...configProps} />
    case "music-mood": return <MusicMoodConfig {...configProps} />
    case "instrumentation": return <InstrumentationConfig {...configProps} />
    case "voice-character": return <VoiceCharacterConfig {...configProps} />
    case "voice-delivery": return <VoiceDeliveryConfig {...configProps} />
    case "framing": return <FramingConfig {...configProps} />
    case "lens": return <LensConfig {...configProps} />
    case "camera-format": return <CameraFormatConfig {...configProps} />
    case "lighting": return <LightingConfig {...configProps} />
    case "color-look": return <ColorLookConfig {...configProps} />
    case "atmosphere": return <AtmosphereConfig {...configProps} />
    case "action-fx": return <ActionFxConfig {...configProps} />
    case "style": return <StyleConfig {...configProps} />
    case "setting": return <SettingConfig {...configProps} />
    case "loop-subject": return <LoopSubjectConfig {...configProps} />
    case "person": return <PersonConfig {...configProps} />
    case "mood": return <MoodConfig {...configProps} />
    case "photographer": return <PhotographerConfig {...configProps} />
    case "aesthetic": return <AestheticConfig {...configProps} />
    case "era": return <EraConfig {...configProps} />
    case "pose": return <PoseConfig {...configProps} />
    case "styling": return <StylingConfig {...configProps} />
    case "material": return <MaterialConfig {...configProps} />
    case "animal": return <AnimalConfig {...configProps} />
    case "vehicle": return <VehicleConfig {...configProps} />
    case "weapon": return <WeaponConfig {...configProps} />
    case "photo-genre": return <PhotoGenreConfig {...configProps} />
    case "backdrop": return <BackdropConfig {...configProps} />
    case "held-prop": return <HeldPropConfig {...configProps} />
    case "temporal": return <TemporalConfig {...configProps} />
    case "exposure-settings": return <ExposureSettingsConfig {...configProps} />
    case "render-quality": return <RenderQualityConfig {...configProps} />
    case "composition-effects": return <CompositionEffectsConfig {...configProps} />
    case "post-process-effects": return <PostProcessEffectsConfig {...configProps} />
    case "transition": return <TransitionConfig {...configProps} />
    case "character-fx": return <CharacterFxConfig {...configProps} />
    case "generate-script": return <GenerateScriptConfig {...configProps} />
    case "generate-image": return <GenerateImageConfig {...configProps} nodeId={selectedNodeId} />
    case "modify-image": return <ModifyImageConfig {...configProps} nodeId={selectedNodeId} />
    case "upscale-image": return <UpscaleImageConfig {...configProps} />
    case "remove-background": return <RemoveBackgroundConfig {...configProps} />
    case "generate-mask": return <GenerateMaskConfig {...configProps} />
    // ImageToVideoConfig dispatches the kling-3.0 provider to the
    // (lazy-loaded) Kling3StudioConfig internally — no separate branch needed
    // here, which keeps the studio panel in a single on-demand chunk.
    case "image-to-video": return <ImageToVideoConfig {...configProps} onUpdateNode={updateNodeData} nodeId={selectedNodeId} />
    case "video-to-video": return <VideoToVideoConfig {...configProps} nodeId={selectedNodeId} />
    case "text-to-video": return (
      <>
        <TextToVideoConfig {...configProps} nodeId={selectedNodeId} />
        {(nodeData as TextToVideoData).provider === "kling-3.0" && (
          <Button variant="outline" className="w-full mt-2" onClick={onExpandDirector}>
            <Maximize2 className="w-4 h-4 mr-2" />
            Expand Director
          </Button>
        )}
      </>
    )
    // generate-video: unified i2v + t2v node (Task 7.1 + 7.2). Uses the
    // GenerateVideoConfig union panel — Kling3 director button mirrors the
    // t2v branch above so users keep the storyboard/element studio UX
    // when targeting kling-3.0 from the unified node.
    case "generate-video": return (
      <>
        <GenerateVideoConfig {...configProps} onUpdateNode={updateNodeData} nodeId={selectedNodeId} />
        {(nodeData as GenerateVideoNodeData).provider === "kling-3.0" && (
          <Button variant="outline" className="w-full mt-2" onClick={onExpandDirector}>
            <Maximize2 className="w-4 h-4 mr-2" />
            Expand Director
          </Button>
        )}
      </>
    )
    case "text-to-speech": return <TextToSpeechConfig {...configProps} />
    case "qa-check": return <QACheckConfig {...configProps} />
    case "image-critic": return <ImageCriticConfig {...configProps} />
    case "generate-music": return <GenerateMusicConfig {...configProps} nodeId={selectedNodeId} />
    case "text-to-audio": return <TextToAudioConfig {...configProps} nodeId={selectedNodeId} />
    case "audio-isolation": return <AudioIsolationConfig {...configProps} />
    case "text-to-dialogue": return <TextToDialogueConfig {...configProps} />
    case "voice-changer": return <VoiceChangerConfig {...configProps} />
    case "dubbing": return <DubbingConfig {...configProps} />
    case "voice-remix": return <VoiceRemixConfig {...configProps} nodeId={selectedNodeId} />
    case "voice-design": return <VoiceDesignConfig {...configProps} nodeId={selectedNodeId} />
    case "forced-alignment": return <ForcedAlignmentConfig {...configProps} />
    case "suno-voice": return <SunoVoiceConfig {...configProps} />
    case "suno-generate": return <SunoGenerateConfig {...configProps} nodeId={selectedNodeId} />
    case "suno-cover": return <SunoCoverConfig {...configProps} />
    case "suno-extend": return <SunoExtendConfig {...configProps} />
    case "suno-lyrics": return <SunoLyricsConfig {...configProps} />
    case "suno-separate": return <SunoSeparateConfig {...configProps} />
    case "suno-music-video": return <SunoMusicVideoConfig {...configProps} />
    case "suno-mashup": return <SunoMashupConfig {...configProps} />
    case "suno-replace-section": return <SunoReplaceSectionConfig {...configProps} />
    case "suno-style-boost": return <SunoStyleBoostConfig {...configProps} />
    case "suno-add-instrumental": return <SunoAddInstrumentalConfig {...configProps} />
    case "suno-add-vocals": return <SunoAddVocalsConfig {...configProps} />
    case "suno-convert-wav": return <SunoConvertWavConfig {...configProps} />
    case "suno-upload-extend": return <SunoUploadExtendConfig {...configProps} />
    case "lip-sync": return <LipSyncConfig {...configProps} nodeId={selectedNodeId} />
    case "speech-to-video": return <SpeechToVideoConfig {...configProps} nodeId={selectedNodeId} />
    case "ai-avatar": return <AiAvatarConfig {...configProps} />
    case "cinematic-avatar": return <CinematicAvatarConfig {...configProps} />
    case "motion-transfer": return <MotionTransferConfig {...configProps} nodeId={selectedNodeId} />
    case "transcribe": return <TranscribeConfig {...configProps} />
    case "image-to-text": return <ImageToTextConfig {...configProps} />
    case "llm-chat": return <LLMChatConfig {...configProps} />
    case "video-upscale": return <VideoUpscaleConfig {...configProps} />
    case "extend-video": return <ExtendVideoConfig {...configProps} nodeId={selectedNodeId} />
    case "video-retake": return <VideoRetakeConfig {...configProps} nodeId={selectedNodeId} />
    case "face-swap": return <FaceSwapConfig {...configProps} nodeId={selectedNodeId} />
    case "video-sfx": return <VideoSfxConfig {...configProps} />
    case "combine-videos": return <CombineVideosConfig {...configProps} />
    case "merge-video-audio": return <MergeVideoAudioConfig {...configProps} />
    case "add-captions": return <AddCaptionsConfig {...configProps} />
    case "resize-video": return <ResizeVideoConfig {...configProps} />
    case "social-media-format": return <SocialMediaFormatConfig {...configProps} />
    case "trim-audio": return <TrimAudioConfig {...configProps} />
    case "split-media": return <SplitMediaConfig {...configProps} />
    case "extract-audio": return <ExtractAudioConfig {...configProps} />
    case "remove-audio": return <RemoveAudioConfig {...configProps} />
    case "mix-audio": return <MixAudioConfig {...configProps} />
    case "combine-audio": return <CombineAudioConfig {...configProps} />
    case "adjust-volume": return <AdjustVolumeConfig {...configProps} />
    case "trim-video": return <TrimVideoConfig {...configProps} />
    case "extract-frame": return <ExtractFrameConfig {...configProps} />
    case "video-composer": return <VideoComposerConfig {...configProps} />
    case "after-effects": return <AfterEffectsConfig {...configProps} />
    case "lottie-overlay": return <LottieOverlayConfig {...configProps} />
    case "3d-title": return <ThreeDTitleConfig {...configProps} />
    case "motion-graphics": return <MotionGraphicsConfig {...configProps} />
    case "composite": return <CompositeConfig {...configProps} />
    case "render-video": return <RenderVideoConfig {...configProps} />
    case "speed-ramp": return <SpeedRampConfig {...configProps} />
    case "loop-video": return <LoopVideoConfig {...configProps} />
    case "fade-video": return <FadeVideoConfig {...configProps} />
    case "transcode-video": return <TranscodeVideoConfig {...configProps} />
    case "manual-edit": return <ManualEditConfig {...configProps} />
    case "combine-text": return <CombineTextConfig {...configProps} />
    case "split-text": return <SplitTextConfig {...configProps} />
    case "extract-field": return <ExtractFieldConfig {...configProps} />
    case "json-process": return <JsonProcessConfig {...configProps} />
    case "filter-list": return <FilterListConfig {...configProps} />
    case "deduplicate": return <DeduplicateConfig {...configProps} />
    case "merge-lists": return <MergeListsConfig {...configProps} />
    case "sort-list": return <SortListConfig {...configProps} />
    case "selector": return <SelectorConfig {...configProps} />
    case "reference-sheet": return <ReferenceSheetConfig {...configProps} nodeId={selectedNodeId} />
    case "preview": return <PreviewConfig {...configProps} />
    case "teleport-send": case "teleport-receive": return <TeleporterConfig {...configProps} nodeType={nodeType} />
    case "router": return <RouterConfig {...configProps} />
    // Group has no config panel (title is inline on the node); Collect uses CollectConfig for handle reorder.
    case "collect": return <CollectConfig {...configProps} nodeId={selectedNodeId} />
    case "reduce": return <ReduceConfig {...configProps} />
    case "save-to-storage": return <SaveToStorageConfig {...configProps} />
    case "webhook-output": return <WebhookOutputConfig {...configProps} />
    case "instagram-post": return <InstagramPostConfig {...configProps} />
    case "tiktok-post": return <TiktokPostConfig {...configProps} />
    case "youtube-upload": return <YoutubeUploadConfig {...configProps} />
    case "linkedin-post": return <LinkedinPostConfig {...configProps} />
    case "x-post": return <XPostConfig {...configProps} />
    case "facebook-post": return <FacebookPostConfig {...configProps} />
    case "telegram-post": return <TelegramPostConfig {...configProps} />
    case "telegram-trigger": return <TelegramTriggerConfig {...configProps} />
    case "sub-workflow-input": return <SubWorkflowInputConfig {...configProps} />
    case "sub-workflow-output": return <SubWorkflowOutputConfig {...configProps} />
    case "sub-workflow": return <SubWorkflowConfig {...configProps} />
    case "component": return <ComponentConfig {...configProps} nodeId={selectedNodeId} />
    case "character": return <CharacterConfig {...configProps} nodeId={selectedNodeId} />
    case "face": return <FaceConfig {...configProps} />
    case "object": return <ObjectConfig {...configProps} nodeId={selectedNodeId!} />
    case "creature": return <CreatureConfig {...configProps} nodeId={selectedNodeId!} />
    case "location": return <LocationConfig {...configProps} nodeId={selectedNodeId!} />
    case "scene": return (
      <SceneConfig
        {...configProps}
        stageOutput={sceneImagesStage?.output as { match_cut_verdicts?: Record<string, import("@nodaro/shared").MatchCutVerdict>; match_cut_break_pending?: string[] } | undefined}
      />
    )
    case "generative-pipeline": return <GenerativePipelineConfig {...configProps} />
    default: return null
  }
}

export function ConfigPanel() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const deleteEdge = useWorkflowStore((s) => s.deleteEdge)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const variableDisplayMode = useWorkflowStore((s) => s.variableDisplayMode)
  const isReadOnly = useWorkflowStore((s) => s.isReadOnly)
  const [userId, setUserId] = useState<string | undefined>(undefined)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: any } }) => {
      setUserId(user?.id ?? undefined)
    })
  }, [])

  const foundNode = nodes.find((n) => n.id === selectedNodeId)

  // Topology signature that EXCLUDES the selected node's own data. Editing the
  // selected node creates a fresh `nodes` array (and a new data object for that
  // node) on every keystroke; keying the heavy whole-graph BFS memos directly
  // on [nodes, edges] would re-run them all on each keystroke even though only
  // the selected node changed. We bump `topoVersion` only when `edges` change
  // or when ANY non-selected node's identity/type/data reference changes — so
  // the BFS memos still recompute when an UPSTREAM node's data changes
  // (liveRefMap reads upstream output via extractNodeOutput) but stay put while
  // the user types into the selected node. Zustand does immutable updates, so a
  // changed node always carries a new `data` reference (reference compare is
  // sufficient and cheap).
  const topoVersionRef = useRef(0)
  const prevTopoRef = useRef<{ edges: typeof edges; sig: ReadonlyArray<unknown> } | null>(null)
  const topoVersion = useMemo(() => {
    const sig: unknown[] = []
    for (const n of nodes) {
      if (n.id === selectedNodeId) continue
      sig.push(n.id, n.type, n.data)
    }
    const prev = prevTopoRef.current
    const changed =
      !prev ||
      prev.edges !== edges ||
      prev.sig.length !== sig.length ||
      sig.some((v, i) => v !== prev.sig[i])
    if (changed) {
      topoVersionRef.current += 1
      prevTopoRef.current = { edges, sig }
    }
    return topoVersionRef.current
  }, [nodes, edges, selectedNodeId])

  const liveSources = useMemo(() => {
    if (!selectedNodeId) return [] as SourceNodeInfo[]
    return getConnectedSources(selectedNodeId, edges, nodes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topoVersion, selectedNodeId])

  const liveNodeRefs = useMemo(() => {
    if (!selectedNodeId) return []
    return getUpstreamNodes(selectedNodeId, nodes, edges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topoVersion, selectedNodeId])

  const liveRefMap = useMemo(() => {
    if (!selectedNodeId) return new Map<string, string>()
    return buildNodeRefMap(selectedNodeId, nodes, edges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topoVersion, selectedNodeId])

  const liveHasDownstream = useMemo(() => {
    if (!selectedNodeId) return false
    return edges.some((e) => e.source === selectedNodeId)
  }, [selectedNodeId, edges])

  const liveFieldMappings: FieldMappings = useMemo(() => {
    if (!foundNode) return {}
    const d = foundNode.data as Record<string, unknown>
    return (d.fieldMappings as FieldMappings) ?? {}
  }, [foundNode])

  // Phase 1B.2: `expandSceneOpen` state removed along with SceneEditorModal —
  // the new SceneNode uses the pipeline panel for editing, not a legacy modal.
  const [expandDirectorOpen, setExpandDirectorOpen] = useState(false)
  const isMobile = useIsMobile()
  // `isExpanded` is sourced from the store so external code — e.g. picker-node
  // creation in workflow-canvas / node-toolbar — can open the panel in fullscreen
  // by calling `setConfigPanelFullscreen(true)`.
  const isExpanded = useWorkflowStore((s) => s.configPanelFullscreen)
  const setConfigPanelFullscreen = useWorkflowStore((s) => s.setConfigPanelFullscreen)
  const closeFullscreenSettings = useWorkflowStore((s) => s.closeFullscreenSettings)

  // Mobile bottom sheet: peek (collapsed) / expanded states with bidirectional drag
  const [sheetState, setSheetState] = useState<"peek" | "expanded">("peek")
  const dragStartY = useRef(0)
  const dragDelta = useRef(0)
  const dragStartState = useRef<"peek" | "expanded">("peek")
  const sheetRef = useRef<HTMLDivElement>(null)

  // Reset to peek when node changes
  useEffect(() => {
    if (isMobile && selectedNodeId) setSheetState("peek")
  }, [isMobile, selectedNodeId])

  const handleSheetTouchStart = useCallback((e: ReactTouchEvent) => {
    dragStartY.current = e.touches[0].clientY
    dragDelta.current = 0
    dragStartState.current = sheetState
  }, [sheetState])

  const handleSheetTouchMove = useCallback((e: ReactTouchEvent) => {
    const dy = e.touches[0].clientY - dragStartY.current
    dragDelta.current = dy
    if (sheetRef.current) {
      if (dragStartState.current === "expanded" && dy > 0) {
        // Expanded: allow downward drag to collapse
        sheetRef.current.style.transform = `translateY(${dy}px)`
      } else if (dragStartState.current === "peek") {
        // Peek: allow upward drag (expand) or downward drag (dismiss)
        sheetRef.current.style.transform = `translateY(${dy}px)`
      }
    }
  }, [])

  const handleSheetTouchEnd = useCallback(() => {
    const dy = dragDelta.current
    const fromState = dragStartState.current

    if (fromState === "expanded") {
      if (dy > 60) setSheetState("peek")
    } else if (fromState === "peek") {
      if (dy < -60) {
        setSheetState("expanded")
      } else if (dy > 80) {
        useWorkflowStore.setState({ selectedNodeId: null })
      }
    }

    if (sheetRef.current) sheetRef.current.style.transform = ""
    dragDelta.current = 0
  }, [])

  // Group has no config panel — its title is edited inline on the node itself
  // (same UX rule as sticky-note: visual-only containers).
  const isVisible = !!foundNode && foundNode.type !== "sticky-note" && foundNode.type !== "group"
  const lastNodeRef = useRef(foundNode)
  if (foundNode) lastNodeRef.current = foundNode
  const displayNode = foundNode ?? lastNodeRef.current

  const frozenSourcesRef = useRef(liveSources)
  const frozenFieldMappingsRef = useRef(liveFieldMappings)
  const frozenHasDownstreamRef = useRef(liveHasDownstream)
  const frozenNodeRefsRef = useRef(liveNodeRefs)
  const frozenRefMapRef = useRef(liveRefMap)
  if (isVisible) {
    frozenSourcesRef.current = liveSources
    frozenFieldMappingsRef.current = liveFieldMappings
    frozenHasDownstreamRef.current = liveHasDownstream
    frozenNodeRefsRef.current = liveNodeRefs
    frozenRefMapRef.current = liveRefMap
  }
  const sources = isVisible ? liveSources : frozenSourcesRef.current
  const fieldMappings = isVisible ? liveFieldMappings : frozenFieldMappingsRef.current
  const hasDownstream = isVisible ? liveHasDownstream : frozenHasDownstreamRef.current
  const nodeRefs = isVisible ? liveNodeRefs : frozenNodeRefsRef.current
  const refMap = isVisible ? liveRefMap : frozenRefMapRef.current

  useEffect(() => {
    if (!isVisible) setConfigPanelFullscreen(false)
  }, [isVisible, setConfigPanelFullscreen])

  // Unmount-cleanup: configPanelFullscreen is a global Zustand flag that
  // OTHER components read (workflow-editor-main.tsx hides the floating
  // bottom action bar when it's true; workflow-canvas.tsx gates keyboard
  // shortcuts). If ConfigPanel unmounts while the flag is true — e.g.,
  // route change to a different workflow, editor remount — the flag would
  // leak into the next mount and the UI would render with no panel but
  // the bottom rail hidden / shortcuts dead.
  useEffect(() => {
    return () => {
      setConfigPanelFullscreen(false)
    }
  }, [setConfigPanelFullscreen])

  // Scroll-to-top on fullscreen entry. Without this, opening a fresh picker
  // inherits whatever scroll position the side-panel scroller had — pickers
  // that auto-open in fullscreen (addNodeAndOpenPicker) would land halfway
  // down the tile grid, and the Maximize2 toggle would keep the prior offset
  // instead of giving the wider modal a clean top-aligned view. Re-fires when
  // the selected node changes too so opening a different node in fullscreen
  // doesn't carry over the previous node's offset.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [isExpanded, selectedNodeId])

  const update = useCallback((data: Record<string, unknown>) => {
    if (!selectedNodeId) return
    updateNodeData(selectedNodeId, data)
  }, [selectedNodeId, updateNodeData])

  const handleMapField = useCallback((field: string, sourceNodeId: string | null) => {
    const current = { ...fieldMappings }
    if (sourceNodeId === null) {
      const { [field]: _, ...rest } = current
      update({ fieldMappings: rest })
    } else {
      update({ fieldMappings: { ...current, [field]: { sourceNodeId } } })
    }
  }, [fieldMappings, update])

  const removeLoopColumnEdges = useCallback((colHandleId: string) => {
    const targetHandle = `${colHandleId}_in`
    const edgesToRemove = edges.filter(
      (e) => e.target === selectedNodeId && e.targetHandle === targetHandle,
    )
    for (const edge of edgesToRemove) {
      deleteEdge(edge.id)
    }
  }, [edges, selectedNodeId, deleteEdge])

  // useMemo must be called unconditionally (before any early return) to satisfy React's rules of hooks
  const configProps = useMemo(
    () => ({
      data: (displayNode?.data ?? {}) as any,
      onUpdate: update,
      sources,
      fieldMappings,
      onMapField: handleMapField,
      nodes,
      edges,
      nodeRefs,
      refMap,
      variableDisplayMode,
      onRemoveColumnEdges: removeLoopColumnEdges,
    }),
    [displayNode?.data, update, sources, fieldMappings, handleMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, removeLoopColumnEdges]
  )

  // Multi-provider sum + repeat count for the GenerateButton's displayed total.
  // Hooks called unconditionally with safe defaults when no node is selected.
  const _earlyType = displayNode?.type as string | undefined
  const _earlyData = (displayNode?.data ?? {}) as Record<string, unknown>
  const _isMultiProviderNode = _earlyType === "generate-image"
    && Array.isArray(_earlyData.providers)
    && (_earlyData.providers as unknown[]).length >= 2
  const _providersForSum = _isMultiProviderNode ? (_earlyData.providers as readonly string[]) : []
  const _providerSum = useProvidersCreditsSum(_providersForSum, _earlyData)
  const _repeatMultiplier = _earlyType && REPEATABLE_NODE_TYPES.has(_earlyType)
    ? getEffectiveRepeatCount(_earlyData)
    : 1

  if (!displayNode) {
    // On mobile, render nothing when no node selected (bottom sheet simply gone)
    if (isMobile) return null
    return (
      <div className="absolute inset-0 z-10 bg-white dark:bg-[#1E1E1E] shadow-2xl flex flex-col sm:inset-auto sm:top-0 sm:right-0 sm:h-full sm:w-96 sm:border-l border-gray-200 dark:border-[#2D2D2D] transition-transform duration-200 ease-in-out translate-x-full pointer-events-none" />
    )
  }

  const selectedNode = displayNode
  const nodeType = selectedNode.type as string
  const nodeData = selectedNode.data as Record<string, unknown>
  // Locks run-affecting config (model, resolution, prompt, pickers, …) while
  // the node is executing or initiating. Name / results / run buttons / the
  // fullscreen toggle stay interactive — see the fieldset around NodeTypeConfig.
  const isNodeRunning =
    nodeData.executionStatus === "running" || nodeData.executionStatus === "pending"

  // Cross-cutting preset dropdown — one component, reads its node from the store by id. Self-hides
  // for nodes with no portable config (and asset/structural nodes). Placed below the heading in the
  // side panel; inline "on the side" of the header row in fullscreen.
  const presetDropdown = <PresetDropdown nodeId={selectedNode.id} variant="panel" />

  // --- Shared content for both desktop and mobile ---
  const panelHeader = (
    <div className="flex flex-col border-b border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] shrink-0">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-700 dark:text-[#ff0073]">
          {getNodeTypeDisplayName(nodeType)} Node Settings
        </h3>
        <div className="flex items-center gap-2">
          {/* Fullscreen: preset dropdown on the side (inline in the header row). */}
          {isExpanded && <div className="w-56">{presetDropdown}</div>}
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 dark:text-[#64748B] hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2D2D2D]"
              onClick={() => {
                // Read from the store imperatively so rapid double-clicks in
                // the same React batch still toggle correctly — `isExpanded`
                // from the selector is captured at render time, so two clicks
                // before the next render would both write the same value and
                // collapse to a single toggle. Mirrors the prior local-state
                // `setIsExpanded(v => !v)` functional-updater behavior.
                const current = useWorkflowStore.getState().configPanelFullscreen
                setConfigPanelFullscreen(!current)
              }}
              title={isExpanded ? "Collapse to side panel" : "Expand to full screen"}
              aria-label={isExpanded ? "Collapse panel" : "Expand panel"}
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
          {isExpanded ? (
            // Fullscreen: a prominent text "Close" button reads as the
            // primary exit affordance — the small X icon was easy to miss
            // against the wider modal chrome.
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={(e) => { e.stopPropagation(); closeFullscreenSettings() }}>
              Close
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="text-gray-400 dark:text-[#64748B] hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2D2D2D]" onClick={() => useWorkflowStore.setState({ selectedNodeId: null })} aria-label="Close panel">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {/* Side panel: preset dropdown on its own row, just below the node-type heading. */}
      {!isExpanded && <div className="px-4 pb-3">{presetDropdown}</div>}
    </div>
  )

  // --- Desktop: side panel (unchanged) ---
  const panelContent = (
    <div className={isExpanded
      ? "fixed inset-0 z-50 flex items-center justify-center"
      : isMobile
        ? `fixed bottom-0 left-0 right-0 z-50 transition-transform duration-200 ease-in-out ${isVisible ? "translate-y-0" : "translate-y-full pointer-events-none"}`
        : `absolute inset-0 z-10 bg-white dark:bg-[#1E1E1E] shadow-2xl flex flex-col sm:inset-auto sm:top-0 sm:right-0 sm:h-full sm:w-96 sm:border-l border-gray-200 dark:border-[#2D2D2D] ${isVisible && !isExpanded ? "transition-transform duration-200 ease-in-out translate-x-0" : "hidden"}`
    }>
      {isExpanded && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={(e) => { e.stopPropagation(); closeFullscreenSettings() }} />
      )}
      <div className={isExpanded
        ? "relative w-full max-w-[900px] max-h-[90vh] mx-4 bg-white dark:bg-[#1E1E1E] rounded-xl shadow-2xl border border-gray-200 dark:border-[#2D2D2D] flex flex-col overflow-hidden min-h-0"
        : isMobile
          ? `bg-white dark:bg-[#1E1E1E] rounded-t-2xl shadow-2xl flex flex-col transition-[max-height] duration-300 ease-in-out ${sheetState === "expanded" ? "max-h-[70vh]" : "max-h-[15vh]"} min-h-0`
          : "flex flex-col h-full min-h-0"
      }
        ref={isMobile ? sheetRef : undefined}
        // Delegate dblclick on the fullscreen modal: when the target is a
        // role="radio"/role="checkbox" tile button anywhere inside (custom
        // pickers like Lens, Framing, Animal, Camera Motion, Person,
        // Styling, etc. don't go through DimensionTileGrid but they all
        // share this role convention on their tiles), close the modal.
        // DimensionTileGrid handles its own dblclick + stopPropagation so
        // its events don't reach here — that's deliberate: it owns the
        // override path used inside a sub-Dialog (modal browser) to close
        // the dialog instead of the panel underneath.
        onDoubleClick={isExpanded && isTileGridPickerType(nodeType) ? (e) => {
          const t = e.target as HTMLElement | null
          if (!t) return
          const tile = t.closest('button[role="radio"], button[role="checkbox"]')
          if (tile) closeFullscreenSettings()
        } : undefined}
      >
        {/* Mobile drag handle + peek header */}
        {isMobile && (
          <div
            className="shrink-0 cursor-grab touch-manipulation"
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
          >
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
            </div>
            <div className="flex items-center justify-between px-4 pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-[#64748B]">
                  {getNodeTypeDisplayName(nodeType)}
                </span>
                <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {(selectedNode.data as { label: string }).label}
                </span>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7 text-gray-400 dark:text-[#64748B]" onClick={() => useWorkflowStore.setState({ selectedNodeId: null })} aria-label="Close panel">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
        {!isMobile && panelHeader}

      {(!isMobile || sheetState === "expanded") && (
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[#F8FAFC] dark:bg-[#121212]">
        <div className="flex flex-col gap-5 p-4">
          <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
            <Label htmlFor="node-label" className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Label</Label>
            <Input
              id="node-label"
              value={(selectedNode.data as { label: string }).label}
              onChange={(e) => update({ label: e.target.value })}
              className="mt-2 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-gray-900 dark:text-[#E2E8F0] focus:border-[#ff0073] focus:ring-[#ff0073]/20"
            />
          </div>

          {sources.length > 0 && (
            <div className="text-xs text-gray-500 dark:text-[#94A3B8] bg-gray-100 dark:bg-[#2D2D2D] rounded-lg px-3 py-2 border border-gray-200 dark:border-[#2D2D2D]">
              <span className="font-medium">{sources.length} connected source{sources.length !== 1 ? "s" : ""}</span>
              {": "}
              {sources.map((s) => s.label).join(", ")}
            </div>
          )}

          <Separator />

          {/* Node-type-specific config. In fullscreen, expose a "commit"
              channel via context so DimensionTileGrid (used by Pose, Mood,
              Person, Styling, etc.) closes the modal on a double-click pick.
              Side-panel mode leaves the context null — double-click is a
              no-op there, which matches the surrounding-non-tile picker UX. */}
          {/* While the node runs, lock the run-affecting parameters (model,
              resolution, prompt, pickers, …) — these all live inside
              NodeTypeConfig. The node name, Results Gallery (replacing the
              selected output), run/stop buttons, and the fullscreen toggle are
              rendered OUTSIDE this fieldset, so they stay interactive.
              Read-only (Studio/shared) workflows lock the same body: native
              form controls go inert via the disabled fieldset (custom Radix
              controls can still focus, but `updateNodeData` is already gated
              for read-only so edits can't persist). */}
          <fieldset
            disabled={isNodeRunning || isReadOnly}
            className="border-0 p-0 m-0 min-w-0 disabled:opacity-70 disabled:pointer-events-none"
          >
            {isExpanded ? (
              <TileCommitContext.Provider value={{ commit: closeFullscreenSettings }}>
                <NodeTypeConfig
                  nodeType={nodeType}
                  nodeData={nodeData}
                  configProps={configProps}
                  updateNodeData={updateNodeData}
                  onExpandDirector={() => setExpandDirectorOpen(true)}
                  update={update}
                  selectedNodeId={selectedNodeId ?? undefined}
                />
              </TileCommitContext.Provider>
            ) : (
              <NodeTypeConfig
                nodeType={nodeType}
                nodeData={nodeData}
                configProps={configProps}
                updateNodeData={updateNodeData}
                onExpandDirector={() => setExpandDirectorOpen(true)}
                update={update}
                selectedNodeId={selectedNodeId ?? undefined}
              />
            )}
          </fieldset>

          <Separator />

          {/* Results Gallery — shown before run buttons for result-producing nodes */}
          {(() => {
            if (!RESULT_PRODUCING_TYPES.has(nodeType)) return null
            const results = (nodeData.generatedResults ?? []) as Array<{ url?: string; jobId?: string; timestamp?: number }>
            if (results.length === 0) return null
            const activeIdx = (nodeData.activeResultIndex as number) ?? 0
            const mediaType: "image" | "video" | "audio" = LIBRARY_VIDEO_TYPES.has(nodeType) ? "video" : LIBRARY_AUDIO_TYPES.has(nodeType) ? "audio" : "image"
            return (
              <ResultsGallery
                nodeType={nodeType}
                results={results}
                activeIndex={activeIdx}
                mediaType={mediaType}
                onUpdate={update}
              />
            )
          })()}

          {(REPEATABLE_NODE_TYPES.has(nodeType) && (
            <div className="flex items-center gap-2 pt-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Repeat</span>
              <input
                type="number"
                min={1}
                max={20}
                step={1}
                value={getEffectiveRepeatCount(nodeData as Record<string, unknown>)}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  update({ repeatCount: isNaN(val) || val <= 1 ? undefined : Math.min(val, 20) })
                }}
                className="w-14 h-7 rounded border border-border bg-background text-center text-sm font-mono"
              />
              <span className="text-xs text-muted-foreground">times</span>
            </div>
          )) as any /* TS JSX children inference limit */}

          <div className="flex flex-col gap-2 pt-2">
            {/* Tile-grid pickers in fullscreen hide the Run button (pickers
                emit a prompt fragment via fieldMappings — they never execute,
                so a Run action is meaningless). Delete stays available next
                to Close so the user can dismiss a just-auto-opened picker
                without first leaving fullscreen to find the node on the
                canvas. text-prompt / tone (registered as picker node types
                for handle compatibility) keep the normal rail because their
                config UI is a plain Input/Textarea, not a tile grid. */}
            {isExpanded && isTileGridPickerType(nodeType) ? (
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={(e) => { e.stopPropagation(); closeFullscreenSettings() }}
                >
                  Close
                </Button>
              </div>
            ) : (
              <>
                {!isReadOnly && GENERATE_BUTTON_TYPES.has(nodeType) && (
                  <GenerateButton
                    onClick={() => runSingleNode?.(selectedNode.id)}
                    modelIdentifier={getModelIdentifier(selectedNode)}
                    userId={userId ?? ""}
                    label="Run This Node"
                    isRunning={nodeData.executionStatus === "running"}
                    creditOverride={
                      nodeType === "component"
                        ? (nodeData.estimatedCredits as number) || undefined
                        : _isMultiProviderNode && _providerSum > 0
                          ? _providerSum
                          : undefined
                    }
                    multiplier={_repeatMultiplier}
                  />
                )}

                {!isReadOnly && RUN_BUTTON_TYPES.has(nodeType) && (
                  <button
                    type="button"
                    onClick={() => runSingleNode?.(selectedNode.id)}
                    disabled={nodeData.executionStatus === "running"}
                    className={`w-full flex items-center justify-center gap-2 h-10 rounded-lg font-medium disabled:opacity-50 ${RUN_BUTTON_CLASS}`}
                  >
                    {nodeData.executionStatus === "running"
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Play className="w-4 h-4" />
                    }
                    {nodeData.executionStatus === "running" ? "Running..." : "Run"}
                  </button>
                )}

                {!isReadOnly && RUN_FROM_HERE_TYPES.has(nodeType) && (
                  <button
                    type="button"
                    onClick={() => runFromHere?.(selectedNode.id)}
                    disabled={nodeData.executionStatus === "running"}
                    className={`w-full flex items-center justify-center gap-2 h-10 rounded-lg font-medium disabled:opacity-50 ${RUN_BUTTON_CLASS}`}
                    title="Runs this node and all connected downstream nodes in sequence"
                  >
                    {nodeData.executionStatus === "running"
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <FastForward className="w-4 h-4" />
                    }
                    {nodeData.executionStatus === "running" ? "Running..." : "Run from here"}
                  </button>
                )}

                {!isReadOnly && hasDownstream && !RUN_FROM_HERE_TYPES.has(nodeType) && (
                  <button
                    type="button"
                    onClick={() => runFromHere?.(selectedNode.id)}
                    disabled={nodeData.executionStatus === "running" || nodeData.executionStatus === "pending"}
                    className="w-full flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-medium border border-[#ff0073]/30 text-[#ff0073] hover:bg-[#ff0073]/10 disabled:opacity-50 transition-colors"
                    title="Runs this node and all connected downstream nodes in sequence"
                  >
                    <FastForward className="w-3.5 h-3.5" />
                    Run from here
                  </button>
                )}

                {(() => {
                  const d = nodeData
                  const listResults = d.__listResults as string[] | undefined
                  const listInputs = d.__listInputs as string[] | undefined
                  // Only show iteration results when fan-out data exists AND the
                  // node still has visible results (user may have deleted them).
                  const hasResults = ((d.generatedResults ?? []) as unknown[]).length > 0
                  if (!listResults || listResults.length <= 1 || !hasResults) return null
                  return (
                    <IterationResultsPanel
                      nodeId={selectedNode.id}
                      nodeType={nodeType}
                      listResults={listResults}
                      listInputs={listInputs ?? []}
                    />
                  )
                })()}

              </>
            )}
          </div>
          {/* Presentation display settings */}
          {(nodeData.presentationInput || nodeData.presentationOutput) && (
            <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
              <PresentationDisplayConfig
                display={nodeData.presentationDisplay as PresentationDisplay ?? {}}
                onChange={(d) => updateNodeData(selectedNodeId!, { presentationDisplay: d })}
                showElementSize={nodeType !== "text-prompt"}
                viewModes={nodeType === "list" ? [{ value: "cards", label: "Cards" }, { value: "table", label: "Table" }] : undefined}
              />
            </div>
          )}

          {/* Safe area padding for mobile bottom sheet */}
          {isMobile && <div className="h-[env(safe-area-inset-bottom)]" />}
        </div>
      </div>
      )}
      {/* Phase 1B.2: legacy SceneEditorModal removed — new SceneNode is
          pipeline-managed (see Section L's pipeline panel + Section H's
          storyboard view). The expandSceneOpen state is retained as dead
          state until the legacy scene-editor-modal.tsx cleanup pass. */}
      {KLING3_DIRECTOR_TYPES.has(nodeType) && expandDirectorOpen && (
        <Suspense fallback={null}>
          <Kling3DirectorModal
            isOpen={expandDirectorOpen}
            onClose={() => setExpandDirectorOpen(false)}
            nodeId={selectedNode.id}
          />
        </Suspense>
      )}
      </div>
    </div>
  )

  return panelContent
}
