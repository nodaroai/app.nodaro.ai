"use client"

import { memo, useState, useMemo, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Users, Loader2, AlertCircle, X, Image as ImageIcon, Volume2, Clapperboard, LayoutGrid, Expand, Download, Link } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useModelCredits } from "@/hooks/use-model-credits"
import { CachedImage } from "@/components/ui/cached-image"
import { useCanvasZoom } from "@/components/editor/canvas-zoom-context"
import { EditableNodeLabel } from "./editable-node-label"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import type { LipSyncData, GeneratedResult } from "@/types/nodes"

// Node types that output images (for portrait/face)
const IMAGE_OUTPUT_TYPES = [
  "generate-image",
  "upload-image",
  "scene",
  "character",
  "object",
  "location",
  "face",
  "image-to-image",
  "edit-image",
]

// Node types that output audio
const AUDIO_OUTPUT_TYPES = [
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "suno-generate",
  "suno-cover",
  "upload-audio",
  "reference-audio",
  "trim-audio",
  "adjust-volume",
  "mix-audio",
]

const PROVIDER_LABELS: Record<string, string> = {
  "kling-avatar": "Kling Avatar",
  "kling-avatar-pro": "Kling Avatar Pro",
  "infinitalk": "Infinitalk",
}

interface ConnectedNodeInfo {
  id: string
  label: string
  type: string
  thumbnailUrl?: string
  outputType: "image" | "audio" | "video" | "other"
}

function LipSyncNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LipSyncData
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
  const activeThumbnail = activeResult?.thumbnailUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const { zoom } = useCanvasZoom()
  const useFull = zoom >= 0.8
  const lipSyncProvider = nodeData.provider ?? "kling-avatar"
  const creditModelId = lipSyncProvider === "infinitalk"
    ? `infinitalk:${nodeData.resolution ?? "720p"}`
    : lipSyncProvider
  const credits = useModelCredits(creditModelId, lipSyncProvider === "kling-avatar" ? 28 : 42)

  // Get all connected nodes to this node (deduplicated by node ID)
  const connectedNodes = useMemo(() => {
    const connectedEdges = edges.filter((e) => e.target === id)
    const nodeMap = new Map<string, ConnectedNodeInfo>()

    for (const edge of connectedEdges) {
      const srcNode = nodes.find((n) => n.id === edge.source)
      if (!srcNode) continue
      if (nodeMap.has(srcNode.id)) continue

      const srcData = srcNode.data as Record<string, unknown>
      const nodeType = String(srcNode.type ?? "unknown")

      let outputType: "image" | "audio" | "video" | "other" = "other"
      if (IMAGE_OUTPUT_TYPES.includes(nodeType)) {
        outputType = "image"
      } else if (AUDIO_OUTPUT_TYPES.includes(nodeType)) {
        outputType = "audio"
      }

      let thumbnailUrl: string | undefined
      if (outputType === "image") {
        const results = (srcData.generatedResults as readonly GeneratedResult[] | undefined) ?? []
        const activeIdx = (srcData.activeResultIndex as number | undefined) ?? 0
        thumbnailUrl =
          results[activeIdx]?.url ??
          (srcData.generatedImageUrl as string | undefined) ??
          (srcData.url as string | undefined) ??
          (srcData.portraitUrl as string | undefined) ??
          (srcData.mainImageUrl as string | undefined) ??
          (srcData.sourceImageUrl as string | undefined)
      }

      nodeMap.set(srcNode.id, {
        id: srcNode.id,
        label: (srcData.label as string | undefined) ?? nodeType,
        type: nodeType,
        thumbnailUrl,
        outputType,
      })
    }

    return Array.from(nodeMap.values())
  }, [edges, nodes, id])

  const imageNodes = useMemo(
    () => connectedNodes.filter((n) => n.outputType === "image"),
    [connectedNodes]
  )

  const audioNodes = useMemo(
    () => connectedNodes.filter((n) => n.outputType === "audio"),
    [connectedNodes]
  )

  // Auto-select first image when connected
  useEffect(() => {
    if (imageNodes.length > 0 && !nodeData.selectedImageNodeId) {
      updateNodeData(id, { selectedImageNodeId: imageNodes[0].id })
    }
  }, [imageNodes, nodeData.selectedImageNodeId, id, updateNodeData])

  // Auto-select first audio when connected
  useEffect(() => {
    if (audioNodes.length > 0 && !nodeData.selectedAudioNodeId) {
      updateNodeData(id, { selectedAudioNodeId: audioNodes[0].id })
    }
  }, [audioNodes, nodeData.selectedAudioNodeId, id, updateNodeData])

  // Clear selections if corresponding nodes are disconnected
  useEffect(() => {
    const imageNodeIds = imageNodes.map((n) => n.id)
    const audioNodeIds = audioNodes.map((n) => n.id)

    const updates: Partial<LipSyncData> = {}

    if (nodeData.selectedImageNodeId && !imageNodeIds.includes(nodeData.selectedImageNodeId)) {
      updates.selectedImageNodeId = imageNodes[0]?.id
    }
    if (nodeData.selectedAudioNodeId && !audioNodeIds.includes(nodeData.selectedAudioNodeId)) {
      updates.selectedAudioNodeId = audioNodes[0]?.id
    }

    if (Object.keys(updates).length > 0) {
      updateNodeData(id, updates)
    }
  }, [imageNodes, audioNodes, nodeData.selectedImageNodeId, nodeData.selectedAudioNodeId, id, updateNodeData])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  const selectedImage = imageNodes.find((n) => n.id === nodeData.selectedImageNodeId)
  const selectedAudio = audioNodes.find((n) => n.id === nodeData.selectedAudioNodeId)

  const hasConnections = connectedNodes.length > 0
  const hasImageConnection = imageNodes.length > 0
  const hasAudioConnection = audioNodes.length > 0
  const hasRequiredInputs = hasImageConnection && hasAudioConnection

  const providerLabel = PROVIDER_LABELS[nodeData.provider] ?? nodeData.provider

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Users className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />

    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Users className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      hideHeader
      bottomToolbarContent={
        showThumbnails && results.length > 1 ? (
          <div className="flex gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
            {results.slice(0, 8).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative shrink-0">
                {r.thumbnailUrl ? (
                  <CachedImage
                    src={r.thumbnailUrl}
                    alt={`Result ${i + 1}`}
                    className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-all ${
                      i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                    }}
                  />
                ) : (
                  <video
                    src={r.url}
                    className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-all ${
                      i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                    }}
                    muted
                    playsInline
                  />
                )}
              </div>
            ))}
          </div>
        ) : undefined
      }
      topToolbarContent={
        status !== "running" ? (
          <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      handles={[
        { id: "image", type: "target", position: Position.Left, customStyle: { top: '25%', left: '-29px' }, hideHandle: true },
        { id: "audio", type: "target", position: Position.Left, customStyle: { top: '75%', left: '-29px' }, hideHandle: true },
        { id: "video", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
      ]}
    >
      <div className="flex flex-col gap-2" style={{ minHeight: 180 }}>
        {/* Input Selection Dropdowns */}
        {hasConnections && (
          <div className="flex flex-col gap-1.5 px-3 pt-2">
            {/* Portrait/Face Image - Required */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground/60 text-center">Portrait Image</span>
              {hasImageConnection ? (
                <Select
                  value={nodeData.selectedImageNodeId ?? ""}
                  onValueChange={(v) => updateNodeData(id, { selectedImageNodeId: v || undefined })}
                >
                  <SelectTrigger className="bg-black/30 border-white/10 text-white/80 h-7 text-[11px]" aria-label="Select portrait image">
                    <SelectValue placeholder="Select image...">
                      {selectedImage && (
                        <div className="flex items-center gap-2">
                          {selectedImage.thumbnailUrl ? (
                            <CachedImage
                              src={selectedImage.thumbnailUrl}
                              alt=""
                              className="w-5 h-5 object-cover rounded"
                              thumbnail
                              thumbnailWidth={80}
                            />
                          ) : (
                            <ImageIcon className="w-4 h-4 text-[#ff0073]" />
                          )}
                          <span className="truncate">{selectedImage.label}</span>
                        </div>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {imageNodes.map((node) => (
                      <SelectItem key={node.id} value={node.id}>
                        <div className="flex items-center gap-2">
                          {node.thumbnailUrl ? (
                            <CachedImage
                              src={node.thumbnailUrl}
                              alt=""
                              className="w-5 h-5 object-cover rounded"
                              thumbnail
                              thumbnailWidth={80}
                            />
                          ) : (
                            <ImageIcon className="w-4 h-4 text-[#ff0073]" />
                          )}
                          <span>{node.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="h-7 px-3 flex items-center text-[11px] text-white/30 bg-black/20 rounded-md border border-dashed border-white/10">
                  Connect portrait image
                </div>
              )}
            </div>

            {/* Audio Track - Required */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground/60 text-center">Audio Track</span>
              {hasAudioConnection ? (
                <Select
                  value={nodeData.selectedAudioNodeId ?? ""}
                  onValueChange={(v) => updateNodeData(id, { selectedAudioNodeId: v || undefined })}
                >
                  <SelectTrigger className="bg-black/30 border-white/10 text-white/80 h-7 text-[11px]" aria-label="Select audio track">
                    <SelectValue placeholder="Select audio...">
                      {selectedAudio && (
                        <div className="flex items-center gap-2">
                          <Volume2 className="w-4 h-4 text-[#ff0073]" />
                          <span className="truncate">{selectedAudio.label}</span>
                        </div>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {audioNodes.map((node) => (
                      <SelectItem key={node.id} value={node.id}>
                        <div className="flex items-center gap-2">
                          <Volume2 className="w-4 h-4 text-[#ff0073]" />
                          <span>{node.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="h-7 px-3 flex items-center text-[11px] text-white/30 bg-black/20 rounded-md border border-dashed border-white/10">
                  Connect audio track
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state when nothing connected */}
        {!hasConnections && status !== "running" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-1 py-4 text-muted-foreground/60">
            <Users className="w-8 h-8" />
            <span className="text-[10px] text-center">Connect portrait image + audio</span>
          </div>
        )}

        {/* Video Preview / Loading / Error States */}
        <div className="relative w-full group/video" style={{ minHeight: activeUrl || status === "running" || status === "failed" ? 180 : undefined }}>
          {/* Running state */}
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/10" style={{ minHeight: 180 }}>
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40" />
            </div>
          )}

          {/* Video / thumbnail */}
          {status !== "running" && activeUrl && (
            <>
              {activeThumbnail && !videoAutoplay ? (
                <CachedImage
                  src={activeThumbnail}
                  alt="Video preview"
                  className="w-full h-full object-cover rounded-xl"
                  style={{ minHeight: 180 }}
                  thumbnail={!useFull}
                  thumbnailWidth={320}
                />
              ) : (
                <video
                  src={activeUrl}
                  poster={activeThumbnail}
                  className="w-full object-cover rounded-xl"
                  style={{ minHeight: 180 }}
                  autoPlay={videoAutoplay}
                  muted
                  loop={videoAutoplay}
                  playsInline
                />
              )}

              {/* Provider badge */}
              <span className="absolute top-2 right-10 text-[10px] text-white/70 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded opacity-0 group-hover/video:opacity-100 transition-opacity">
                {providerLabel}
              </span>

              {/* Version badge - top left */}
              {results.length > 0 && (
                <button
                  type="button"
                  className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md opacity-0 group-hover/video:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
                >
                  <LayoutGrid className="w-3 h-3" />
                  <span>{results.length}</span>
                </button>
              )}

              {/* Delete - top right */}
              {results.length > 0 && (
                <div className="absolute top-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
                  <button
                    type="button"
                    aria-label="Remove result"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Bottom left: fullscreen + download */}
              <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <button
                  type="button"
                  aria-label="Expand preview"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}
                >
                  <Expand className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Download"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`; a.download = `${nodeData.label || 'video'}.mp4`; a.click() }}
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Copy URL"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(activeUrl!, "URL copied") }}
                >
                  <Link className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Bottom right: save to library */}
              <div className="absolute bottom-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <SaveToLibraryButton url={activeUrl} type="video" />
              </div>
            </>
          )}

          {/* Failed state */}
          {status === "failed" && !activeUrl && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-red-500/5 text-red-500" style={{ minHeight: 180 }}>
              <AlertCircle className="w-6 h-6" />
              {nodeData.errorMessage && (
                <p className="text-[10px] text-center text-red-400 px-2 line-clamp-2">{nodeData.errorMessage}</p>
              )}
            </div>
          )}

          {/* Ready state (has inputs, no result yet) */}
          {status !== "running" && !activeUrl && status !== "failed" && hasRequiredInputs && (
            <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40" style={{ minHeight: 180 }}>
              <Users className="w-10 h-10" />
            </div>
          )}
        </div>
      </div>
    </BaseNode>

    {/* image input handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: 'calc(25% - 14px)', left: '-29px' }}
    >
      <ImageIcon className="w-3.5 h-3.5 text-white" />
    </div>

    {/* audio input handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: 'calc(75% - 14px)', left: '-29px' }}
    >
      <Volume2 className="w-3.5 h-3.5 text-white" />
    </div>

    {/* video output handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: '6px', right: '-29px' }}
    >
      <Clapperboard className="w-3.5 h-3.5 text-white" />
    </div>

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

export const LipSyncNode = memo(LipSyncNodeComponent)
