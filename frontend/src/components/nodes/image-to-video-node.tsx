"use client"

import { memo, useState, useMemo, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film, Loader2, AlertCircle, X, Play, Image as ImageIcon, Music, Volume2 } from "lucide-react"
import { BaseNode } from "./base-node"
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
import type { ImageToVideoData, GeneratedResult } from "@/types/nodes"

// Providers that support End Frame (second image for video ending)
// VEO3/VEO3.1: uses imageUrls array [startFrame, endFrame]
// MiniMax: uses end_image_url parameter
// Kling Turbo: uses tail_image_url parameter
// Note: kling (regular), grok, sora2 do NOT support end frame
const END_FRAME_SUPPORTED_PROVIDERS = [
  "veo3", "veo3.1",           // VEO - imageUrls array
  "minimax",                   // Hailuo - end_image_url
  "kling-turbo",               // Kling Turbo - tail_image_url
  "runway", "pika",            // Replicate providers
]

// Node types that output images
const IMAGE_OUTPUT_TYPES = [
  "generate-image",
  "upload-image",
  "scene",
  "character",
  "object",
  "location",
]

// Node types that output audio
const AUDIO_OUTPUT_TYPES = [
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "reference-audio",
  "extract-audio",
  "adjust-volume",
  "mix-audio",
]

interface ConnectedNodeInfo {
  id: string
  label: string
  type: string
  thumbnailUrl?: string
  outputType: "image" | "audio" | "video" | "other"
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

  // Check if provider supports End Frame
  const supportsEndFrame = END_FRAME_SUPPORTED_PROVIDERS.includes(nodeData.provider)

  // Get all connected nodes to this node's input handle (deduplicated by node ID)
  const connectedNodes = useMemo(() => {
    // Find all edges where target is this node
    const connectedEdges = edges.filter((e) => e.target === id)

    // Use a Map to deduplicate by node ID (in case of multiple edges from same source)
    const nodeMap = new Map<string, ConnectedNodeInfo>()

    for (const edge of connectedEdges) {
      const srcNode = nodes.find((n) => n.id === edge.source)
      if (!srcNode) continue

      // Skip if we already processed this node
      if (nodeMap.has(srcNode.id)) continue

      const srcData = srcNode.data as Record<string, unknown>
      const nodeType = String(srcNode.type ?? "unknown")

      // Determine output type
      let outputType: "image" | "audio" | "video" | "other" = "other"
      if (IMAGE_OUTPUT_TYPES.includes(nodeType)) {
        outputType = "image"
      } else if (AUDIO_OUTPUT_TYPES.includes(nodeType)) {
        outputType = "audio"
      }

      // Get thumbnail URL for image nodes
      let thumbnailUrl: string | undefined
      if (outputType === "image") {
        const results = (srcData.generatedResults as readonly GeneratedResult[] | undefined) ?? []
        const activeIdx = (srcData.activeResultIndex as number | undefined) ?? 0
        thumbnailUrl =
          results[activeIdx]?.url ??
          (srcData.generatedImageUrl as string | undefined) ??
          (srcData.url as string | undefined) ??
          (srcData.portraitUrl as string | undefined) ??
          (srcData.mainImageUrl as string | undefined)
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

  // Filter connected nodes by type
  const imageNodes = useMemo(
    () => connectedNodes.filter((n) => n.outputType === "image"),
    [connectedNodes]
  )

  const audioNodes = useMemo(
    () => connectedNodes.filter((n) => n.outputType === "audio"),
    [connectedNodes]
  )

  // Get connected text-prompt content (for Motion Prompt visual indicator)
  const connectedTextPrompt = useMemo(() => {
    // Find connected text-prompt nodes
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

  // Auto-select first image for Start Frame when connected
  useEffect(() => {
    if (imageNodes.length > 0 && !nodeData.selectedStartFrameNodeId) {
      updateNodeData(id, { selectedStartFrameNodeId: imageNodes[0].id })
    }
  }, [imageNodes, nodeData.selectedStartFrameNodeId, id, updateNodeData])

  // Auto-select first audio when connected
  useEffect(() => {
    if (audioNodes.length === 1 && !nodeData.selectedAudioNodeId) {
      updateNodeData(id, { selectedAudioNodeId: audioNodes[0].id })
    }
  }, [audioNodes, nodeData.selectedAudioNodeId, id, updateNodeData])

  // Clear selections if corresponding nodes are disconnected
  useEffect(() => {
    const imageNodeIds = imageNodes.map((n) => n.id)
    const audioNodeIds = audioNodes.map((n) => n.id)

    const updates: Partial<ImageToVideoData> = {}

    if (nodeData.selectedStartFrameNodeId && !imageNodeIds.includes(nodeData.selectedStartFrameNodeId)) {
      updates.selectedStartFrameNodeId = imageNodes[0]?.id
    }
    if (nodeData.selectedEndFrameNodeId && !imageNodeIds.includes(nodeData.selectedEndFrameNodeId)) {
      updates.selectedEndFrameNodeId = undefined
    }
    if (nodeData.selectedAudioNodeId && !audioNodeIds.includes(nodeData.selectedAudioNodeId)) {
      updates.selectedAudioNodeId = undefined
    }

    if (Object.keys(updates).length > 0) {
      updateNodeData(id, updates)
    }
  }, [imageNodes, audioNodes, nodeData.selectedStartFrameNodeId, nodeData.selectedEndFrameNodeId, nodeData.selectedAudioNodeId, id, updateNodeData])

  // Clear end frame selection if provider doesn't support it
  useEffect(() => {
    if (!supportsEndFrame && nodeData.selectedEndFrameNodeId) {
      updateNodeData(id, { selectedEndFrameNodeId: undefined })
    }
  }, [supportsEndFrame, nodeData.selectedEndFrameNodeId, id, updateNodeData])

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

  // Get selected nodes for display
  const selectedStartFrame = imageNodes.find((n) => n.id === nodeData.selectedStartFrameNodeId)
  const selectedEndFrame = imageNodes.find((n) => n.id === nodeData.selectedEndFrameNodeId)
  const selectedAudio = audioNodes.find((n) => n.id === nodeData.selectedAudioNodeId)

  // Available end frame options (exclude start frame)
  const endFrameOptions = imageNodes.filter((n) => n.id !== nodeData.selectedStartFrameNodeId)

  const hasConnections = connectedNodes.length > 0
  const hasImageConnections = imageNodes.length > 0

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
      handles={[
        // Single input handle for all connection types
        { id: "input", type: "target", position: Position.Left, label: "Input" },
        // Output
        { id: "video", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <div className="flex flex-col gap-2">
        {/* Input Selection Dropdowns */}
        {hasConnections && (
          <div className="flex flex-col gap-1.5 p-2 rounded-md bg-muted/30 border border-muted">
            {/* Start Frame - Required */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground font-medium">Start Frame</span>
              {hasImageConnections ? (
                <Select
                  value={nodeData.selectedStartFrameNodeId ?? ""}
                  onValueChange={(v) => updateNodeData(id, { selectedStartFrameNodeId: v || undefined })}
                >
                  <SelectTrigger className="h-8 text-[11px]">
                    <SelectValue placeholder="Select start frame...">
                      {selectedStartFrame && (
                        <div className="flex items-center gap-2">
                          {selectedStartFrame.thumbnailUrl ? (
                            <img
                              src={selectedStartFrame.thumbnailUrl}
                              alt=""
                              className="w-5 h-5 object-cover rounded"
                            />
                          ) : (
                            <ImageIcon className="w-4 h-4 text-blue-500" />
                          )}
                          <span className="truncate">{selectedStartFrame.label}</span>
                        </div>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {imageNodes.map((node) => (
                      <SelectItem key={node.id} value={node.id}>
                        <div className="flex items-center gap-2">
                          {node.thumbnailUrl ? (
                            <img
                              src={node.thumbnailUrl}
                              alt=""
                              className="w-5 h-5 object-cover rounded"
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
                  Connect image nodes
                </div>
              )}
            </div>

            {/* End Frame - Optional, only for supported providers */}
            {supportsEndFrame && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground font-medium">
                  End Frame <span className="text-muted-foreground/60">(optional)</span>
                </span>
                {endFrameOptions.length > 0 ? (
                  <Select
                    value={nodeData.selectedEndFrameNodeId ?? "__none__"}
                    onValueChange={(v) => updateNodeData(id, { selectedEndFrameNodeId: v === "__none__" ? undefined : v })}
                  >
                    <SelectTrigger className="h-8 text-[11px]">
                      <SelectValue placeholder="None">
                        {selectedEndFrame ? (
                          <div className="flex items-center gap-2">
                            {selectedEndFrame.thumbnailUrl ? (
                              <img
                                src={selectedEndFrame.thumbnailUrl}
                                alt=""
                                className="w-5 h-5 object-cover rounded"
                              />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-violet-500" />
                            )}
                            <span className="truncate">{selectedEndFrame.label}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span className="text-muted-foreground">None</span>
                      </SelectItem>
                      {endFrameOptions.map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          <div className="flex items-center gap-2">
                            {node.thumbnailUrl ? (
                              <img
                                src={node.thumbnailUrl}
                                alt=""
                                className="w-5 h-5 object-cover rounded"
                              />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-violet-500" />
                            )}
                            <span>{node.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : hasImageConnections ? (
                  <div className="h-8 px-3 flex items-center text-[11px] text-muted-foreground bg-muted/50 rounded-md border border-dashed">
                    Connect another image
                  </div>
                ) : (
                  <div className="h-8 px-3 flex items-center text-[11px] text-muted-foreground bg-muted/50 rounded-md border border-dashed">
                    Connect image nodes
                  </div>
                )}
              </div>
            )}

            {/* Provider hint for non-supported providers */}
            {!supportsEndFrame && imageNodes.length > 1 && (
              <p className="text-[9px] text-amber-500/80 italic">
                {nodeData.provider} doesn't support end frame
              </p>
            )}

            {/* Audio Track - Optional */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground font-medium">
                Audio Track <span className="text-muted-foreground/60">(optional)</span>
              </span>
              {audioNodes.length > 0 ? (
                <Select
                  value={nodeData.selectedAudioNodeId ?? "__none__"}
                  onValueChange={(v) => updateNodeData(id, { selectedAudioNodeId: v === "__none__" ? undefined : v })}
                >
                  <SelectTrigger className="h-8 text-[11px]">
                    <SelectValue placeholder="None">
                      {selectedAudio ? (
                        <div className="flex items-center gap-2">
                          <Volume2 className="w-4 h-4 text-green-500" />
                          <span className="truncate">{selectedAudio.label}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">None</span>
                    </SelectItem>
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
                  Connect audio nodes (optional)
                </div>
              )}
            </div>

          </div>
        )}

        {/* Motion Prompt - Always visible, shows connected text when available */}
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
          {/* Show connected text preview when no direct motionPrompt is set */}
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
        {!hasConnections && !connectedTextPrompt && status !== "running" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-1 py-4 text-muted-foreground/60">
            <Film className="w-8 h-8" />
            <span className="text-[10px]">Connect image/audio nodes</span>
          </div>
        )}

        {/* Video Preview / Loading / Error States */}
        {status === "running" && (
          <div className="flex flex-col items-center justify-center h-28 rounded-md bg-muted/30 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            {/* Show progress percentage if available from KIE.ai providers */}
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
            {results.length > 0 && (
              <button
                type="button"
                className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
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

        {status !== "running" && !activeUrl && status !== "failed" && hasImageConnections && (
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
