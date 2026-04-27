"use client"

import { memo, useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Users, Loader2, AlertCircle, X, Image as ImageIcon, Volume2, Clapperboard, LayoutGrid, Expand, Download, Link, Settings, Scissors } from "lucide-react"
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
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { CachedImage } from "@/components/ui/cached-image"
import { NodeJobProgress } from "./node-job-progress"
import { EditableNodeLabel } from "./editable-node-label"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import type { LipSyncData, GeneratedResult } from "@/types/nodes"
import { VIDEO_INPUT_LIP_SYNC_PROVIDERS, FLEXIBLE_INPUT_LIP_SYNC_PROVIDERS } from "@nodaro-shared/model-constants"

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

// Node types that output video (for video-input lip-sync providers)
const VIDEO_OUTPUT_TYPES = [
  "image-to-video",
  "text-to-video",
  "video-to-video",
  "upload-video",
  "speech-to-video",
  "sora-storyboard",
  "motion-transfer",
  "video-upscale",
  "extend-video",
  "lip-sync",
  "render-video",
  "combine-videos",
  "merge-video-audio",
  "resize-video",
  "trim-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "suno-music-video",
]

const PROVIDER_LABELS: Record<string, string> = {
  "kling-avatar": "Kling Avatar",
  "kling-avatar-pro": "Kling Avatar Pro",
  "infinitalk": "Infinitalk",
  "latentsync": "LatentSync",
  "wav2lip": "Wav2Lip",
  "video-retalking": "Video-Retalking",
  "sadtalker": "SadTalker",
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
  const videoRef = useRef<HTMLVideoElement>(null)
  const playState = nodeData.videoPlayState ?? "loop"
  const shouldPlay = videoAutoplay && playState === "loop"
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
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
  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)

  useEffect(() => {
    const v = videoRef.current
    if (!v || !activeUrl) return
    if (playState === "paused") {
      v.pause()
      if (nodeData.pausedAtTime !== undefined) v.currentTime = nodeData.pausedAtTime
    } else if (playState === "stopped") {
      v.pause()
      v.currentTime = 0
    } else if (shouldPlay) {
      v.play().catch(() => {})
    }
  }, [playState, shouldPlay, activeUrl, nodeData.pausedAtTime])

  const handleVideoStateChange = useCallback((state: { playState: "loop" | "paused" | "stopped"; currentTime: number }) => {
    updateNodeData(id, { videoPlayState: state.playState, pausedAtTime: state.currentTime })
  }, [id, updateNodeData])

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
      } else if (VIDEO_OUTPUT_TYPES.includes(nodeType)) {
        outputType = "video"
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

      if (outputType === "video") {
        const vResults = (srcData.generatedResults as readonly GeneratedResult[] | undefined) ?? []
        const vActiveIdx = (srcData.activeResultIndex as number | undefined) ?? 0
        thumbnailUrl = vResults[vActiveIdx]?.thumbnailUrl
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

  const videoNodes = useMemo(
    () => connectedNodes.filter((n) => n.outputType === "video"),
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

  // Auto-select first video when connected
  useEffect(() => {
    if (videoNodes.length > 0 && !nodeData.selectedVideoNodeId) {
      updateNodeData(id, { selectedVideoNodeId: videoNodes[0].id })
    }
  }, [videoNodes, nodeData.selectedVideoNodeId, id, updateNodeData])

  // Clear selections if corresponding nodes are disconnected
  useEffect(() => {
    const imageNodeIds = imageNodes.map((n) => n.id)
    const audioNodeIds = audioNodes.map((n) => n.id)
    const videoNodeIds = videoNodes.map((n) => n.id)

    const updates: Partial<LipSyncData> = {}

    if (nodeData.selectedImageNodeId && !imageNodeIds.includes(nodeData.selectedImageNodeId)) {
      updates.selectedImageNodeId = imageNodes[0]?.id
    }
    if (nodeData.selectedAudioNodeId && !audioNodeIds.includes(nodeData.selectedAudioNodeId)) {
      updates.selectedAudioNodeId = audioNodes[0]?.id
    }
    if (nodeData.selectedVideoNodeId && !videoNodeIds.includes(nodeData.selectedVideoNodeId)) {
      updates.selectedVideoNodeId = videoNodes[0]?.id
    }

    if (Object.keys(updates).length > 0) {
      updateNodeData(id, updates)
    }
  }, [imageNodes, audioNodes, videoNodes, nodeData.selectedImageNodeId, nodeData.selectedAudioNodeId, nodeData.selectedVideoNodeId, id, updateNodeData])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  const selectedImage = imageNodes.find((n) => n.id === nodeData.selectedImageNodeId)
  const selectedAudio = audioNodes.find((n) => n.id === nodeData.selectedAudioNodeId)
  const selectedVideo = videoNodes.find((n) => n.id === nodeData.selectedVideoNodeId)

  const needsVideoInput = VIDEO_INPUT_LIP_SYNC_PROVIDERS.has(lipSyncProvider as never)
  const needsImageInput = !needsVideoInput && !FLEXIBLE_INPUT_LIP_SYNC_PROVIDERS.has(lipSyncProvider as never)
  const needsBothInputs = FLEXIBLE_INPUT_LIP_SYNC_PROVIDERS.has(lipSyncProvider as never)
  const hasVideoConnection = videoNodes.length > 0

  const hasConnections = connectedNodes.length > 0
  const hasImageConnection = imageNodes.length > 0
  const hasAudioConnection = audioNodes.length > 0
  const hasRequiredInputs = (() => {
    if (!hasAudioConnection) return false
    if (needsVideoInput) return hasVideoConnection
    if (needsBothInputs) return hasImageConnection || hasVideoConnection
    return hasImageConnection
  })()

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
      minWidth={200}
      minHeight={mediaAspectRatio ? Math.round(200 / mediaAspectRatio) : 150}
      imageAspectRatio={mediaAspectRatio}
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
                    thumbnail
                    thumbnailWidth={128}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                    }}
                  />
                ) : (
                  <video
                    src={r.url}
                    crossOrigin="anonymous"
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
                  <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
      }
      handles={[
        { id: "image", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 80px)', left: '-29px' }, hideHandle: true },
        { id: "videoIn", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 50px)', left: '-29px' }, hideHandle: true },
        { id: "audio", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
        { id: "video", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
      ]}
    >
      {/* When result exists, show video fullscreen in node */}
      {status !== "running" && activeUrl ? (
      <div className="relative w-full h-full group/video">
        <video
          ref={videoRef}
          src={activeUrl}
          crossOrigin="anonymous"
          poster={activeThumbnail || undefined}
          className="w-full h-full object-cover rounded-xl"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (v.videoWidth > 0) handleLoadDimensions({ width: v.videoWidth, height: v.videoHeight })
            if (shouldPlay) v.play().catch(() => {})
          }}
          autoPlay={shouldPlay}
          muted
          loop={shouldPlay}
          playsInline
        />

        {/* Version badge - top left */}
        {results.length > 1 && (
          <button
            type="button"
            className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md z-10 opacity-0 group-hover/video:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
            title="Show versions"
          >
            <LayoutGrid className="w-3 h-3" />
            <span className="text-[11px] font-medium">{results.length}</span>
          </button>
        )}

        {/* Delete - top right */}
        {results.length > 0 && (
          <div className="absolute top-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
            <button type="button" aria-label="Remove result"
              className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }} title="Delete this result">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Bottom left: fullscreen + download + copy URL */}
        <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
          <button type="button" aria-label="Expand preview"
            className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }} title="Fullscreen">
            <Expand className="w-3.5 h-3.5" />
          </button>
          <button type="button" aria-label="Download"
            className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`; a.download = `${nodeData.label || 'video'}.mp4`; a.click() }} title="Download">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button type="button" aria-label="Copy URL"
            className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => { e.stopPropagation(); copyToClipboard(activeUrl!, "URL copied") }} title="Copy URL">
            <Link className="w-3.5 h-3.5" />
          </button>
          <button type="button" aria-label="Edit in FreeCut"
            className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => { e.stopPropagation(); openFreeCut(id, activeUrl!, activeResult?.freecutProjectUrl) }} title="Edit in FreeCut">
            <Scissors className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Bottom right: settings */}
        <div className="absolute bottom-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
          <button type="button" aria-label="Settings" className={`w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm${isSettingsOpen ? " ring-1 ring-white/30" : ""}`}
            onClick={(e) => { e.stopPropagation(); selectNode(isSettingsOpen ? null : id) }} title="Settings">
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      ) : (
      <div className="flex flex-col gap-2 h-full">
        {/* Input Selection Dropdowns */}
        {hasConnections && (
          <div className="flex flex-col gap-1.5 px-3 pt-2">
            {/* Portrait Image - shown for image-input and flexible providers */}
            {(needsImageInput || needsBothInputs) && (
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
                              <CachedImage src={selectedImage.thumbnailUrl} alt="" className="w-5 h-5 object-cover rounded" thumbnail thumbnailWidth={80} />
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
                              <CachedImage src={node.thumbnailUrl} alt="" className="w-5 h-5 object-cover rounded" thumbnail thumbnailWidth={80} />
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
            )}

            {/* Video Input - shown for video-input and flexible providers */}
            {(needsVideoInput || needsBothInputs) && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground/60 text-center">Source Video</span>
                {hasVideoConnection ? (
                  <Select
                    value={nodeData.selectedVideoNodeId ?? ""}
                    onValueChange={(v) => updateNodeData(id, { selectedVideoNodeId: v || undefined })}
                  >
                    <SelectTrigger className="bg-black/30 border-white/10 text-white/80 h-7 text-[11px]" aria-label="Select source video">
                      <SelectValue placeholder="Select video...">
                        {selectedVideo && (
                          <div className="flex items-center gap-2">
                            <Clapperboard className="w-4 h-4 text-[#ff0073]" />
                            <span className="truncate">{selectedVideo.label}</span>
                          </div>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {videoNodes.map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          <div className="flex items-center gap-2">
                            <Clapperboard className="w-4 h-4 text-[#ff0073]" />
                            <span>{node.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-7 px-3 flex items-center text-[11px] text-white/30 bg-black/20 rounded-md border border-dashed border-white/10">
                    Connect source video
                  </div>
                )}
              </div>
            )}

            {/* Audio Track - Required for all providers */}
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
            <span className="text-[10px] text-center">
              {needsVideoInput ? "Connect video + audio" : needsBothInputs ? "Connect image or video + audio" : "Connect portrait image + audio"}
            </span>
          </div>
        )}

        {/* Running state */}
        {status === "running" && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/10 h-[180px]">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          </div>
        )}

        {/* Failed state */}
        {status === "failed" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-red-500/5 text-red-500 h-[180px]">
            <AlertCircle className="w-6 h-6" />
            {nodeData.errorMessage && (
              <p className="text-[10px] text-center text-red-400 px-2 line-clamp-2">{nodeData.errorMessage}</p>
            )}
          </div>
        )}

        {/* Ready state (has inputs, no result yet) */}
        {status !== "running" && !activeUrl && status !== "failed" && hasRequiredInputs && (
          <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
            <Users className="w-10 h-10" />
          </div>
        )}
      </div>
      )}
    </BaseNode>

    {/* image input handle icon — only for image-input/flexible providers */}
    {(needsImageInput || needsBothInputs) && (
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
        style={{ top: 'calc(100% - 80px)', left: '-29px', transform: 'translateY(-50%)' }}
      >
        <ImageIcon className="w-3.5 h-3.5 text-white" />
      </div>
    )}

    {/* video input handle icon — only for video-input/flexible providers */}
    {(needsVideoInput || needsBothInputs) && (
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
        style={{ top: 'calc(100% - 50px)', left: '-29px', transform: 'translateY(-50%)' }}
      >
        <Clapperboard className="w-3.5 h-3.5 text-white" />
      </div>
    )}

    {/* audio input handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: 'calc(100% - 20px)', left: '-29px', transform: 'translateY(-50%)' }}
    >
      <Volume2 className="w-3.5 h-3.5 text-white" />
    </div>

    {/* video output handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: '20px', right: '-29px', transform: 'translateY(-50%)' }}
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
        results={results}
        initialIndex={activeIndex}
        onVideoStateChange={handleVideoStateChange}
        initialVideoPlayState={nodeData.videoPlayState}
        initialPausedAtTime={nodeData.pausedAtTime}
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
