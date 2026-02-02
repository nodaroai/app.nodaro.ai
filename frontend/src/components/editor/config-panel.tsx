"use client"

import { useMemo, useState, useCallback, useRef } from "react"
import { X, Play, Copy, Check, ImageIcon, FileText, Plus, UserPlus, Download, Maximize2, Loader2, Sparkles, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { uploadAudio, uploadImage, downloadYouTubeAudio, extractYouTubeAudioApi, fetchYouTubeOEmbed, getJobStatus } from "@/lib/api"
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
  UploadImageData,
  UploadVideoData,
  RSSFeedData,
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
  ImageToVideoData,
  VideoToVideoData,
  TextToVideoData,
  TextToSpeechData,
  QACheckData,
  GenerateMusicData,
  TextToAudioData,
  CombineVideosData,
  MergeVideoAudioData,
  AddCaptionsData,
  ResizeVideoData,
  ExtractAudioData,
  MixAudioData,
  AdjustVolumeData,
  TrimVideoData,
  SaveToStorageData,
  WebhookOutputData,
  FieldMappings,
  GeneratedScript,
  ScriptScene,
  CharacterDefinition,
  CharacterNodeData,
} from "@/types/nodes"
import type { WorkflowNode, WorkflowEdge, SceneNodeDataType } from "@/types/nodes"
import { SceneConfig } from "./scene-config"
import { SceneEditorModal } from "./scene-editor-modal"
import { DefineCharacterModal } from "./define-character-modal"
import { ImportAssetsModal } from "./manage-characters-modal"

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

  return sources.filter((s) => {
    if (!compatibleTypes.includes(s.type)) return false
    if (s.type === "provider" && providerCategory && s.providerCategory !== providerCategory) return false
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
    <div className="rounded-md border border-border/50 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <Label className="text-xs font-medium">{label}</Label>
        {compatible.length > 0 && (
          <Select
            value={mapping?.sourceNodeId ?? "__manual__"}
            onValueChange={(v) => onMapField(field, v === "__manual__" ? null : v)}
          >
            <SelectTrigger className="h-6 text-[10px] w-auto max-w-[140px] px-2 py-0 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
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
        <p className="text-xs text-muted-foreground bg-background rounded px-2.5 py-2 break-words whitespace-pre-wrap border border-border/50">
          {mappedSource.value || "(empty)"}
        </p>
      ) : (
        children
      )}
    </div>
  )
}

export function ConfigPanel() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const deleteNode = useWorkflowStore((s) => s.deleteNode)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)

  const sources = useMemo(() => {
    if (!selectedNodeId) return [] as SourceNodeInfo[]
    return getConnectedSources(selectedNodeId, edges, nodes)
  }, [edges, nodes, selectedNodeId])

  const fieldMappings: FieldMappings = useMemo(() => {
    if (!selectedNode) return {}
    const d = selectedNode.data as Record<string, unknown>
    return (d.fieldMappings as FieldMappings) ?? {}
  }, [selectedNode])

  const [expandSceneOpen, setExpandSceneOpen] = useState(false)

  if (!selectedNode) return null

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

  return (
    <div className="absolute inset-0 z-10 bg-card shadow-lg flex flex-col sm:inset-auto sm:top-0 sm:right-0 sm:h-full sm:w-96 sm:border-l">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold">Node Settings</h3>
        <Button variant="ghost" size="icon" onClick={() => selectNode(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 overflow-hidden">
        <div className="flex flex-col gap-5 p-4">
          <div className="rounded-md border border-border/50 bg-muted/20 p-3">
            <Label htmlFor="node-label" className="text-xs font-medium">Label</Label>
            <Input
              id="node-label"
              value={(selectedNode.data as { label: string }).label}
              onChange={(e) => update({ label: e.target.value })}
              className="mt-2"
            />
          </div>

          {sources.length > 0 && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
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
          {selectedNode.type === "upload-image" && (
            <UploadImageConfig data={selectedNode.data as UploadImageData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "upload-video" && (
            <UploadVideoConfig data={selectedNode.data as UploadVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "rss-feed" && (
            <RSSFeedConfig data={selectedNode.data as RSSFeedData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
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
          {selectedNode.type === "image-to-video" && (
            <ImageToVideoConfig data={selectedNode.data as ImageToVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "video-to-video" && (
            <VideoToVideoConfig data={selectedNode.data as VideoToVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
          )}
          {selectedNode.type === "text-to-video" && (
            <TextToVideoConfig data={selectedNode.data as TextToVideoData} onUpdate={update} sources={sources} fieldMappings={fieldMappings} onMapField={handleMapField} nodes={nodes} />
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

          {/* Processing Nodes */}
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
            {(selectedNode.type === "generate-script" || selectedNode.type === "generate-image" || selectedNode.type === "image-to-video" || selectedNode.type === "video-to-video" || selectedNode.type === "text-to-video" || selectedNode.type === "text-to-speech" || selectedNode.type === "generate-music") && (
              <Button
                className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                onClick={() => runSingleNode?.(selectedNode.id)}
              >
                <Play className="w-4 h-4 mr-2" />
                Run This Node
              </Button>
            )}

            <Button variant="outline" size="sm" className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30" onClick={handleDelete}>
              Delete Node
            </Button>
          </div>
        </div>
      </ScrollArea>
      {selectedNode.type === "scene" && (
        <SceneEditorModal
          isOpen={expandSceneOpen}
          onClose={() => setExpandSceneOpen(false)}
          nodeId={selectedNode.id}
        />
      )}
    </div>
  )
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
              <img src={data.videoThumbnail} alt="" className="w-full aspect-video object-cover" />
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

function GenerateImageConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<GenerateImageData>) {
  const [showDefineModal, setShowDefineModal] = useState(false)
  const [showManageModal, setShowManageModal] = useState(false)
  const [showAddDropdown, setShowAddDropdown] = useState(false)
  const [editingChar, setEditingChar] = useState<CharacterDefinition | null>(null)
  const allCharDefs = useWorkflowStore((s) => s.characterDefinitions)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)
  const updateCharacterDefinition = useWorkflowStore((s) => s.updateCharacterDefinition)

  const attachedIds = data.characterDefinitionIds ?? []
  const attachedChars = allCharDefs.filter((c) => attachedIds.includes(c.id))
  const unattachedChars = allCharDefs.filter((c) => !attachedIds.includes(c.id))

  function attachCharacter(id: string) {
    onUpdate({ characterDefinitionIds: [...attachedIds, id] })
    setShowAddDropdown(false)
  }

  function detachCharacter(id: string) {
    onUpdate({ characterDefinitionIds: attachedIds.filter((cid) => cid !== id) })
  }

  function handleDefineAndAttach(char: CharacterDefinition) {
    if (editingChar) {
      updateCharacterDefinition(char.id, { name: char.name, type: char.type, referenceImageUrl: char.referenceImageUrl, description: char.description })
      setEditingChar(null)
    } else {
      addCharacterDefinition(char)
      onUpdate({ characterDefinitionIds: [...attachedIds, char.id] })
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
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="image">
        <Select
          value={data.provider || "nano-banana"}
          onValueChange={(v) => onUpdate({ provider: v as GenerateImageData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nano-banana">Nano Banana (default)</SelectItem>
            <SelectItem value="flux">Flux</SelectItem>
            <SelectItem value="dalle">DALL-E</SelectItem>
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
            <div key={char.id} className="flex items-start gap-2 p-2 rounded-md border bg-muted/30 cursor-pointer hover:border-primary/50 transition-colors" onClick={() => { setEditingChar(char); setShowDefineModal(true) }}>
              {char.referenceImageUrl ? (
                <img src={char.referenceImageUrl} alt={char.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
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
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAddDropdown(!showAddDropdown)}
              disabled={unattachedChars.length === 0}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" /> Add existing
            </button>
            {showAddDropdown && unattachedChars.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-44 max-h-32 overflow-y-auto rounded-md border bg-popover shadow-md z-30">
                {unattachedChars.map((char) => (
                  <button
                    key={char.id}
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-1.5"
                    onClick={() => attachCharacter(char.id)}
                  >
                    {char.referenceImageUrl ? (
                      <img src={char.referenceImageUrl} alt="" className="w-4 h-4 rounded object-cover" />
                    ) : (
                      <FileText className="w-3 h-3 text-orange-500" />
                    )}
                    <span className="truncate">{char.name}</span>
                    <span className={`text-[8px] px-1 rounded ${
                      char.category === "location" ? "bg-cyan-500/10 text-cyan-500"
                      : char.category === "object" ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-muted text-muted-foreground"
                    }`}>
                      {char.category === "location" ? "loc" : char.category === "object" ? "obj" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowDefineModal(true)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-muted transition-colors"
          >
            <UserPlus className="w-3 h-3" /> Define new
          </button>
          <button
            type="button"
            onClick={() => setShowManageModal(true)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border hover:bg-muted transition-colors"
          >
            <Download className="w-3 h-3" /> Import Assets
          </button>
        </div>
      </div>

      <DefineCharacterModal
        isOpen={showDefineModal}
        onClose={() => { setShowDefineModal(false); setEditingChar(null) }}
        onSave={handleDefineAndAttach}
        existingNames={allCharDefs.map((c) => c.name)}
        editingCharacter={editingChar}
      />
      <ImportAssetsModal
        isOpen={showManageModal}
        onClose={() => setShowManageModal(false)}
        onImported={(ids) => {
          onUpdate({ characterDefinitionIds: [...attachedIds, ...ids] })
        }}
      />
    </div>
  )
}

function ImageToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<ImageToVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={data.provider || "minimax"}
          onValueChange={(v) => onUpdate({ provider: v as ImageToVideoData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="minimax">MiniMax (default)</SelectItem>
            <SelectItem value="veo">VEO</SelectItem>
            <SelectItem value="veo3">VEO 3</SelectItem>
            <SelectItem value="kling">Kling</SelectItem>
            <SelectItem value="runway">Runway</SelectItem>
            <SelectItem value="pika">Pika</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      {data.provider === "veo3" && (
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
          <p className="text-xs text-muted-foreground px-1">VEO 3 creates AI audio from the prompt. Disable for silent video, then use Add Audio node.</p>
        </div>
      )}
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={1}
          max={30}
          value={data.duration}
          onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) || 5 })}
        />
      </MappableField>
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
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={data.provider || "minimax"}
          onValueChange={(v) => onUpdate({ provider: v as VideoToVideoData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="minimax">MiniMax (default)</SelectItem>
            <SelectItem value="veo">VEO</SelectItem>
            <SelectItem value="veo3">VEO 3</SelectItem>
            <SelectItem value="kling">Kling</SelectItem>
            <SelectItem value="runway">Runway</SelectItem>
            <SelectItem value="pika">Pika</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      {data.provider === "veo3" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="v2vGenerateAudio"
              checked={(data as Record<string, unknown>).generateAudio !== false}
              onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="v2vGenerateAudio" className="text-xs">Generate Audio</label>
          </div>
          <p className="text-xs text-muted-foreground px-1">VEO 3 creates AI audio from the prompt. Disable for silent video.</p>
        </div>
      )}
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={1}
          max={30}
          value={data.duration}
          onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) || 5 })}
        />
      </MappableField>
    </div>
  )
}

function TextToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes }: ConfigProps<TextToVideoData>) {
  const category: ProviderCategory = "video"
  const providers = getProviders(category)
  const models = getModels(category, data.provider)
  const connectedModel = getConnectedProviderModel(fieldMappings, sources, nodes)

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
            {providers.map((p) => (
              <SelectItem key={p} value={p}>{getProviderLabel(category, p)}{p === "minimax" ? " (default)" : ""}</SelectItem>
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
        <Input
          type="number"
          min={1}
          max={30}
          value={data.duration}
          onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) || 5 })}
        />
      </MappableField>
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
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="voice">
        <Select
          value={data.provider || "elevenlabs"}
          onValueChange={(v) => onUpdate({ provider: v as TextToSpeechData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="elevenlabs">ElevenLabs (default)</SelectItem>
            <SelectItem value="playht">PlayHT</SelectItem>
            <SelectItem value="azure">Azure TTS</SelectItem>
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
        <Label htmlFor="language">Language</Label>
        <Input
          id="language"
          value={data.language}
          onChange={(e) => onUpdate({ language: e.target.value })}
          placeholder="e.g. en, es, fr"
        />
      </div>
      <div>
        <Label htmlFor="speed">Speed</Label>
        <Input
          id="speed"
          type="number"
          min={0.5}
          max={2}
          step={0.1}
          value={data.speed}
          onChange={(e) => onUpdate({ speed: parseFloat(e.target.value) || 1 })}
        />
      </div>
      <div>
        <Label htmlFor="pitch">Pitch</Label>
        <Input
          id="pitch"
          type="number"
          min={0.5}
          max={2}
          step={0.1}
          value={data.pitch}
          onChange={(e) => onUpdate({ pitch: parseFloat(e.target.value) || 1 })}
        />
      </div>
    </div>
  )
}

function TextToAudioConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<TextToAudioData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe the sound effect (e.g. dog barking, rain on window)..."
        />
      </MappableField>
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.provider || "tangoflux"}
          onValueChange={(v) => onUpdate({ provider: v as TextToAudioData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="tangoflux">TangoFlux (default)</SelectItem>
            <SelectItem value="tango">Tango</SelectItem>
            <SelectItem value="audioldm">AudioLDM</SelectItem>
            <SelectItem value="bark">Bark</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={1}
          max={30}
          value={data.duration}
          onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) || 10 })}
        />
      </MappableField>
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
                  <img src={connectedRef.nodeData.videoThumbnail} alt="" className="w-full h-16 object-cover" />
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

function CombineVideosConfig({ data, onUpdate }: ConfigProps<CombineVideosData>) {
  return (
    <div className="flex flex-col gap-3">
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
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="transition-duration">Transition Duration (s)</Label>
        <Input
          id="transition-duration"
          type="number"
          min={0}
          max={5}
          step={0.1}
          value={data.transitionDuration}
          onChange={(e) =>
            onUpdate({ transitionDuration: parseFloat(e.target.value) || 0.5 })
          }
        />
      </div>
    </div>
  )
}

function MergeVideoAudioConfig({ data, onUpdate }: ConfigProps<MergeVideoAudioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Audio Type</Label>
        <Select
          value={data.audioType}
          onValueChange={(v) => onUpdate({ audioType: v as MergeVideoAudioData["audioType"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="voiceover">Voiceover</SelectItem>
            <SelectItem value="background">Background</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="voiceover-vol">Voiceover Volume (%)</Label>
        <Input
          id="voiceover-vol"
          type="number"
          min={0}
          max={200}
          value={data.voiceoverVolume}
          onChange={(e) => onUpdate({ voiceoverVolume: parseInt(e.target.value, 10) || 100 })}
        />
      </div>
      <div>
        <Label htmlFor="bg-vol">Background Volume (%)</Label>
        <Input
          id="bg-vol"
          type="number"
          min={0}
          max={200}
          value={data.backgroundVolume}
          onChange={(e) => onUpdate({ backgroundVolume: parseInt(e.target.value, 10) || 30 })}
        />
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

function MixAudioConfig({ data, onUpdate }: ConfigProps<MixAudioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="track-count">Track Count</Label>
        <Input
          id="track-count"
          type="number"
          min={2}
          max={8}
          value={data.trackCount}
          onChange={(e) => onUpdate({ trackCount: parseInt(e.target.value, 10) || 2 })}
        />
      </div>
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
              <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
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
    // Check if user typed a name that matches but hasn't been auto-versioned yet
    const exactMatch = existingNames.includes(data.characterName)
    if (exactMatch) return `A character named "${data.characterName}" already exists. It will be auto-versioned on blur.`
    return null
  }, [data.characterName, existingNames])

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
        className="w-full text-xs h-8 bg-orange-500 hover:bg-orange-600 text-white"
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
