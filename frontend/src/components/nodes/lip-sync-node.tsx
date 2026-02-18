"use client"

import { memo, useState, useMemo, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Users, Loader2, AlertCircle, X, Image as ImageIcon, Volume2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useModelCredits } from "@/hooks/use-model-credits"
import { CachedImage } from "@/components/ui/cached-image"
import type { LipSyncData, GeneratedResult } from "@/types/nodes"

// Node types that output images (for portrait/face)
const IMAGE_OUTPUT_TYPES = [
  "generate-image",
  "upload-image",
  "scene",
  "character",
  "object",
  "location",
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
  "extract-audio",
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
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const credits = useModelCredits(nodeData.provider ?? "kling-avatar", 2)

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

  const selectedImage = imageNodes.find((n) => n.id === nodeData.selectedImageNodeId)
  const selectedAudio = audioNodes.find((n) => n.id === nodeData.selectedAudioNodeId)

  const hasConnections = connectedNodes.length > 0
  const hasImageConnection = imageNodes.length > 0
  const hasAudioConnection = audioNodes.length > 0
  const hasRequiredInputs = hasImageConnection && hasAudioConnection

  const providerLabel = PROVIDER_LABELS[nodeData.provider] ?? nodeData.provider

  return (
    <div className="relative group/run">
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Users className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        handles={[
          { id: "image", type: "target", position: Position.Left, label: "Image", top: "30%" },
          { id: "audio", type: "target", position: Position.Left, label: "Audio", top: "70%" },
          { id: "video", type: "source", position: Position.Right, label: "Video" },
        ]}
      >
        <div className="flex flex-col gap-2">
          {/* Input Selection Dropdowns */}
          {hasConnections && (
            <div className="flex flex-col gap-1.5 p-2 rounded-md bg-muted/30 border border-muted">
              {/* Portrait/Face Image - Required */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground font-medium">Portrait Image</span>
                {hasImageConnection ? (
                  <Select
                    value={nodeData.selectedImageNodeId ?? ""}
                    onValueChange={(v) => updateNodeData(id, { selectedImageNodeId: v || undefined })}
                  >
                    <SelectTrigger className="h-8 text-[11px]">
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
                              <ImageIcon className="w-4 h-4 text-blue-500" />
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
                              <ImageIcon className="w-4 h-4 text-blue-500" />
                            )}
                            <span>{node.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-8 px-3 flex items-center text-[11px] text-muted-foreground bg-muted/50 rounded-md border border-dashed">
                    Connect portrait image
                  </div>
                )}
              </div>

              {/* Audio Track - Required */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground font-medium">Audio Track</span>
                {hasAudioConnection ? (
                  <Select
                    value={nodeData.selectedAudioNodeId ?? ""}
                    onValueChange={(v) => updateNodeData(id, { selectedAudioNodeId: v || undefined })}
                  >
                    <SelectTrigger className="h-8 text-[11px]">
                      <SelectValue placeholder="Select audio...">
                        {selectedAudio && (
                          <div className="flex items-center gap-2">
                            <Volume2 className="w-4 h-4 text-green-500" />
                            <span className="truncate">{selectedAudio.label}</span>
                          </div>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {audioNodes.map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          <div className="flex items-center gap-2">
                            <Volume2 className="w-4 h-4 text-green-500" />
                            <span>{node.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-8 px-3 flex items-center text-[11px] text-muted-foreground bg-muted/50 rounded-md border border-dashed">
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
          {status === "running" && (
            <div className="flex items-center justify-center h-28 rounded-md bg-muted/30">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
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
                Talking Video
              </div>
              {results.length > 0 && (
                <button
                  type="button"
                  className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
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

          {status !== "running" && !activeUrl && status !== "failed" && hasRequiredInputs && (
            <div className="flex items-center justify-center h-20 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <Users className="w-6 h-6" />
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
                    aria-label="Remove" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
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

          {/* Provider Info */}
          <div className="flex justify-between text-muted-foreground">
            <span>{providerLabel}</span>
            <span>{nodeData.resolution}</span>
          </div>
        </div>
      </BaseNode>

      {/* Run Button */}
      <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />

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
