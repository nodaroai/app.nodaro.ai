"use client"

import { useMemo, useCallback, useState, useRef, useEffect, Suspense, type TouchEvent as ReactTouchEvent } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { X, Play, Maximize2, Minimize2, Loader2, FastForward } from "lucide-react"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
const Kling3DirectorModal = lazy(() => import("@/components/editor/kling3-director-modal").then(m => ({ default: m.Kling3DirectorModal })))
const Kling3StudioConfig = lazy(() => import("./config-panels/kling3-studio-config").then(m => ({ default: m.Kling3StudioConfig })))
import { GenerateButton } from "@/ee/components/credits/GenerateButton"
import { useProvidersCreditsSum } from "@/ee/hooks/use-providers-credits-sum"
import { createClient } from "@/lib/supabase"
import {
  NODE_DEFINITIONS,
  type ImageToVideoData,
  type TextToVideoData,
  type FieldMappings,
  type PresentationDisplay,
} from "@/types/nodes"
import { PresentationDisplayConfig } from "./config-panels/presentation-display-config"
// Phase 1B.2: SceneConfig now ships from `./config-panels/scene-configs`.
// Legacy `./scene-config` + `./scene-editor-modal` are dead code pending cleanup.
import { IterationResultsPanel } from "./iteration-results-panel"
import { getUpstreamNodes, buildNodeRefMap } from "@/lib/node-refs"
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
  GenerateScriptConfig,
  QACheckConfig,
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
  TextToVideoConfig,
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
  LocationConfig,
  AIWriterConfig,
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
  ResultsGallery,
} from "./config-panels"

const LIBRARY_VIDEO_TYPES = new Set(["image-to-video", "video-to-video", "text-to-video", "video-upscale", "extend-video", "motion-transfer", "lip-sync", "speech-to-video", "face-swap"])
const LIBRARY_AUDIO_TYPES = new Set(["text-to-speech", "generate-music", "text-to-audio", "audio-isolation", "text-to-dialogue", "voice-changer", "dubbing", "voice-remix", "voice-design", "suno-generate", "suno-cover", "suno-extend", "suno-separate", "suno-mashup", "suno-replace-section", "suno-add-instrumental", "suno-add-vocals", "suno-convert-wav", "suno-upload-extend"])

const NODE_TYPE_DISPLAY_NAMES: Record<string, string> = {
  "text-prompt": "Text Prompt",
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
  "generate-script": "Generate Script",
  "generate-image": "Generate Image",
  "modify-image": "Modify Image",
  "upscale-image": "Upscale Image",
  "remove-background": "Remove Background",
  "generate-mask": "Generate Mask",
  "image-to-video": "Image to Video",
  "video-to-video": "Video to Video",
  "text-to-video": "Text to Video",
  "text-to-speech": "Text to Speech",
  "qa-check": "QA Check",
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
  "llm-chat": "LLM Chat",
  "ai-writer": "AI Agent",
  "combine-videos": "Combine Videos",
  "merge-video-audio": "Merge Video & Audio",
  "add-captions": "Add Captions",
  "resize-video": "Resize Video",
  "social-media-format": "Social Media Format",
  "trim-audio": "Trim Audio",
  "split-media": "Split Media",
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
  "face-swap": "Face Swap",
  "speech-to-video": "Speech to Video",
  "video-upscale": "Upscale Video",
  "combine-text": "Combine Text",
  "split-text": "Split Text",
  "extract-field": "Extract Field",
  "json-process": "JSON Process",
  "filter-list": "Filter List",
  "deduplicate": "Remove Duplicates",
  "merge-lists": "Merge Lists",
  "sort-list": "Sort List",
  "preview": "Preview",
  "loop": "Table",
  "save-to-storage": "Save to Storage",
  "webhook-output": "Webhook Output",
  "character": "Character",
  "object": "Object",
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
  "generative-pipeline": "Story → Video",
}

export function getNodeTypeDisplayName(type: string): string {
  return NODE_TYPE_DISPLAY_NAMES[type] || type.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

export const GENERATE_BUTTON_TYPES = new Set([
  "generate-script", "generate-image", "modify-image", "upscale-image", "remove-background", "generate-mask",
  "image-to-video", "video-to-video", "text-to-video", "text-to-speech",
  "text-to-audio", "audio-isolation", "text-to-dialogue", "voice-changer", "dubbing", "voice-remix", "voice-design", "forced-alignment", "generate-music", "motion-transfer", "lip-sync", "speech-to-video",
  "video-upscale", "extend-video", "face-swap", "suno-generate", "suno-cover", "suno-extend",
  "suno-lyrics", "suno-separate", "suno-music-video",
  "suno-mashup", "suno-replace-section", "suno-style-boost", "suno-add-instrumental", "suno-add-vocals", "suno-convert-wav", "suno-upload-extend",
  "ai-writer", "llm-chat", "web-scrape",
  "video-composer", "after-effects", "lottie-overlay", "3d-title", "motion-graphics",
  "image-to-text", "qa-check", "transcribe",
  "render-video",
  "instagram-post", "tiktok-post", "youtube-upload", "linkedin-post", "x-post", "facebook-post", "telegram-post",
  "component",
  // FFmpeg processing (tiered credits)
  "merge-video-audio", "combine-videos", "trim-audio", "split-media", "trim-video", "extract-frame",
  "speed-ramp", "loop-video", "fade-video", "transcode-video", "resize-video", "social-media-format", "adjust-volume",
  "add-captions", "mix-audio", "combine-audio",
])

export const RUN_BUTTON_TYPES = new Set([
  "manual-edit", "composite",
  "sub-workflow", "router",
])

/** Nodes that show "Run from here" as primary action instead of "Run". */
const RUN_FROM_HERE_TYPES: Set<string> = new Set([
  ...NODE_DEFINITIONS.filter((d) => d.autoExecute).map((d) => d.type),
  "preview", "loop", "list",
])

const KLING3_DIRECTOR_TYPES = new Set(["image-to-video", "text-to-video"])

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
  switch (nodeType) {
    case "text-prompt": return <TextPromptConfig {...configProps} />
    case "list": return <LoopConfig {...configProps} nodeId={selectedNodeId} singleColumn />
    case "loop": return <LoopConfig {...configProps} nodeId={selectedNodeId} />
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
    case "generate-script": return <GenerateScriptConfig {...configProps} />
    case "generate-image": return <GenerateImageConfig {...configProps} nodeId={selectedNodeId} />
    case "modify-image": return <ModifyImageConfig {...configProps} nodeId={selectedNodeId} />
    case "upscale-image": return <UpscaleImageConfig {...configProps} />
    case "remove-background": return <RemoveBackgroundConfig {...configProps} />
    case "generate-mask": return <GenerateMaskConfig {...configProps} />
    case "image-to-video": return (nodeData as ImageToVideoData).provider === "kling-3.0"
      ? <Suspense fallback={null}><Kling3StudioConfig {...configProps} /></Suspense>
      : <ImageToVideoConfig {...configProps} onUpdateNode={updateNodeData} nodeId={selectedNodeId} />
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
    case "text-to-speech": return <TextToSpeechConfig {...configProps} />
    case "qa-check": return <QACheckConfig {...configProps} />
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
    case "motion-transfer": return <MotionTransferConfig {...configProps} nodeId={selectedNodeId} />
    case "transcribe": return <TranscribeConfig {...configProps} />
    case "image-to-text": return <ImageToTextConfig {...configProps} />
    case "llm-chat": return <LLMChatConfig {...configProps} />
    case "ai-writer": return <AIWriterConfig {...configProps} />
    case "video-upscale": return <VideoUpscaleConfig {...configProps} />
    case "extend-video": return <ExtendVideoConfig {...configProps} nodeId={selectedNodeId} />
    case "face-swap": return <FaceSwapConfig {...configProps} nodeId={selectedNodeId} />
    case "combine-videos": return <CombineVideosConfig {...configProps} />
    case "merge-video-audio": return <MergeVideoAudioConfig {...configProps} />
    case "add-captions": return <AddCaptionsConfig {...configProps} />
    case "resize-video": return <ResizeVideoConfig {...configProps} />
    case "social-media-format": return <SocialMediaFormatConfig {...configProps} />
    case "trim-audio": return <TrimAudioConfig {...configProps} />
    case "split-media": return <SplitMediaConfig {...configProps} />
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
    case "preview": return <PreviewConfig {...configProps} />
    case "teleport-send": case "teleport-receive": return <TeleporterConfig {...configProps} nodeType={nodeType} />
    case "router": return <RouterConfig {...configProps} />
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
    case "object": return <ObjectConfig {...configProps} />
    case "location": return <LocationConfig {...configProps} nodeId={selectedNodeId!} />
    case "scene": return <SceneConfig {...configProps} />
    case "generative-pipeline": return <GenerativePipelineConfig {...configProps} />
    default: return null
  }
}

export function ConfigPanel() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const deleteNode = useWorkflowStore((s) => s.deleteNode)
  const deleteEdge = useWorkflowStore((s) => s.deleteEdge)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const variableDisplayMode = useWorkflowStore((s) => s.variableDisplayMode)
  const [userId, setUserId] = useState<string | undefined>(undefined)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: any } }) => {
      setUserId(user?.id ?? undefined)
    })
  }, [])

  const foundNode = nodes.find((n) => n.id === selectedNodeId)

  const liveSources = useMemo(() => {
    if (!selectedNodeId) return [] as SourceNodeInfo[]
    return getConnectedSources(selectedNodeId, edges, nodes)
  }, [edges, nodes, selectedNodeId])

  const liveNodeRefs = useMemo(() => {
    if (!selectedNodeId) return []
    return getUpstreamNodes(selectedNodeId, nodes, edges)
  }, [selectedNodeId, nodes, edges])

  const liveRefMap = useMemo(() => {
    if (!selectedNodeId) return new Map<string, string>()
    return buildNodeRefMap(selectedNodeId, nodes, edges)
  }, [selectedNodeId, nodes, edges])

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
  const [isExpanded, setIsExpanded] = useState(false)
  const isMobile = useIsMobile()
  const setConfigPanelFullscreen = useWorkflowStore((s) => s.setConfigPanelFullscreen)

  useEffect(() => {
    setConfigPanelFullscreen(isExpanded)
    return () => setConfigPanelFullscreen(false)
  }, [isExpanded, setConfigPanelFullscreen])

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

  const isVisible = !!foundNode && foundNode.type !== "sticky-note"
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
    if (!isVisible) setIsExpanded(false)
  }, [isVisible])

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

  function handleDelete() {
    if (!selectedNodeId) return
    deleteNode(selectedNodeId)
  }

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

  // --- Shared content for both desktop and mobile ---
  const panelHeader = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] shrink-0">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-700 dark:text-[#ff0073]">
        {getNodeTypeDisplayName(nodeType)} Node Settings
      </h3>
      <div className="flex items-center gap-1">
        {!isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="text-gray-400 dark:text-[#64748B] hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2D2D2D]"
            onClick={() => setIsExpanded((v) => !v)}
            title={isExpanded ? "Collapse to side panel" : "Expand to full screen"}
            aria-label={isExpanded ? "Collapse panel" : "Expand panel"}
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="text-gray-400 dark:text-[#64748B] hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2D2D2D]" onClick={() => { setIsExpanded(false); useWorkflowStore.setState({ selectedNodeId: null }) }} aria-label="Close panel">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )

  // --- Desktop: side panel (unchanged) ---
  const panelContent = (
    <div className={isExpanded
      ? "fixed inset-0 z-50 flex items-center justify-center"
      : isMobile
        ? `fixed bottom-0 left-0 right-0 z-50 transition-transform duration-200 ease-in-out ${isVisible ? "translate-y-0" : "translate-y-full pointer-events-none"}`
        : `absolute inset-0 z-10 bg-white dark:bg-[#1E1E1E] shadow-2xl flex flex-col sm:inset-auto sm:top-0 sm:right-0 sm:h-full sm:w-96 sm:border-l border-gray-200 dark:border-[#2D2D2D] transition-transform duration-200 ease-in-out ${isVisible ? "translate-x-0" : "translate-x-full pointer-events-none"}`
    }>
      {isExpanded && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsExpanded(false)} />
      )}
      <div className={isExpanded
        ? "relative w-full max-w-[900px] max-h-[90vh] mx-4 bg-white dark:bg-[#1E1E1E] rounded-xl shadow-2xl border border-gray-200 dark:border-[#2D2D2D] flex flex-col overflow-hidden min-h-0"
        : isMobile
          ? `bg-white dark:bg-[#1E1E1E] rounded-t-2xl shadow-2xl flex flex-col transition-[max-height] duration-300 ease-in-out ${sheetState === "expanded" ? "max-h-[70vh]" : "max-h-[15vh]"} min-h-0`
          : "flex flex-col h-full min-h-0"
      }
        ref={isMobile ? sheetRef : undefined}
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
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[#F8FAFC] dark:bg-[#121212]">
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

          {/* Node-type-specific config */}
          <NodeTypeConfig
            nodeType={nodeType}
            nodeData={nodeData}
            configProps={configProps}
            updateNodeData={updateNodeData}
            onExpandDirector={() => setExpandDirectorOpen(true)}
            update={update}
            selectedNodeId={selectedNodeId ?? undefined}
          />

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
            {GENERATE_BUTTON_TYPES.has(nodeType) && (
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

            {RUN_BUTTON_TYPES.has(nodeType) && (
              <button
                type="button"
                onClick={() => runSingleNode?.(selectedNode.id)}
                disabled={nodeData.executionStatus === "running"}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-lg text-white font-medium bg-[#ff0073] hover:bg-[#e0005f] disabled:opacity-50 transition-colors"
              >
                {nodeData.executionStatus === "running"
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Play className="w-4 h-4" />
                }
                {nodeData.executionStatus === "running" ? "Running..." : "Run"}
              </button>
            )}

            {RUN_FROM_HERE_TYPES.has(nodeType) && (
              <button
                type="button"
                onClick={() => runFromHere?.(selectedNode.id)}
                disabled={nodeData.executionStatus === "running"}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-lg text-white font-medium bg-[#ff0073] hover:bg-[#e0005f] disabled:opacity-50 transition-colors"
                title="Runs this node and all connected downstream nodes in sequence"
              >
                {nodeData.executionStatus === "running"
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <FastForward className="w-4 h-4" />
                }
                {nodeData.executionStatus === "running" ? "Running..." : "Run from here"}
              </button>
            )}

            {hasDownstream && !RUN_FROM_HERE_TYPES.has(nodeType) && (
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

            <Button variant="outline" size="sm" className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30" onClick={handleDelete}>
              Delete Node
            </Button>
          </div>
          {/* Presentation display settings */}
          {(nodeData.presentationInput || nodeData.presentationOutput) && (
            <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
              <PresentationDisplayConfig
                display={nodeData.presentationDisplay as PresentationDisplay ?? {}}
                onChange={(d) => updateNodeData(selectedNodeId!, { presentationDisplay: d })}
                showElementSize={nodeType !== "text-prompt"}
                viewModes={nodeType === "loop" ? [{ value: "cards", label: "Cards" }, { value: "table", label: "Table" }] : undefined}
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
