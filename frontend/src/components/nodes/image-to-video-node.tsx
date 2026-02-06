"use client"

import { memo, useState, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film, Loader2, AlertCircle, X, Play, Image as ImageIcon, Volume2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import type { ImageToVideoData, GeneratedResult } from "@/types/nodes"

// Providers that support End Frame (second image for video ending)
const END_FRAME_SUPPORTED_PROVIDERS = [
  "veo3", "veo3.1",
  "minimax",
  "kling-turbo",
  "runway", "pika",
]

// Node types that output images
const IMAGE_OUTPUT_TYPES = new Set([
  "generate-image", "upload-image", "scene",
  "character", "object", "location",
  "edit-image", "image-to-image",
])

// Node types that output audio
const AUDIO_OUTPUT_TYPES = new Set([
  "text-to-speech", "generate-music", "text-to-audio",
  "upload-audio", "reference-audio", "extract-audio",
  "adjust-volume", "mix-audio",
])

function getNodeThumbnail(srcData: Record<string, unknown>, nodeType: string): string | undefined {
  if (!IMAGE_OUTPUT_TYPES.has(nodeType)) return undefined

  const results = (srcData.generatedResults as readonly GeneratedResult[] | undefined) ?? []
  const activeIdx = (srcData.activeResultIndex as number | undefined) ?? 0
  return (
    results[activeIdx]?.url ??
    (srcData.generatedImageUrl as string | undefined) ??
    (srcData.url as string | undefined) ??
    (srcData.portraitUrl as string | undefined) ??
    (srcData.mainImageUrl as string | undefined)
  )
}

function ImageToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageToVideoData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const edges = useWorkflowStore((s) => s.edges)
  const nodes = useWorkflowStore((s) => s.nodes)

  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const supportsEndFrame = END_FRAME_SUPPORTED_PROVIDERS.includes(nodeData.provider)

  // Resolve connected nodes per handle
  const startFrameInfo = useMemo(() => {
    const edge = edges.find((e) => e.target === id && e.targetHandle === "startFrame")
    if (!edge) return null
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) return null
    const srcData = srcNode.data as Record<string, unknown>
    return {
      id: srcNode.id,
      label: (srcData.label as string | undefined) ?? String(srcNode.type ?? "Image"),
      thumbnailUrl: getNodeThumbnail(srcData, String(srcNode.type ?? "")),
    }
  }, [edges, nodes, id])

  const endFrameInfo = useMemo(() => {
    const edge = edges.find((e) => e.target === id && e.targetHandle === "endFrame")
    if (!edge) return null
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) return null
    const srcData = srcNode.data as Record<string, unknown>
    return {
      id: srcNode.id,
      label: (srcData.label as string | undefined) ?? String(srcNode.type ?? "Image"),
      thumbnailUrl: getNodeThumbnail(srcData, String(srcNode.type ?? "")),
    }
  }, [edges, nodes, id])

  const audioInfo = useMemo(() => {
    const edge = edges.find((e) => e.target === id && e.targetHandle === "audio")
    if (!edge) return null
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) return null
    const srcData = srcNode.data as Record<string, unknown>
    return {
      id: srcNode.id,
      label: (srcData.label as string | undefined) ?? String(srcNode.type ?? "Audio"),
    }
  }, [edges, nodes, id])

  // Get connected text-prompt content (for Motion Prompt visual indicator)
  const connectedTextPrompt = useMemo(() => {
    const connectedEdges = edges.filter((e) => e.target === id)
    for (const edge of connectedEdges) {
      const srcNode = nodes.find((n) => n.id === edge.source)
      if (srcNode?.type === "text-prompt") {
        const srcData = srcNode.data as Record<string, unknown>
        const text = srcData.text as string | undefined
        if (text?.trim()) {
          return {
            text: text.trim(),
            nodeLabel: (srcData.label as string | undefined) ?? "Text Prompt",
          }
        }
      }
    }
    return null
  }, [edges, nodes, id])

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) {
      newActiveIndex = 0
    } else if (indexToDelete < activeIndex) {
      newActiveIndex = activeIndex - 1
    }
    updateNodeData(id, {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
      generatedVideoUrl: newResults[newActiveIndex]?.url,
    })
  }

  // Build dynamic handles
  const handles = useMemo(() => {
    const h = [
      { id: "startFrame", type: "target" as const, position: Position.Left, label: "Start Frame", top: "25%" },
      { id: "endFrame", type: "target" as const, position: Position.Left, label: "End Frame", top: "50%" },
      { id: "audio", type: "target" as const, position: Position.Left, label: "Audio", top: "75%" },
      { id: "video", type: "source" as const, position: Position.Right, label: "Video" },
    ]
    return h
  }, [])

  const hasAnyConnection = startFrameInfo || endFrameInfo || audioInfo

  return (
    <div className="relative group/run">
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Film className="h-4 w-4" />}
      category="i2v"
      credits={20}
      selected={selected}
      isRunning={status === "running"}
      handles={handles}
    >
      <div className="flex flex-col gap-2">
        {/* Frame Previews - side by side label + image per row */}
        <div className="flex flex-col gap-2">
          {/* Start Frame */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-medium w-[52px] shrink-0 leading-tight">Start Frame</span>
            {startFrameInfo?.thumbnailUrl ? (
              <div className="relative flex-1 h-[52px] rounded-md overflow-hidden bg-muted/30 border border-muted">
                <img
                  src={startFrameInfo.thumbnailUrl}
                  alt={startFrameInfo.label}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-0.5 left-0.5 text-[8px] bg-black/60 text-white px-1 rounded truncate max-w-[90%]">
                  {startFrameInfo.label}
                </span>
              </div>
            ) : startFrameInfo ? (
              <div className="flex-1 h-[52px] rounded-md bg-muted/30 border border-muted flex items-center justify-center">
                <ImageIcon className="w-4 h-4 text-muted-foreground/40" />
              </div>
            ) : (
              <div className="flex-1 h-[52px] rounded-md border-2 border-dashed border-muted-foreground/20 flex items-center justify-center">
                <ImageIcon className="w-4 h-4 text-muted-foreground/20" />
              </div>
            )}
          </div>

          {/* End Frame */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-medium w-[52px] shrink-0 leading-tight">
              End Frame
              {!supportsEndFrame && (
                <span className="text-[8px] text-amber-500/80 ml-0.5 block" title={`${nodeData.provider} doesn't support end frame`}>N/A</span>
              )}
            </span>
            {endFrameInfo?.thumbnailUrl ? (
              <div className="relative flex-1 h-[52px] rounded-md overflow-hidden bg-muted/30 border border-muted">
                <img
                  src={endFrameInfo.thumbnailUrl}
                  alt={endFrameInfo.label}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-0.5 left-0.5 text-[8px] bg-black/60 text-white px-1 rounded truncate max-w-[90%]">
                  {endFrameInfo.label}
                </span>
              </div>
            ) : endFrameInfo ? (
              <div className="flex-1 h-[52px] rounded-md bg-muted/30 border border-muted flex items-center justify-center">
                <ImageIcon className="w-4 h-4 text-muted-foreground/40" />
              </div>
            ) : (
              <div className={`flex-1 h-[52px] rounded-md border-2 border-dashed flex items-center justify-center ${
                supportsEndFrame ? "border-muted-foreground/20" : "border-muted-foreground/10 opacity-50"
              }`}>
                <ImageIcon className="w-4 h-4 text-muted-foreground/20" />
              </div>
            )}
          </div>
        </div>

        {/* Audio Track indicator */}
        {audioInfo && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/30 border border-muted">
            <Volume2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
            <span className="text-[10px] text-muted-foreground truncate">{audioInfo.label}</span>
          </div>
        )}

        {/* Motion Prompt */}
        <div className="flex flex-col gap-1 px-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-medium">
              Motion Prompt <span className="text-muted-foreground/60">(optional)</span>
            </span>
            {connectedTextPrompt && !nodeData.motionPrompt && (
              <span className="text-[9px] text-primary/70 italic flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/70" />
                From: {connectedTextPrompt.nodeLabel}
              </span>
            )}
          </div>
          {connectedTextPrompt && !nodeData.motionPrompt && (
            <div
              className="w-full min-h-[40px] p-2 text-[11px] bg-primary/5 border border-primary/20 rounded-md text-muted-foreground italic overflow-hidden"
              style={{ wordBreak: "break-word" }}
            >
              {connectedTextPrompt.text.length > 120
                ? `${connectedTextPrompt.text.slice(0, 120)}...`
                : connectedTextPrompt.text}
            </div>
          )}
          <textarea
            value={nodeData.motionPrompt ?? ""}
            onChange={(e) => updateNodeData(id, { motionPrompt: e.target.value })}
            placeholder={connectedTextPrompt && !nodeData.motionPrompt
              ? "Type to override connected prompt..."
              : "Describe the motion, e.g. 'camera slowly zooms in while subject walks forward'"
            }
            className={`w-full min-h-[60px] p-2 text-[11px] border rounded-md resize-none placeholder:text-muted-foreground/50 ${
              connectedTextPrompt && !nodeData.motionPrompt
                ? "bg-muted/20 border-dashed h-[36px] min-h-[36px]"
                : "bg-background"
            }`}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Empty state when nothing connected */}
        {!hasAnyConnection && !connectedTextPrompt && status !== "running" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-1 py-4 text-muted-foreground/60">
            <Film className="w-8 h-8" />
            <span className="text-[10px]">Connect image/audio nodes</span>
          </div>
        )}

        {/* Video Preview / Loading / Error States */}
        {status === "running" && (
          <div className="flex flex-col items-center justify-center h-28 rounded-md bg-muted/30 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            {nodeData.currentJobProgress != null && nodeData.currentJobProgress > 0 && (
              <div className="flex flex-col items-center gap-1 w-full px-4">
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${nodeData.currentJobProgress}%` }}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground font-medium">
                  {nodeData.currentJobProgress}%
                </span>
              </div>
            )}
          </div>
        )}

        {status !== "running" && activeUrl && (
          <div className="relative group">
            <video
              src={activeUrl}
              className="w-full h-28 object-cover rounded-md cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                setPreviewOpen(true)
              }}
              autoPlay={videoAutoplay}
              muted
              loop={videoAutoplay}
              playsInline
            />
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">
              Video
            </div>
            <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {results.length > 0 && (
                <button
                  type="button"
                  className="w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(activeIndex)
                  }}
                  title="Delete this result"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="absolute bottom-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <SaveToLibraryButton url={activeUrl} type="video" />
            </div>
          </div>
        )}

        {status === "failed" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-1 h-28 rounded-md bg-red-500/5 text-red-500 p-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">Failed</span>
            </div>
            {nodeData.errorMessage && (
              <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>
                {nodeData.errorMessage}
              </p>
            )}
          </div>
        )}

        {status !== "running" && !activeUrl && status !== "failed" && startFrameInfo && (
          <div className="flex items-center justify-center h-20 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Film className="w-6 h-6" />
          </div>
        )}

        {/* Version History */}
        {results.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {results.slice(0, 5).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                <video
                  src={r.url}
                  className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${
                    i === activeIndex
                      ? "opacity-100 ring-2 ring-primary"
                      : "opacity-50 hover:opacity-80"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                  }}
                  muted
                  playsInline
                />
                <button
                  type="button"
                  className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(i)
                  }}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Provider & Duration Info */}
        <div className="flex justify-between text-muted-foreground">
          <span>{nodeData.provider}</span>
          <span>{nodeData.duration}s</span>
        </div>
      </div>
    </BaseNode>

    {/* Run Button */}
    {status !== "running" && (
      <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover/run:opacity-100 transition-opacity">
        <button
          type="button"
          className="flex items-center gap-1 h-6 px-3 text-[11px] font-medium text-white rounded-b-md shadow-md transition-colors"
          style={{ backgroundColor: '#ff0073' }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e60068'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#ff0073'}
          onClick={(e) => {
            e.stopPropagation()
            runSingleNode?.(id)
          }}
          title="Run this node only"
        >
          <Play className="w-3 h-3" />
          Run
        </button>
      </div>
    )}

    {/* Preview Modal */}
    {activeUrl && (
      <MediaPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type="video"
        url={activeUrl}
      />
    )}

    {/* Delete Confirmation */}
    <DeleteConfirmationDialog
      isOpen={deleteConfirm !== null}
      onClose={() => setDeleteConfirm(null)}
      onConfirm={() => {
        if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
      }}
    />
    </div>
  )
}

export const ImageToVideoNode = memo(ImageToVideoNodeComponent)
