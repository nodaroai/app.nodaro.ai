"use client"

import { useMemo, useState, useCallback, useRef, useEffect, lazy, Suspense } from "react"
import { X, Play, Copy, Check, ImageIcon, FileText, Plus, UserPlus, Download, Maximize2, Minimize2, Loader2, Sparkles, Upload, UserCircle, Package, MapPin, Volume2, VolumeX, Mic, Music, Film, AudioWaveform, AlertCircle, FastForward, Trash2, ChevronUp, ChevronDown, Users, GripVertical } from "lucide-react"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemWithMeta,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAuth } from "@/hooks/use-auth"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { CachedImage } from "@/components/ui/cached-image"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
const Kling3DirectorModal = lazy(() => import("@/components/editor/kling3-director-modal").then(m => ({ default: m.Kling3DirectorModal })))
import { GenerateButton } from "@/components/credits/GenerateButton"
import { useModelCredits, prefetchModelCredits } from "@/hooks/use-model-credits"
import { createClient } from "@/lib/supabase"
import { uploadFile, uploadAudio, uploadImage, downloadYouTubeAudio, extractYouTubeAudioApi, fetchYouTubeOEmbed, getJobStatus, startVideoDownload, subscribeToDownloadProgress } from "@/lib/api"
import type { DownloadProgressEvent } from "@/lib/api"
import {
  getProviders,
  getProviderLabel,
  getModels,
  getFirstProvider,
  getFirstModel,
  type ProviderCategory,
} from "@/lib/providers-config"
import { TTS_VOICES } from "@/lib/tts-voices"
import type {
  TextPromptData,
  ListNodeData,
  LoopNodeData,
  LoopColumn,
  UploadImageData,
  UploadVideoData,
  UploadAudioData,
  RSSFeedData,
  YouTubeVideoData,
  ReferenceAudioData,
  ToneData,
  StyleGuideData,
  ProviderData,
  SceneCountData,
  DurationData,
  AspectRatioData,
  MotionData,
  CameraMotionData,
  GenerateScriptData,
  GenerateImageData,
  EditImageData,
  ImageToImageData,
  ImageToVideoData,
  VideoToVideoData,
  TextToVideoData,
  TextToSpeechData,
  QACheckData,
  GenerateMusicData,
  TextToAudioData,
  SunoGenerateData,
  SunoCoverData,
  SunoExtendData,
  SunoLyricsData,
  SunoSeparateData,
  SunoMusicVideoData,
  TranscribeData,
  CombineVideosData,
  MergeVideoAudioData,
  AddCaptionsData,
  ResizeVideoData,
  ExtractAudioData,
  MixAudioData,
  AdjustVolumeData,
  TrimVideoData,
  VideoComposerData,
  RenderVideoData,
  SpeedRampData,
  LoopVideoData,
  FadeVideoData,
  LipSyncData,
  MotionTransferData,
  VideoUpscaleData,
  AIWriterNodeData,
  CombineTextNodeData,
  SplitTextData,
  SaveToStorageData,
  WebhookOutputData,
  FieldMappings,
  GeneratedScript,
  ScriptScene,
  CharacterDefinition,
  CharacterNodeData,
  FaceNodeData,
  ObjectNodeData,
  LocationNodeData,
} from "@/types/nodes"
import type { WorkflowNode, WorkflowEdge, SceneNodeDataType } from "@/types/nodes"
import { AI_WRITER_TEMPLATES, getAIWriterTemplate } from "@/lib/ai-writer-templates"
import { SceneConfig } from "./scene-config"
const SceneEditorModal = lazy(() => import("./scene-editor-modal").then(m => ({ default: m.SceneEditorModal })))
import type { SelectedAsset } from "./asset-selection-modal"
const AssetSelectionModal = lazy(() => import("./asset-selection-modal").then(m => ({ default: m.AssetSelectionModal })))
import { IterationResultsPanel } from "./iteration-results-panel"

interface SourceNodeInfo {
  readonly id: string
  readonly type: string
  readonly label: string
  readonly value: string
  readonly providerCategory?: string
  readonly targetHandle?: string
  readonly nodeData?: Record<string, unknown>
}

const FIELD_COMPATIBLE_TYPES: Readonly<Record<string, ReadonlyArray<string>>> = {
  prompt: ["text-prompt"],
  negativePrompt: ["text-prompt"],
  style: ["style-guide"],
  styleGuide: ["style-guide"],
  tone: ["text-prompt", "tone"],
  provider: ["provider"],
  aspectRatio: ["aspect-ratio"],
  duration: ["duration"],
  targetLength: ["duration"],
  motion: ["motion"],
  cameraMotion: ["camera-motion"],
  sceneCount: ["scene-count"],
}

function getCompatibleSources(
  field: string,
  sources: ReadonlyArray<SourceNodeInfo>,
  providerCategory?: string,
): ReadonlyArray<SourceNodeInfo> {
  const compatibleTypes = FIELD_COMPATIBLE_TYPES[field]
  if (!compatibleTypes) return sources

  const filtered = sources.filter((s) => {
    if (!compatibleTypes.includes(s.type)) return false
    if (s.type === "provider" && providerCategory && s.providerCategory !== providerCategory) return false
    return true
  })

  // Deduplicate by id to avoid React key warnings
  const seen = new Set<string>()
  return filtered.filter((s) => {
    if (seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })
}

function getConnectedSources(
  nodeId: string,
  edges: ReadonlyArray<WorkflowEdge>,
  nodes: ReadonlyArray<WorkflowNode>,
): ReadonlyArray<SourceNodeInfo> {
  const sources: SourceNodeInfo[] = []
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const source = nodes.find((n) => n.id === edge.source)
    if (!source) continue
    const d = source.data as Record<string, unknown>
    sources.push({
      id: source.id,
      type: source.type as string,
      label: (d.label as string) ?? source.type ?? source.id,
      value: extractDisplayValue(d, source.type as string),
      providerCategory: source.type === "provider" ? (d.category as string) : undefined,
      targetHandle: edge.targetHandle ?? undefined,
      nodeData: d,
    })
  }
  return sources
}

function getConnectedProviderModel(
  fieldMappings: FieldMappings,
  sources: ReadonlyArray<SourceNodeInfo>,
  nodes: ReadonlyArray<WorkflowNode>,
): string | undefined {
  const providerMapping = fieldMappings.provider
  if (!providerMapping) return undefined
  const source = sources.find((s) => s.id === providerMapping.sourceNodeId)
  if (!source || source.type !== "provider") return undefined
  const sourceNode = nodes.find((n) => n.id === source.id)
  if (!sourceNode) return undefined
  const d = sourceNode.data as Record<string, unknown>
  return (d.model as string) ?? undefined
}

function extractDisplayValue(data: Record<string, unknown>, nodeType: string): string {
  switch (nodeType) {
    case "text-prompt":
      return (data.text as string) ?? ""
    case "tone":
      return (data.tone as string) ?? ""
    case "style-guide":
      return (data.text as string) ?? ""
    case "provider":
      return `${data.provider ?? ""}/${data.model ?? ""}`
    case "scene-count":
      return `${data.count ?? ""} scenes`
    case "duration":
      return `${data.seconds ?? ""}s`
    case "aspect-ratio":
      return (data.ratio as string) ?? ""
    case "motion":
      return (data.motion as string) ?? ""
    case "camera-motion":
      return (data.cameraMotion as string) ?? ""
    case "reference-audio":
      return (data.videoTitle as string) || (data.extractedAudioUrl as string) ? "Audio ready" : "No audio"
    default:
      return (data.label as string) ?? ""
  }
}

interface ConfigProps<T> {
  readonly data: T
  readonly onUpdate: (d: Record<string, unknown>) => void
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly onUpdateNode?: (nodeId: string, data: Record<string, unknown>) => void
}

function MappableField({
  field,
  label,
  sources,
  fieldMappings,
  onMapField,
  providerCategory,
  children,
}: {
  readonly field: string
  readonly label: string
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
  readonly providerCategory?: string
  readonly children: React.ReactNode
}) {
  const compatible = getCompatibleSources(field, sources, providerCategory)
  const mapping = fieldMappings[field]
  const mappedSource = mapping ? compatible.find((s) => s.id === mapping.sourceNodeId) : undefined
  const isMapped = !!mappedSource

  return (
    <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">{label}</Label>
        {compatible.length > 0 && (
          <Select
            value={mapping?.sourceNodeId ?? "__manual__"}
            onValueChange={(v) => onMapField(field, v === "__manual__" ? null : v)}
          >
            <SelectTrigger className="h-6 text-[10px] w-auto max-w-[140px] px-2 py-0 shrink-0 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-gray-700 dark:text-[#E2E8F0]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white dark:bg-[#1E1E1E] border-gray-200 dark:border-[#2D2D2D]">
              <SelectItem value="__manual__">Manual</SelectItem>
              {compatible.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {isMapped ? (
        <p className="text-xs text-gray-500 dark:text-[#94A3B8] bg-[#F8FAFC] dark:bg-[#121212] rounded-lg px-2.5 py-2 break-words whitespace-pre-wrap border border-gray-200 dark:border-[#2D2D2D]">
          {mappedSource.value || "(empty)"}
        </p>
      ) : (
        children
      )}
    </div>
  )
}

function getModelIdentifier(node: WorkflowNode): string {
  // AI Writer always uses "ai-writer" for credit cost lookup (not the LLM provider name)
  if (node.type === "ai-writer") return "ai-writer"
  const data = node.data as Record<string, unknown>
  const provider = data.provider as string | undefined
  if (provider) return provider
  return node.type ?? "unknown"
}

export function ConfigPanel() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const deleteNode = useWorkflowStore((s) => s.deleteNode)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const runFromHere = useWorkflowStore((s) => s.runFromHere)

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

  // Slide-in/out: compute visibility, keep last node for exit animation content
  const isVisible = !!foundNode && foundNode.type !== "sticky-note"
  const lastNodeRef = useRef(foundNode)
  if (foundNode) lastNodeRef.current = foundNode
  const displayNode = foundNode ?? lastNodeRef.current

  // Freeze derived data during exit animation so content doesn't shift
  const frozenSourcesRef = useRef(liveSources)
  const frozenFieldMappingsRef = useRef(liveFieldMappings)
  const frozenHasDownstreamRef = useRef(liveHasDownstream)
  if (isVisible) {
    frozenSourcesRef.current = liveSources
    frozenFieldMappingsRef.current = liveFieldMappings
    frozenHasDownstreamRef.current = liveHasDownstream
  }
  const sources = isVisible ? liveSources : frozenSourcesRef.current
  const fieldMappings = isVisible ? liveFieldMappings : frozenFieldMappingsRef.current
  const hasDownstream = isVisible ? liveHasDownstream : frozenHasDownstreamRef.current

  // Reset expanded state when panel closes
  useEffect(() => {
    if (!isVisible) setIsExpanded(false)
  }, [isVisible])

  // Functions only depend on selectedNodeId (not selectedNode), safe to declare before guard
  function update(data: Record<string, unknown>) {
    if (!selectedNodeId) return
    updateNodeData(selectedNodeId, data)
  }

  function handleMapField(field: string, sourceNodeId: string | null) {
    const current = { ...fieldMappings }
    if (sourceNodeId === null) {
      const { [field]: _, ...rest } = current
      update({ fieldMappings: rest })
    } else {
      update({ fieldMappings: { ...current, [field]: { sourceNodeId } } })
    }
  }

  function handleDelete() {
    if (!selectedNodeId) return
    deleteNode(selectedNodeId)
  }

  // Always render the outer wrapper so the CSS transition has a DOM element to animate.
  // When no node has ever been selected, render an empty off-screen shell.
  if (!displayNode) {
    return (
      <div className="absolute inset-0 z-10 bg-white dark:bg-[#1E1E1E] shadow-2xl flex flex-col sm:inset-auto sm:top-0 sm:right-0 sm:h-full sm:w-96 sm:border-l border-gray-200 dark:border-[#2D2D2D] transition-transform duration-200 ease-in-out translate-x-full pointer-events-none" />
    )
  }

  // displayNode is the node to render (current or last-selected during exit animation)
  const selectedNode = displayNode

  // Get display name for node type
  const getNodeTypeDisplayName = (type: string): string => {
    const names: Record<string, string> = {
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
      "suno-generate": "Suno Generate",
      "suno-cover": "Suno Cover",
      "suno-extend": "Suno Extend",
      "suno-lyrics": "Suno Lyrics",
      "suno-separate": "Suno Separate",
      "suno-music-video": "Suno Music Video",
      "transcribe": "Transcribe",
      "ai-writer": "AI Agent",
      "combine-videos": "Combine Videos",
      "merge-video-audio": "Merge Video & Audio",
      "add-captions": "Add Captions",
      "resize-video": "Resize Video",
      "extract-audio": "Extract Audio",
      "mix-audio": "Mix Audio",
      "adjust-volume": "Adjust Volume",
      "trim-video": "Trim Video",
      "speed-ramp": "Adjust Speed",
      "loop-video": "Loop Video",
      "fade-video": "Fade In/Out",
      "combine-text": "Combine Text",
      "split-text": "Split Text",
      "loop": "Loop",
      "save-to-storage": "Save to Storage",
      "webhook-output": "Webhook Output",
      "character": "Character",
      "object": "Object",
      "location": "Location",
      "scene": "Scene",
    }
    return names[type] || type.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  }

  const panelContent = (
    <div className={isExpanded
      ? "fixed inset-0 z-50 flex items-center justify-center"
      : `absolute inset-0 z-10 bg-white dark:bg-[#1E1E1E] shadow-2xl flex flex-col sm:inset-auto sm:top-0 sm:right-0 sm:h-full sm:w-96 sm:border-l border-gray-200 dark:border-[#2D2D2D] transition-transform duration-200 ease-in-out ${isVisible ? "translate-x-0" : "translate-x-full pointer-events-none"}`
    }>
      {/* Backdrop (expanded mode only) */}
      {isExpanded && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsExpanded(false)} />
      )}
      <div className={isExpanded
        ? "relative w-full max-w-[900px] max-h-[90vh] mx-4 bg-white dark:bg-[#1E1E1E] rounded-xl shadow-2xl border border-gray-200 dark:border-[#2D2D2D] flex flex-col overflow-hidden min-h-0"
        : "flex flex-col h-full min-h-0"
      }>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] shrink-0">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-700 dark:text-[#ff0073]">
            {getNodeTypeDisplayName(selectedNode.type as string)} Node Settings
          </h3>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 dark:text-[#64748B] hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2D2D2D]"
              onClick={() => setIsExpanded((v) => !v)}
              title={isExpanded ? "Collapse to side panel" : "Expand to full screen"}
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="text-gray-400 dark:text-[#64748B] hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2D2D2D]" onClick={() => { setIsExpanded(false); selectNode(null) }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F8FAFC] dark:bg-[#121212]">
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

          {/* Input Nodes */}
          {selectedNode.type === "text-prompt" && (
            <TextPromptConfig data={selectedNode.data as TextPromptData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "list" && (
            <ListConfig data={selectedNode.data as ListNodeData} onUpdate={update} />
          )}
          {selectedNode.type === "loop" && (
            <LoopConfig data={selectedNode.data as LoopNodeData} onUpdate={update} />
          )}
          {selectedNode.type === "upload-image" && (
            <UploadImageConfig data={selectedNode.data as UploadImageData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "upload-video" && (
            <UploadVideoConfig data={selectedNode.data as UploadVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "upload-audio" && (
            <UploadAudioConfig data={selectedNode.data as UploadAudioData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "rss-feed" && (
            <RSSFeedConfig data={selectedNode.data as RSSFeedData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "youtube-video" && (
            <YouTubeVideoConfig data={selectedNode.data as YouTubeVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "reference-audio" && (
            <ReferenceAudioConfig data={selectedNode.data as ReferenceAudioData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}

          {/* Parameter Nodes */}
          {selectedNode.type === "tone" && (
            <ToneConfig data={selectedNode.data as ToneData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "style-guide" && (
            <StyleGuideConfig data={selectedNode.data as StyleGuideData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "provider" && (
            <ProviderConfig data={selectedNode.data as ProviderData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "scene-count" && (
            <SceneCountConfig data={selectedNode.data as SceneCountData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "duration" && (
            <DurationConfig data={selectedNode.data as DurationData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "aspect-ratio" && (
            <AspectRatioConfig data={selectedNode.data as AspectRatioData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "motion" && (
            <MotionConfig data={selectedNode.data as MotionData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "camera-motion" && (
            <CameraMotionConfig data={selectedNode.data as CameraMotionData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}

          {/* AI Nodes */}
          {selectedNode.type === "generate-script" && (
            <GenerateScriptConfig data={selectedNode.data as GenerateScriptData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "generate-image" && (
            <GenerateImageConfig data={selectedNode.data as GenerateImageData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "edit-image" && (
            <EditImageConfig data={selectedNode.data as EditImageData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "image-to-image" && (
            <ImageToImageConfig data={selectedNode.data as ImageToImageData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "image-to-video" && (
            <>
              <ImageToVideoConfig data={selectedNode.data as ImageToVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} onUpdateNode={updateNodeData} />
              {(selectedNode.data as ImageToVideoData).provider === "kling-3.0" && (
                <Button
                  variant="outline"
                  className="w-full mt-2"
                  onClick={() => setExpandDirectorOpen(true)}
                >
                  <Maximize2 className="w-4 h-4 mr-2" />
                  Expand Director
                </Button>
              )}
            </>
          )}
          {selectedNode.type === "video-to-video" && (
            <VideoToVideoConfig data={selectedNode.data as VideoToVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "text-to-video" && (
            <>
              <TextToVideoConfig data={selectedNode.data as TextToVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
              {(selectedNode.data as TextToVideoData).provider === "kling-3.0" && (
                <Button
                  variant="outline"
                  className="w-full mt-2"
                  onClick={() => setExpandDirectorOpen(true)}
                >
                  <Maximize2 className="w-4 h-4 mr-2" />
                  Expand Director
                </Button>
              )}
            </>
          )}
          {selectedNode.type === "text-to-speech" && (
            <TextToSpeechConfig data={selectedNode.data as TextToSpeechData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "qa-check" && (
            <QACheckConfig data={selectedNode.data as QACheckData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "generate-music" && (
            <GenerateMusicConfig data={selectedNode.data as GenerateMusicData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "text-to-audio" && (
            <TextToAudioConfig data={selectedNode.data as TextToAudioData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "suno-generate" && (
            <SunoGenerateConfig data={selectedNode.data as SunoGenerateData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "suno-cover" && (
            <SunoCoverConfig data={selectedNode.data as SunoCoverData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "suno-extend" && (
            <SunoExtendConfig data={selectedNode.data as SunoExtendData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "suno-lyrics" && (
            <SunoLyricsConfig data={selectedNode.data as SunoLyricsData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "suno-separate" && (
            <SunoSeparateConfig data={selectedNode.data as SunoSeparateData} onUpdate={update} />
          )}
          {selectedNode.type === "suno-music-video" && (
            <SunoMusicVideoConfig data={selectedNode.data as SunoMusicVideoData} onUpdate={update} />
          )}
          {selectedNode.type === "lip-sync" && (
            <LipSyncConfig data={selectedNode.data as LipSyncData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "motion-transfer" && (
            <MotionTransferConfig data={selectedNode.data as unknown as MotionTransferData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "transcribe" && (
            <TranscribeConfig data={selectedNode.data as TranscribeData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "ai-writer" && (
            <AIWriterConfig data={selectedNode.data as AIWriterNodeData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}

          {/* Processing Nodes */}
          {selectedNode.type === "video-upscale" && (
            <VideoUpscaleConfig data={selectedNode.data as unknown as VideoUpscaleData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "combine-videos" && (
            <CombineVideosConfig data={selectedNode.data as CombineVideosData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "merge-video-audio" && (
            <MergeVideoAudioConfig data={selectedNode.data as MergeVideoAudioData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "add-captions" && (
            <AddCaptionsConfig data={selectedNode.data as AddCaptionsData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "resize-video" && (
            <ResizeVideoConfig data={selectedNode.data as ResizeVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "extract-audio" && (
            <ExtractAudioConfig data={selectedNode.data as ExtractAudioData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "mix-audio" && (
            <MixAudioConfig data={selectedNode.data as MixAudioData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "adjust-volume" && (
            <AdjustVolumeConfig data={selectedNode.data as AdjustVolumeData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "trim-video" && (
            <TrimVideoConfig data={selectedNode.data as TrimVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "video-composer" && (
            <VideoComposerConfig data={selectedNode.data as VideoComposerData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "render-video" && (
            <RenderVideoConfig data={selectedNode.data as RenderVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "speed-ramp" && (
            <SpeedRampConfig data={selectedNode.data as SpeedRampData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "loop-video" && (
            <LoopVideoConfig data={selectedNode.data as LoopVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "fade-video" && (
            <FadeVideoConfig data={selectedNode.data as FadeVideoData} onUpdate={update} />
          )}
          {selectedNode.type === "combine-text" && (
            <CombineTextConfig data={selectedNode.data as CombineTextNodeData} onUpdate={update} />
          )}
          {selectedNode.type === "split-text" && (
            <SplitTextConfig data={selectedNode.data as SplitTextData} onUpdate={update} />
          )}

          {/* Output Nodes */}
          {selectedNode.type === "save-to-storage" && (
            <SaveToStorageConfig data={selectedNode.data as SaveToStorageData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "webhook-output" && (
            <WebhookOutputConfig data={selectedNode.data as WebhookOutputData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}

          {/* Character Node */}
          {selectedNode.type === "character" && (
            <CharacterConfig data={selectedNode.data as CharacterNodeData} onUpdate={update} />
          )}

          {/* Face Node */}
          {selectedNode.type === "face" && (
            <FaceConfig data={selectedNode.data as FaceNodeData} onUpdate={update} />
          )}

          {/* Object Node */}
          {selectedNode.type === "object" && (
            <ObjectConfig data={selectedNode.data as ObjectNodeData} onUpdate={update} />
          )}

          {/* Location Node */}
          {selectedNode.type === "location" && (
            <LocationConfig data={selectedNode.data as LocationNodeData} onUpdate={update} />
          )}

          {/* Scene Node */}
          {selectedNode.type === "scene" && (
            <>
              <SceneConfig data={selectedNode.data as SceneNodeDataType} onUpdate={update} nodeId={selectedNodeId ?? undefined} />
              <Button
                variant="outline"
                className="w-full mt-2"
                onClick={() => setExpandSceneOpen(true)}
              >
                <Maximize2 className="w-4 h-4 mr-2" />
                Expand Scene Editor
              </Button>
            </>
          )}

          <Separator />

          <div className="flex flex-col gap-2 pt-2">
            {(selectedNode.type === "generate-script" || selectedNode.type === "generate-image" || selectedNode.type === "edit-image" || selectedNode.type === "image-to-image" || selectedNode.type === "image-to-video" || selectedNode.type === "video-to-video" || selectedNode.type === "text-to-video" || selectedNode.type === "text-to-speech" || selectedNode.type === "text-to-audio" || selectedNode.type === "generate-music" || selectedNode.type === "motion-transfer" || selectedNode.type === "lip-sync" || selectedNode.type === "video-upscale" || selectedNode.type === "suno-generate" || selectedNode.type === "suno-cover" || selectedNode.type === "suno-extend" || selectedNode.type === "suno-lyrics" || selectedNode.type === "suno-separate" || selectedNode.type === "suno-music-video" || selectedNode.type === "ai-writer") && (
              <GenerateButton
                onClick={() => runSingleNode?.(selectedNode.id)}
                modelIdentifier={getModelIdentifier(selectedNode)}
                userId={userId ?? ""}
                label="Run This Node"
                isRunning={(selectedNode.data as Record<string, unknown>).executionStatus === "running"}
              />
            )}

            {(selectedNode.type === "merge-video-audio" || selectedNode.type === "combine-videos" || selectedNode.type === "extract-audio" || selectedNode.type === "trim-video" || selectedNode.type === "speed-ramp" || selectedNode.type === "loop-video" || selectedNode.type === "fade-video" || selectedNode.type === "resize-video" || selectedNode.type === "adjust-volume" || selectedNode.type === "add-captions" || selectedNode.type === "mix-audio" || selectedNode.type === "combine-text" || selectedNode.type === "split-text") && (
              <button
                type="button"
                onClick={() => runSingleNode?.(selectedNode.id)}
                disabled={(selectedNode.data as Record<string, unknown>).executionStatus === "running"}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-lg text-white font-medium bg-[#ff0073] hover:bg-[#e0005f] disabled:opacity-50 transition-colors"
              >
                {(selectedNode.data as Record<string, unknown>).executionStatus === "running"
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Play className="w-4 h-4" />
                }
                {(selectedNode.data as Record<string, unknown>).executionStatus === "running" ? "Running..." : "Run"}
              </button>
            )}

            {hasDownstream && (
              <button
                type="button"
                onClick={() => runFromHere?.(selectedNode.id)}
                disabled={(selectedNode.data as Record<string, unknown>).executionStatus === "running"}
                className="w-full flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-medium border border-[#ff0073]/30 text-[#ff0073] hover:bg-[#ff0073]/10 disabled:opacity-50 transition-colors"
                title="Runs this node and all connected downstream nodes in sequence"
              >
                <FastForward className="w-3.5 h-3.5" />
                Run from here
              </button>
            )}

            {(() => {
              const d = selectedNode.data as Record<string, unknown>
              const results = (d.generatedResults ?? []) as Array<{ url?: string }>
              const activeIdx = (d.activeResultIndex as number) ?? 0
              const activeUrl = results[activeIdx]?.url ?? (d.generatedImageUrl as string) ?? (d.generatedVideoUrl as string) ?? (d.url as string)
              if (!activeUrl) return null
              const videoTypes = new Set(["image-to-video", "video-to-video", "text-to-video", "video-upscale", "motion-transfer", "lip-sync"])
              const audioTypes = new Set(["text-to-speech", "generate-music", "text-to-audio", "suno-generate", "suno-cover", "suno-extend", "suno-separate"])
              const mediaType: "image" | "video" | "audio" = videoTypes.has(selectedNode.type as string) ? "video" : audioTypes.has(selectedNode.type as string) ? "audio" : "image"
              return (
                <SaveToLibraryButton url={activeUrl} type={mediaType} compact={false} className="w-full" />
              )
            })()}

            {/* Iteration Results Panel — shown when node ran multiple times via List/Loop */}
            {(() => {
              const d = selectedNode.data as Record<string, unknown>
              const listResults = d.__listResults as string[] | undefined
              const listInputs = d.__listInputs as string[] | undefined
              if (!listResults || listResults.length <= 1) return null
              return (
                <IterationResultsPanel
                  nodeId={selectedNode.id}
                  nodeType={selectedNode.type as string}
                  listResults={listResults}
                  listInputs={listInputs ?? []}
                />
              )
            })()}

            <Button variant="outline" size="sm" className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30" onClick={handleDelete}>
              Delete Node
            </Button>
          </div>
        </div>
      </div>
      {selectedNode.type === "scene" && expandSceneOpen && (
        <Suspense fallback={null}>
          <SceneEditorModal
            isOpen={expandSceneOpen}
            onClose={() => setExpandSceneOpen(false)}
            nodeId={selectedNode.id}
          />
        </Suspense>
      )}
      {(selectedNode.type === "image-to-video" || selectedNode.type === "text-to-video") && expandDirectorOpen && (
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

/* ── Input Node Configs ── */

function TextPromptConfig({ data, onUpdate }: ConfigProps<TextPromptData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="prompt-text">Prompt Text</Label>
        <Textarea
          id="prompt-text"
          rows={5}
          value={data.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder="Enter your story prompt..."
        />
      </div>
    </div>
  )
}

function ListConfig({ data, onUpdate }: { data: ListNodeData; onUpdate: (patch: Partial<ListNodeData>) => void }) {
  const [newItem, setNewItem] = useState("")
  const itemList = useMemo(
    () => (data.items || "").split("\n").filter((l) => l.trim() !== ""),
    [data.items],
  )

  function save(updated: ReadonlyArray<string>) {
    onUpdate({ items: updated.join("\n") })
  }

  function addItem(text: string) {
    if (!text.trim()) return
    save([...itemList, text.trim()])
    setNewItem("")
  }

  function updateItem(index: number, value: string) {
    const updated = itemList.map((item, i) => (i === index ? value : item))
    save(updated)
  }

  function removeItem(index: number) {
    save(itemList.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-3">
      <Label>Items</Label>
      <div className="flex flex-col gap-1.5">
        {itemList.map((item, i) => (
          <div key={`item-${i}`} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}</span>
            <input
              className="flex-1 text-sm bg-muted/30 rounded px-2 py-1 border border-border focus:border-[#ff0073] focus:outline-none"
              value={item}
              onChange={(e) => updateItem(i, e.target.value)}
            />
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
              onClick={() => removeItem(i)}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-5 text-right shrink-0" />
          <input
            className="flex-1 text-sm bg-muted/30 rounded px-2 py-1 border border-dashed border-border focus:border-[#ff0073] focus:outline-none"
            placeholder="Add item..."
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newItem.trim()) {
                e.preventDefault()
                addItem(newItem)
              }
            }}
            onBlur={() => {
              if (newItem.trim()) addItem(newItem)
            }}
          />
          <span className="w-3 shrink-0" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {itemList.length} item{itemList.length !== 1 ? "s" : ""}
      </p>
    </div>
  )
}

function LoopConfig({ data, onUpdate }: { data: LoopNodeData; onUpdate: (patch: Partial<LoopNodeData>) => void }) {
  const columns = data.columns ?? []
  const rows = data.rows ?? []

  function addColumn() {
    const id = crypto.randomUUID()
    const name = `Column ${columns.length + 1}`
    const newCol: LoopColumn = { id, name, handleId: `col_${id}` }
    const updatedRows = rows.map((row) => [...row, ""])
    onUpdate({ columns: [...columns, newCol], rows: updatedRows })
  }

  function removeColumn(colIndex: number) {
    const updatedCols = columns.filter((_, i) => i !== colIndex)
    const updatedRows = rows.map((row) => row.filter((_, i) => i !== colIndex))
    onUpdate({ columns: updatedCols, rows: updatedRows })
  }

  function renameColumn(colIndex: number, name: string) {
    const updatedCols = columns.map((col, i) =>
      i === colIndex ? { ...col, name } : col,
    )
    onUpdate({ columns: updatedCols })
  }

  function addRow() {
    const newRow = columns.map(() => "")
    onUpdate({ rows: [...rows, newRow] })
  }

  function removeRow(rowIndex: number) {
    onUpdate({ rows: rows.filter((_, i) => i !== rowIndex) })
  }

  function updateCell(rowIndex: number, colIndex: number, value: string) {
    const updatedRows = rows.map((row, ri) =>
      ri === rowIndex ? row.map((cell, ci) => (ci === colIndex ? value : cell)) : row,
    )
    onUpdate({ rows: updatedRows })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Table</Label>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={addColumn}
        >
          <Plus className="w-3 h-3" />
          Add Column
        </button>
      </div>

      {columns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/50">
          <p className="text-sm">No columns yet</p>
          <p className="text-xs mt-1">Add a column to get started</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="w-6" />
                {columns.map((col, ci) => (
                  <th key={col.id} className="pb-1 px-0.5">
                    <div className="flex items-center gap-0.5">
                      <input
                        className="flex-1 min-w-[60px] text-xs font-medium bg-muted/30 rounded px-1.5 py-1 border border-border focus:border-[#ff0073] focus:outline-none"
                        value={col.name}
                        onChange={(e) => renameColumn(ci, e.target.value)}
                      />
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                        onClick={() => removeColumn(ci)}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={`row-${ri}`}>
                  <td className="pr-1 text-right align-middle">
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground/40 hover:text-red-500 transition-colors"
                        onClick={() => removeRow(ri)}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                      <span className="text-muted-foreground w-3 text-right">{ri + 1}</span>
                    </div>
                  </td>
                  {columns.map((col, ci) => (
                    <td key={`${col.id}-${ri}`} className="px-0.5 py-0.5">
                      <input
                        className="w-full min-w-[60px] text-xs bg-muted/30 rounded px-1.5 py-1 border border-border focus:border-[#ff0073] focus:outline-none"
                        value={row[ci] ?? ""}
                        onChange={(e) => updateCell(ri, ci, e.target.value)}
                        placeholder={col.name}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <button
            type="button"
            className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={addRow}
          >
            <Plus className="w-3 h-3" />
            Add Row
          </button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {rows.length} row{rows.length !== 1 ? "s" : ""} &times; {columns.length} column{columns.length !== 1 ? "s" : ""}
      </p>
    </div>
  )
}

function UploadImageConfig({ data, onUpdate }: ConfigProps<UploadImageData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="image-url">Image URL</Label>
        <Input
          id="image-url"
          value={data.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/image.png"
        />
      </div>
    </div>
  )
}

function UploadVideoConfig({ data, onUpdate }: ConfigProps<UploadVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="video-url">Video URL</Label>
        <Input
          id="video-url"
          value={data.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/video.mp4"
        />
      </div>
    </div>
  )
}

function UploadAudioConfig({ data, onUpdate }: ConfigProps<UploadAudioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="audio-url">Audio URL</Label>
        <Input
          id="audio-url"
          value={data.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/audio.mp3"
        />
      </div>
    </div>
  )
}

function RSSFeedConfig({ data, onUpdate }: ConfigProps<RSSFeedData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="feed-url">Feed URL</Label>
        <Input
          id="feed-url"
          value={data.feedUrl}
          onChange={(e) => onUpdate({ feedUrl: e.target.value })}
          placeholder="https://example.com/feed.xml"
        />
      </div>
      <div>
        <Label htmlFor="item-index">Item Index</Label>
        <Input
          id="item-index"
          type="number"
          min={0}
          value={data.itemIndex}
          onChange={(e) => onUpdate({ itemIndex: parseInt(e.target.value, 10) || 0 })}
        />
      </div>
    </div>
  )
}

function detectVideoPlatform(url: string): string {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube"
  if (/facebook\.com|fb\.watch|fb\.com/.test(url)) return "facebook"
  if (/tiktok\.com/.test(url)) return "tiktok"
  if (/instagram\.com/.test(url)) return "instagram"
  if (/(?:twitter\.com|x\.com)/.test(url)) return "twitter"
  return "unknown"
}

function extractVideoUrlId(url: string): string | null {
  // YouTube
  const ytMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  )
  if (ytMatch) return ytMatch[1]
  // TikTok
  const tiktokMatch = url.match(/tiktok\.com\/@[\w.-]+\/video\/(\d+)/)
  if (tiktokMatch) return tiktokMatch[1]
  // Instagram
  const igMatch = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)
  if (igMatch) return igMatch[1]
  // Twitter/X
  const twMatch = url.match(/(?:twitter\.com|x\.com)\/[\w]+\/status\/(\d+)/)
  if (twMatch) return twMatch[1]
  // Facebook - multiple URL formats
  const fbMatch = url.match(/facebook\.com\/.*\/videos\/(\d+)/)
  if (fbMatch) return fbMatch[1]
  const fbShareMatch = url.match(/facebook\.com\/share\/(?:v|r)\/([A-Za-z0-9_-]+)/)
  if (fbShareMatch) return fbShareMatch[1]
  const fbReelMatch = url.match(/facebook\.com\/reel\/([A-Za-z0-9_-]+)/)
  if (fbReelMatch) return fbReelMatch[1]
  if (/fb\.watch/.test(url)) return url
  // Fallback for recognized non-YouTube platforms
  const platform = detectVideoPlatform(url)
  if (platform !== "unknown" && platform !== "youtube") return url
  return null
}

const VIDEO_PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitter: "Twitter/X",
  unknown: "Video",
}

function YouTubeVideoConfig({ data, onUpdate }: ConfigProps<YouTubeVideoData>) {
  const [loading, setLoading] = useState(false)

  const platform = detectVideoPlatform(data.youtubeUrl || "")
  const isYouTube = platform === "youtube"
  const downloadStatus = data.downloadStatus ?? "idle"
  const isDownloading = downloadStatus === "downloading"
  const displayThumbnail = data.downloadedThumbnailUrl || data.thumbnailUrl

  const handleUrlChange = useCallback(async (url: string) => {
    onUpdate({
      youtubeUrl: url,
      downloadedVideoUrl: "",
      downloadedThumbnailUrl: "",
      downloadStatus: "idle",
      downloadError: "",
      downloadPercent: 0,
    })

    const videoId = extractVideoUrlId(url)
    if (!videoId) {
      onUpdate({ videoId: "", title: "", thumbnailUrl: "" })
      return
    }

    const detectedPlatform = detectVideoPlatform(url)
    onUpdate({ videoId })
    setLoading(true)
    try {
      if (detectedPlatform === "youtube") {
        const meta = await fetchYouTubeOEmbed(url)
        onUpdate({ title: meta.title, thumbnailUrl: meta.thumbnail_url })
      } else {
        onUpdate({ title: `${VIDEO_PLATFORM_LABELS[detectedPlatform]} Video`, thumbnailUrl: "" })
      }
    } catch {
      if (detectedPlatform === "youtube") {
        onUpdate({ title: "", thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` })
      } else {
        onUpdate({ title: `${VIDEO_PLATFORM_LABELS[detectedPlatform]} Video`, thumbnailUrl: "" })
      }
    } finally {
      setLoading(false)
    }
  }, [onUpdate])

  const handleDownload = useCallback(async () => {
    const url = data.youtubeUrl?.trim()
    if (!url) return
    onUpdate({
      downloadStatus: "downloading",
      downloadPercent: 0,
      downloadError: "",
      downloadedVideoUrl: "",
      downloadedThumbnailUrl: "",
    })
    try {
      const { downloadId } = await startVideoDownload(url)
      subscribeToDownloadProgress(downloadId, (event: DownloadProgressEvent) => {
        if (event.phase === "completed" && event.videoUrl) {
          onUpdate({
            downloadedVideoUrl: event.videoUrl,
            downloadedThumbnailUrl: event.thumbnailUrl ?? "",
            downloadStatus: "completed",
            downloadPercent: 100,
            thumbnailUrl: event.thumbnailUrl ?? data.thumbnailUrl,
          })
        } else if (event.phase === "failed") {
          onUpdate({
            downloadStatus: "failed",
            downloadError: event.error ?? "Download failed",
            downloadPercent: 0,
          })
        } else {
          onUpdate({ downloadPercent: event.percent, downloadPhase: event.phase })
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed"
      onUpdate({
        downloadStatus: "failed",
        downloadError: message,
        downloadPercent: 0,
      })
    }
  }, [data.youtubeUrl, data.thumbnailUrl, onUpdate])

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="video-url">Video URL</Label>
        <Input
          id="video-url"
          value={data.youtubeUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="YouTube, Facebook, TikTok, Instagram, or X URL"
        />
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Fetching metadata...</span>
        </div>
      )}
      {!loading && displayThumbnail && (
        <div className="rounded-md overflow-hidden">
          <CachedImage
            src={displayThumbnail}
            alt={data.title || "Video"}
            className="w-full rounded-md"
            thumbnail
            thumbnailWidth={480}
          />
        </div>
      )}
      {data.title && (
        <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
          <span className="font-medium">Title:</span> {data.title}
        </div>
      )}

      {/* Download status for non-YouTube platforms */}
      {!loading && data.videoId && !isYouTube && (
        <div className="flex flex-col gap-2">
          {/* Download button - show when idle or failed */}
          {(downloadStatus === "idle" || downloadStatus === "failed") && (
            <>
              {downloadStatus === "failed" && data.downloadError && (
                <div className="flex items-center gap-1.5 p-2 rounded-md bg-red-500/10 text-red-500 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="line-clamp-2">{data.downloadError}</span>
                </div>
              )}
              <Button
                size="sm"
                onClick={handleDownload}
                className="w-full bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                {downloadStatus === "failed" ? "Retry Download" : "Download Video"}
              </Button>
            </>
          )}

          {/* Downloading state with progress */}
          {isDownloading && (
            <div className="flex flex-col gap-1.5 p-2 bg-muted/30 rounded-md">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#ff0073]" />
                <span>{data.downloadPhase === "uploading" ? "Uploading..." : data.downloadPhase === "processing" ? "Processing..." : "Downloading video..."}</span>
                <span className="ml-auto font-mono text-[#ff0073]">{data.downloadPercent ?? 0}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-muted-foreground/20 overflow-hidden">
                <div
                  className="h-full bg-[#ff0073] rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${data.downloadPercent ?? 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Completed state */}
          {downloadStatus === "completed" && (
            <div className="flex items-center gap-2 text-xs text-green-500 p-2 bg-green-500/10 rounded-md">
              <Check className="w-3.5 h-3.5" />
              <span>Downloaded and ready</span>
            </div>
          )}
        </div>
      )}

      {/* YouTube direct streaming badge */}
      {!loading && data.videoId && isYouTube && (
        <div className="flex items-center gap-2 text-xs text-green-500 p-2 bg-green-500/10 rounded-md">
          <Check className="w-3.5 h-3.5" />
          <span>Direct streaming</span>
        </div>
      )}
    </div>
  )
}

function ReferenceAudioConfig({ data, onUpdate }: ConfigProps<ReferenceAudioData>) {
  const [extracting, setExtracting] = useState(false)
  const [fetchingMeta, setFetchingMeta] = useState(false)

  const handleYouTubeUrlChange = useCallback(async (url: string) => {
    onUpdate({ youtubeUrl: url })
    if (!url.trim()) return
    try {
      const parsed = new URL(url)
      if (!parsed.hostname.includes("youtube.com") && !parsed.hostname.includes("youtu.be")) return
    } catch {
      return
    }
    setFetchingMeta(true)
    try {
      const meta = await fetchYouTubeOEmbed(url)
      onUpdate({ videoTitle: meta.title, videoThumbnail: meta.thumbnail_url })
    } catch {
      // ignore metadata fetch errors
    } finally {
      setFetchingMeta(false)
    }
  }, [onUpdate])

  const handleExtract = useCallback(async () => {
    const url = data.youtubeUrl?.trim()
    if (!url) return
    setExtracting(true)
    onUpdate({ extractionStatus: "extracting" })
    try {
      const { jobId } = await extractYouTubeAudioApi(url)
      // Poll for completion
      const poll = async (): Promise<string> => {
        const status = await getJobStatus(jobId)
        if (status.status === "completed" && status.output_data?.audioUrl) {
          return status.output_data.audioUrl
        }
        if (status.status === "failed") {
          throw new Error(status.error_message ?? "Extraction failed")
        }
        await new Promise((r) => setTimeout(r, 2000))
        return poll()
      }
      const audioUrl = await poll()
      onUpdate({ extractedAudioUrl: audioUrl, extractionStatus: "ready" })
    } catch {
      onUpdate({ extractionStatus: "failed" })
    } finally {
      setExtracting(false)
    }
  }, [data.youtubeUrl, onUpdate])

  const handleFileUpload = useCallback(async (file: File) => {
    setExtracting(true)
    onUpdate({ extractionStatus: "extracting" })
    try {
      const result = await uploadAudio(file)
      onUpdate({ uploadedFileUrl: result.url, extractedAudioUrl: result.url, extractionStatus: "ready" })
    } catch {
      onUpdate({ extractionStatus: "failed" })
    } finally {
      setExtracting(false)
    }
  }, [onUpdate])

  const handleDirectUrlSet = useCallback(() => {
    const url = data.directUrl?.trim()
    if (url) {
      onUpdate({ extractedAudioUrl: url, extractionStatus: "ready" })
    }
  }, [data.directUrl, onUpdate])

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Source</Label>
        <Select
          value={data.sourceType || "youtube"}
          onValueChange={(v) => onUpdate({ sourceType: v as ReferenceAudioData["sourceType"], extractedAudioUrl: "", extractionStatus: "idle", videoTitle: "", videoThumbnail: "" })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="youtube">YouTube</SelectItem>
            <SelectItem value="upload">Upload File</SelectItem>
            <SelectItem value="url">Direct URL</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(data.sourceType === "youtube" || !data.sourceType) && (
        <div className="flex flex-col gap-2">
          <div>
            <Label htmlFor="yt-url">YouTube URL</Label>
            <Input
              id="yt-url"
              value={data.youtubeUrl || ""}
              onChange={(e) => handleYouTubeUrlChange(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
            />
          </div>
          {fetchingMeta && <p className="text-xs text-muted-foreground">Fetching video info...</p>}
          {data.videoThumbnail && (
            <div className="rounded-md overflow-hidden bg-muted border border-border">
              <CachedImage src={data.videoThumbnail} alt="" className="w-full aspect-video object-cover" thumbnail thumbnailWidth={480} />
              {data.videoTitle && <p className="text-xs px-2 py-1.5 truncate text-foreground">{data.videoTitle}</p>}
            </div>
          )}
          <Button
            size="sm"
            onClick={handleExtract}
            disabled={extracting || !data.youtubeUrl?.trim()}
          >
            {extracting ? "Extracting..." : "Extract Audio"}
          </Button>
        </div>
      )}

      {data.sourceType === "upload" && (
        <div className="flex flex-col gap-2">
          <Label>Audio File</Label>
          <Input
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileUpload(file)
            }}
          />
          {extracting && <p className="text-xs text-muted-foreground">Uploading...</p>}
        </div>
      )}

      {data.sourceType === "url" && (
        <div className="flex flex-col gap-2">
          <div>
            <Label htmlFor="direct-url">Audio URL</Label>
            <Input
              id="direct-url"
              value={data.directUrl || ""}
              onChange={(e) => onUpdate({ directUrl: e.target.value })}
              placeholder="https://example.com/audio.mp3"
            />
          </div>
          <Button size="sm" onClick={handleDirectUrlSet} disabled={!data.directUrl?.trim()}>
            Set URL
          </Button>
        </div>
      )}

      {data.extractionStatus === "ready" && data.extractedAudioUrl && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-green-600">Audio ready</p>
          <audio src={data.extractedAudioUrl} controls className="w-full h-8" />
        </div>
      )}
      {data.extractionStatus === "failed" && (
        <p className="text-xs text-red-500">Extraction failed. Try again.</p>
      )}
    </div>
  )
}

/* ── Parameter Node Configs ── */

function ToneConfig({ data, onUpdate }: ConfigProps<ToneData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="tone-value">Tone</Label>
        <Input
          id="tone-value"
          value={data.tone}
          onChange={(e) => onUpdate({ tone: e.target.value })}
          placeholder="e.g. dramatic, playful, dark"
        />
      </div>
    </div>
  )
}

function StyleGuideConfig({ data, onUpdate }: ConfigProps<StyleGuideData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="style-text">Style Description</Label>
        <Textarea
          id="style-text"
          rows={3}
          value={data.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder="e.g. Studio Ghibli watercolor..."
        />
      </div>
    </div>
  )
}

function ProviderConfig({ data, onUpdate }: ConfigProps<ProviderData>) {
  const category = data.category as ProviderCategory
  const providers = getProviders(category)
  const models = getModels(category, data.provider)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Category</Label>
        <Select
          value={data.category}
          onValueChange={(v) => {
            const cat = v as ProviderCategory
            const firstProvider = getFirstProvider(cat)
            const firstModel = getFirstModel(cat, firstProvider)
            onUpdate({ category: cat, provider: firstProvider, model: firstModel })
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="image">Image</SelectItem>
            <SelectItem value="video">Video</SelectItem>
            <SelectItem value="voice">Voice</SelectItem>
            <SelectItem value="script">Script</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider}
          onValueChange={(v) => {
            const firstModel = getFirstModel(category, v)
            onUpdate({ provider: v, model: firstModel })
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>{getProviderLabel(category, p)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Model</Label>
        <Select
          value={data.model}
          onValueChange={(v) => onUpdate({ model: v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function SceneCountConfig({ data, onUpdate }: ConfigProps<SceneCountData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="scene-count-val">Number of Scenes</Label>
        <Input
          id="scene-count-val"
          type="number"
          min={1}
          max={20}
          value={data.count}
          onChange={(e) => onUpdate({ count: parseInt(e.target.value, 10) || 5 })}
        />
      </div>
    </div>
  )
}

function DurationConfig({ data, onUpdate }: ConfigProps<DurationData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="duration-seconds">Duration (seconds)</Label>
        <Input
          id="duration-seconds"
          type="number"
          min={1}
          max={600}
          value={data.seconds}
          onChange={(e) => onUpdate({ seconds: parseInt(e.target.value, 10) || 60 })}
        />
      </div>
    </div>
  )
}

function AspectRatioConfig({ data, onUpdate }: ConfigProps<AspectRatioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Aspect Ratio</Label>
        <Select
          value={data.ratio}
          onValueChange={(v) => onUpdate({ ratio: v as AspectRatioData["ratio"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1:1">1:1 (Square)</SelectItem>
            <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
            <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
            <SelectItem value="4:3">4:3</SelectItem>
            <SelectItem value="4:5">4:5</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function MotionConfig({ data, onUpdate }: ConfigProps<MotionData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Motion</Label>
        <Select
          value={data.motion}
          onValueChange={(v) => onUpdate({ motion: v as MotionData["motion"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="subtle">Subtle</SelectItem>
            <SelectItem value="moderate">Moderate</SelectItem>
            <SelectItem value="dynamic">Dynamic</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function CameraMotionConfig({ data, onUpdate }: ConfigProps<CameraMotionData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Camera Motion</Label>
        <Select
          value={data.cameraMotion}
          onValueChange={(v) => onUpdate({ cameraMotion: v as CameraMotionData["cameraMotion"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="static">Static</SelectItem>
            <SelectItem value="pan-left">Pan Left</SelectItem>
            <SelectItem value="pan-right">Pan Right</SelectItem>
            <SelectItem value="zoom-in">Zoom In</SelectItem>
            <SelectItem value="zoom-out">Zoom Out</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

/* ── AI Node Configs ── */

function GenerateScriptConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<GenerateScriptData>) {
  const [copied, setCopied] = useState(false)
  const script = data.generatedScript
  const results = data.generatedResults ?? []
  const activeIndex = data.activeResultIndex ?? 0

  function updateScene(sceneIndex: number, field: keyof ScriptScene, value: string | number) {
    if (!script) return
    const updatedScenes = script.scenes.map((s, i) =>
      i === sceneIndex ? { ...s, [field]: value } : s,
    )
    const updatedScript: GeneratedScript = { ...script, scenes: updatedScenes }
    const updatedResults = results.map((r, i) =>
      i === activeIndex ? { ...r, script: updatedScript } : r,
    )
    onUpdate({ generatedScript: updatedScript, generatedResults: updatedResults })
  }

  function handleCopyImagePrompts() {
    if (!script) return
    const text = script.scenes.map((s) => s.imagePrompt).join("\n\n")
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="script">
        <Select
          value={data.provider || "gemini"}
          onValueChange={(v) => onUpdate({ provider: v as GenerateScriptData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="gemini">Gemini Flash (default)</SelectItem>
            <SelectItem value="claude">Claude</SelectItem>
            <SelectItem value="gpt">GPT</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="sceneCount" label="Number of Scenes" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={1}
          max={20}
          value={data.sceneCount}
          onChange={(e) => onUpdate({ sceneCount: parseInt(e.target.value, 10) || 5 })}
        />
      </MappableField>
      <div>
        <Label>Structure</Label>
        <Select
          value={data.structure}
          onValueChange={(v) => onUpdate({ structure: v as GenerateScriptData["structure"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="freeform">Freeform</SelectItem>
            <SelectItem value="8-step">8-Step Story</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <MappableField field="styleGuide" label="Style Guide" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.styleGuide}
          onChange={(e) => onUpdate({ styleGuide: e.target.value })}
          placeholder="e.g. children's book illustration, watercolor..."
        />
      </MappableField>
      <MappableField field="tone" label="Tone" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.tone}
          onChange={(e) => onUpdate({ tone: e.target.value })}
          placeholder="e.g. whimsical, dramatic, educational"
        />
      </MappableField>
      <MappableField field="targetLength" label="Target Length (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={10}
          max={600}
          value={data.targetLength}
          onChange={(e) => onUpdate({ targetLength: parseInt(e.target.value, 10) || 60 })}
        />
      </MappableField>

      {script && (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Generated Script</Label>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleCopyImagePrompts}
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied" : "Copy Prompts"}
              </Button>
            </div>

            <div>
              <Label className="text-xs">Title</Label>
              <Input
                value={script.title}
                onChange={(e) => {
                  const updatedScript = { ...script, title: e.target.value }
                  const updatedResults = results.map((r, i) =>
                    i === activeIndex ? { ...r, script: updatedScript } : r,
                  )
                  onUpdate({ generatedScript: updatedScript, generatedResults: updatedResults })
                }}
              />
            </div>

            <div className="text-xs text-muted-foreground">
              {script.scenes.length} scenes / {script.totalDuration}s total
            </div>

            <Accordion type="single" collapsible className="w-full">
              {script.scenes.map((scene, i) => (
                <AccordionItem key={scene.sceneNumber} value={`scene-${i}`}>
                  <AccordionTrigger className="text-xs py-2 hover:no-underline">
                    <span className="text-left truncate pr-2">
                      Scene {scene.sceneNumber}: {scene.action.slice(0, 40)}{scene.action.length > 40 ? "..." : ""}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-2 pt-1">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Visual Description</Label>
                        <Textarea
                          rows={3}
                          className="text-xs"
                          value={scene.visualDescription}
                          onChange={(e) => updateScene(i, "visualDescription", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Action</Label>
                        <Textarea
                          rows={2}
                          className="text-xs"
                          value={scene.action}
                          onChange={(e) => updateScene(i, "action", e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Mood</Label>
                          <Input
                            className="text-xs h-7"
                            value={Array.isArray(scene.mood) ? scene.mood.join(", ") : scene.mood}
                            onChange={(e) => updateScene(i, "mood", e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Duration (s)</Label>
                          <Input
                            type="number"
                            className="text-xs h-7"
                            min={1}
                            max={120}
                            value={scene.durationHint}
                            onChange={(e) => updateScene(i, "durationHint", parseInt(e.target.value, 10) || 5)}
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Image Prompt (for Generate Image)</Label>
                        <Textarea
                          rows={3}
                          className="text-xs"
                          value={scene.imagePrompt}
                          onChange={(e) => updateScene(i, "imagePrompt", e.target.value)}
                        />
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </>
      )}
    </div>
  )
}

const IMAGE_GEN_MODELS = [
  { value: "nano-banana", label: "Nano Banana", desc: "Fast drafts, iteration, storyboards" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production-ready images" },
  { value: "grok", label: "Grok", desc: "Creative and stylized imagery" },
  { value: "flux", label: "Flux", desc: "Photorealistic, highest quality output" },
  { value: "gpt-image", label: "GPT Image", desc: "Text rendering, complex compositions" },
] as const

const IMAGE_I2I_MODELS = [
  { value: "nano-banana", label: "Nano Banana", desc: "Fast iteration, quick transforms" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production images" },
  { value: "grok-i2i", label: "Grok", desc: "Creative and stylized imagery" },
  { value: "flux-i2i", label: "Flux-2", desc: "Style-faithful transformations" },
  { value: "flux-pro-i2i", label: "Flux-2 Pro", desc: "Premium quality image transforms" },
  { value: "gpt-image-i2i", label: "GPT Image", desc: "Text rendering, complex compositions" },
] as const

const VIDEO_I2V_MODELS = [
  { value: "minimax", label: "MiniMax", desc: "Fast, reliable 5s clips" },
  { value: "veo3", label: "VEO 3", desc: "Top quality, 8s with audio" },
  { value: "veo3.1", label: "VEO 3.1 (Fast)", desc: "Fast VEO, 8s with audio" },
  { value: "kling", label: "Kling", desc: "Versatile, 5-10s clips" },
  { value: "kling-turbo", label: "Kling Turbo", desc: "Fast generation, end frame support" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Latest Kling, 3-15s variable duration" },
  { value: "veo", label: "VEO 2", desc: "Previous gen VEO" },
  { value: "grok-i2v", label: "Grok", desc: "Creative, stylized motion" },
  { value: "sora2-pro", label: "Sora 2 Pro", desc: "Cinematic, high fidelity" },
  { value: "runway", label: "Runway", desc: "Smooth motion, via Replicate" },
  { value: "pika", label: "Pika", desc: "Stylized animation, via Replicate" },
  { value: "sora", label: "Sora", desc: "Legacy Sora, via Replicate" },
] as const

const VIDEO_T2V_MODELS = [
  { value: "minimax", label: "MiniMax", desc: "Fast, reliable 5s clips" },
  { value: "veo3", label: "VEO 3", desc: "Top quality, 8s with audio" },
  { value: "kling", label: "Kling", desc: "Versatile, 5-10s clips" },
  { value: "kling-turbo", label: "Kling Turbo", desc: "Fast generation, 5-10s" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Latest Kling, 3-15s variable duration" },
  { value: "veo", label: "VEO 2", desc: "Previous gen VEO" },
  { value: "grok", label: "Grok", desc: "Creative, stylized motion" },
  { value: "sora2-pro", label: "Sora 2 Pro", desc: "Cinematic, high fidelity" },
  { value: "runway", label: "Runway", desc: "Smooth motion, via Replicate" },
  { value: "pika", label: "Pika", desc: "Stylized animation, via Replicate" },
  { value: "sora", label: "Sora", desc: "Legacy Sora, via Replicate" },
] as const

function ModelSelectOption({ value, label, desc }: { value: string; label: string; desc: string }) {
  const credits = useModelCredits(value)
  return (
    <SelectItemWithMeta
      value={value}
      badge={credits > 0 ? `${credits} CR` : undefined}
      description={desc}
    >
      {label}
    </SelectItemWithMeta>
  )
}

function GenerateImageConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<GenerateImageData>) {
  useEffect(() => { prefetchModelCredits(IMAGE_GEN_MODELS.map((m) => m.value)) }, [])
  const [showAssetLibrary, setShowAssetLibrary] = useState(false)
  const [showDefineNewMenu, setShowDefineNewMenu] = useState(false)
  const refImageInputRef = useRef<HTMLInputElement>(null)
  const [uploadingRefImage, setUploadingRefImage] = useState(false)
  const allCharDefs = useWorkflowStore((s) => s.characterDefinitions)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const addNode = useWorkflowStore((s) => s.addNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const nodes = useWorkflowStore((s) => s.nodes)
  const attachedIds = data.characterDefinitionIds ?? []
  const attachedChars = allCharDefs.filter((c) => attachedIds.includes(c.id))

  function detachCharacter(id: string) {
    onUpdate({ characterDefinitionIds: attachedIds.filter((cid) => cid !== id) })
  }

  function handleDefineNewAsset(assetType: "character" | "object" | "location") {
    // Calculate position for new node (to the right of existing nodes)
    const maxX = nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.x)) + 300 : 200
    const avgY = nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length : 200

    // Add new node to canvas
    const newNodeId = addNode(assetType, { x: maxX, y: avgY })

    if (newNodeId) {
      // Select the new node to open its settings panel
      selectNode(newNodeId)
    }

    setShowDefineNewMenu(false)
  }

  function handleAssetSelected(asset: SelectedAsset) {
    // Convert selected database asset to CharacterDefinition format
    const charDef: CharacterDefinition = {
      id: asset.id,
      name: asset.name,
      type: asset.thumbnailUrl ? "reference" : "description",
      category: asset.type,
      referenceImageUrl: asset.thumbnailUrl,
      description: asset.description,
    }

    // Add to workflow characterDefinitions if not already there
    const exists = allCharDefs.some((c) => c.id === asset.id)
    if (!exists) {
      addCharacterDefinition(charDef)
    }

    // Attach to this node
    if (!attachedIds.includes(asset.id)) {
      onUpdate({ characterDefinitionIds: [...attachedIds, asset.id] })
    }
  }

  async function handleRefImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingRefImage(true)
    try {
      const { url } = await uploadImage(file)
      onUpdate({ referenceImageUrl: url })
    } catch {
      // error already thrown by uploadImage
    } finally {
      setUploadingRefImage(false)
      if (refImageInputRef.current) refImageInputRef.current.value = ""
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe the image to generate..."
        />
      </MappableField>

      {/* Reference Image */}
      <div>
        <Label className="text-xs">Reference Image</Label>
        <p className="text-[10px] text-muted-foreground mb-1">
          Upload an image to use as visual reference for generation.
        </p>
        {data.referenceImageUrl ? (
          <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
            <CachedImage
              src={data.referenceImageUrl}
              alt="Reference"
              className="w-10 h-10 rounded object-cover flex-shrink-0"
              thumbnail
              thumbnailWidth={80}
            />
            <span className="text-xs text-muted-foreground truncate flex-1">Reference image</span>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-6 w-6"
              onClick={() => onUpdate({ referenceImageUrl: undefined })}
              title="Remove reference image"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <Input
              value=""
              onChange={(e) => {
                if (e.target.value.trim()) onUpdate({ referenceImageUrl: e.target.value.trim() })
              }}
              placeholder="https://... or upload"
              className="flex-1"
            />
            <input
              ref={refImageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleRefImageUpload}
            />
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 h-9 w-9"
              disabled={uploadingRefImage}
              onClick={() => refImageInputRef.current?.click()}
              title="Upload reference image"
            >
              {uploadingRefImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            </Button>
          </div>
        )}
      </div>

      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="image">
        <Select
          value={data.provider || "nano-banana"}
          onValueChange={(v) => onUpdate({ provider: v as GenerateImageData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {IMAGE_GEN_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.aspectRatio}
          onValueChange={(v) => onUpdate({ aspectRatio: v as GenerateImageData["aspectRatio"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1:1">1:1 (Square)</SelectItem>
            <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
            <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
            <SelectItem value="4:3">4:3</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="style" label="Style" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.style}
          onChange={(e) => onUpdate({ style: e.target.value })}
          placeholder="e.g. children-book, photorealistic"
        />
      </MappableField>
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={2}
          value={data.negativePrompt}
          onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
          placeholder="Things to avoid..."
        />
      </MappableField>

      {/* Assets section (characters, locations, objects) */}
      <div className="pt-1">
        <Separator className="mb-3" />
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assets</label>
        <div className="flex flex-col gap-1.5 mt-2">
          {attachedChars.map((char) => (
            <div key={char.id} className="flex items-start gap-2 p-2 rounded-md border bg-muted/30">
              {char.referenceImageUrl ? (
                <CachedImage src={char.referenceImageUrl} alt={char.name} className="w-8 h-8 rounded object-cover flex-shrink-0" thumbnail thumbnailWidth={80} />
              ) : (
                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium truncate">{char.name}</span>
                  <span className={`text-[9px] px-1 py-0.5 rounded ${
                    char.category === "location" ? "bg-cyan-500/10 text-cyan-500"
                    : char.category === "object" ? "bg-emerald-500/10 text-emerald-500"
                    : char.referenceImageUrl ? "bg-blue-500/10 text-blue-500"
                    : "bg-orange-500/10 text-orange-500"
                  }`}>
                    {char.category === "location" ? "location" : char.category === "object" ? "object" : char.referenceImageUrl ? "ref" : "desc"}
                  </span>
                  {char.type === "description" && !char.referenceImageUrl && (
                    <span className="text-[8px] text-orange-500" title="Needs reference image for reuse">needs ref</span>
                  )}
                </div>
                {char.type === "description" && char.description && (
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{char.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => detachCharacter(char.id)}
                className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {attachedChars.length === 0 && (
            <p className="text-[10px] text-muted-foreground/60">No assets attached. Add characters, locations, or objects for visual consistency.</p>
          )}
        </div>

        {/* Add buttons */}
        <div className="flex gap-1.5 mt-2">
          <button
            type="button"
            onClick={() => setShowAssetLibrary(true)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-muted transition-colors"
          >
            <Plus className="w-3 h-3" /> Add from Library
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDefineNewMenu(!showDefineNewMenu)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-muted transition-colors"
            >
              <UserPlus className="w-3 h-3" /> Create new
            </button>
            {showDefineNewMenu && (
              <div className="absolute top-full left-0 mt-1 w-36 rounded-md border bg-popover shadow-md z-30">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-pink-500/10 transition-colors flex items-center gap-2"
                  onClick={() => handleDefineNewAsset("character")}
                >
                  <UserCircle className="w-4 h-4 text-pink-500" />
                  <span>Character</span>
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-emerald-500/10 transition-colors flex items-center gap-2"
                  onClick={() => handleDefineNewAsset("object")}
                >
                  <Package className="w-4 h-4 text-emerald-500" />
                  <span>Object</span>
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-cyan-500/10 transition-colors flex items-center gap-2"
                  onClick={() => handleDefineNewAsset("location")}
                >
                  <MapPin className="w-4 h-4 text-cyan-500" />
                  <span>Location</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showAssetLibrary && (
        <Suspense fallback={null}>
          <AssetSelectionModal
            isOpen={showAssetLibrary}
            onClose={() => setShowAssetLibrary(false)}
            onSelect={handleAssetSelected}
            title="Select Asset from Library"
            excludeIds={attachedIds}
          />
        </Suspense>
      )}
    </div>
  )
}

function EditImageConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<EditImageData>) {
  const showPrompt = data.provider === "nano-banana-edit"

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Operation" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.provider || "recraft-upscale"}
          onValueChange={(v) => onUpdate({ provider: v as EditImageData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="recraft-upscale">Upscale / Enhance</SelectItem>
            <SelectItem value="recraft-remove-bg">Remove Background</SelectItem>
            <SelectItem value="nano-banana-edit">Edit with Prompt</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      {showPrompt && (
        <MappableField field="prompt" label="Edit Instructions" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Textarea
            rows={3}
            value={data.prompt}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            placeholder="Describe how to edit the image..."
          />
        </MappableField>
      )}
      {!showPrompt && (
        <p className="text-xs text-muted-foreground px-1">
          {data.provider === "recraft-upscale"
            ? "Upscale and enhance the input image to higher resolution."
            : "Remove the background from the input image, leaving a transparent PNG."}
        </p>
      )}
    </div>
  )
}

function ImageToImageConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<ImageToImageData>) {
  useEffect(() => { prefetchModelCredits(IMAGE_I2I_MODELS.map((m) => m.value)) }, [])
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.provider || "nano-banana"}
          onValueChange={(v) => onUpdate({ provider: v as ImageToImageData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {IMAGE_I2I_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="prompt" label="Transformation Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe how to transform the input image..."
        />
      </MappableField>
      <p className="text-xs text-muted-foreground px-1">
        Transform the input image based on your prompt while maintaining the core composition.
      </p>
    </div>
  )
}

// Kling 3.0 supports continuous durations from 3s to 15s
const KLING3_DURATIONS = Array.from({ length: 13 }, (_, i) => i + 3)

// KIE.ai allowed durations per video provider
const KIE_VIDEO_DURATIONS: Record<string, number[]> = {
  "minimax": [5],
  "veo3": [8],
  "veo3.1": [8],
  "kling": [5, 10],
  "kling-turbo": [5, 10],
  "kling-3.0": KLING3_DURATIONS,
  "grok-i2v": [10],
  "sora2-pro": [5, 10],
}

// Providers that support start + end frame (2 images → video)
// Note: This applies to both KIE and Replicate modes
const PROVIDERS_WITH_END_FRAME: string[] = [
  "minimax",     // KIE: end_image_url parameter
  "veo3",        // KIE: imageUrls array with 2 images
  "veo3.1",      // KIE: imageUrls array with 2 images
  "kling-turbo", // KIE: tail_image_url parameter
  "kling-3.0",   // KIE: image_urls array with 2 images
  "runway",      // Replicate
  "pika",        // Replicate
]

// ─── Kling 3.0 Studio Config (3-tab interface) ────────────────────────────

type Kling3Tab = "scene" | "shots" | "elements"

function Kling3StudioConfig({ data, onUpdate, sources, fieldMappings, onMapField, onUpdateNode }: ConfigProps<ImageToVideoData>) {
  useEffect(() => { prefetchModelCredits(VIDEO_I2V_MODELS.map((m) => m.value)) }, [])
  const { user } = useAuth()
  const allNodes = useWorkflowStore((s) => s.nodes)
  const [activeTab, setActiveTab] = useState<Kling3Tab>("scene")
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  const [workflowDropdownIndex, setWorkflowDropdownIndex] = useState<number | null>(null)
  const [copiedName, setCopiedName] = useState<string | null>(null)
  const workflowDropdownRef = useRef<HTMLDivElement | null>(null)
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const elementNameRefs = useRef<Record<number, HTMLInputElement | null>>({})

  const supportsEndFrame = PROVIDERS_WITH_END_FRAME.includes(data.provider || "minimax")

  // Connected text prompts
  const connectedTextPrompts = useMemo(() => {
    return sources.filter((s) => s.type === "text-prompt").map((s) => ({
      id: s.id,
      label: s.label,
      text: (s.nodeData?.text as string) || "",
      targetHandle: s.targetHandle,
    }))
  }, [sources])

  // Connected images
  const connectedImages = useMemo(() => {
    const imageTypes = ["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"]
    return sources.filter((s) => imageTypes.includes(s.type)).map((s) => {
      let imageUrl: string | undefined
      const nodeData = s.nodeData || {}
      if (s.type === "upload-image") {
        imageUrl = (nodeData.url as string) || undefined
      } else if (s.type === "generate-image" || s.type === "edit-image" || s.type === "image-to-image" || s.type === "scene") {
        const results = nodeData.generatedResults as Array<{ url?: string }> | undefined
        const activeIndex = (nodeData.activeResultIndex as number) ?? 0
        if (results && results.length > 0) {
          imageUrl = results[activeIndex]?.url || results[0]?.url
        }
        if (!imageUrl) {
          imageUrl = (nodeData.generatedImageUrl as string) || undefined
        }
      } else if (s.type === "character" || s.type === "object" || s.type === "location") {
        imageUrl = (nodeData.sourceImageUrl as string) || undefined
      }
      let displayLabel = s.label
      if (s.targetHandle === "startFrame") displayLabel = `Start: ${s.label}`
      else if (s.targetHandle === "endFrame") displayLabel = `End: ${s.label}`
      return { id: s.id, type: s.type, label: displayLabel, imageUrl, targetHandle: s.targetHandle }
    })
  }, [sources])

  const handleTextPromptChange = useCallback((nodeId: string, newText: string) => {
    if (onUpdateNode) onUpdateNode(nodeId, { text: newText })
  }, [onUpdateNode])

  // ── Shot helpers ──
  const shots = data.shots ?? []
  const totalDuration = shots.reduce((sum, s) => sum + s.duration, 0)

  const handleAddShot = useCallback(() => {
    onUpdate({ shots: [...shots, { prompt: "", duration: 3 }] })
  }, [shots, onUpdate])

  const handleRemoveShot = useCallback((index: number) => {
    onUpdate({ shots: shots.filter((_, i) => i !== index) })
  }, [shots, onUpdate])

  const handleUpdateShot = useCallback((index: number, field: "prompt" | "duration", value: string | number) => {
    onUpdate({ shots: shots.map((s, i) => i === index ? { ...s, [field]: value } : s) })
  }, [shots, onUpdate])

  const handleMoveShot = useCallback((index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= shots.length) return
    const next = [...shots]
    const temp = next[index]
    next[index] = next[target]!
    next[target] = temp!
    onUpdate({ shots: next })
  }, [shots, onUpdate])

  // ── Element helpers ──
  const elements = data.elements ?? []

  const handleAddElement = useCallback(() => {
    onUpdate({ elements: [...elements, { name: "", description: "", type: "image" as const, urls: [] }] })
  }, [elements, onUpdate])

  const handleRemoveElement = useCallback((index: number) => {
    onUpdate({ elements: elements.filter((_, i) => i !== index) })
  }, [elements, onUpdate])

  const handleUpdateElement = useCallback((index: number, field: string, value: unknown) => {
    onUpdate({ elements: elements.map((el, i) => i === index ? { ...el, [field]: value } : el) })
  }, [elements, onUpdate])

  const handleRemoveElementUrl = useCallback((elementIndex: number, urlIndex: number) => {
    onUpdate({
      elements: elements.map((el, i) =>
        i === elementIndex ? { ...el, urls: el.urls.filter((_, ui) => ui !== urlIndex) } : el
      ),
    })
  }, [elements, onUpdate])

  const handleElementUpload = useCallback(async (elementIndex: number, file: File) => {
    setUploadingIndex(elementIndex)
    try {
      const result = await uploadFile(file, user?.id)
      const detectedType = file.type.startsWith("video/") ? "video" as const : "image" as const
      onUpdate({
        elements: elements.map((el, i) =>
          i === elementIndex
            ? { ...el, urls: [...el.urls, result.url], type: el.urls.length === 0 ? detectedType : el.type }
            : el
        ),
      })
    } catch (err) {
      console.error("[Kling3Elements] Upload failed:", err)
    } finally {
      setUploadingIndex(null)
    }
  }, [elements, onUpdate, user?.id])

  // Image-outputting node types for "From Workflow" picker
  const IMAGE_NODE_TYPES = useMemo(() => new Set([
    "generate-image", "upload-image", "scene", "character", "object", "location", "edit-image", "image-to-image",
  ]), [])

  const workflowImageNodes = useMemo(() => {
    return allNodes
      .filter((n) => IMAGE_NODE_TYPES.has(String(n.type ?? "")))
      .map((n) => {
        const nd = n.data as Record<string, unknown>
        const results = nd.generatedResults as Array<{ url?: string }> | undefined
        const activeIdx = (nd.activeResultIndex as number) ?? 0
        const thumbUrl =
          results?.[activeIdx]?.url ??
          (nd.generatedImageUrl as string | undefined) ??
          (nd.url as string | undefined) ??
          (nd.portraitUrl as string | undefined) ??
          (nd.mainImageUrl as string | undefined)
        return { id: n.id, type: String(n.type), label: (nd.label as string) ?? String(n.type), thumbUrl }
      })
  }, [allNodes, IMAGE_NODE_TYPES])

  const handleAddFromWorkflow = useCallback((elementIndex: number, url: string) => {
    onUpdate({
      elements: elements.map((el, i) =>
        i === elementIndex ? { ...el, urls: [...el.urls, url] } : el
      ),
    })
    setWorkflowDropdownIndex(null)
  }, [elements, onUpdate])

  // Close workflow dropdown on outside click
  useEffect(() => {
    if (workflowDropdownIndex === null) return
    const handleClickOutside = (e: MouseEvent) => {
      if (workflowDropdownRef.current && !workflowDropdownRef.current.contains(e.target as Node)) {
        setWorkflowDropdownIndex(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [workflowDropdownIndex])

  // Auto-focus empty element name input
  useEffect(() => {
    const lastIdx = elements.length - 1
    if (lastIdx >= 0 && elements[lastIdx]?.name === "") {
      elementNameRefs.current[lastIdx]?.focus()
    }
  }, [elements.length])

  // Check if end frame is connected
  const hasEndFrame = connectedImages.some((img) => img.targetHandle === "endFrame")

  // Tab button styling
  const tabClass = (tab: Kling3Tab) =>
    `px-3 py-2 text-xs font-medium transition-colors ${
      activeTab === tab
        ? "border-b-2 border-[#ff0073] text-[#ff0073] font-semibold"
        : "text-muted-foreground hover:text-foreground"
    }`

  return (
    <div className="flex flex-col gap-4">
      {/* Connected Images */}
      {connectedImages.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
            Connected Images ({connectedImages.length})
          </Label>
          <div className="flex flex-col gap-2">
            {connectedImages.map((img) => (
              <div key={img.id} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 dark:text-[#64748B] font-medium w-16 shrink-0 leading-tight truncate" title={img.label}>
                  {img.label}
                </span>
                <div
                  className="flex-1 h-16 rounded-lg border border-border overflow-hidden cursor-pointer hover:ring-2 hover:ring-[#ff0073] transition-all bg-muted/30"
                  onClick={() => img.imageUrl && setLightboxImage(img.imageUrl)}
                  title={`Click to view: ${img.label}`}
                >
                  {img.imageUrl ? (
                    <img src={img.imageUrl} alt={img.label} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Click to view full size</p>
        </div>
      )}

      {/* Connected Text Prompts */}
      {connectedTextPrompts.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
            Motion Prompt (from connected node)
          </Label>
          {connectedTextPrompts.map((prompt, idx) => (
            <div key={`${prompt.id}-${idx}`} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 mb-1">
                <FileText className="w-3 h-3 text-[#ff0073]" />
                <span className="text-[10px] text-[#ff0073] font-medium">{prompt.label}</span>
              </div>
              <Textarea
                value={prompt.text}
                onChange={(e) => handleTextPromptChange(prompt.id, e.target.value)}
                placeholder="Enter motion prompt..."
                rows={3}
                className="text-xs bg-muted/30 border-border resize-none"
              />
            </div>
          ))}
        </div>
      )}

      {/* Manual Motion Prompt */}
      {connectedTextPrompts.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
            Motion Prompt
          </Label>
          <Textarea
            value={data.motionPrompt || ""}
            onChange={(e) => onUpdate({ motionPrompt: e.target.value })}
            placeholder="Describe the overall scene, characters, and setting. Use @name to reference elements. Add dialogue with 'character says ...'"
            rows={3}
            className="text-xs bg-muted/30 border-border resize-none"
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Tip: Connect a Text Prompt node for reusable prompts
          </p>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex border-b border-gray-200 dark:border-[#2D2D2D]">
        <button type="button" className={tabClass("scene")} onClick={() => setActiveTab("scene")}>Scene</button>
        <button type="button" className={tabClass("shots")} onClick={() => setActiveTab("shots")}>Shots</button>
        <button type="button" className={tabClass("elements")} onClick={() => setActiveTab("elements")}>Elements</button>
      </div>

      {/* ═══ SCENE TAB ═══ */}
      {activeTab === "scene" && (
        <div className="flex flex-col gap-4">
          {/* Provider Section */}
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Provider</Label>
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <MappableField field="provider" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
                <Select
                  value={data.provider || "minimax"}
                  onValueChange={(v) => onUpdate({ provider: v as ImageToVideoData["provider"] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VIDEO_I2V_MODELS.map((m) => (
                      <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
                    ))}
                  </SelectContent>
                </Select>
              </MappableField>
            </div>
          </div>

          {/* Generation Settings Section */}
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Generation Settings</Label>
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-1 block">Mode</Label>
                  <Select
                    value={(data as Record<string, unknown>).kling3Mode as string ?? "pro"}
                    onValueChange={(v) => onUpdate({ kling3Mode: v })}
                  >
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="std">Standard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-1 block">Aspect Ratio</Label>
                  <Select
                    value={data.aspectRatio ?? "16:9"}
                    onValueChange={(v) => onUpdate({ aspectRatio: v })}
                  >
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="16:9">16:9</SelectItem>
                      <SelectItem value="9:16">9:16</SelectItem>
                      <SelectItem value="1:1">1:1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2 py-1" title={data.multiShot ? "Sound is required in multi-shot mode" : undefined}>
                <input
                  type="checkbox"
                  id="kling3Sound"
                  checked={data.multiShot ? true : (data as Record<string, unknown>).kling3Sound !== false}
                  onChange={(e) => onUpdate({ kling3Sound: e.target.checked })}
                  disabled={!!data.multiShot}
                  className="rounded border-muted-foreground/40 accent-[#ff0073] disabled:opacity-50"
                />
                <label htmlFor="kling3Sound" className={`text-xs ${data.multiShot ? "text-muted-foreground" : ""}`}>Sound Effects</label>
                {data.multiShot ? (
                  <span className="text-[10px] text-muted-foreground ml-auto italic">Required for multi-shot</span>
                ) : (
                  <span className="text-[10px] text-muted-foreground ml-auto">Lip-sync + SFX</span>
                )}
              </div>

              <div>
                <Label className="text-[10px] text-muted-foreground mb-1 block">Duration</Label>
                {data.multiShot ? (
                  <div className="flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
                    {totalDuration}s (from shots)
                  </div>
                ) : (
                  <Select
                    value={String(data.duration || 5)}
                    onValueChange={(v) => onUpdate({ duration: parseInt(v, 10) })}
                  >
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((d) => (
                        <SelectItem key={d} value={String(d)}>{d}s</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>

          {supportsEndFrame && !data.multiShot && (
            <p className="text-[10px] text-muted-foreground px-1">
              Connect an image node to the &quot;End Frame&quot; handle for start-to-end frame generation.
            </p>
          )}

          <p className="text-[10px] text-muted-foreground/70 px-1 leading-relaxed">
            Kling 3.0 generates cinematic video with native audio, lip-synced dialogue, multi-shot storyboarding, and element references.
          </p>
        </div>
      )}

      {/* ═══ SHOTS TAB ═══ */}
      {activeTab === "shots" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="multiShotToggle"
                  checked={data.multiShot ?? false}
                  onChange={(e) => {
                    const checked = e.target.checked
                    if (checked && shots.length === 0) {
                      onUpdate({ multiShot: true, shots: [{ prompt: "", duration: 3 }] })
                    } else {
                      onUpdate({ multiShot: checked })
                    }
                  }}
                  className="rounded border-muted-foreground/40 accent-[#ff0073]"
                />
                <label htmlFor="multiShotToggle" className="text-xs font-medium">Multi-Shot Mode</label>
              </div>
              {data.multiShot && (
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${totalDuration > 15 ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"}`}>
                  {totalDuration}s / 15s
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Split your video into 2-6 scenes, each with its own prompt and timing.
            </p>
          </div>

          {data.multiShot ? (
            <div className="flex flex-col gap-3">
              {hasEndFrame && (
                <p className="text-[10px] text-amber-500 px-1">End frame is not supported in multi-shot mode.</p>
              )}

              {shots.map((shot, i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-foreground shrink-0">Shot {i + 1}</span>
                    <Select
                      value={String(shot.duration)}
                      onValueChange={(v) => handleUpdateShot(i, "duration", parseInt(v, 10))}
                    >
                      <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, k) => k + 1).map((d) => (
                          <SelectItem key={d} value={String(d)}>{d}s</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => handleMoveShot(i, -1)}
                      disabled={i === 0}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                      title="Move up"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveShot(i, 1)}
                      disabled={i === shots.length - 1}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                      title="Move down"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    {shots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveShot(i)}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-colors"
                        title="Delete shot"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <Textarea
                    value={shot.prompt}
                    onChange={(e) => handleUpdateShot(i, "prompt", e.target.value)}
                    placeholder="Camera angle, action, dialogue... e.g. Close-up, she whispers 'I knew you'd come back.' Soft rain."
                    rows={2}
                    className="text-xs bg-muted/30 border-border resize-none"
                  />
                  {elements.some((el) => el.name.trim()) && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[9px] text-muted-foreground">Reference:</span>
                      {copiedName && <span className="text-[9px] text-green-400 animate-pulse">Copied!</span>}
                      {elements.filter((el) => el.name.trim()).map((el) => (
                        <span
                          key={el.name}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-400 cursor-pointer hover:bg-pink-500/20 transition-colors"
                          title="Click to copy @name"
                          onClick={() => {
                            navigator.clipboard.writeText(`@${el.name}`)
                            setCopiedName(el.name)
                            setTimeout(() => setCopiedName(null), 1500)
                          }}
                        >
                          @{el.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Director Tips */}
              <div className="rounded-xl border border-border bg-gradient-to-br from-[#ff0073]/5 to-purple-500/5 p-3 space-y-1.5">
                <span className="text-[11px] font-semibold text-foreground">Director Tips</span>
                <div className="grid grid-cols-1 gap-1">
                  <span className="text-[10px] text-muted-foreground">Dialogue: character says &quot;...&quot; or whispers &quot;...&quot;</span>
                  <span className="text-[10px] text-muted-foreground">Voice tone: calm, excited, sad, angry, whispering</span>
                  <span className="text-[10px] text-muted-foreground">Camera: dolly zoom, tracking, close-up, wide establishing</span>
                  <span className="text-[10px] text-muted-foreground">Languages: English, Chinese, Japanese, Korean, Spanish</span>
                </div>
              </div>

              {/* Add Shot (dashed) */}
              <button
                type="button"
                onClick={handleAddShot}
                disabled={shots.length >= 6}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-border hover:border-[#ff0073]/50 text-xs text-muted-foreground hover:text-[#ff0073] transition-colors disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add Shot {shots.length < 6 && `(${shots.length}/6)`}
              </button>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/70 px-1">
              Single continuous shot using the master prompt and duration from the Scene tab.
            </p>
          )}
        </div>
      )}

      {/* ═══ ELEMENTS TAB ═══ */}
      {activeTab === "elements" && (
        <div className="flex flex-col gap-4">
          {elements.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-2.5">
              <Users className="w-10 h-10 text-muted-foreground/30" />
              <span className="text-xs font-medium text-foreground">No elements yet</span>
              <p className="text-[10px] text-muted-foreground max-w-[220px] text-center">
                Elements let you create consistent characters and objects across shots.
              </p>
            </div>
          )}

          {elements.map((el, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-3">
              {/* HEADER ROW */}
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-[#ff0073] font-bold shrink-0">@</span>
                <input
                  ref={(ref) => { elementNameRefs.current[i] = ref }}
                  type="text"
                  value={el.name}
                  onChange={(e) => handleUpdateElement(i, "name", e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""))}
                  placeholder="name your character..."
                  className={`h-7 w-28 px-1 text-xs font-medium bg-transparent border-b-2 font-mono outline-none transition-colors ${el.name === "" ? "border-red-500" : "border-[#ff0073]"} focus:border-[#ff0073]`}
                />
                <button
                  type="button"
                  onClick={() => handleUpdateElement(i, "type", el.type === "image" ? "video" : "image")}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors shrink-0 ${
                    el.type === "image"
                      ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                      : "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                  }`}
                >
                  {el.type === "image" ? "Image" : "Video"}
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => handleRemoveElement(i)}
                  className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                  title="Delete element"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* DESCRIPTION */}
              <div>
                <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block">Description</span>
                <input
                  type="text"
                  value={el.description}
                  onChange={(e) => handleUpdateElement(i, "description", e.target.value.slice(0, 100))}
                  maxLength={100}
                  placeholder="Describe appearance, clothing, voice tone... e.g. 'Young woman with red hair, green jacket, confident warm voice'"
                  className="w-full h-8 px-2.5 text-xs rounded-lg border-2 border-border bg-background outline-none focus:border-[#ff0073] transition-colors"
                />
                <span className={`text-[9px] mt-0.5 block text-right ${el.description.length >= 100 ? "text-red-500" : el.description.length > 80 ? "text-yellow-500" : "text-muted-foreground"}`}>
                  {el.description.length}/100
                </span>
              </div>

              {/* REFERENCE IMAGES */}
              <div>
                <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block">References (2-4 recommended)</span>
                {el.urls.length > 0 ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {el.urls.map((url, ui) => (
                      <div key={ui} className="relative group/thumb w-12 h-12 shrink-0">
                        <img src={url} alt={`${el.name} ${ui + 1}`} className="w-12 h-12 rounded-lg object-cover border border-border" />
                        <button
                          type="button"
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow-sm"
                          onClick={() => handleRemoveElementUrl(i, ui)}
                          title="Remove"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-14 rounded-lg border-2 border-dashed border-border bg-muted/20 text-muted-foreground/50">
                    <ImageIcon className="w-5 h-5 mb-0.5" />
                    <span className="text-[10px]">Drop images or use buttons below</span>
                  </div>
                )}
              </div>

              {/* Row 4: Add media buttons (dashed style) */}
              <div className="flex items-center gap-1.5 relative">
                <button
                  type="button"
                  className="h-7 px-2.5 rounded-lg border border-dashed border-border hover:border-[#ff0073]/50 text-[10px] text-muted-foreground hover:text-[#ff0073] transition-colors"
                  onClick={() => alert("Coming soon")}
                >
                  + Library
                </button>
                <button
                  type="button"
                  className="h-7 px-2.5 rounded-lg border border-dashed border-border hover:border-[#ff0073]/50 text-[10px] text-muted-foreground hover:text-[#ff0073] transition-colors disabled:opacity-40"
                  disabled={uploadingIndex === i}
                  onClick={() => fileInputRefs.current[i]?.click()}
                >
                  {uploadingIndex === i ? (
                    <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Uploading</span>
                  ) : (
                    "+ Upload"
                  )}
                </button>
                <input
                  ref={(ref) => { fileInputRefs.current[i] = ref }}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleElementUpload(i, file)
                    e.target.value = ""
                  }}
                />
                <button
                  type="button"
                  className="h-7 px-2.5 rounded-lg border border-dashed border-border hover:border-[#ff0073]/50 text-[10px] text-muted-foreground hover:text-[#ff0073] transition-colors"
                  onClick={() => setWorkflowDropdownIndex(workflowDropdownIndex === i ? null : i)}
                >
                  + Workflow
                </button>

                {/* From Workflow dropdown */}
                {workflowDropdownIndex === i && (
                  <div
                    ref={workflowDropdownRef}
                    className="absolute top-full left-0 mt-1 w-56 max-h-48 overflow-y-auto z-50 rounded-xl border border-border bg-card shadow-lg"
                  >
                    {workflowImageNodes.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground p-3 text-center">No image nodes in workflow</p>
                    ) : (
                      workflowImageNodes.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                          disabled={!node.thumbUrl}
                          onClick={() => node.thumbUrl && handleAddFromWorkflow(i, node.thumbUrl)}
                        >
                          {node.thumbUrl ? (
                            <img src={node.thumbUrl} alt={node.label} className="w-7 h-7 rounded-lg object-cover border border-border shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/20 flex items-center justify-center shrink-0">
                              <ImageIcon className="w-3 h-3 text-muted-foreground/40" />
                            </div>
                          )}
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] font-medium truncate">{node.label}</span>
                            <span className="text-[9px] text-muted-foreground">{node.type}</span>
                          </div>
                          {!node.thumbUrl && <span className="text-[9px] text-muted-foreground/60 ml-auto">No output</span>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* VOICE HINT */}
              {el.type === "image" && (
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  Tip: Add voice description like &quot;deep calm male voice&quot; to enable dialogue
                </p>
              )}
            </div>
          ))}

          {/* Add Element (dashed) */}
          <button
            type="button"
            onClick={handleAddElement}
            disabled={elements.length >= 5}
            className="w-full py-2.5 rounded-xl border-2 border-dashed border-border hover:border-[#ff0073]/50 text-xs text-muted-foreground hover:text-[#ff0073] transition-colors disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add Element {elements.length < 5 && `(${elements.length}/5)`}
          </button>

          <div className="rounded-xl border border-border bg-gradient-to-br from-[#ff0073]/5 to-transparent p-3">
            <p className="text-[10px] text-muted-foreground">
              Example: <span className="font-mono text-foreground">&quot;Close-up of @hero walking through rain&quot;</span>
            </p>
          </div>
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage}
          alt="Connected image"
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  )
}

// ─── Standard Image-to-Video Config ───────────────────────────────────────

function ImageToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, onUpdateNode }: ConfigProps<ImageToVideoData>) {
  useEffect(() => { prefetchModelCredits(VIDEO_I2V_MODELS.map((m) => m.value)) }, [])
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  // Get allowed durations for current provider (model-specific)
  const allowedDurations = KIE_VIDEO_DURATIONS[data.provider || "minimax"] || null

  // Check if current provider supports end frame
  const supportsEndFrame = PROVIDERS_WITH_END_FRAME.includes(data.provider || "minimax")

  // Find connected text-prompt sources
  const connectedTextPrompts = useMemo(() => {
    return sources.filter((s) => s.type === "text-prompt").map((s) => ({
      id: s.id,
      label: s.label,
      text: (s.nodeData?.text as string) || "",
      targetHandle: s.targetHandle,
    }))
  }, [sources])

  // Find connected image sources (generate-image, upload-image, character, object, location)
  const connectedImages = useMemo(() => {
    const imageTypes = ["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"]
    return sources.filter((s) => imageTypes.includes(s.type)).map((s) => {
      let imageUrl: string | undefined
      const nodeData = s.nodeData || {}

      // Extract image URL based on node type
      if (s.type === "upload-image") {
        imageUrl = (nodeData.url as string) || undefined
      } else if (s.type === "generate-image" || s.type === "edit-image" || s.type === "image-to-image" || s.type === "scene") {
        // Check generatedResults first, then generatedImageUrl
        const results = nodeData.generatedResults as Array<{ url?: string }> | undefined
        const activeIndex = (nodeData.activeResultIndex as number) ?? 0
        if (results && results.length > 0) {
          imageUrl = results[activeIndex]?.url || results[0]?.url
        }
        if (!imageUrl) {
          imageUrl = (nodeData.generatedImageUrl as string) || undefined
        }
      } else if (s.type === "character" || s.type === "object" || s.type === "location") {
        // Asset nodes store main image in sourceImageUrl
        imageUrl = (nodeData.sourceImageUrl as string) || undefined
      }

      // Determine display label based on target handle
      let displayLabel = s.label
      if (s.targetHandle === "startFrame") {
        displayLabel = `Start: ${s.label}`
      } else if (s.targetHandle === "endFrame") {
        displayLabel = `End: ${s.label}`
      }

      return {
        id: s.id,
        type: s.type,
        label: displayLabel,
        imageUrl,
        targetHandle: s.targetHandle,
      }
    })
  }, [sources])

  // Handler for updating connected text prompt
  const handleTextPromptChange = useCallback((nodeId: string, newText: string) => {
    if (onUpdateNode) {
      onUpdateNode(nodeId, { text: newText })
    }
  }, [onUpdateNode])

  // Kling 3.0 uses its own studio config panel
  if (data.provider === "kling-3.0") {
    return <Kling3StudioConfig data={data} onUpdate={onUpdate} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} nodes={nodes} onUpdateNode={onUpdateNode} />
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Connected Images Section - side by side label + thumbnail per row */}
      {connectedImages.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
            Connected Images ({connectedImages.length})
          </Label>
          <div className="flex flex-col gap-2">
            {connectedImages.map((img) => (
              <div key={img.id} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 dark:text-[#64748B] font-medium w-16 shrink-0 leading-tight truncate" title={img.label}>
                  {img.label}
                </span>
                <div
                  className="flex-1 h-16 rounded-lg border border-gray-200 dark:border-[#2D2D2D] overflow-hidden cursor-pointer hover:ring-2 hover:ring-[#ff0073] transition-all bg-gray-100 dark:bg-[#121212]"
                  onClick={() => img.imageUrl && setLightboxImage(img.imageUrl)}
                  title={`Click to view: ${img.label}`}
                >
                  {img.imageUrl ? (
                    <CachedImage
                      src={img.imageUrl}
                      alt={img.label}
                      className="w-full h-full object-cover"
                      thumbnail
                      thumbnailWidth={160}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-gray-400" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Click to view full size</p>
        </div>
      )}

      {/* Connected Text Prompts Section */}
      {connectedTextPrompts.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
            Motion Prompt (from connected node)
          </Label>
          {connectedTextPrompts.map((prompt, idx) => (
            <div key={`${prompt.id}-${idx}`} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 mb-1">
                <FileText className="w-3 h-3 text-[#ff0073]" />
                <span className="text-[10px] text-[#ff0073] font-medium">{prompt.label}</span>
              </div>
              <Textarea
                value={prompt.text}
                onChange={(e) => handleTextPromptChange(prompt.id, e.target.value)}
                placeholder="Enter motion prompt..."
                rows={3}
                className="text-xs bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]"
              />
            </div>
          ))}
        </div>
      )}

      {/* Motion Prompt (manual, when no text prompt connected) */}
      {connectedTextPrompts.length === 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
            Motion Prompt
          </Label>
          <Textarea
            value={data.motionPrompt || ""}
            onChange={(e) => onUpdate({ motionPrompt: e.target.value })}
            placeholder="Describe the motion or animation you want..."
            rows={3}
            className="text-xs bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]"
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Tip: Connect a Text Prompt node for reusable prompts
          </p>
        </div>
      )}

      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={data.provider || "minimax"}
          onValueChange={(v) => onUpdate({ provider: v as ImageToVideoData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {VIDEO_I2V_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      {(data.provider === "veo3" || data.provider === "veo3.1") && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="generateAudio"
              checked={data.generateAudio !== false}
              onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="generateAudio" className="text-xs">Generate Audio</label>
          </div>
          <p className="text-xs text-muted-foreground px-1">VEO 3/3.1 creates AI audio from the prompt. Disable for silent video, then use Add Audio node.</p>
        </div>
      )}
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        {allowedDurations ? (
          <Select
            value={String(allowedDurations.includes(data.duration) ? data.duration : allowedDurations[0])}
            onValueChange={(v) => onUpdate({ duration: parseInt(v, 10) })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowedDurations.map((d) => (
                <SelectItem key={d} value={String(d)}>{d} seconds</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type="number"
            min={1}
            max={30}
            value={data.duration}
            onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) || 5 })}
          />
        )}
      </MappableField>
      {allowedDurations && allowedDurations.length === 1 && (
        <p className="text-xs text-muted-foreground px-1">
          {data.provider === "veo3" || data.provider === "veo3.1"
            ? "VEO 3 produces ~8 second videos (not configurable)."
            : `${data.provider || "This provider"} produces ~${allowedDurations[0]} second videos.`}
        </p>
      )}
      {supportsEndFrame && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">End Frame (optional)</Label>
          <p className="text-xs text-muted-foreground px-1">
            Connect an image node to the &quot;End Frame&quot; handle for start-to-end frame video generation.
          </p>
        </div>
      )}
      <MappableField field="motion" label="Motion" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.motion}
          onValueChange={(v) => onUpdate({ motion: v as ImageToVideoData["motion"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="subtle">Subtle</SelectItem>
            <SelectItem value="moderate">Moderate</SelectItem>
            <SelectItem value="dynamic">Dynamic</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="cameraMotion" label="Camera Motion" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.cameraMotion}
          onValueChange={(v) => onUpdate({ cameraMotion: v as ImageToVideoData["cameraMotion"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="static">Static</SelectItem>
            <SelectItem value="pan-left">Pan Left</SelectItem>
            <SelectItem value="pan-right">Pan Right</SelectItem>
            <SelectItem value="zoom-in">Zoom In</SelectItem>
            <SelectItem value="zoom-out">Zoom Out</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>

      {/* Kling 2.6 sound toggle */}
      {data.provider === "kling" && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="klingSound"
            checked={(data as Record<string, unknown>).kling3Sound !== false}
            onChange={(e) => onUpdate({ kling3Sound: e.target.checked })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="klingSound" className="text-xs">Enable Sound</label>
        </div>
      )}

      {/* Kling Turbo negative prompt */}
      {data.provider === "kling-turbo" && (
        <div>
          <Label className="text-xs">Negative Prompt</Label>
          <Textarea
            rows={2}
            value={(data as Record<string, unknown>).negativePrompt as string || ""}
            onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
            placeholder="Things to avoid..."
          />
        </div>
      )}

      {/* Kling Turbo CFG scale */}
      {data.provider === "kling-turbo" && (
        <div>
          <Label className="text-xs">CFG Scale ({String((data as Record<string, unknown>).cfgScale ?? 0.5)})</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={(data as Record<string, unknown>).cfgScale as number ?? 0.5}
            onChange={(e) => onUpdate({ cfgScale: parseFloat(e.target.value) || 0.5 })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">0 = creative, 1 = strict prompt adherence</p>
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage}
          alt="Connected image"
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  )
}

function VideoToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<VideoToVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe what to change or continue..."
          rows={3}
        />
      </MappableField>
      <p className="text-xs text-muted-foreground px-1">
        Uses Wan 2.6 via KIE.ai (only provider that supports video-to-video)
      </p>
    </div>
  )
}

function MotionTransferConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<MotionTransferData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt (Optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value.slice(0, 2500) })}
          placeholder="Optional: Describe the motion transfer..."
          rows={2}
        />
        <span className="text-xs text-muted-foreground">{data.prompt?.length || 0}/2500</span>
      </MappableField>
      <MappableField field="characterOrientation" label="Character Orientation" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.characterOrientation || "video"}
          onValueChange={(v) => onUpdate({ characterOrientation: v as MotionTransferData["characterOrientation"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="image">Image (same as picture, max 10s)</SelectItem>
            <SelectItem value="video">Video (consistent with video, max 30s)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="resolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.resolution || "720p"}
          onValueChange={(v) => onUpdate({ resolution: v as MotionTransferData["resolution"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="720p">720p</SelectItem>
            <SelectItem value="1080p">1080p</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <p className="text-xs text-muted-foreground px-1">
        Uses Kling 2.6 Motion Control via KIE.ai. Connect image and video inputs.
      </p>
    </div>
  )
}

function VideoUpscaleConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<VideoUpscaleData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="upscaleFactor" label="Upscale Factor" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.upscaleFactor || "2"}
          onValueChange={(v) => onUpdate({ upscaleFactor: v as VideoUpscaleData["upscaleFactor"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1x (no upscale, AI enhance only)</SelectItem>
            <SelectItem value="2">2x (recommended)</SelectItem>
            <SelectItem value="4">4x (maximum)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <p className="text-xs text-muted-foreground px-1">
        Uses Topaz Video Upscaler via KIE.ai. Max 50MB input video.
      </p>
    </div>
  )
}

// KIE.ai allowed durations per text-to-video provider
const KIE_T2V_DURATIONS: Record<string, number[]> = {
  "minimax": [5],
  "veo3": [8],
  "kling": [5, 10],
  "kling-turbo": [5, 10],
  "grok": [10],
  "sora2-pro": [5, 10],
  "kling-3.0": KLING3_DURATIONS,
}

function TextToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes }: ConfigProps<TextToVideoData>) {
  useEffect(() => { prefetchModelCredits(VIDEO_T2V_MODELS.map((m) => m.value)) }, [])
  const category: ProviderCategory = "video"
  const models = getModels(category, data.provider)
  const connectedModel = getConnectedProviderModel(fieldMappings, sources, nodes)
  // Get allowed durations for current provider (model-specific)
  const allowedDurations = KIE_T2V_DURATIONS[data.provider || "minimax"] || null

  if (data.provider === "kling-3.0") {
    return <Kling3StudioConfig data={data as unknown as ImageToVideoData} onUpdate={onUpdate} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} nodes={nodes} />
  }

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe the video to generate..."
        />
      </MappableField>
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={data.provider || "minimax"}
          onValueChange={(v) => {
            const firstModel = getFirstModel(category, v)
            onUpdate({ provider: v, model: firstModel })
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {VIDEO_T2V_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <div>
        <Label className="text-xs">Model</Label>
        {connectedModel ? (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5 truncate">
            {connectedModel}
          </p>
        ) : (
          <Select
            value={data.model}
            onValueChange={(v) => onUpdate({ model: v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        {allowedDurations ? (
          <Select
            value={String(allowedDurations.includes(data.duration) ? data.duration : allowedDurations[0])}
            onValueChange={(v) => onUpdate({ duration: parseInt(v, 10) })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowedDurations.map((d) => (
                <SelectItem key={d} value={String(d)}>{d} seconds</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type="number"
            min={1}
            max={30}
            value={data.duration}
            onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) || 5 })}
          />
        )}
      </MappableField>
      {allowedDurations && allowedDurations.length === 1 && (
        <p className="text-xs text-muted-foreground px-1">
          {data.provider === "veo3"
            ? "VEO 3 produces ~8 second videos (not configurable)."
            : `${data.provider || "This provider"} produces ~${allowedDurations[0]} second videos.`}
        </p>
      )}
      {/* Kling 2.6 sound toggle */}
      {data.provider === "kling" && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="t2vKlingSound"
            checked={(data as Record<string, unknown>).kling3Sound !== false}
            onChange={(e) => onUpdate({ kling3Sound: e.target.checked })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="t2vKlingSound" className="text-xs">Enable Sound</label>
        </div>
      )}

      {/* Kling Turbo CFG scale */}
      {data.provider === "kling-turbo" && (
        <div>
          <Label className="text-xs">CFG Scale ({String((data as Record<string, unknown>).cfgScale ?? 0.5)})</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={(data as Record<string, unknown>).cfgScale as number ?? 0.5}
            onChange={(e) => onUpdate({ cfgScale: parseFloat(e.target.value) || 0.5 })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">0 = creative, 1 = strict prompt adherence</p>
        </div>
      )}

      <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.aspectRatio}
          onValueChange={(v) => onUpdate({ aspectRatio: v as TextToVideoData["aspectRatio"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
            <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
            <SelectItem value="1:1">1:1 (Square)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={2}
          value={data.negativePrompt}
          onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
          placeholder="Things to avoid..."
        />
      </MappableField>
    </div>
  )
}

function TextToSpeechConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<TextToSpeechData>) {
  const textSource = data.textSource || "connected"
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Text Source</Label>
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={() => onUpdate({ textSource: "connected" })}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${textSource === "connected" ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
          >
            From connected node
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ textSource: "direct" })}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${textSource === "direct" ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
          >
            Write directly
          </button>
        </div>
      </div>
      {textSource === "direct" && (
        <div>
          <Label>Text</Label>
          <Textarea
            rows={4}
            value={data.directText || ""}
            onChange={(e) => onUpdate({ directText: e.target.value })}
            placeholder="Enter text to convert to speech..."
          />
        </div>
      )}
      <MappableField field="provider" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="voice">
        <Select
          value={data.provider === "elevenlabs" ? "elevenlabs-turbo" : (data.provider || "elevenlabs-turbo")}
          onValueChange={(v) => onUpdate({ provider: v as TextToSpeechData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="elevenlabs-turbo">ElevenLabs Turbo v2.5 (fast)</SelectItem>
            <SelectItem value="elevenlabs-multilingual">ElevenLabs Multilingual v2</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <div>
        <Label>Voice</Label>
        <Select
          value={data.voiceId || "Rachel"}
          onValueChange={(v) => onUpdate({ voiceId: v })}
        >
          <SelectTrigger><SelectValue placeholder="Select voice" /></SelectTrigger>
          <SelectContent>
            {TTS_VOICES.map((voice) => (
              <SelectItem key={voice.id} value={voice.id}>
                {voice.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Language</Label>
        <Select
          value={data.languageCode || "auto"}
          onValueChange={(v) => onUpdate({ languageCode: v === "auto" ? "" : v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="he">Hebrew</SelectItem>
            <SelectItem value="es">Spanish</SelectItem>
            <SelectItem value="fr">French</SelectItem>
            <SelectItem value="de">German</SelectItem>
            <SelectItem value="it">Italian</SelectItem>
            <SelectItem value="pt">Portuguese</SelectItem>
            <SelectItem value="ja">Japanese</SelectItem>
            <SelectItem value="zh">Chinese</SelectItem>
            <SelectItem value="ko">Korean</SelectItem>
            <SelectItem value="ar">Arabic</SelectItem>
            <SelectItem value="ru">Russian</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="stability">Stability ({data.stability ?? 0.5})</Label>
        <Input
          id="stability"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={data.stability ?? 0.5}
          onChange={(e) => onUpdate({ stability: parseFloat(e.target.value) })}
          className="h-2"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>Variable</span>
          <span>Stable</span>
        </div>
      </div>
      <div>
        <Label htmlFor="similarityBoost">Similarity ({data.similarityBoost ?? 0.75})</Label>
        <Input
          id="similarityBoost"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={data.similarityBoost ?? 0.75}
          onChange={(e) => onUpdate({ similarityBoost: parseFloat(e.target.value) })}
          className="h-2"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>Low</span>
          <span>High</span>
        </div>
      </div>
      <div>
        <Label htmlFor="style">Style Exaggeration ({data.style ?? 0})</Label>
        <Input
          id="style"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={data.style ?? 0}
          onChange={(e) => onUpdate({ style: parseFloat(e.target.value) })}
          className="h-2"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>None</span>
          <span>Exaggerated</span>
        </div>
      </div>
      <div>
        <Label htmlFor="speed">Speed ({data.speed ?? 1})</Label>
        <Input
          id="speed"
          type="range"
          min={0.7}
          max={1.2}
          step={0.05}
          value={data.speed ?? 1}
          onChange={(e) => onUpdate({ speed: parseFloat(e.target.value) })}
          className="h-2"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>0.7x</span>
          <span>1.2x</span>
        </div>
      </div>
    </div>
  )
}

function TextToAudioConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<TextToAudioData>) {
  const isSfx = data.provider === "elevenlabs-sfx"
  const maxPromptLen = isSfx ? 450 : 2000
  const minDuration = isSfx ? 0.5 : 1
  const maxDuration = isSfx ? 22 : 30

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => {
            const v = e.target.value
            if (v.length <= maxPromptLen) onUpdate({ prompt: v })
          }}
          placeholder={isSfx ? "Describe the sound effect (max 450 chars)..." : "Describe the sound effect (e.g. dog barking, rain on window)..."}
        />
        {isSfx && (
          <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/{maxPromptLen}</p>
        )}
      </MappableField>
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.provider || "tangoflux"}
          onValueChange={(v) => onUpdate({ provider: v as TextToAudioData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="tangoflux">TangoFlux (default)</SelectItem>
            <SelectItem value="elevenlabs-sfx">ElevenLabs SFX v2</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={minDuration}
          max={maxDuration}
          step={isSfx ? 0.5 : 1}
          value={data.duration}
          onChange={(e) => onUpdate({ duration: parseFloat(e.target.value) || 10 })}
        />
      </MappableField>
      {isSfx && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Loop</label>
            <Select
              value={data.loop ? "true" : "false"}
              onValueChange={(v) => onUpdate({ loop: v === "true" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="false">Off</SelectItem>
                <SelectItem value="true">On (seamless loop)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Prompt Influence</label>
              <span className="text-xs text-muted-foreground">{(data.promptInfluence ?? 0.3).toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={data.promptInfluence ?? 0.3}
              onChange={(e) => onUpdate({ promptInfluence: parseFloat(e.target.value) })}
              className="w-full accent-[#ff0073]"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>More random</span>
              <span>More faithful</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SunoGenerateConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SunoGenerateData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => {
            const v = e.target.value
            if (v.length <= 3000) onUpdate({ prompt: v })
          }}
          placeholder="Describe the song you want to generate..."
        />
        <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/3000</p>
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.model || "V5"}
          onValueChange={(v) => onUpdate({ model: v as SunoGenerateData["model"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
            <SelectItem value="V4_5ALL">Suno V4.5 All</SelectItem>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V4_5">Suno V4.5</SelectItem>
            <SelectItem value="V4">Suno V4</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.title ?? ""}
          maxLength={200}
          onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder="Song title"
        />
      </MappableField>
      <MappableField field="lyrics" label="Lyrics (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={4}
          value={data.lyrics ?? ""}
          onChange={(e) => {
            const v = e.target.value
            if (v.length <= 3000) onUpdate({ lyrics: v })
          }}
          placeholder="Write custom lyrics..."
        />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.style ?? ""}
          maxLength={500}
          onChange={(e) => onUpdate({ style: e.target.value })}
          placeholder="e.g. pop, rock, jazz, lo-fi..."
        />
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.negativeStyle ?? ""}
          maxLength={500}
          onChange={(e) => onUpdate({ negativeStyle: e.target.value })}
          placeholder="Styles to avoid..."
        />
      </MappableField>
      <MappableField field="vocalGender" label="Vocal Gender (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.vocalGender ?? "auto"}
          onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? undefined : v })}
        >
          <SelectTrigger><SelectValue placeholder="Auto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Style Weight</label>
          <span className="text-xs text-muted-foreground">{data.styleWeight ?? 50}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={data.styleWeight ?? 50}
          onChange={(e) => onUpdate({ styleWeight: parseInt(e.target.value) })}
          className="w-full accent-[#ff0073]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Weirdness</label>
          <span className="text-xs text-muted-foreground">{data.weirdnessConstraint ?? 0}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={data.weirdnessConstraint ?? 0}
          onChange={(e) => onUpdate({ weirdnessConstraint: parseInt(e.target.value) })}
          className="w-full accent-[#ff0073]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Audio Weight</label>
          <span className="text-xs text-muted-foreground">{data.audioWeight ?? 50}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={data.audioWeight ?? 50}
          onChange={(e) => onUpdate({ audioWeight: parseInt(e.target.value) })}
          className="w-full accent-[#ff0073]"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="suno-instrumental"
          checked={data.instrumental ?? false}
          onChange={(e) => onUpdate({ instrumental: e.target.checked })}
          className="accent-[#ff0073]"
        />
        <label htmlFor="suno-instrumental" className="text-xs font-medium text-muted-foreground">Instrumental (no vocals)</label>
      </div>
    </div>
  )
}

function SunoCoverConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SunoCoverData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => {
            const v = e.target.value
            if (v.length <= 3000) onUpdate({ prompt: v })
          }}
          placeholder="Describe the cover style..."
        />
        <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/3000</p>
      </MappableField>
      <MappableField field="uploadUrl" label="Source Audio URL" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.uploadUrl ?? ""}
          onChange={(e) => onUpdate({ uploadUrl: e.target.value })}
          placeholder="URL of the audio to cover (or connect an audio node)"
        />
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.model || "V5"}
          onValueChange={(v) => onUpdate({ model: v as SunoCoverData["model"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
            <SelectItem value="V4_5ALL">Suno V4.5 All</SelectItem>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V4_5">Suno V4.5</SelectItem>
            <SelectItem value="V4">Suno V4</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.title ?? ""}
          maxLength={200}
          onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder="Cover title"
        />
      </MappableField>
      <MappableField field="lyrics" label="Lyrics (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={4}
          value={data.lyrics ?? ""}
          onChange={(e) => {
            const v = e.target.value
            if (v.length <= 3000) onUpdate({ lyrics: v })
          }}
          placeholder="Write custom lyrics for the cover..."
        />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.style ?? ""}
          maxLength={500}
          onChange={(e) => onUpdate({ style: e.target.value })}
          placeholder="e.g. pop, rock, jazz, lo-fi..."
        />
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.negativeStyle ?? ""}
          maxLength={500}
          onChange={(e) => onUpdate({ negativeStyle: e.target.value })}
          placeholder="Styles to avoid..."
        />
      </MappableField>
      <MappableField field="vocalGender" label="Vocal Gender (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.vocalGender ?? "auto"}
          onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? undefined : v })}
        >
          <SelectTrigger><SelectValue placeholder="Auto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="suno-cover-instrumental"
          checked={data.instrumental ?? false}
          onChange={(e) => onUpdate({ instrumental: e.target.checked })}
          className="accent-[#ff0073]"
        />
        <label htmlFor="suno-cover-instrumental" className="text-xs font-medium text-muted-foreground">Instrumental (no vocals)</label>
      </div>
    </div>
  )
}

function SunoExtendConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SunoExtendData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="audioId" label="Audio ID (from Suno node)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.audioId ?? ""}
          onChange={(e) => onUpdate({ audioId: e.target.value })}
          placeholder="Suno track ID (auto-filled from connected node)"
        />
      </MappableField>
      <MappableField field="continueAt" label="Continue From (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={0}
          value={data.continueAt ?? 0}
          onChange={(e) => onUpdate({ continueAt: Number(e.target.value) })}
          placeholder="0"
        />
      </MappableField>
      <MappableField field="prompt" label="Extension Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt ?? ""}
          onChange={(e) => {
            const v = e.target.value
            if (v.length <= 5000) onUpdate({ prompt: v })
          }}
          placeholder="Describe how the music should continue..."
        />
        <p className="text-xs text-muted-foreground mt-1">{(data.prompt ?? "").length}/5000</p>
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5"} onValueChange={(v) => onUpdate({ model: v as SunoExtendData["model"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
            <SelectItem value="V4_5ALL">Suno V4.5 All</SelectItem>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V4_5">Suno V4.5</SelectItem>
            <SelectItem value="V4">Suno V4</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={80} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Extended track title" />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.style ?? ""} maxLength={1000} onChange={(e) => onUpdate({ style: e.target.value })} placeholder="e.g. pop, rock, jazz..." />
      </MappableField>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="suno-extend-customParams" checked={data.defaultParamFlag ?? true} onChange={(e) => onUpdate({ defaultParamFlag: e.target.checked })} className="accent-[#ff0073]" />
        <label htmlFor="suno-extend-customParams" className="text-xs font-medium text-muted-foreground">Use default parameters (uncheck to customize)</label>
      </div>
    </div>
  )
}

function SunoLyricsConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SunoLyricsData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => {
            const v = e.target.value
            if (v.length <= 1000) onUpdate({ prompt: v })
          }}
          placeholder="Describe the lyrics you want (theme, mood, style)..."
        />
        <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/1000</p>
      </MappableField>
      {data.generatedText && (
        <div className="rounded-md border bg-muted/30 p-2 text-xs max-h-40 overflow-y-auto whitespace-pre-wrap">
          {data.generatedTitle && <p className="font-medium mb-1">{data.generatedTitle}</p>}
          {data.generatedText}
        </div>
      )}
    </div>
  )
}

function SunoSeparateConfig({ data, onUpdate }: { readonly data: SunoSeparateData; readonly onUpdate: (updates: Partial<SunoSeparateData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Separation Type</label>
        <Select value={data.type} onValueChange={(v) => onUpdate({ type: v as SunoSeparateData["type"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="separate_vocal">Vocal / Instrumental</SelectItem>
            <SelectItem value="split_stem">12 Stems</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Task ID</label>
        <Input value={data.taskId} onChange={(e) => onUpdate({ taskId: e.target.value })} placeholder="Suno task ID" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Audio ID</label>
        <Input value={data.audioId} onChange={(e) => onUpdate({ audioId: e.target.value })} placeholder="Suno audio ID" />
      </div>
      {data.vocalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Vocal</label>
          <audio src={data.vocalUrl} controls className="w-full h-8" preload="none" />
        </div>
      )}
      {data.instrumentalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Instrumental</label>
          <audio src={data.instrumentalUrl} controls className="w-full h-8" preload="none" />
        </div>
      )}
      {data.stems && Object.keys(data.stems).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Stems</label>
          {Object.entries(data.stems).map(([name, url]) => (
            <div key={name} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground capitalize">{name.replace(/_/g, " ")}</span>
              <audio src={url} controls className="w-full h-8" preload="none" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SunoMusicVideoConfig({ data, onUpdate }: { readonly data: SunoMusicVideoData; readonly onUpdate: (updates: Partial<SunoMusicVideoData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Task ID</label>
        <Input value={data.taskId} onChange={(e) => onUpdate({ taskId: e.target.value })} placeholder="From upstream Suno node" />
        <p className="text-[10px] text-muted-foreground mt-1">Auto-filled when connected to a Suno node</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Audio ID</label>
        <Input value={data.audioId} onChange={(e) => onUpdate({ audioId: e.target.value })} placeholder="From upstream Suno node" />
        <p className="text-[10px] text-muted-foreground mt-1">Auto-filled when connected to a Suno node</p>
      </div>
      {data.generatedVideoUrl && (
        <div className="rounded-md border overflow-hidden">
          <video src={data.generatedVideoUrl} controls className="w-full" />
        </div>
      )}
    </div>
  )
}

function TranscribeConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<TranscribeData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.provider || "whisper"}
          onValueChange={(v) => onUpdate({ provider: v as TranscribeData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="whisper">Whisper (default)</SelectItem>
            <SelectItem value="incredibly-fast-whisper">Incredibly Fast Whisper</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="language" label="Language" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.language || "auto"}
          onValueChange={(v) => onUpdate({ language: v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto Detect</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="he">Hebrew</SelectItem>
            <SelectItem value="es">Spanish</SelectItem>
            <SelectItem value="fr">French</SelectItem>
            <SelectItem value="de">German</SelectItem>
            <SelectItem value="it">Italian</SelectItem>
            <SelectItem value="pt">Portuguese</SelectItem>
            <SelectItem value="ja">Japanese</SelectItem>
            <SelectItem value="zh">Chinese</SelectItem>
            <SelectItem value="ko">Korean</SelectItem>
            <SelectItem value="ar">Arabic</SelectItem>
            <SelectItem value="ru">Russian</SelectItem>
            <SelectItem value="hi">Hindi</SelectItem>
            <SelectItem value="nl">Dutch</SelectItem>
            <SelectItem value="tr">Turkish</SelectItem>
            <SelectItem value="pl">Polish</SelectItem>
            <SelectItem value="sv">Swedish</SelectItem>
            <SelectItem value="th">Thai</SelectItem>
            <SelectItem value="vi">Vietnamese</SelectItem>
            <SelectItem value="uk">Ukrainian</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
    </div>
  )
}

function LipSyncConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<LipSyncData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.provider || "kling-avatar"}
          onValueChange={(v) => onUpdate({ provider: v as LipSyncData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="kling-avatar">Kling Avatar (40 credits)</SelectItem>
            <SelectItem value="kling-avatar-pro">Kling Avatar Pro (60 credits)</SelectItem>
            <SelectItem value="infinitalk">Infinitalk (60 credits)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="resolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.resolution || "720p"}
          onValueChange={(v) => onUpdate({ resolution: v as LipSyncData["resolution"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="480p">480p</SelectItem>
            <SelectItem value="720p">720p (default)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="prompt" label="Motion Prompt (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={2}
          value={data.prompt ?? ""}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Optional: describe head/expression motions..."
        />
      </MappableField>
      <p className="text-xs text-muted-foreground">
        Connect a portrait image and an audio track (speech/voiceover) to generate a talking head video.
      </p>
    </div>
  )
}

function QACheckConfig({ data, onUpdate }: ConfigProps<QACheckData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider}
          onValueChange={(v) => onUpdate({ provider: v as QACheckData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="claude">Claude</SelectItem>
            <SelectItem value="gpt">GPT</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Check Type</Label>
        <Select
          value={data.checkType}
          onValueChange={(v) => onUpdate({ checkType: v as QACheckData["checkType"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="content">Content</SelectItem>
            <SelectItem value="quality">Quality</SelectItem>
            <SelectItem value="consistency">Consistency</SelectItem>
            <SelectItem value="safety">Safety</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="threshold">Threshold</Label>
        <Input
          id="threshold"
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={data.threshold}
          onChange={(e) => onUpdate({ threshold: parseFloat(e.target.value) || 0.8 })}
        />
      </div>
    </div>
  )
}

function GenerateMusicConfig({ data, onUpdate, sources }: ConfigProps<GenerateMusicData>) {
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "error">("idle")
  const [ytStatus, setYtStatus] = useState<"idle" | "downloading" | "error">("idle")

  const connectedPrompt = sources.find((s) => s.targetHandle === "in")
  const connectedRef = sources.find((s) => s.targetHandle === "ref-audio")

  const handleFileUpload = useCallback(async (file: File) => {
    setUploadStatus("uploading")
    try {
      const result = await uploadAudio(file)
      onUpdate({ referenceAudioUrl: result.url, referenceSource: "upload" })
      setUploadStatus("idle")
    } catch {
      setUploadStatus("error")
    }
  }, [onUpdate])

  const handleYouTubeDownload = useCallback(async () => {
    const url = data.referenceYouTubeUrl?.trim()
    if (!url) return
    setYtStatus("downloading")
    try {
      const result = await downloadYouTubeAudio(url)
      onUpdate({ referenceAudioUrl: result.url, referenceSource: "youtube" })
      setYtStatus("idle")
    } catch {
      setYtStatus("error")
    }
  }, [data.referenceYouTubeUrl, onUpdate])

  const isMinimax = data.provider === "minimax"
  const hasReference = Boolean(data.referenceAudioUrl) || Boolean(connectedRef)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider || "musicgen"}
          onValueChange={(v) => onUpdate({ provider: v as GenerateMusicData["provider"], referenceSource: "none", referenceAudioUrl: "", referenceYouTubeUrl: "" })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="musicgen">MusicGen (Meta) - instrumental (default)</SelectItem>
            <SelectItem value="minimax">MiniMax Music - vocals & lyrics</SelectItem>
            <SelectItem value="lyria">Lyria 2 (Google) - high quality</SelectItem>
            <SelectItem value="bark">Bark (Suno) - speech & music</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="music-prompt">Prompt</Label>
        {connectedPrompt ? (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <span className="text-muted-foreground">From: </span>
            <span className="font-medium">{connectedPrompt.label}</span>
            {connectedPrompt.value && (
              <p className="mt-1 text-muted-foreground truncate">{connectedPrompt.value}</p>
            )}
          </div>
        ) : (
          <Textarea
            id="music-prompt"
            value={data.prompt}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            placeholder="Describe the music you want..."
            rows={3}
          />
        )}
      </div>
      {(data.provider === "musicgen" || data.provider === "lyria" || !data.provider) && (
        <div>
          <Label htmlFor="music-duration">Duration (seconds)</Label>
          <Input
            id="music-duration"
            type="number"
            min={1}
            max={30}
            value={data.duration}
            onChange={(e) => onUpdate({ duration: parseInt(e.target.value) || 8 })}
          />
        </div>
      )}
      {isMinimax && (
        <div>
          <Label htmlFor="music-lyrics">Lyrics</Label>
          <Textarea
            id="music-lyrics"
            value={data.lyrics || ""}
            onChange={(e) => onUpdate({ lyrics: e.target.value })}
            placeholder="Write lyrics for the song..."
            rows={4}
          />
        </div>
      )}
      {isMinimax && (
        <div className="flex flex-col gap-2">
          <Label>Reference Audio</Label>
          {connectedRef ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs flex flex-col gap-1.5">
              <div>
                <span className="text-muted-foreground">From: </span>
                <span className="font-medium">{connectedRef.label}</span>
              </div>
              {typeof connectedRef.nodeData?.videoThumbnail === "string" && connectedRef.nodeData.videoThumbnail && (
                <div className="rounded overflow-hidden bg-muted">
                  <CachedImage src={connectedRef.nodeData.videoThumbnail} alt="" className="w-full h-16 object-cover" thumbnail thumbnailWidth={320} />
                </div>
              )}
              {typeof connectedRef.nodeData?.videoTitle === "string" && connectedRef.nodeData.videoTitle && (
                <p className="text-foreground truncate">{connectedRef.nodeData.videoTitle}</p>
              )}
              {connectedRef.nodeData?.extractedAudioUrl ? (
                <p className="text-green-600">Audio ready</p>
              ) : (
                <p className="text-amber-500">No audio extracted yet</p>
              )}
            </div>
          ) : (
          <>
          {!hasReference && (
            <p className="text-xs text-amber-500">MiniMax works best with a reference song</p>
          )}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="ref-source" checked={data.referenceSource === "none" || !data.referenceSource} onChange={() => onUpdate({ referenceSource: "none", referenceAudioUrl: "" })} />
              None
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="ref-source" checked={data.referenceSource === "upload"} onChange={() => onUpdate({ referenceSource: "upload" })} />
              Upload file
            </label>
            {data.referenceSource === "upload" && (
              <div className="ml-6 flex flex-col gap-1">
                <Input
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileUpload(file)
                  }}
                />
                {uploadStatus === "uploading" && <p className="text-xs text-muted-foreground">Uploading...</p>}
                {uploadStatus === "error" && <p className="text-xs text-red-500">Upload failed</p>}
                {data.referenceSource === "upload" && hasReference && <p className="text-xs text-green-600">Uploaded</p>}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="ref-source" checked={data.referenceSource === "youtube"} onChange={() => onUpdate({ referenceSource: "youtube" })} />
              YouTube URL
            </label>
            {data.referenceSource === "youtube" && (
              <div className="ml-6 flex flex-col gap-1">
                <div className="flex gap-1">
                  <Input
                    value={data.referenceYouTubeUrl || ""}
                    onChange={(e) => onUpdate({ referenceYouTubeUrl: e.target.value })}
                    placeholder="https://youtube.com/watch?v=..."
                    className="flex-1"
                  />
                  <Button size="sm" variant="outline" onClick={handleYouTubeDownload} disabled={ytStatus === "downloading" || !data.referenceYouTubeUrl?.trim()}>
                    {ytStatus === "downloading" ? "..." : "Get"}
                  </Button>
                </div>
                {ytStatus === "downloading" && <p className="text-xs text-muted-foreground">Downloading audio...</p>}
                {ytStatus === "error" && <p className="text-xs text-red-500">Download failed</p>}
                {data.referenceSource === "youtube" && hasReference && <p className="text-xs text-green-600">Ready</p>}
              </div>
            )}
          </div>
          </>
          )}
        </div>
      )}
      <div>
        <Label htmlFor="music-genre">Genre</Label>
        <Input
          id="music-genre"
          value={data.genre}
          onChange={(e) => onUpdate({ genre: e.target.value })}
          placeholder="e.g. rock, jazz, electronic"
        />
      </div>
      <div>
        <Label htmlFor="music-mood">Mood</Label>
        <Input
          id="music-mood"
          value={data.mood}
          onChange={(e) => onUpdate({ mood: e.target.value })}
          placeholder="e.g. upbeat, melancholic, epic"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="music-instrumental"
          checked={data.instrumental}
          onChange={(e) => onUpdate({ instrumental: e.target.checked })}
          className="h-4 w-4"
        />
        <Label htmlFor="music-instrumental">Instrumental (no vocals)</Label>
      </div>
    </div>
  )
}

/* ── Processing Node Configs ── */

function CombineVideosConfig({ data, onUpdate, nodes }: ConfigProps<CombineVideosData>) {
  const edges = useWorkflowStore((s) => s.edges)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)

  const connectedNodeIds = edges
    .filter((e) => e.target === selectedNodeId)
    .map((e) => e.source)

  const connectedNodes = connectedNodeIds
    .map((id) => nodes?.find((n) => n.id === id))
    .filter(Boolean) as ReadonlyArray<WorkflowNode>

  const clipOrder: string[] = data.clipOrder?.length
    ? data.clipOrder.filter((id) => connectedNodeIds.includes(id))
    : connectedNodeIds

  const orderedClips = clipOrder
    .map((id) => connectedNodes.find((n) => n.id === id))
    .filter(Boolean) as ReadonlyArray<WorkflowNode>

  return (
    <div className="flex flex-col gap-3">
      {orderedClips.length > 1 && (
        <div>
          <Label>Clip Order</Label>
          <p className="text-xs text-muted-foreground mb-2">Drag to reorder</p>
          <div className="flex flex-col gap-1">
            {orderedClips.map((clip, index) => (
              <div
                key={clip.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", String(index))}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const fromIndex = Number(e.dataTransfer.getData("text/plain"))
                  const toIndex = index
                  if (fromIndex === toIndex) return
                  const newOrder = [...clipOrder]
                  const [moved] = newOrder.splice(fromIndex, 1)
                  newOrder.splice(toIndex, 0, moved)
                  onUpdate({ clipOrder: newOrder })
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-white/5 border border-white/10 cursor-grab active:cursor-grabbing select-none"
              >
                <span className="text-muted-foreground text-xs w-4">{index + 1}</span>
                <svg className="w-3 h-3 text-muted-foreground" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M7 2a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zM7 8a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zM7 14a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4z" />
                </svg>
                <span className="text-sm truncate flex-1">
                  {(clip.data as Record<string, unknown>)?.label as string ?? clip.type ?? clip.id}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <Label>Transition</Label>
        <Select
          value={data.transition}
          onValueChange={(v) => onUpdate({ transition: v as CombineVideosData["transition"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cut">Cut</SelectItem>
            <SelectItem value="fade">Fade</SelectItem>
            <SelectItem value="dissolve">Dissolve</SelectItem>
            <SelectItem value="dip-to-black">Dip to Black</SelectItem>
            <SelectItem value="dip-to-white">Dip to White</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {data.transition !== "cut" && (
        <div>
          <Label htmlFor="transition-duration">Duration — {data.transitionDuration ?? 0.5}s</Label>
          <Input
            id="transition-duration"
            type="number"
            min={0.1}
            max={2}
            step={0.1}
            value={data.transitionDuration ?? 0.5}
            onChange={(e) =>
              onUpdate({ transitionDuration: parseFloat(e.target.value) || 0.5 })
            }
          />
        </div>
      )}

      <div>
        <Label>Audio</Label>
        <Select
          value={data.audioMode ?? "crossfade"}
          onValueChange={(v) => onUpdate({ audioMode: v as CombineVideosData["audioMode"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="keep">Keep original</SelectItem>
            <SelectItem value="crossfade">Crossfade</SelectItem>
            <SelectItem value="remove">Remove audio</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function SortableAssetItem({ id, index, label, typeLabel }: { id: string; index: number; label: string; typeLabel: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/50 text-xs">
      <span {...listeners} className="cursor-grab active:cursor-grabbing shrink-0 touch-none">
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40" />
      </span>
      <span className="text-muted-foreground w-4 text-center shrink-0">{index + 1}</span>
      <span className="truncate flex-1" title={label}>{label}</span>
      <span className="text-muted-foreground/60 text-[10px] shrink-0">{typeLabel}</span>
    </div>
  )
}

const RENDER_MEDIA_SOURCE_TYPES = new Set([
  "generate-image", "upload-image", "edit-image", "image-to-image",
  "image-to-video", "video-to-video", "text-to-video", "upload-video",
  "youtube-video", "combine-videos", "lip-sync", "motion-transfer",
  "video-upscale", "suno-music-video", "merge-video-audio", "add-captions",
  "resize-video", "trim-video",
  "text-to-speech", "text-to-audio", "generate-music", "upload-audio",
  "suno-generate", "suno-cover", "suno-extend", "suno-separate",
  "extract-audio", "mix-audio", "adjust-volume", "reference-audio",
])

const COMPOSER_PRESET_PROMPTS = [
  { label: "Slideshow", prompt: "Create a smooth cinematic slideshow with fade transitions between each image" },
  { label: "Explainer", prompt: "Create an explainer video with slide-in transitions, clear text overlays" },
  { label: "Social Reel", prompt: "Create an energetic social media reel with zoom-in transitions and quick cuts" },
  { label: "Documentary", prompt: "Create a documentary-style video with Ken Burns effect on images and atmospheric fades" },
]

/** Shared hook for media asset ordering via drag-and-drop. */
function useMediaOrder(
  sources: ReadonlyArray<SourceNodeInfo>,
  assetOrder: string[] | undefined,
  onUpdate: (d: Record<string, unknown>) => void,
) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const mediaSources = sources.filter((s) => RENDER_MEDIA_SOURCE_TYPES.has(s.type))
  const currentOrder = assetOrder ?? []
  const orderedIds = [
    ...currentOrder.filter((id) => mediaSources.some((s) => s.id === id)),
    ...mediaSources.filter((s) => !currentOrder.includes(s.id)).map((s) => s.id),
  ]
  const orderedSources = orderedIds.map((id) => mediaSources.find((s) => s.id === id)!).filter(Boolean)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedIds.indexOf(String(active.id))
    const newIndex = orderedIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const newOrder = [...orderedIds]
    const [moved] = newOrder.splice(oldIndex, 1)
    newOrder.splice(newIndex, 0, moved)
    onUpdate({ assetOrder: newOrder })
  }

  return { sensors, orderedIds, orderedSources, handleDragEnd }
}

/** Sortable media list with drag-and-drop reordering. */
function MediaOrderList({
  sensors,
  orderedIds,
  orderedSources,
  onDragEnd,
}: {
  sensors: ReturnType<typeof useSensors>
  orderedIds: string[]
  orderedSources: ReadonlyArray<SourceNodeInfo>
  onDragEnd: (event: DragEndEvent) => void
}) {
  if (orderedSources.length === 0) return null
  return (
    <div>
      <Label className="mb-1.5 block">Media Order</Label>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1">
            {orderedSources.map((s, i) => (
              <SortableAssetItem
                key={s.id}
                id={s.id}
                index={i}
                label={s.label}
                typeLabel={s.type.includes("image") ? "img" : "vid"}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

/** Shared video settings accordion (Aspect Ratio, FPS, Duration, Background Color). */
function VideoSettingsAccordion({
  aspectRatio,
  fps,
  durationSeconds,
  backgroundColor,
  onUpdate,
  idPrefix,
}: {
  aspectRatio: string
  fps: number
  durationSeconds: number
  backgroundColor: string
  onUpdate: (d: Record<string, unknown>) => void
  idPrefix: string
}) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="advanced" className="border-0">
        <AccordionTrigger className="text-xs text-muted-foreground py-1.5 hover:no-underline">
          Advanced Settings
        </AccordionTrigger>
        <AccordionContent className="space-y-3 pt-1">
          <div>
            <Label>Aspect Ratio</Label>
            <Select value={aspectRatio} onValueChange={(v) => onUpdate({ aspectRatio: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                <SelectItem value="1:1">1:1 (Square)</SelectItem>
                <SelectItem value="4:5">4:5 (Social)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-fps`}>FPS</Label>
            <Select value={String(fps)} onValueChange={(v) => onUpdate({ fps: parseInt(v, 10) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 fps (Film)</SelectItem>
                <SelectItem value="30">30 fps (Standard)</SelectItem>
                <SelectItem value="60">60 fps (Smooth)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-duration`}>Duration (seconds)</Label>
            <Input
              id={`${idPrefix}-duration`}
              type="number"
              min={1}
              max={300}
              value={durationSeconds}
              onChange={(e) => onUpdate({ durationSeconds: parseInt(e.target.value, 10) || 30 })}
            />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-bg`}>Background Color</Label>
            <Input
              id={`${idPrefix}-bg`}
              type="color"
              value={backgroundColor}
              onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
              className="h-8 w-full"
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function VideoComposerConfig({ data, onUpdate, sources }: ConfigProps<VideoComposerData>) {
  const [isGenerating, setIsGenerating] = useState(false)
  const { user } = useAuth()
  const { sensors, orderedIds, orderedSources, handleDragEnd } = useMediaOrder(sources, data.assetOrder, onUpdate)

  async function handleGenerateComposition() {
    if (!data.compositionPrompt?.trim() || !user?.id) return
    setIsGenerating(true)
    try {
      const { generateSceneGraph } = await import("@/lib/api")
      const assets = orderedSources.map((s) => {
        const nd = s.nodeData ?? {}
        const url = (nd.generatedImageUrl as string) || (nd.generatedVideoUrl as string) || s.value || ""
        return {
          id: s.id,
          type: (s.type.includes("image") ? "image" : "video") as "image" | "video",
          url,
          label: s.label,
        }
      }).filter((a) => a.url)

      const result = await generateSceneGraph({
        prompt: data.compositionPrompt,
        assets,
        fps: data.fps,
        aspectRatio: data.aspectRatio,
        durationSeconds: data.durationSeconds,
        userId: user.id,
      })
      onUpdate({ sceneGraph: result.sceneGraph })
    } catch {
      // Error toast handled by API layer
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <MediaOrderList sensors={sensors} orderedIds={orderedIds} orderedSources={orderedSources} onDragEnd={handleDragEnd} />

      <div>
        <Label className="mb-1.5 block">Composition Prompt</Label>
        <Textarea
          placeholder="Describe the style of video you want: cinematic product showcase with slow fades, energetic social reel with zoom cuts..."
          value={data.compositionPrompt ?? ""}
          onChange={(e) => onUpdate({ compositionPrompt: e.target.value })}
          rows={3}
          className="text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {COMPOSER_PRESET_PROMPTS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => onUpdate({ compositionPrompt: preset.prompt })}
            className="text-[10px] px-2 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[#ff0073] hover:text-[#ff0073] transition-colors"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <Button
        onClick={handleGenerateComposition}
        disabled={!data.compositionPrompt?.trim() || isGenerating || orderedSources.length === 0}
        className="w-full bg-[#ff0073] hover:bg-[#e0005f] text-white"
        size="sm"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Sparkles className="w-3 h-3 mr-1" />
            Generate Composition
            <span className="ml-1.5 text-[10px] opacity-80 bg-white/20 px-1.5 py-0.5 rounded">2 CR</span>
          </>
        )}
      </Button>

      {data.sceneGraph && (
        <>
          <Separator />
          <SceneGraphPreviewInline
            sceneGraph={data.sceneGraph}
            fps={data.fps}
            onUpdate={(sg) => onUpdate({ sceneGraph: sg })}
            onRegenerate={handleGenerateComposition}
            isGenerating={isGenerating}
          />
        </>
      )}

      <VideoSettingsAccordion
        aspectRatio={data.aspectRatio}
        fps={data.fps}
        durationSeconds={data.durationSeconds}
        backgroundColor={data.backgroundColor}
        onUpdate={onUpdate}
        idPrefix="composer"
      />
    </div>
  )
}

function RenderVideoConfig({ data, onUpdate, sources }: ConfigProps<RenderVideoData>) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const { sensors, orderedIds, orderedSources, handleDragEnd } = useMediaOrder(sources, data.assetOrder, onUpdate)

  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const upstreamComposer = useMemo(() => {
    if (!selectedNodeId) return undefined
    const inEdges = edges.filter((e) => e.target === selectedNodeId)
    for (const edge of inEdges) {
      const srcNode = nodes.find((n) => n.id === edge.source)
      if (srcNode?.type === "video-composer") {
        const composerData = srcNode.data as VideoComposerData
        return { label: composerData.label, trackCount: ((composerData.sceneGraph as Record<string, unknown>)?.tracks as unknown[])?.length ?? 0 }
      }
    }
    return undefined
  }, [selectedNodeId, edges, nodes])

  return (
    <div className="flex flex-col gap-3">
      {upstreamComposer && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-[#ff0073]/5 border border-[#ff0073]/20">
          <Sparkles className="w-4 h-4 text-[#ff0073] shrink-0" />
          <div className="text-xs">
            <span className="text-[var(--text-primary)]">Composition from </span>
            <span className="font-medium text-[#ff0073]">{upstreamComposer.label}</span>
            {upstreamComposer.trackCount > 0 && (
              <span className="ml-1 text-muted-foreground">({upstreamComposer.trackCount} tracks)</span>
            )}
          </div>
        </div>
      )}

      {!upstreamComposer && (
        <MediaOrderList sensors={sensors} orderedIds={orderedIds} orderedSources={orderedSources} onDragEnd={handleDragEnd} />
      )}

      <VideoSettingsAccordion
        aspectRatio={data.aspectRatio}
        fps={data.fps}
        durationSeconds={data.durationSeconds}
        backgroundColor={data.backgroundColor}
        onUpdate={onUpdate}
        idPrefix="render"
      />
    </div>
  )
}

const LazySceneGraphPreview = lazy(() => import("@/components/editor/scene-graph-preview").then(m => ({ default: m.SceneGraphPreview })))

function SceneGraphPreviewInline({
  sceneGraph,
  fps,
  onUpdate,
  onRegenerate,
  isGenerating,
}: {
  sceneGraph: Record<string, unknown>
  fps: number
  onUpdate: (sg: Record<string, unknown>) => void
  onRegenerate: () => void
  isGenerating: boolean
}) {
  return (
    <Suspense fallback={<div className="text-xs text-muted-foreground py-2">Loading preview...</div>}>
      <LazySceneGraphPreview
        sceneGraph={sceneGraph}
        fps={fps}
        onUpdate={onUpdate}
        onRegenerate={onRegenerate}
        isGenerating={isGenerating}
      />
    </Suspense>
  )
}

const AUDIO_SOURCE_TYPES = new Set([
  "text-to-speech", "generate-music", "text-to-audio",
  "upload-audio", "reference-audio", "extract-audio",
  "adjust-volume", "mix-audio",
])

const VIDEO_SOURCE_TYPES = new Set([
  "image-to-video", "video-to-video", "text-to-video",
  "lip-sync", "motion-transfer", "video-upscale",
  "combine-videos", "add-captions", "resize-video", "trim-video", "speed-ramp", "loop-video", "fade-video",
  "render-video", "upload-video", "youtube-video",
])

const TRACK_ROLE_OPTIONS = [
  { value: "dialogue", label: "Dialogue", icon: Mic, color: "text-pink-400 bg-pink-500/15" },
  { value: "narration", label: "Narration", icon: Mic, color: "text-purple-400 bg-purple-500/15" },
  { value: "background", label: "Background", icon: Music, color: "text-blue-400 bg-blue-500/15" },
  { value: "effect", label: "Effect", icon: AudioWaveform, color: "text-amber-400 bg-amber-500/15" },
] as const

function getRoleBadgeColor(role: string): string {
  return TRACK_ROLE_OPTIONS.find((o) => o.value === role)?.color ?? "text-muted-foreground bg-muted"
}

function getTrackIcon(sourceType: string) {
  if (sourceType === "text-to-speech") return Mic
  if (sourceType === "generate-music") return Music
  if (sourceType === "text-to-audio") return AudioWaveform
  if (VIDEO_SOURCE_TYPES.has(sourceType)) return Film
  return Volume2
}

function getTrackDefaultRole(sourceType: string): string {
  if (sourceType === "text-to-speech") return "dialogue"
  if (sourceType === "generate-music") return "background"
  if (sourceType === "text-to-audio") return "effect"
  return "background"
}

function MergeVideoAudioConfig({ data, onUpdate, nodes }: ConfigProps<MergeVideoAudioData>) {
  const edges = useWorkflowStore((s) => s.edges)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)

  const trackSettings = data.trackSettings ?? {}

  // Classify connected sources into video (first one) and audio tracks
  const { videoSource, audioSources } = useMemo(() => {
    if (!selectedNodeId) return { videoSource: null, audioSources: [] }
    const incomingEdges = edges.filter((e) => e.target === selectedNodeId)
    const sourceNodes = incomingEdges
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is typeof nodes[number] => n !== undefined)

    let firstVideo: typeof nodes[number] | null = null
    const audios: typeof nodes[number][] = []

    for (const src of sourceNodes) {
      if (!firstVideo && VIDEO_SOURCE_TYPES.has(src.type)) {
        firstVideo = src
      } else if (AUDIO_SOURCE_TYPES.has(src.type)) {
        audios.push(src)
      } else if (firstVideo && VIDEO_SOURCE_TYPES.has(src.type)) {
        // Additional video connections treated as audio extraction candidates
        audios.push(src)
      }
    }
    return { videoSource: firstVideo, audioSources: audios }
  }, [selectedNodeId, edges, nodes])

  function getTrackSetting(sourceNodeId: string, field: "role" | "volume" | "startTime") {
    const s = trackSettings[sourceNodeId]
    if (!s) {
      const src = audioSources.find((n) => n.id === sourceNodeId)
      if (field === "role") return getTrackDefaultRole(src?.type ?? "")
      if (field === "volume") return 100
      return 0
    }
    return s[field]
  }

  function updateTrackSetting(sourceNodeId: string, field: "role" | "volume" | "startTime", value: string | number) {
    const src = audioSources.find((n) => n.id === sourceNodeId)
    const existing = trackSettings[sourceNodeId] ?? {
      role: getTrackDefaultRole(src?.type ?? ""),
      volume: 100,
      startTime: 0,
    }
    onUpdate({
      trackSettings: {
        ...trackSettings,
        [sourceNodeId]: { ...existing, [field]: value },
      },
    })
  }

  const keepOriginal = data.keepOriginalAudio ?? true
  const origVolume = data.originalAudioVolume ?? 30

  return (
    <div className="flex flex-col gap-4">
      {/* Video Source Section */}
      <div>
        <Label className="text-xs text-[#ff0073] uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-2">
          <Film className="w-3.5 h-3.5" />
          Video Source
        </Label>
        {videoSource ? (
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2 mb-2">
              <Film className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium truncate">
                {(videoSource.data as Record<string, unknown>).label as string ?? videoSource.type}
              </span>
            </div>

            {/* Original audio controls */}
            <div className="border-t pt-2 mt-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Original Audio</span>
                <button
                  type="button"
                  className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors ${keepOriginal ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"}`}
                  onClick={() => onUpdate({ keepOriginalAudio: !keepOriginal })}
                >
                  {keepOriginal ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                  {keepOriginal ? "Keep" : "Muted"}
                </button>
              </div>

              {keepOriginal && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-12 shrink-0">Vol</span>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={origVolume}
                      onChange={(e) => onUpdate({ originalAudioVolume: parseInt(e.target.value, 10) })}
                      className="flex-1 h-1.5 accent-[#ff0073] cursor-pointer"
                    />
                    <Input
                      type="number"
                      min={0}
                      max={200}
                      value={origVolume}
                      onChange={(e) => onUpdate({ originalAudioVolume: parseInt(e.target.value, 10) || 0 })}
                      className="w-14 h-6 text-xs text-center px-1"
                    />
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-12 shrink-0">Role</span>
                    <Select
                      value={data.originalAudioRole ?? "background"}
                      onValueChange={(v) => onUpdate({ originalAudioRole: v })}
                    >
                      <SelectTrigger className="h-6 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="background">Background</SelectItem>
                        <SelectItem value="narration">Narration</SelectItem>
                        <SelectItem value="effect">Effect</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border-2 border-dashed border-muted-foreground/20 p-3 text-center">
            <p className="text-xs text-muted-foreground">No video connected</p>
          </div>
        )}
      </div>

      {/* Audio Tracks Section */}
      <div>
        <Label className="text-xs text-[#ff0073] uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-2">
          <Volume2 className="w-3.5 h-3.5" />
          Audio Tracks
          {audioSources.length > 0 && (
            <span className="bg-[#ff0073]/15 text-[#ff0073] text-[10px] rounded-full px-1.5 py-0.5 font-mono">
              {audioSources.length}
            </span>
          )}
        </Label>

        {audioSources.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-muted-foreground/20 p-3 text-center">
            <p className="text-xs text-muted-foreground">No audio sources connected</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">Connect TTS, Music, or Audio nodes</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {[...audioSources]
              .sort((a, b) => {
                const aStart = (getTrackSetting(a.id, "startTime") as number) ?? 0
                const bStart = (getTrackSetting(b.id, "startTime") as number) ?? 0
                return aStart - bStart
              })
              .map((src, idx) => {
              const srcLabel = (src.data as Record<string, unknown>).label as string ?? src.type
              const isVideoSource = VIDEO_SOURCE_TYPES.has(src.type)
              const TrackIcon = getTrackIcon(src.type)
              const vol = getTrackSetting(src.id, "volume") as number
              const startTime = getTrackSetting(src.id, "startTime") as number
              const role = getTrackSetting(src.id, "role") as string
              const roleBadge = getRoleBadgeColor(role)
              const srcData = src.data as Record<string, unknown>
              const previewUrl = (srcData.generatedAudioUrl as string)
                ?? (srcData.generatedVideoUrl as string)
                ?? ((srcData.generatedResults as readonly { url: string }[] | undefined)?.[
                  (srcData.activeResultIndex as number | undefined) ?? 0
                ]?.url)
                ?? (srcData.url as string)

              return (
                <div key={src.id} className="rounded-lg border bg-card overflow-hidden">
                  {/* Track header */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b">
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {idx + 1}
                    </span>
                    <TrackIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium truncate flex-1" title={srcLabel}>
                      {isVideoSource && (
                        <span className="text-amber-400 mr-1" title="Audio extracted from video">
                          {"[vid] "}
                        </span>
                      )}
                      {srcLabel}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${roleBadge}`}>
                      {TRACK_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role}
                    </span>
                    {previewUrl && (
                      <button
                        type="button"
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        title="Preview audio"
                        onClick={() => {
                          const audio = new Audio(previewUrl)
                          audio.volume = Math.min(vol / 100, 1)
                          audio.play()
                        }}
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Track controls */}
                  <div className="px-3 py-2 flex flex-col gap-1.5">
                    {/* Role */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-10 shrink-0">Role</span>
                      <Select
                        value={role}
                        onValueChange={(v) => updateTrackSetting(src.id, "role", v)}
                      >
                        <SelectTrigger className="h-6 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRACK_ROLE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Volume */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-10 shrink-0">Vol</span>
                      <input
                        type="range"
                        min={0}
                        max={200}
                        value={vol}
                        onChange={(e) => updateTrackSetting(src.id, "volume", parseInt(e.target.value, 10))}
                        className="flex-1 h-1.5 accent-[#ff0073] cursor-pointer"
                      />
                      <Input
                        type="number"
                        min={0}
                        max={200}
                        value={vol}
                        onChange={(e) => updateTrackSetting(src.id, "volume", parseInt(e.target.value, 10) || 0)}
                        className="w-14 h-6 text-xs text-center px-1"
                      />
                      <span className="text-[10px] text-muted-foreground">%</span>
                    </div>

                    {/* Start time */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-10 shrink-0">Start</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.1}
                        value={startTime}
                        onChange={(e) => updateTrackSetting(src.id, "startTime", parseFloat(e.target.value) || 0)}
                        className="flex-1 h-6 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">s</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function AddCaptionsConfig({ data, onUpdate }: ConfigProps<AddCaptionsData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Style</Label>
        <Select
          value={data.style}
          onValueChange={(v) => onUpdate({ style: v as AddCaptionsData["style"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="subtitle">Subtitle</SelectItem>
            <SelectItem value="word-highlight">Word Highlight</SelectItem>
            <SelectItem value="karaoke">Karaoke</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Position</Label>
        <Select
          value={data.position}
          onValueChange={(v) => onUpdate({ position: v as AddCaptionsData["position"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="bottom">Bottom</SelectItem>
            <SelectItem value="top">Top</SelectItem>
            <SelectItem value="center">Center</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="font-size">Font Size</Label>
        <Input
          id="font-size"
          type="number"
          min={8}
          max={72}
          value={data.fontSize}
          onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value, 10) || 24 })}
        />
      </div>
      <div>
        <Label htmlFor="caption-color">Color</Label>
        <Input
          id="caption-color"
          type="color"
          value={data.color}
          onChange={(e) => onUpdate({ color: e.target.value })}
        />
      </div>
    </div>
  )
}

function ResizeVideoConfig({ data, onUpdate }: ConfigProps<ResizeVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Target Aspect Ratio</Label>
        <Select
          value={data.targetAspect}
          onValueChange={(v) => onUpdate({ targetAspect: v as ResizeVideoData["targetAspect"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1:1">1:1 (Square)</SelectItem>
            <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
            <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
            <SelectItem value="4:5">4:5</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Method</Label>
        <Select
          value={data.method}
          onValueChange={(v) => onUpdate({ method: v as ResizeVideoData["method"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="crop">Crop</SelectItem>
            <SelectItem value="pad">Pad</SelectItem>
            <SelectItem value="stretch">Stretch</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="pad-color">Pad Color</Label>
        <Input
          id="pad-color"
          type="color"
          value={data.padColor}
          onChange={(e) => onUpdate({ padColor: e.target.value })}
        />
      </div>
    </div>
  )
}

function ExtractAudioConfig({ data, onUpdate }: ConfigProps<ExtractAudioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Audio Format</Label>
        <Select
          value={data.audioFormat}
          onValueChange={(v) => onUpdate({ audioFormat: v as ExtractAudioData["audioFormat"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mp3">MP3</SelectItem>
            <SelectItem value="wav">WAV</SelectItem>
            <SelectItem value="aac">AAC</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="output-silent"
          checked={data.outputSilentVideo}
          onChange={(e) => onUpdate({ outputSilentVideo: e.target.checked })}
        />
        <Label htmlFor="output-silent">Output silent video</Label>
      </div>
    </div>
  )
}

function MixAudioConfig({ data, onUpdate, nodes }: ConfigProps<MixAudioData>) {
  const edges = useWorkflowStore((s) => s.edges)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)

  const connectedNodeIds = edges
    .filter((e) => e.target === selectedNodeId)
    .map((e) => e.source)

  const connectedNodes = connectedNodeIds
    .map((id) => nodes?.find((n) => n.id === id))
    .filter(Boolean) as ReadonlyArray<WorkflowNode>

  const trackVolumes = data.trackVolumes ?? {}

  return (
    <div className="flex flex-col gap-3">
      {connectedNodes.length === 0 && (
        <p className="text-xs text-muted-foreground">Connect audio nodes to set per-track volumes.</p>
      )}
      {connectedNodes.map((node) => {
        const volume = trackVolumes[node.id] ?? 100
        const label = (node.data as Record<string, unknown>)?.label as string ?? node.type ?? node.id
        return (
          <div key={node.id}>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs truncate flex-1">{label}</Label>
              <span className="text-xs text-muted-foreground ml-2 tabular-nums">{volume}%</span>
            </div>
            <Input
              type="range"
              min={0}
              max={200}
              step={1}
              value={volume}
              onChange={(e) => onUpdate({
                trackVolumes: { ...trackVolumes, [node.id]: parseInt(e.target.value, 10) },
              })}
              className="w-full h-2 accent-[#ff0073]"
            />
          </div>
        )
      })}
    </div>
  )
}

function AdjustVolumeConfig({ data, onUpdate }: ConfigProps<AdjustVolumeData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="volume">Volume (%)</Label>
        <Input
          id="volume"
          type="number"
          min={0}
          max={200}
          value={data.volume}
          onChange={(e) => onUpdate({ volume: parseInt(e.target.value, 10) || 100 })}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="normalize"
          checked={data.normalize}
          onChange={(e) => onUpdate({ normalize: e.target.checked })}
        />
        <Label htmlFor="normalize">Normalize</Label>
      </div>
      <div>
        <Label htmlFor="fade-in">Fade In (s)</Label>
        <Input
          id="fade-in"
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={data.fadeIn}
          onChange={(e) => onUpdate({ fadeIn: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <div>
        <Label htmlFor="fade-out">Fade Out (s)</Label>
        <Input
          id="fade-out"
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={data.fadeOut}
          onChange={(e) => onUpdate({ fadeOut: parseFloat(e.target.value) || 0 })}
        />
      </div>
    </div>
  )
}

function TrimVideoConfig({ data, onUpdate }: ConfigProps<TrimVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="start-time">Start Time (s)</Label>
        <Input
          id="start-time"
          type="number"
          min={0}
          step={0.1}
          value={data.startTime}
          onChange={(e) => onUpdate({ startTime: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <div>
        <Label htmlFor="end-time">End Time (s)</Label>
        <Input
          id="end-time"
          type="number"
          min={0}
          step={0.1}
          value={data.endTime}
          onChange={(e) => onUpdate({ endTime: parseFloat(e.target.value) || 0 })}
        />
      </div>
    </div>
  )
}

function SpeedRampConfig({ data, onUpdate }: ConfigProps<SpeedRampData>) {
  const speedLabel = data.speed === 1 ? "1x (Normal)" : data.speed < 1 ? `${data.speed}x (Slow Mo)` : `${data.speed}x (Fast)`
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="speed">Speed: {speedLabel}</Label>
        <input
          id="speed"
          type="range"
          min={0.25}
          max={4.0}
          step={0.05}
          value={data.speed}
          onChange={(e) => onUpdate({ speed: parseFloat(e.target.value) })}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>0.25x</span>
          <span>1x</span>
          <span>4x</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="adjust-audio"
          checked={data.adjustAudio}
          onChange={(e) => onUpdate({ adjustAudio: e.target.checked })}
        />
        <Label htmlFor="adjust-audio">Adjust Audio Speed</Label>
      </div>
      <p className="text-[10px] text-muted-foreground">
        When audio adjustment is off, the audio track is removed entirely.
      </p>
    </div>
  )
}

function LoopVideoConfig({ data, onUpdate }: ConfigProps<LoopVideoData>) {
  const mode = data.mode ?? "repeat"
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Mode</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ mode: v as LoopVideoData["mode"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="repeat">Repeat N times</SelectItem>
            <SelectItem value="duration">Loop to duration</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "repeat" && (
        <div>
          <Label htmlFor="repeat-count">Repeat: {data.repeatCount ?? 2}x</Label>
          <input
            id="repeat-count"
            type="range"
            min={2}
            max={20}
            step={1}
            value={data.repeatCount ?? 2}
            onChange={(e) => onUpdate({ repeatCount: parseInt(e.target.value, 10) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>2x</span>
            <span>10x</span>
            <span>20x</span>
          </div>
        </div>
      )}

      {mode === "duration" && (
        <div>
          <Label htmlFor="target-duration">Target Duration: {data.targetDuration ?? 10}s</Label>
          <input
            id="target-duration"
            type="range"
            min={1}
            max={300}
            step={1}
            value={data.targetDuration ?? 10}
            onChange={(e) => onUpdate({ targetDuration: parseInt(e.target.value, 10) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>1s</span>
            <span>150s</span>
            <span>300s</span>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        {mode === "repeat"
          ? "The input video will be repeated the specified number of times."
          : "The input video will loop until the target duration is reached, then trim to exact length."}
      </p>
    </div>
  )
}

function FadeVideoConfig({ data, onUpdate }: { data: FadeVideoData; onUpdate: (patch: Partial<FadeVideoData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Fade Color</Label>
        <Select value={data.color ?? "black"} onValueChange={(v) => onUpdate({ color: v as "black" | "white" })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="black">Black</SelectItem>
            <SelectItem value="white">White</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="fade-in-toggle"
          checked={data.fadeIn !== false}
          onChange={(e) => onUpdate({ fadeIn: e.target.checked })}
          className="accent-[#ff0073]"
        />
        <Label htmlFor="fade-in-toggle" className="mb-0">Fade In</Label>
      </div>
      {data.fadeIn !== false && (
        <div>
          <Label htmlFor="fade-in-dur">Duration: {data.fadeInDuration ?? 0.5}s</Label>
          <input
            id="fade-in-dur"
            type="range"
            min={0.1}
            max={3}
            step={0.1}
            value={data.fadeInDuration ?? 0.5}
            onChange={(e) => onUpdate({ fadeInDuration: parseFloat(e.target.value) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>0.1s</span>
            <span>1.5s</span>
            <span>3s</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="fade-out-toggle"
          checked={data.fadeOut !== false}
          onChange={(e) => onUpdate({ fadeOut: e.target.checked })}
          className="accent-[#ff0073]"
        />
        <Label htmlFor="fade-out-toggle" className="mb-0">Fade Out</Label>
      </div>
      {data.fadeOut !== false && (
        <div>
          <Label htmlFor="fade-out-dur">Duration: {data.fadeOutDuration ?? 0.5}s</Label>
          <input
            id="fade-out-dur"
            type="range"
            min={0.1}
            max={3}
            step={0.1}
            value={data.fadeOutDuration ?? 0.5}
            onChange={(e) => onUpdate({ fadeOutDuration: parseFloat(e.target.value) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>0.1s</span>
            <span>1.5s</span>
            <span>3s</span>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Apply fade in/out transitions to video. Audio fades are applied automatically when the video has an audio track.
      </p>
    </div>
  )
}

/* ── Utility Node Configs ── */

function CombineTextConfig({ data, onUpdate }: { data: CombineTextNodeData; onUpdate: (patch: Partial<CombineTextNodeData>) => void }) {
  const SEPARATOR_OPTIONS = [
    { value: "newline", label: "New Line (\\n)" },
    { value: "double-newline", label: "Double New Line (\\n\\n)" },
    { value: "comma", label: "Comma (,)" },
    { value: "space", label: "Space" },
    { value: "custom", label: "Custom" },
  ] as const

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Separator</Label>
        <Select value={data.separator} onValueChange={(v) => onUpdate({ separator: v as CombineTextNodeData["separator"] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEPARATOR_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data.separator === "custom" && (
        <div>
          <Label>Custom Separator</Label>
          <Input
            value={data.customSeparator}
            onChange={(e) => onUpdate({ customSeparator: e.target.value })}
            placeholder="Enter separator..."
          />
        </div>
      )}

      {data.combinedText && (
        <div>
          <Label>Output Preview</Label>
          <Textarea
            rows={4}
            value={data.combinedText}
            readOnly
            className="text-xs opacity-70"
          />
        </div>
      )}
    </div>
  )
}

/* ── Output Node Configs ── */

function SaveToStorageConfig({ data, onUpdate }: ConfigProps<SaveToStorageData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="filename">Filename</Label>
        <Input
          id="filename"
          value={data.filename}
          onChange={(e) => onUpdate({ filename: e.target.value })}
          placeholder="output_video"
        />
      </div>
      <div>
        <Label>Format</Label>
        <Select
          value={data.format}
          onValueChange={(v) => onUpdate({ format: v as SaveToStorageData["format"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mp4">MP4</SelectItem>
            <SelectItem value="webm">WebM</SelectItem>
            <SelectItem value="mov">MOV</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Quality</Label>
        <Select
          value={data.quality}
          onValueChange={(v) => onUpdate({ quality: v as SaveToStorageData["quality"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="4k">4K</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function CharacterAssetButton({
  label,
  status,
  itemCount,
  onClick,
  disabled,
}: {
  readonly label: string
  readonly status: "idle" | "running" | "completed" | "failed"
  readonly itemCount: number
  readonly onClick: () => void
  readonly disabled?: boolean
}) {
  const isRunning = status === "running"
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-between text-xs h-8"
      disabled={isRunning || disabled}
      onClick={onClick}
    >
      <span className="flex items-center gap-1.5">
        {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
        {label}
      </span>
      {itemCount > 0 && (
        <span className="text-muted-foreground">{itemCount} images</span>
      )}
    </Button>
  )
}

function CharacterAssetGrid({ items }: { readonly items: readonly { name: string; url: string }[] }) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  if (items.length === 0) return null
  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => (
          <button
            key={item.name}
            type="button"
            className="flex flex-col items-center gap-0.5 cursor-pointer"
            onClick={() => setLightboxSrc(item.url)}
            title={`${item.name} - click to enlarge`}
          >
            <div className="w-full aspect-square rounded overflow-hidden bg-muted/30 hover:ring-2 hover:ring-primary/50 transition-shadow">
              <CachedImage src={item.url} alt={item.name} className="w-full h-full object-cover" thumbnail thumbnailWidth={160} />
            </div>
            <span className="text-[9px] text-muted-foreground truncate w-full text-center">{item.name}</span>
          </button>
        ))}
      </div>
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </>
  )
}

function CharacterConfig({ data, onUpdate }: { readonly data: CharacterNodeData; readonly onUpdate: (updates: Partial<CharacterNodeData>) => void }) {
  const generateAsset = useWorkflowStore((s) => s.generateCharacterAssetFn)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const nodes = useWorkflowStore((s) => s.nodes)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const hasPortrait = Boolean(
    ((data.generatedResults ?? [])[data.activeResultIndex ?? 0]?.url) || data.sourceImageUrl,
  )
  const isRunning = data.executionStatus === "running"

  // Check for duplicate character names across all character nodes
  const existingNames = useMemo(() => {
    const names: string[] = []
    for (const n of nodes) {
      if (n.type === "character" && n.id !== selectedNodeId) {
        const nd = n.data as CharacterNodeData
        if (nd.characterName) names.push(nd.characterName)
      }
    }
    return names
  }, [nodes, selectedNodeId])

  function handleNameChange(newName: string) {
    if (!newName) {
      onUpdate({ characterName: newName })
      return
    }
    // Auto-version duplicate names
    const baseName = newName
    let finalName = baseName
    let version = 2
    const wasVersioned = existingNames.includes(baseName)
    while (existingNames.includes(finalName)) {
      finalName = `${baseName} (${version})`
      version++
    }
    if (wasVersioned) {
      // Clear reference data so the new version starts fresh
      onUpdate({
        characterName: finalName,
        sourceImageUrl: "",
        generatedResults: [],
        activeResultIndex: 0,
        executionStatus: "idle",
      })
    } else {
      onUpdate({ characterName: finalName })
    }
  }

  const duplicateWarning = useMemo(() => {
    if (!data.characterName) return null
    // Skip duplicate check if character is already saved to DB - it's already established
    if (data.characterDbId) return null
    // Check if user typed a name that matches but hasn't been auto-versioned yet
    const exactMatch = existingNames.includes(data.characterName)
    if (exactMatch) return `A character named "${data.characterName}" already exists. It will be auto-versioned on blur.`
    return null
  }, [data.characterName, data.characterDbId, existingNames])

  async function handleUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { url } = await uploadImage(file)
      onUpdate({ sourceImageUrl: url })
    } catch (err) {
      // error already thrown by uploadImage
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  function handleGenerateAsset(assetType: "expressions" | "poses" | "lighting" | "angles") {
    if (!selectedNodeId || !generateAsset) return
    generateAsset(selectedNodeId, assetType)
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="char-name">Character Name</Label>
        <Input
          id="char-name"
          value={data.characterName}
          onChange={(e) => onUpdate({ characterName: e.target.value })}
          onBlur={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Sir Aldric"
        />
        {duplicateWarning && (
          <p className="text-[10px] text-amber-500 mt-0.5">{duplicateWarning}</p>
        )}
      </div>
      <div>
        <Label htmlFor="char-desc">Description</Label>
        <Textarea
          id="char-desc"
          value={data.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="A brave knight in his 30s with blonde hair..."
          rows={3}
        />
      </div>
      <div>
        <Label htmlFor="char-gender">Gender</Label>
        <Select value={data.gender} onValueChange={(v) => onUpdate({ gender: v as CharacterNodeData["gender"] })}>
          <SelectTrigger id="char-gender">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="char-style">Style</Label>
        <Select value={data.style} onValueChange={(v) => onUpdate({ style: v as CharacterNodeData["style"] })}>
          <SelectTrigger id="char-style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="realistic">Realistic</SelectItem>
            <SelectItem value="anime">Anime</SelectItem>
            <SelectItem value="3d-pixar">3D Pixar</SelectItem>
            <SelectItem value="illustration">Illustration</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="char-outfit">Base Outfit</Label>
        <Textarea
          id="char-outfit"
          value={data.baseOutfit}
          onChange={(e) => onUpdate({ baseOutfit: e.target.value })}
          placeholder="Steel plate armor with blue cape..."
          rows={2}
        />
      </div>

      {/* Source image: URL input + Upload button */}
      <div>
        <Label htmlFor="char-image">Reference Image</Label>
        <div className="flex gap-1.5">
          <Input
            id="char-image"
            value={data.sourceImageUrl}
            onChange={(e) => onUpdate({ sourceImageUrl: e.target.value })}
            placeholder="https://... or upload"
            className="flex-1"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleUploadImage}
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 h-9 w-9"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            title="Upload image from computer"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Generate Portrait button */}
      <Button
        size="sm"
        className="w-full text-xs h-8 text-white hover:opacity-90"
        style={{ backgroundColor: '#ff0073' }}
        disabled={isRunning || !data.characterName}
        onClick={() => {
          if (selectedNodeId && runSingleNode) runSingleNode(selectedNodeId)
        }}
      >
        {isRunning ? (
          <>
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Play className="w-3 h-3 mr-1.5" />
            Generate Portrait
          </>
        )}
      </Button>

      <Separator />

      {/* Asset Generation - requires portrait first */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">
          Character Assets
        </Label>
        {!hasPortrait && (
          <p className="text-[10px] text-muted-foreground">
            Generate or upload a main portrait first, then generate assets below.
          </p>
        )}

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="angles">
            <AccordionTrigger className="text-xs py-1.5">
              Angles ({(data.angles ?? []).length})
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <CharacterAssetButton
                label="Generate Angles"
                status={data.anglesStatus ?? "idle"}
                itemCount={(data.angles ?? []).length}
                onClick={() => handleGenerateAsset("angles")}
                disabled={!hasPortrait}
              />
              <CharacterAssetGrid items={data.angles ?? []} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="expressions">
            <AccordionTrigger className="text-xs py-1.5">
              Expressions ({(data.expressions ?? []).length})
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <CharacterAssetButton
                label="Generate Expressions"
                status={data.expressionStatus ?? "idle"}
                itemCount={(data.expressions ?? []).length}
                onClick={() => handleGenerateAsset("expressions")}
                disabled={!hasPortrait}
              />
              <CharacterAssetGrid items={data.expressions ?? []} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="poses">
            <AccordionTrigger className="text-xs py-1.5">
              Poses ({(data.poses ?? []).length})
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <CharacterAssetButton
                label="Generate Poses"
                status={data.poseStatus ?? "idle"}
                itemCount={(data.poses ?? []).length}
                onClick={() => handleGenerateAsset("poses")}
                disabled={!hasPortrait}
              />
              <CharacterAssetGrid items={data.poses ?? []} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="lighting">
            <AccordionTrigger className="text-xs py-1.5">
              Lighting ({(data.lightingVariations ?? []).length})
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <CharacterAssetButton
                label="Generate Lighting"
                status={data.lightingStatus ?? "idle"}
                itemCount={(data.lightingVariations ?? []).length}
                onClick={() => handleGenerateAsset("lighting")}
                disabled={!hasPortrait}
              />
              <CharacterAssetGrid items={data.lightingVariations ?? []} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs h-8 mt-1"
          disabled={
            !hasPortrait ||
            data.expressionStatus === "running" ||
            data.poseStatus === "running" ||
            data.lightingStatus === "running" ||
            data.anglesStatus === "running" ||
            !data.characterName
          }
          onClick={() => {
            handleGenerateAsset("angles")
            setTimeout(() => handleGenerateAsset("expressions"), 500)
            setTimeout(() => handleGenerateAsset("poses"), 1000)
            setTimeout(() => handleGenerateAsset("lighting"), 1500)
          }}
        >
          <Sparkles className="w-3 h-3 mr-1.5" />
          Generate All Assets
        </Button>
      </div>
    </div>
  )
}

function FaceConfig({ data, onUpdate }: { readonly data: FaceNodeData; readonly onUpdate: (updates: Partial<FaceNodeData>) => void }) {
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const isRunning = data.executionStatus === "running"

  const hasConnectedImage = useMemo(() => {
    if (!selectedNodeId) return false
    const IMAGE_TYPES = new Set(["upload-image", "generate-image", "edit-image", "image-to-image"])
    return edges
      .filter((e) => e.target === selectedNodeId)
      .some((e) => {
        const src = nodes.find((n) => n.id === e.source)
        return src && IMAGE_TYPES.has(src.type ?? "")
      })
  }, [selectedNodeId, edges, nodes])

  // Check for duplicate face names across all face nodes
  const existingNames = useMemo(() => {
    const names: string[] = []
    for (const n of nodes) {
      if (n.type === "face" && n.id !== selectedNodeId) {
        const nd = n.data as FaceNodeData
        if (nd.faceName) names.push(nd.faceName)
      }
    }
    return names
  }, [nodes, selectedNodeId])

  function handleNameChange(newName: string) {
    if (!newName) {
      onUpdate({ faceName: newName })
      return
    }
    let finalName = newName
    let version = 2
    const wasVersioned = existingNames.includes(newName)
    while (existingNames.includes(finalName)) {
      finalName = `${newName} (${version})`
      version++
    }
    if (wasVersioned) {
      onUpdate({
        faceName: finalName,
        generatedResults: [],
        activeResultIndex: 0,
        executionStatus: "idle",
      })
    } else {
      onUpdate({ faceName: finalName })
    }
  }

  const duplicateWarning = useMemo(() => {
    if (!data.faceName) return null
    if (data.faceDbId) return null
    const exactMatch = existingNames.includes(data.faceName)
    if (exactMatch) return `A face named "${data.faceName}" already exists. It will be auto-versioned on blur.`
    return null
  }, [data.faceName, data.faceDbId, existingNames])

  async function handleUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { url } = await uploadImage(file)
      onUpdate({ sourceImageUrl: url })
    } catch {
      // error already thrown by uploadImage
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="face-name">Face Name</Label>
        <Input
          id="face-name"
          value={data.faceName}
          onChange={(e) => onUpdate({ faceName: e.target.value })}
          onBlur={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. John Smith"
        />
        {duplicateWarning && (
          <p className="text-[10px] text-amber-500 mt-0.5">{duplicateWarning}</p>
        )}
      </div>
      <div>
        <Label htmlFor="face-desc">Description</Label>
        <Textarea
          id="face-desc"
          value={data.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="A person in their 30s with brown eyes and short dark hair..."
          rows={3}
        />
      </div>
      <div>
        <Label htmlFor="face-style">Style</Label>
        <Select value={data.style} onValueChange={(v) => onUpdate({ style: v as FaceNodeData["style"] })}>
          <SelectTrigger id="face-style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="realistic">Realistic</SelectItem>
            <SelectItem value="anime">Anime</SelectItem>
            <SelectItem value="3d-pixar">3D Pixar</SelectItem>
            <SelectItem value="illustration">Illustration</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Source image: URL input + Upload button */}
      <div>
        <Label htmlFor="face-image">Reference Photo</Label>
        <p className="text-[10px] text-muted-foreground mb-1">
          Upload a clear face photo. This will be used to maintain facial identity in generated images.
        </p>
        <div className="flex gap-1.5">
          <Input
            id="face-image"
            value={data.sourceImageUrl}
            onChange={(e) => onUpdate({ sourceImageUrl: e.target.value })}
            placeholder="https://... or upload"
            className="flex-1"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleUploadImage}
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 h-9 w-9"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            title="Upload image from computer"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Generate Headshot button */}
      <Button
        size="sm"
        className="w-full text-xs h-8 text-white hover:opacity-90"
        style={{ backgroundColor: '#ff0073' }}
        disabled={isRunning || !data.faceName || (!data.sourceImageUrl && !hasConnectedImage)}
        onClick={() => {
          if (selectedNodeId && runSingleNode) runSingleNode(selectedNodeId)
        }}
      >
        {isRunning ? (
          <>
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Play className="w-3 h-3 mr-1.5" />
            Generate Headshot
          </>
        )}
      </Button>
      {!data.sourceImageUrl && !hasConnectedImage && data.faceName && (
        <p className="text-[10px] text-muted-foreground">
          Upload a reference photo or connect an Upload Image node to enable headshot generation.
        </p>
      )}
    </div>
  )
}

function ObjectConfig({ data, onUpdate }: { readonly data: ObjectNodeData; readonly onUpdate: (updates: Partial<ObjectNodeData>) => void }) {
  const generateAsset = useWorkflowStore((s) => s.generateObjectAssetFn)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const nodes = useWorkflowStore((s) => s.nodes)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const hasImage = Boolean(
    ((data.generatedResults ?? [])[data.activeResultIndex ?? 0]?.url) || data.sourceImageUrl,
  )
  const isRunning = data.executionStatus === "running"

  // Check for duplicate object names across all object nodes
  const existingNames = useMemo(() => {
    const names: string[] = []
    for (const n of nodes) {
      if (n.type === "object" && n.id !== selectedNodeId) {
        const nd = n.data as ObjectNodeData
        if (nd.objectName) names.push(nd.objectName)
      }
    }
    return names
  }, [nodes, selectedNodeId])

  function handleNameChange(newName: string) {
    if (!newName) {
      onUpdate({ objectName: newName })
      return
    }
    // Auto-version duplicate names
    const baseName = newName
    let finalName = baseName
    let version = 2
    const wasVersioned = existingNames.includes(baseName)
    while (existingNames.includes(finalName)) {
      finalName = `${baseName} (${version})`
      version++
    }
    if (wasVersioned) {
      // Clear reference data so the new version starts fresh
      onUpdate({
        objectName: finalName,
        sourceImageUrl: "",
        generatedResults: [],
        activeResultIndex: 0,
        executionStatus: "idle",
      })
    } else {
      onUpdate({ objectName: finalName })
    }
  }

  const duplicateWarning = useMemo(() => {
    if (!data.objectName) return null
    // Skip duplicate check if object is already saved to DB - it's already established
    if (data.objectDbId) return null
    // Check if user typed a name that matches but hasn't been auto-versioned yet
    const exactMatch = existingNames.includes(data.objectName)
    if (exactMatch) return `An object named "${data.objectName}" already exists. It will be auto-versioned on blur.`
    return null
  }, [data.objectName, data.objectDbId, existingNames])

  async function handleUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { url } = await uploadImage(file)
      onUpdate({ sourceImageUrl: url })
    } catch (err) {
      // error already thrown by uploadImage
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  function handleGenerateAsset(assetType: "angles" | "materials" | "variations") {
    if (!selectedNodeId || !generateAsset) return
    generateAsset(selectedNodeId, assetType)
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="obj-name">Object Name</Label>
        <Input
          id="obj-name"
          value={data.objectName}
          onChange={(e) => onUpdate({ objectName: e.target.value })}
          onBlur={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Magic Sword"
        />
        {duplicateWarning && (
          <p className="text-[10px] text-amber-500 mt-0.5">{duplicateWarning}</p>
        )}
      </div>
      <div>
        <Label htmlFor="obj-desc">Description</Label>
        <Textarea
          id="obj-desc"
          value={data.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="A glowing sword with ancient runes..."
          rows={3}
        />
      </div>
      <div>
        <Label htmlFor="obj-category">Category</Label>
        <Select value={data.category} onValueChange={(v) => onUpdate({ category: v as ObjectNodeData["category"] })}>
          <SelectTrigger id="obj-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="furniture">Furniture</SelectItem>
            <SelectItem value="vehicle">Vehicle</SelectItem>
            <SelectItem value="weapon">Weapon</SelectItem>
            <SelectItem value="food">Food</SelectItem>
            <SelectItem value="clothing">Clothing</SelectItem>
            <SelectItem value="electronics">Electronics</SelectItem>
            <SelectItem value="nature">Nature</SelectItem>
            <SelectItem value="tool">Tool</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="obj-style">Style</Label>
        <Select value={data.style} onValueChange={(v) => onUpdate({ style: v as ObjectNodeData["style"] })}>
          <SelectTrigger id="obj-style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="realistic">Realistic</SelectItem>
            <SelectItem value="anime">Anime</SelectItem>
            <SelectItem value="3d-pixar">3D Pixar</SelectItem>
            <SelectItem value="illustration">Illustration</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Source image: URL input + Upload button */}
      <div>
        <Label htmlFor="obj-image">Reference Image</Label>
        <div className="flex gap-1.5">
          <Input
            id="obj-image"
            value={data.sourceImageUrl}
            onChange={(e) => onUpdate({ sourceImageUrl: e.target.value })}
            placeholder="https://... or upload"
            className="flex-1"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleUploadImage}
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 h-9 w-9"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            title="Upload image from computer"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Generate Image button */}
      <Button
        size="sm"
        className="w-full text-xs h-8 text-white hover:opacity-90"
        style={{ backgroundColor: '#ff0073' }}
        disabled={isRunning || !data.objectName}
        onClick={() => {
          if (selectedNodeId && runSingleNode) runSingleNode(selectedNodeId)
        }}
      >
        {isRunning ? (
          <>
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Play className="w-3 h-3 mr-1.5" />
            Generate Image
          </>
        )}
      </Button>

      <Separator />

      {/* Asset Generation - requires main image first */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">
          Object Assets
        </Label>
        {!hasImage && (
          <p className="text-[10px] text-muted-foreground">
            Generate or upload a main image first, then generate assets below.
          </p>
        )}

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="angles">
            <AccordionTrigger className="text-xs py-1.5">
              Angles ({(data.angles ?? []).length})
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <ObjectAssetButton
                label="Generate Angles"
                status={data.anglesStatus ?? "idle"}
                itemCount={(data.angles ?? []).length}
                onClick={() => handleGenerateAsset("angles")}
                disabled={!hasImage}
              />
              <ObjectAssetGrid items={data.angles ?? []} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="materials">
            <AccordionTrigger className="text-xs py-1.5">
              Materials ({(data.materials ?? []).length})
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <ObjectAssetButton
                label="Generate Materials"
                status={data.materialsStatus ?? "idle"}
                itemCount={(data.materials ?? []).length}
                onClick={() => handleGenerateAsset("materials")}
                disabled={!hasImage}
              />
              <ObjectAssetGrid items={data.materials ?? []} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="variations">
            <AccordionTrigger className="text-xs py-1.5">
              Variations ({(data.variations ?? []).length})
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <ObjectAssetButton
                label="Generate Variations"
                status={data.variationsStatus ?? "idle"}
                itemCount={(data.variations ?? []).length}
                onClick={() => handleGenerateAsset("variations")}
                disabled={!hasImage}
              />
              <ObjectAssetGrid items={data.variations ?? []} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs h-8 mt-1"
          disabled={
            !hasImage ||
            data.anglesStatus === "running" ||
            data.materialsStatus === "running" ||
            data.variationsStatus === "running" ||
            !data.objectName
          }
          onClick={() => {
            handleGenerateAsset("angles")
            setTimeout(() => handleGenerateAsset("materials"), 500)
            setTimeout(() => handleGenerateAsset("variations"), 1000)
          }}
        >
          <Sparkles className="w-3 h-3 mr-1.5" />
          Generate All Assets
        </Button>
      </div>
    </div>
  )
}

function ObjectAssetButton({
  label,
  status,
  itemCount,
  onClick,
  disabled,
}: {
  readonly label: string
  readonly status: string
  readonly itemCount: number
  readonly onClick: () => void
  readonly disabled: boolean
}) {
  const isRunning = status === "running"
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full text-xs h-7 justify-start"
      disabled={disabled || isRunning}
      onClick={onClick}
    >
      {isRunning ? (
        <>
          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          Generating...
        </>
      ) : itemCount > 0 ? (
        <>
          <Check className="w-3 h-3 mr-1.5 text-emerald-500" />
          {label} ({itemCount})
        </>
      ) : (
        <>
          <Play className="w-3 h-3 mr-1.5" />
          {label}
        </>
      )}
    </Button>
  )
}

function ObjectAssetGrid({ items }: { readonly items: Array<{ name: string; url: string }> }) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  if (items.length === 0) return null
  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => (
          <button
            key={item.url}
            type="button"
            className="relative aspect-square rounded overflow-hidden bg-muted/30 group cursor-pointer"
            onClick={() => setLightboxSrc(item.url)}
            title={item.name}
          >
            <CachedImage src={item.url} alt={item.name} className="w-full h-full object-cover" thumbnail thumbnailWidth={160} />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Maximize2 className="w-4 h-4 text-white" />
            </div>
            <span className="absolute bottom-0 left-0 right-0 text-[8px] bg-black/60 text-white text-center truncate px-0.5">
              {item.name}
            </span>
          </button>
        ))}
      </div>
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </>
  )
}

function WebhookOutputConfig({ data, onUpdate }: ConfigProps<WebhookOutputData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="webhook-id">Webhook ID</Label>
        <Input
          id="webhook-id"
          value={data.webhookId}
          onChange={(e) => onUpdate({ webhookId: e.target.value })}
          placeholder="Select or enter webhook..."
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="include-asset"
          checked={data.includeAssetUrl}
          onChange={(e) => onUpdate({ includeAssetUrl: e.target.checked })}
        />
        <Label htmlFor="include-asset">Include asset URL</Label>
      </div>
    </div>
  )
}

function LocationConfig({ data, onUpdate }: { readonly data: LocationNodeData; readonly onUpdate: (updates: Partial<LocationNodeData>) => void }) {
  const generateAsset = useWorkflowStore((s) => s.generateLocationAssetFn)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const nodes = useWorkflowStore((s) => s.nodes)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const hasImage = Boolean(
    ((data.generatedResults ?? [])[data.activeResultIndex ?? 0]?.url) || data.sourceImageUrl,
  )
  const isRunning = data.executionStatus === "running"

  // Check for duplicate location names across all location nodes
  const existingNames = useMemo(() => {
    const names: string[] = []
    for (const n of nodes) {
      if (n.type === "location" && n.id !== selectedNodeId) {
        const nd = n.data as LocationNodeData
        if (nd.locationName) names.push(nd.locationName)
      }
    }
    return names
  }, [nodes, selectedNodeId])

  function handleNameChange(newName: string) {
    if (!newName) {
      onUpdate({ locationName: newName })
      return
    }
    // Auto-version duplicate names
    const baseName = newName
    let finalName = baseName
    let version = 2
    const wasVersioned = existingNames.includes(baseName)
    while (existingNames.includes(finalName)) {
      finalName = `${baseName} (${version})`
      version++
    }
    if (wasVersioned) {
      // Clear reference data so the new version starts fresh
      onUpdate({
        locationName: finalName,
        sourceImageUrl: "",
        generatedResults: [],
        activeResultIndex: 0,
        executionStatus: "idle",
      })
    } else {
      onUpdate({ locationName: finalName })
    }
  }

  const duplicateWarning = useMemo(() => {
    if (!data.locationName) return null
    // Skip duplicate check if location is already saved to DB - it's already established
    if (data.locationDbId) return null
    // Check if user typed a name that matches but hasn't been auto-versioned yet
    const exactMatch = existingNames.includes(data.locationName)
    if (exactMatch) return `A location named "${data.locationName}" already exists. It will be auto-versioned on blur.`
    return null
  }, [data.locationName, data.locationDbId, existingNames])

  async function handleUploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { url } = await uploadImage(file)
      onUpdate({ sourceImageUrl: url })
    } catch {
      // error already thrown by uploadImage
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  function handleGenerateAsset(assetType: "timeOfDay" | "weather" | "angles") {
    if (!selectedNodeId || !generateAsset) return
    generateAsset(selectedNodeId, assetType)
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="loc-name">Location Name</Label>
        <Input
          id="loc-name"
          value={data.locationName}
          onChange={(e) => onUpdate({ locationName: e.target.value })}
          onBlur={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Ancient Forest"
        />
        {duplicateWarning && (
          <p className="text-[10px] text-amber-500 mt-0.5">{duplicateWarning}</p>
        )}
      </div>
      <div>
        <Label htmlFor="loc-desc">Description</Label>
        <Textarea
          id="loc-desc"
          value={data.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="A mystical forest with ancient trees..."
          rows={3}
        />
      </div>
      <div>
        <Label htmlFor="loc-category">Category</Label>
        <Select value={data.category} onValueChange={(v) => onUpdate({ category: v as LocationNodeData["category"] })}>
          <SelectTrigger id="loc-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="indoor">Indoor</SelectItem>
            <SelectItem value="outdoor">Outdoor</SelectItem>
            <SelectItem value="urban">Urban</SelectItem>
            <SelectItem value="nature">Nature</SelectItem>
            <SelectItem value="fantasy">Fantasy</SelectItem>
            <SelectItem value="sci-fi">Sci-Fi</SelectItem>
            <SelectItem value="historical">Historical</SelectItem>
            <SelectItem value="futuristic">Futuristic</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="loc-style">Style</Label>
        <Select value={data.style} onValueChange={(v) => onUpdate({ style: v as LocationNodeData["style"] })}>
          <SelectTrigger id="loc-style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="realistic">Realistic</SelectItem>
            <SelectItem value="anime">Anime</SelectItem>
            <SelectItem value="3d-pixar">3D Pixar</SelectItem>
            <SelectItem value="illustration">Illustration</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Source image: URL input + Upload button */}
      <div>
        <Label htmlFor="loc-image">Reference Image</Label>
        <div className="flex gap-1.5">
          <Input
            id="loc-image"
            value={data.sourceImageUrl}
            onChange={(e) => onUpdate({ sourceImageUrl: e.target.value })}
            placeholder="https://... or upload"
            className="flex-1"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleUploadImage}
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 h-9 w-9"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            title="Upload image from computer"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Generate Image button */}
      <Button
        size="sm"
        className="w-full text-xs h-8 text-white hover:opacity-90"
        style={{ backgroundColor: '#ff0073' }}
        disabled={isRunning || !data.locationName}
        onClick={() => {
          if (selectedNodeId && runSingleNode) runSingleNode(selectedNodeId)
        }}
      >
        {isRunning ? (
          <>
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Play className="w-3 h-3 mr-1.5" />
            Generate Image
          </>
        )}
      </Button>

      <Separator />

      {/* Asset Generation - requires main image first */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">
          Location Assets
        </Label>
        {!hasImage && (
          <p className="text-[10px] text-muted-foreground">
            Generate or upload a main image first, then generate assets below.
          </p>
        )}

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="timeOfDay">
            <AccordionTrigger className="text-xs py-1.5">
              Time of Day ({(data.timeOfDay ?? []).length})
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <LocationAssetButton
                label="Generate Time of Day"
                status={data.timeOfDayStatus ?? "idle"}
                itemCount={(data.timeOfDay ?? []).length}
                onClick={() => handleGenerateAsset("timeOfDay")}
                disabled={!hasImage}
              />
              <LocationAssetGrid items={data.timeOfDay ?? []} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="weather">
            <AccordionTrigger className="text-xs py-1.5">
              Weather ({(data.weather ?? []).length})
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <LocationAssetButton
                label="Generate Weather"
                status={data.weatherStatus ?? "idle"}
                itemCount={(data.weather ?? []).length}
                onClick={() => handleGenerateAsset("weather")}
                disabled={!hasImage}
              />
              <LocationAssetGrid items={data.weather ?? []} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="angles">
            <AccordionTrigger className="text-xs py-1.5">
              Angles ({(data.angles ?? []).length})
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2">
              <LocationAssetButton
                label="Generate Angles"
                status={data.anglesStatus ?? "idle"}
                itemCount={(data.angles ?? []).length}
                onClick={() => handleGenerateAsset("angles")}
                disabled={!hasImage}
              />
              <LocationAssetGrid items={data.angles ?? []} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs h-8 mt-1"
          disabled={
            !hasImage ||
            data.timeOfDayStatus === "running" ||
            data.weatherStatus === "running" ||
            data.anglesStatus === "running" ||
            !data.locationName
          }
          onClick={() => {
            handleGenerateAsset("timeOfDay")
            setTimeout(() => handleGenerateAsset("weather"), 500)
            setTimeout(() => handleGenerateAsset("angles"), 1000)
          }}
        >
          <Sparkles className="w-3 h-3 mr-1.5" />
          Generate All Assets
        </Button>
      </div>
    </div>
  )
}

function LocationAssetButton({
  label,
  status,
  itemCount,
  onClick,
  disabled,
}: {
  readonly label: string
  readonly status: string
  readonly itemCount: number
  readonly onClick: () => void
  readonly disabled: boolean
}) {
  const isRunning = status === "running"
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full text-xs h-7 justify-start"
      disabled={disabled || isRunning}
      onClick={onClick}
    >
      {isRunning ? (
        <>
          <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          Generating...
        </>
      ) : itemCount > 0 ? (
        <>
          <Check className="w-3 h-3 mr-1.5 text-cyan-500" />
          {label} ({itemCount})
        </>
      ) : (
        <>
          <Play className="w-3 h-3 mr-1.5" />
          {label}
        </>
      )}
    </Button>
  )
}

function LocationAssetGrid({ items }: { readonly items: Array<{ name: string; url: string }> }) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  if (items.length === 0) return null
  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {items.map((item) => (
          <button
            key={item.url}
            type="button"
            className="relative aspect-square rounded overflow-hidden bg-muted/30 group cursor-pointer"
            onClick={() => setLightboxSrc(item.url)}
            title={item.name}
          >
            <CachedImage src={item.url} alt={item.name} className="w-full h-full object-cover" thumbnail thumbnailWidth={160} />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Maximize2 className="w-4 h-4 text-white" />
            </div>
            <span className="absolute bottom-0 left-0 right-0 text-[8px] bg-black/60 text-white text-center truncate px-0.5">
              {item.name}
            </span>
          </button>
        ))}
      </div>
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </>
  )
}

function AIWriterConfig({ data, onUpdate }: ConfigProps<AIWriterNodeData>) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const [expandedItemIndex, setExpandedItemIndex] = useState<number | null>(null)
  const currentTemplate = getAIWriterTemplate(data.templateId)

  // Track execution progress of created image nodes
  const createdIds = data.createdNodeIds ?? []
  const allNodes = useWorkflowStore((s) => s.nodes)
  const imageNodeStatuses = useMemo(() => {
    if (createdIds.length === 0) return { running: 0, completed: 0, failed: 0, total: 0 }
    let running = 0, completed = 0, failed = 0
    for (const id of createdIds) {
      const node = allNodes.find((n) => n.id === id)
      const status = (node?.data as Record<string, unknown>)?.executionStatus as string | undefined
      if (status === "running") running += 1
      else if (status === "completed") completed += 1
      else if (status === "failed") failed += 1
    }
    return { running, completed, failed, total: createdIds.length }
  }, [createdIds, allNodes])
  const isGenerating = imageNodeStatuses.running > 0

  // Check if a reference image source is connected to this AI Writer node
  const allEdges = useWorkflowStore((s) => s.edges)
  const hasRefImage = useMemo(() => {
    if (!selectedNodeId) return false
    const IMG_SRC_TYPES = new Set(["generate-image", "upload-image", "edit-image", "image-to-image", "character", "object", "location", "face"])
    return allEdges
      .filter((e) => e.target === selectedNodeId)
      .some((e) => {
        const src = allNodes.find((n) => n.id === e.source)
        return src && IMG_SRC_TYPES.has(src.type ?? "")
      })
  }, [selectedNodeId, allEdges, allNodes])
  const isPresetTemplate = data.templateId !== "custom"
  const needsRefImage = isPresetTemplate && !hasRefImage

  function handleTemplateChange(templateId: string) {
    const tpl = getAIWriterTemplate(templateId)
    if (!tpl) return
    // Check if userInput is empty or matches the previous template's defaultInput
    const prevTpl = getAIWriterTemplate(data.templateId)
    const isDefaultOrEmpty = !data.userInput?.trim() || data.userInput === prevTpl?.defaultInput
    onUpdate({
      templateId,
      systemPrompt: tpl.systemPrompt,
      ...(isDefaultOrEmpty && tpl.defaultInput ? { userInput: tpl.defaultInput } : {}),
      ...(tpl.defaultMaxTokens ? { maxTokens: tpl.defaultMaxTokens } : {}),
    })
  }

  return (
    <>
      {/* Template Selector */}
      <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-3">
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Template</Label>
        <Select value={data.templateId} onValueChange={handleTemplateChange}>
          <SelectTrigger className="bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_WRITER_TEMPLATES.map((tpl) => (
              <SelectItem key={tpl.id} value={tpl.id}>
                {tpl.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {currentTemplate && currentTemplate.id !== "custom" && (
          <p className="text-xs text-muted-foreground">{currentTemplate.description}</p>
        )}
      </div>

      {/* Reference Image Warning */}
      {needsRefImage && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 shadow-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Connect a reference image node (Generate Image, Upload Image) to AI Agent for character consistency across all generated images.
            </p>
          </div>
        </div>
      )}

      {/* System Prompt */}
      <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">System Prompt</Label>
        <Textarea
          rows={6}
          value={data.systemPrompt}
          onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
          placeholder="Instructions for the AI writer..."
          className="bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-sm font-mono resize-y"
        />
      </div>

      {/* User Input */}
      <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">User Input</Label>
        <Textarea
          rows={4}
          value={data.userInput}
          onChange={(e) => onUpdate({ userInput: e.target.value })}
          placeholder={currentTemplate?.placeholderInput ?? "Enter your instructions..."}
          className="bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-sm resize-y"
        />
      </div>

      {/* Settings */}
      <Accordion type="single" collapsible>
        <AccordionItem value="settings" className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] shadow-sm">
          <AccordionTrigger className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
            Settings
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3 space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Provider</Label>
              <Select value={data.provider} onValueChange={(v) => onUpdate({ provider: v as AIWriterNodeData["provider"] })}>
                <SelectTrigger className="mt-1 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini">Gemini</SelectItem>
                  <SelectItem value="claude">Claude</SelectItem>
                  <SelectItem value="gpt">GPT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Temperature: {data.temperature.toFixed(1)}</Label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={data.temperature}
                onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
                className="w-full mt-1 accent-[#ff0073]"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Max Tokens</Label>
              <Input
                type="number"
                min={256}
                max={8192}
                step={256}
                value={data.maxTokens}
                onChange={(e) => onUpdate({ maxTokens: parseInt(e.target.value, 10) || 2048 })}
                className="mt-1 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]"
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Streaming Output -- visible while AI Writer is running */}
      {data.executionStatus === "running" && (
        <div className="rounded-xl border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/10 p-3 shadow-sm space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">
              Streaming...
            </Label>
          </div>
          <div className="bg-white/60 dark:bg-[#121212] rounded-lg p-3 max-h-60 overflow-y-auto">
            {data.generatedText ? (
              <p className="text-sm whitespace-pre-wrap">
                {data.generatedText}
                <span className="animate-pulse text-violet-500">|</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">Waiting for tokens...</p>
            )}
          </div>
        </div>
      )}

      {/* Generated Prompts List */}
      {data.generatedItems && data.generatedItems.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
              Generated Prompts
            </Label>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-medium">
              {data.generatedItems.length} items
            </span>
          </div>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {data.generatedItems.map((item, idx) => (
              <div key={idx} className="group">
                <div
                  className="flex items-start gap-2 p-2 rounded-lg bg-[#F8FAFC] dark:bg-[#121212] hover:bg-gray-100 dark:hover:bg-[#1a1a1a] cursor-pointer transition-colors"
                  onClick={() => setExpandedItemIndex(expandedItemIndex === idx ? null : idx)}
                >
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-500/10 text-violet-500 text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {idx + 1}
                  </span>
                  {expandedItemIndex === idx ? (
                    <Textarea
                      value={item}
                      onChange={(e) => {
                        const updated = [...data.generatedItems!]
                        updated[idx] = e.target.value
                        onUpdate({ generatedItems: updated })
                      }}
                      onClick={(e) => e.stopPropagation()}
                      rows={4}
                      className="flex-1 text-xs bg-white dark:bg-[#1E1E1E] border-gray-200 dark:border-[#2D2D2D] resize-y"
                    />
                  ) : (
                    <p className="flex-1 text-xs text-muted-foreground line-clamp-2">{item}</p>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const updated = data.generatedItems!.filter((_, i) => i !== idx)
                      onUpdate({ generatedItems: updated })
                      if (expandedItemIndex === idx) setExpandedItemIndex(null)
                    }}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/20"
                  >
                    <X className="w-3 h-3 text-red-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Create Nodes Button */}
          <button
            onClick={() => {
              if (selectedNodeId) {
                useWorkflowStore.getState().createNodesFromWriter?.(selectedNodeId)
              }
            }}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: "#ff0073" }}
          >
            {data.createdNodeIds && data.createdNodeIds.length > 0
              ? `Re-create ${data.generatedItems.length} Image Nodes`
              : `Create ${data.generatedItems.length} Image Nodes`}
          </button>
          {data.createdNodeIds && data.createdNodeIds.length > 0 && (
            <p className="text-[10px] text-center text-muted-foreground">
              {data.createdNodeIds.length} nodes previously created (will be replaced)
            </p>
          )}
          {!hasRefImage && (
            <p className="text-[10px] text-center text-amber-600 dark:text-amber-400">
              No reference image connected -- images will have no visual reference
            </p>
          )}
        </div>
      )}

      {/* Run All Image Nodes */}
      {createdIds.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
          <button
            onClick={() => {
              if (selectedNodeId && !isGenerating) {
                useWorkflowStore.getState().runAllWriterImageNodes?.(selectedNodeId)
              }
            }}
            disabled={isGenerating}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: isGenerating ? "#6b7280" : "#7c3aed" }}
          >
            {isGenerating
              ? `Generating images: ${imageNodeStatuses.completed + imageNodeStatuses.failed}/${imageNodeStatuses.total} complete`
              : `Generate All ${createdIds.length} Images`}
          </button>
          {isGenerating && (
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${imageNodeStatuses.total > 0 ? Math.round(((imageNodeStatuses.completed + imageNodeStatuses.failed) / imageNodeStatuses.total) * 100) : 0}%`,
                  backgroundColor: "#7c3aed",
                }}
              />
            </div>
          )}
          {!isGenerating && (imageNodeStatuses.completed > 0 || imageNodeStatuses.failed > 0) && (
            <p className="text-[10px] text-center text-muted-foreground">
              {imageNodeStatuses.completed} succeeded{imageNodeStatuses.failed > 0 ? `, ${imageNodeStatuses.failed} failed` : ""}
            </p>
          )}
        </div>
      )}

      {/* Raw Output Display */}
      {data.generatedText && !data.generatedItems?.length && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Raw Output</Label>
          <div className="bg-[#F8FAFC] dark:bg-[#121212] rounded-lg p-3 max-h-60 overflow-y-auto">
            <p className="text-sm whitespace-pre-wrap">{data.generatedText}</p>
          </div>
        </div>
      )}
    </>
  )
}

function SplitTextConfig({ data, onUpdate }: { data: SplitTextData; onUpdate: (patch: Partial<SplitTextData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Separator</Label>
        <Input
          value={data.separator}
          onChange={(e) => onUpdate({ separator: e.target.value })}
          placeholder="Enter separator (e.g. * or ===NEXT===)"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          The delimiter used to split the input text into items
        </p>
      </div>

      <div className="flex items-center justify-between">
        <Label>Trim whitespace</Label>
        <Button
          variant={data.trimWhitespace !== false ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onUpdate({ trimWhitespace: data.trimWhitespace === false })}
        >
          {data.trimWhitespace !== false ? "On" : "Off"}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <Label>Remove empty</Label>
        <Button
          variant={data.removeEmpty !== false ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onUpdate({ removeEmpty: data.removeEmpty === false })}
        >
          {data.removeEmpty !== false ? "On" : "Off"}
        </Button>
      </div>

      {data.splitResults && data.splitResults.length > 0 && (
        <div>
          <Label>Preview ({data.splitResults.length} items)</Label>
          <Textarea
            rows={Math.min(data.splitResults.length, 6)}
            value={data.splitResults.map((item, i) => `${i + 1}. ${item}`).join("\n")}
            readOnly
            className="text-xs opacity-70"
          />
        </div>
      )}
    </div>
  )
}
