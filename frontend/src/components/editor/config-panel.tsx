"use client"

import { useMemo, useCallback, useState, useRef, useEffect, Suspense, type TouchEvent as ReactTouchEvent } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { X, Play, Maximize2, Minimize2, Loader2, FastForward, ImageIcon } from "lucide-react"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
const Kling3DirectorModal = lazy(() => import("@/components/editor/kling3-director-modal").then(m => ({ default: m.Kling3DirectorModal })))
import { GenerateButton } from "@/components/credits/GenerateButton"
import { createClient } from "@/lib/supabase"
import type {
  ImageToVideoData,
  TextToVideoData,
  FieldMappings,
} from "@/types/nodes"
import type { SceneNodeDataType } from "@/types/nodes"
import { SceneConfig } from "./scene-config"
const SceneEditorModal = lazy(() => import("./scene-editor-modal").then(m => ({ default: m.SceneEditorModal })))
import { IterationResultsPanel } from "./iteration-results-panel"
import { getUpstreamNodes } from "@/lib/node-refs"
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
  GenerateScriptConfig,
  QACheckConfig,
  GenerateImageConfig,
  EditImageConfig,
  ImageToImageConfig,
  ImageToVideoConfig,
  VideoToVideoConfig,
  MotionTransferConfig,
  VideoUpscaleConfig,
  ExtendVideoConfig,
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
  SunoGenerateConfig,
  SunoCoverConfig,
  SunoExtendConfig,
  SunoLyricsConfig,
  SunoSeparateConfig,
  SunoMusicVideoConfig,
  TranscribeConfig,
  ImageToTextConfig,
  LipSyncConfig,
  GenerateMusicConfig,
  CombineVideosConfig,
  AddCaptionsConfig,
  ResizeVideoConfig,
  SocialMediaFormatConfig,
  ExtractAudioConfig,
  MixAudioConfig,
  AdjustVolumeConfig,
  TrimVideoConfig,
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
  CombineTextConfig,
  SaveToStorageConfig,
  WebhookOutputConfig,
  SplitTextConfig,
  SubWorkflowInputConfig,
  SubWorkflowOutputConfig,
  SubWorkflowConfig,
  WebhookTriggerConfig,
  ScheduleTriggerConfig,
  InstagramPostConfig,
  TiktokPostConfig,
  YoutubeUploadConfig,
  LinkedinPostConfig,
  XPostConfig,
  FacebookPostConfig,
} from "./config-panels"

const LIBRARY_VIDEO_TYPES = new Set(["image-to-video", "video-to-video", "text-to-video", "video-upscale", "extend-video", "motion-transfer", "lip-sync"])
const LIBRARY_AUDIO_TYPES = new Set(["text-to-speech", "generate-music", "text-to-audio", "audio-isolation", "text-to-dialogue", "voice-changer", "dubbing", "voice-remix", "voice-design", "suno-generate", "suno-cover", "suno-extend", "suno-separate"])

const NODE_TYPE_DISPLAY_NAMES: Record<string, string> = {
  "text-prompt": "Text Prompt",
  "upload-image": "Upload Image",
  "upload-video": "Upload Video",
  "upload-audio": "Upload Audio",
  "rss-feed": "RSS Feed",
  "youtube-video": "Video URL",
  "reference-audio": "Reference Audio",
  "tone": "Tone",
  "style-guide": "Style Guide",
  "provider": "Provider",
  "scene-count": "Scene Count",
  "duration": "Duration",
  "aspect-ratio": "Aspect Ratio",
  "motion": "Motion",
  "camera-motion": "Camera Motion",
  "generate-script": "Generate Script",
  "generate-image": "Generate Image",
  "edit-image": "Edit Image",
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
  "suno-generate": "Suno Generate",
  "suno-cover": "Suno Cover",
  "suno-extend": "Suno Extend",
  "suno-lyrics": "Suno Lyrics",
  "suno-separate": "Suno Separate",
  "suno-music-video": "Suno Music Video",
  "transcribe": "Transcribe",
  "image-to-text": "Describe Image",
  "ai-writer": "AI Agent",
  "combine-videos": "Combine Videos",
  "merge-video-audio": "Merge Video & Audio",
  "add-captions": "Add Captions",
  "resize-video": "Resize Video",
  "social-media-format": "Social Media Format",
  "extract-audio": "Extract Audio",
  "mix-audio": "Mix Audio",
  "adjust-volume": "Adjust Volume",
  "trim-video": "Trim Video",
  "speed-ramp": "Adjust Speed",
  "loop-video": "Loop Video",
  "fade-video": "Fade In/Out",
  "transcode-video": "Transcode Video",
  "manual-edit": "Manual Edit",
  "extend-video": "Extend Video",
  "combine-text": "Combine Text",
  "split-text": "Split Text",
  "loop": "Loop",
  "save-to-storage": "Save to Storage",
  "webhook-output": "Webhook Output",
  "character": "Character",
  "object": "Object",
  "location": "Location",
  "scene": "Scene",
  "sub-workflow-input": "Sub-Workflow Input",
  "sub-workflow-output": "Sub-Workflow Output",
  "sub-workflow": "Sub-Workflow",
  "webhook-trigger": "Webhook Trigger",
  "schedule-trigger": "Schedule Trigger",
  "instagram-post": "Instagram Post",
  "tiktok-post": "TikTok Post",
  "youtube-upload": "YouTube Upload",
  "linkedin-post": "LinkedIn Post",
  "x-post": "X Post",
  "facebook-post": "Facebook Post",
}

export function getNodeTypeDisplayName(type: string): string {
  return NODE_TYPE_DISPLAY_NAMES[type] || type.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

export const GENERATE_BUTTON_TYPES = new Set([
  "generate-script", "generate-image", "edit-image", "image-to-image",
  "image-to-video", "video-to-video", "text-to-video", "text-to-speech",
  "text-to-audio", "audio-isolation", "text-to-dialogue", "voice-changer", "dubbing", "voice-remix", "voice-design", "forced-alignment", "generate-music", "motion-transfer", "lip-sync",
  "video-upscale", "extend-video", "suno-generate", "suno-cover", "suno-extend",
  "suno-lyrics", "suno-separate", "suno-music-video", "ai-writer",
  "video-composer", "after-effects", "lottie-overlay", "3d-title", "motion-graphics",
  "image-to-text",
])

export const RUN_BUTTON_TYPES = new Set([
  "merge-video-audio", "combine-videos", "extract-audio", "trim-video",
  "speed-ramp", "loop-video", "fade-video", "transcode-video", "manual-edit", "resize-video", "social-media-format", "adjust-volume",
  "add-captions", "mix-audio", "combine-text", "split-text", "composite", "render-video",
  "sub-workflow",
  "instagram-post", "tiktok-post", "youtube-upload", "linkedin-post", "x-post", "facebook-post",
])

const KLING3_DIRECTOR_TYPES = new Set(["image-to-video", "text-to-video"])


export function ConfigPanel() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const deleteNode = useWorkflowStore((s) => s.deleteNode)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const setWorkflowThumbnail = useWorkflowStore((s) => s.setWorkflowThumbnail)

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

  const liveHasDownstream = useMemo(() => {
    if (!selectedNodeId) return false
    return edges.some((e) => e.source === selectedNodeId)
  }, [selectedNodeId, edges])

  const liveFieldMappings: FieldMappings = useMemo(() => {
    if (!foundNode) return {}
    const d = foundNode.data as Record<string, unknown>
    return (d.fieldMappings as FieldMappings) ?? {}
  }, [foundNode])

  const [expandSceneOpen, setExpandSceneOpen] = useState(false)
  const [expandDirectorOpen, setExpandDirectorOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const isMobile = useIsMobile()

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
  if (isVisible) {
    frozenSourcesRef.current = liveSources
    frozenFieldMappingsRef.current = liveFieldMappings
    frozenHasDownstreamRef.current = liveHasDownstream
    frozenNodeRefsRef.current = liveNodeRefs
  }
  const sources = isVisible ? liveSources : frozenSourcesRef.current
  const fieldMappings = isVisible ? liveFieldMappings : frozenFieldMappingsRef.current
  const hasDownstream = isVisible ? liveHasDownstream : frozenHasDownstreamRef.current
  const nodeRefs = isVisible ? liveNodeRefs : frozenNodeRefsRef.current

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
      nodeRefs,
    }),
    [displayNode?.data, update, sources, fieldMappings, handleMapField, nodes, nodeRefs]
  )

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
          {nodeType === "text-prompt" && <TextPromptConfig {...configProps} />}
          {nodeType === "list" && <ListConfig {...configProps} />}
          {nodeType === "loop" && <LoopConfig {...configProps} />}
          {nodeType === "upload-image" && <UploadImageConfig {...configProps} />}
          {nodeType === "upload-video" && <UploadVideoConfig {...configProps} />}
          {nodeType === "upload-audio" && <UploadAudioConfig {...configProps} />}
          {nodeType === "rss-feed" && <RSSFeedConfig {...configProps} />}
          {nodeType === "youtube-video" && <YouTubeVideoConfig {...configProps} />}
          {nodeType === "reference-audio" && <ReferenceAudioConfig {...configProps} />}
          {nodeType === "webhook-trigger" && <WebhookTriggerConfig {...configProps} />}
          {nodeType === "schedule-trigger" && <ScheduleTriggerConfig {...configProps} />}

          {nodeType === "tone" && <ToneConfig {...configProps} />}
          {nodeType === "style-guide" && <StyleGuideConfig {...configProps} />}
          {nodeType === "provider" && <ProviderConfig {...configProps} />}
          {nodeType === "scene-count" && <SceneCountConfig {...configProps} />}
          {nodeType === "duration" && <DurationConfig {...configProps} />}
          {nodeType === "aspect-ratio" && <AspectRatioConfig {...configProps} />}
          {nodeType === "motion" && <MotionConfig {...configProps} />}
          {nodeType === "camera-motion" && <CameraMotionConfig {...configProps} />}

          {nodeType === "generate-script" && <GenerateScriptConfig {...configProps} />}
          {nodeType === "generate-image" && <GenerateImageConfig {...configProps} />}
          {nodeType === "edit-image" && <EditImageConfig {...configProps} />}
          {nodeType === "image-to-image" && <ImageToImageConfig {...configProps} />}
          {nodeType === "image-to-video" && (
            <>
              <ImageToVideoConfig {...configProps} onUpdateNode={updateNodeData} />
              {(nodeData as ImageToVideoData).provider === "kling-3.0" && (
                <Button variant="outline" className="w-full mt-2" onClick={() => setExpandDirectorOpen(true)}>
                  <Maximize2 className="w-4 h-4 mr-2" />
                  Expand Director
                </Button>
              )}
            </>
          )}
          {nodeType === "video-to-video" && <VideoToVideoConfig {...configProps} />}
          {nodeType === "text-to-video" && (
            <>
              <TextToVideoConfig {...configProps} />
              {(nodeData as TextToVideoData).provider === "kling-3.0" && (
                <Button variant="outline" className="w-full mt-2" onClick={() => setExpandDirectorOpen(true)}>
                  <Maximize2 className="w-4 h-4 mr-2" />
                  Expand Director
                </Button>
              )}
            </>
          )}
          {nodeType === "text-to-speech" && <TextToSpeechConfig {...configProps} />}
          {nodeType === "qa-check" && <QACheckConfig {...configProps} />}
          {nodeType === "generate-music" && <GenerateMusicConfig {...configProps} />}
          {nodeType === "text-to-audio" && <TextToAudioConfig {...configProps} />}
          {nodeType === "audio-isolation" && <AudioIsolationConfig {...configProps} />}
          {nodeType === "text-to-dialogue" && <TextToDialogueConfig {...configProps} />}
          {nodeType === "voice-changer" && <VoiceChangerConfig {...configProps} />}
          {nodeType === "dubbing" && <DubbingConfig {...configProps} />}
          {nodeType === "voice-remix" && <VoiceRemixConfig {...configProps} />}
          {nodeType === "voice-design" && <VoiceDesignConfig {...configProps} />}
          {nodeType === "forced-alignment" && <ForcedAlignmentConfig {...configProps} />}
          {nodeType === "suno-generate" && <SunoGenerateConfig {...configProps} />}
          {nodeType === "suno-cover" && <SunoCoverConfig {...configProps} />}
          {nodeType === "suno-extend" && <SunoExtendConfig {...configProps} />}
          {nodeType === "suno-lyrics" && <SunoLyricsConfig {...configProps} />}
          {nodeType === "suno-separate" && <SunoSeparateConfig {...configProps} />}
          {nodeType === "suno-music-video" && <SunoMusicVideoConfig {...configProps} />}
          {nodeType === "lip-sync" && <LipSyncConfig {...configProps} />}
          {nodeType === "motion-transfer" && <MotionTransferConfig {...configProps} />}
          {nodeType === "transcribe" && <TranscribeConfig {...configProps} />}
          {nodeType === "image-to-text" && <ImageToTextConfig {...configProps} />}
          {nodeType === "ai-writer" && <AIWriterConfig {...configProps} />}

          {nodeType === "video-upscale" && <VideoUpscaleConfig {...configProps} />}
          {nodeType === "extend-video" && <ExtendVideoConfig {...configProps} />}
          {nodeType === "combine-videos" && <CombineVideosConfig {...configProps} />}
          {nodeType === "merge-video-audio" && <MergeVideoAudioConfig {...configProps} />}
          {nodeType === "add-captions" && <AddCaptionsConfig {...configProps} />}
          {nodeType === "resize-video" && <ResizeVideoConfig {...configProps} />}
          {nodeType === "social-media-format" && <SocialMediaFormatConfig {...configProps} />}
          {nodeType === "extract-audio" && <ExtractAudioConfig {...configProps} />}
          {nodeType === "mix-audio" && <MixAudioConfig {...configProps} />}
          {nodeType === "adjust-volume" && <AdjustVolumeConfig {...configProps} />}
          {nodeType === "trim-video" && <TrimVideoConfig {...configProps} />}
          {nodeType === "video-composer" && <VideoComposerConfig {...configProps} />}
          {nodeType === "after-effects" && <AfterEffectsConfig {...configProps} />}
          {nodeType === "lottie-overlay" && <LottieOverlayConfig {...configProps} />}
          {nodeType === "3d-title" && <ThreeDTitleConfig {...configProps} />}
          {nodeType === "motion-graphics" && <MotionGraphicsConfig {...configProps} />}
          {nodeType === "composite" && <CompositeConfig {...configProps} />}
          {nodeType === "render-video" && <RenderVideoConfig {...configProps} />}
          {nodeType === "speed-ramp" && <SpeedRampConfig {...configProps} />}
          {nodeType === "loop-video" && <LoopVideoConfig {...configProps} />}
          {nodeType === "fade-video" && <FadeVideoConfig {...configProps} />}
          {nodeType === "transcode-video" && <TranscodeVideoConfig {...configProps} />}
          {nodeType === "manual-edit" && <ManualEditConfig {...configProps} />}
          {nodeType === "combine-text" && <CombineTextConfig {...configProps} />}
          {nodeType === "split-text" && <SplitTextConfig {...configProps} />}

          {nodeType === "save-to-storage" && <SaveToStorageConfig {...configProps} />}
          {nodeType === "webhook-output" && <WebhookOutputConfig {...configProps} />}

          {nodeType === "instagram-post" && <InstagramPostConfig {...configProps} />}
          {nodeType === "tiktok-post" && <TiktokPostConfig {...configProps} />}
          {nodeType === "youtube-upload" && <YoutubeUploadConfig {...configProps} />}
          {nodeType === "linkedin-post" && <LinkedinPostConfig {...configProps} />}
          {nodeType === "x-post" && <XPostConfig {...configProps} />}
          {nodeType === "facebook-post" && <FacebookPostConfig {...configProps} />}

          {nodeType === "sub-workflow-input" && <SubWorkflowInputConfig {...configProps} />}
          {nodeType === "sub-workflow-output" && <SubWorkflowOutputConfig {...configProps} />}
          {nodeType === "sub-workflow" && <SubWorkflowConfig {...configProps} />}

          {nodeType === "character" && <CharacterConfig data={nodeData as any} onUpdate={update} />}
          {nodeType === "face" && <FaceConfig data={nodeData as any} onUpdate={update} />}
          {nodeType === "object" && <ObjectConfig data={nodeData as any} onUpdate={update} />}
          {nodeType === "location" && <LocationConfig data={nodeData as any} onUpdate={update} />}

          {nodeType === "scene" && (
            <>
              <SceneConfig data={nodeData as SceneNodeDataType} onUpdate={update} nodeId={selectedNodeId ?? undefined} />
              <Button variant="outline" className="w-full mt-2" onClick={() => setExpandSceneOpen(true)}>
                <Maximize2 className="w-4 h-4 mr-2" />
                Expand Scene Editor
              </Button>
            </>
          )}

          <Separator />

          <div className="flex flex-col gap-2 pt-2">
            {GENERATE_BUTTON_TYPES.has(nodeType) && (
              <GenerateButton
                onClick={() => runSingleNode?.(selectedNode.id)}
                modelIdentifier={getModelIdentifier(selectedNode)}
                userId={userId ?? ""}
                label="Run This Node"
                isRunning={nodeData.executionStatus === "running"}
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

            {hasDownstream && (
              <button
                type="button"
                onClick={() => runFromHere?.(selectedNode.id)}
                disabled={nodeData.executionStatus === "running"}
                className="w-full flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-medium border border-[#ff0073]/30 text-[#ff0073] hover:bg-[#ff0073]/10 disabled:opacity-50 transition-colors"
                title="Runs this node and all connected downstream nodes in sequence"
              >
                <FastForward className="w-3.5 h-3.5" />
                Run from here
              </button>
            )}

            {(() => {
              const d = nodeData
              const results = (d.generatedResults ?? []) as Array<{ url?: string }>
              const activeIdx = (d.activeResultIndex as number) ?? 0
              const activeUrl = results[activeIdx]?.url ?? (d.generatedImageUrl as string) ?? (d.generatedVideoUrl as string) ?? (d.url as string)
              if (!activeUrl) return null
              const mediaType: "image" | "video" | "audio" = LIBRARY_VIDEO_TYPES.has(nodeType) ? "video" : LIBRARY_AUDIO_TYPES.has(nodeType) ? "audio" : "image"
              const thumbnailMediaUrl = (d.generatedImageUrl as string) ?? (d.generatedVideoUrl as string)
              return (
                <>
                  <SaveToLibraryButton url={activeUrl} type={mediaType} compact={false} className="w-full" />
                  {thumbnailMediaUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setWorkflowThumbnail(thumbnailMediaUrl)}
                    >
                      <ImageIcon className="w-3.5 h-3.5 mr-2" />
                      Set as Thumbnail
                    </Button>
                  )}
                </>
              )
            })()}

            {(() => {
              const d = nodeData
              const listResults = d.__listResults as string[] | undefined
              const listInputs = d.__listInputs as string[] | undefined
              if (!listResults || listResults.length <= 1) return null
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
          {/* Safe area padding for mobile bottom sheet */}
          {isMobile && <div className="h-[env(safe-area-inset-bottom)]" />}
        </div>
      </div>
      )}
      {nodeType === "scene" && expandSceneOpen && (
        <Suspense fallback={null}>
          <SceneEditorModal
            isOpen={expandSceneOpen}
            onClose={() => setExpandSceneOpen(false)}
            nodeId={selectedNode.id}
          />
        </Suspense>
      )}
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
