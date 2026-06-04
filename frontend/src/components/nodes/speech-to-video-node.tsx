"use client"

import { memo, useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { incomingSourcesFingerprint } from "@/lib/node-fingerprint"
import { MessageSquare, Loader2, AlertCircle, X, Image as ImageIcon, Volume2, Film, LayoutGrid, Expand, Download, Type, Link, Settings, Scissors, Aperture } from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { isValidSpeechToVideoConnection } from "@/lib/video-producer-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { CachedImage } from "@/components/ui/cached-image"
import { NodeJobProgress } from "./node-job-progress"
import { EditableNodeLabel } from "./editable-node-label"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import type { SpeechToVideoData, GeneratedResult } from "@/types/nodes"

const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_IMAGE          = (t: string) => isValidSpeechToVideoConnection("image",          t, isPickerType)
const ACCEPTS_AUDIO          = (t: string) => isValidSpeechToVideoConnection("audio",          t, isPickerType)
const ACCEPTS_PROMPT         = (t: string) => isValidSpeechToVideoConnection("prompt",         t, isPickerType)
const ACCEPTS_CINEMATOGRAPHY = (t: string) => isValidSpeechToVideoConnection("cinematography", t, isPickerType)

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

const TEXT_OUTPUT_TYPES = [
  "text-prompt",
  "generate-script",
  "ai-writer",
  "llm-chat",
  "combine-text",
]

interface ConnectedNodeInfo {
  id: string
  label: string
  type: string
  thumbnailUrl?: string
  outputType: "image" | "audio" | "text" | "video" | "other"
}

function SpeechToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SpeechToVideoData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playState = nodeData.videoPlayState ?? "loop"
  const shouldPlay = videoAutoplay && playState === "loop"
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)

  // Narrow subscription: a primitive fingerprint of the incoming connections
  // and their source nodes (type + full data) instead of whole-array
  // `s.nodes` / `s.edges`. `connectedNodes` is the only consumer; it reads
  // upstream type/label/result fields that change during polling, so we
  // serialize the connected sources' data wholesale (typically 1-3 nodes —
  // cheap) to guarantee no missed field, and re-render only when an incoming
  // connection or upstream source data changes — not on every unrelated
  // mutation across the graph.
  const connectedFingerprint = useWorkflowStore((s) =>
    incomingSourcesFingerprint(s.nodes, s.edges, id),
  )

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

  const resolution = nodeData.resolution ?? "480p"
  const creditModelId = resolution === "720p" ? "speech-to-video:720p" : resolution === "580p" ? "speech-to-video:580p" : "speech-to-video"
  const defaultCost = resolution === "720p" ? 8 : resolution === "580p" ? 6 : 4
  const credits = useModelCredits(creditModelId, defaultCost)

  // Reads live arrays from getState(); memoized on the connected-source
  // fingerprint so it only recomputes when an incoming connection or upstream
  // source data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const connectedNodes = useMemo(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    const connectedEdges = edges.filter((e) => e.target === id)
    const nodeMap = new Map<string, ConnectedNodeInfo>()

    for (const edge of connectedEdges) {
      const srcNode = nodes.find((n) => n.id === edge.source)
      if (!srcNode) continue
      if (nodeMap.has(srcNode.id)) continue

      const srcData = srcNode.data as Record<string, unknown>
      const nodeType = String(srcNode.type ?? "unknown")

      let outputType: "image" | "audio" | "text" | "video" | "other" = "other"
      if (IMAGE_OUTPUT_TYPES.includes(nodeType)) outputType = "image"
      else if (AUDIO_OUTPUT_TYPES.includes(nodeType)) outputType = "audio"
      else if (TEXT_OUTPUT_TYPES.includes(nodeType)) outputType = "text"

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
  }, [id, connectedFingerprint])

  const imageNodes = useMemo(() => connectedNodes.filter((n) => n.outputType === "image"), [connectedNodes])
  const audioNodes = useMemo(() => connectedNodes.filter((n) => n.outputType === "audio"), [connectedNodes])
  const textNodes = useMemo(() => connectedNodes.filter((n) => n.outputType === "text"), [connectedNodes])

  const hasConnections = connectedNodes.length > 0
  const hasImageConnection = imageNodes.length > 0
  const hasAudioConnection = audioNodes.length > 0
  const hasRequiredInputs = hasImageConnection && hasAudioConnection

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<MessageSquare className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />

    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<MessageSquare className="h-4 w-4" />}
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
                  <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />
      }
      handles={[
        { id: "prompt",         type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)',  left: '-29px' }, external: true },
        { id: "audio",          type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)',  left: '-29px' }, external: true },
        { id: "image",          type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 88px)',  left: '-29px' }, external: true },
        { id: "cinematography", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 120px)', left: '-29px' }, external: true },
        { id: "video",          type: "source", position: Position.Right, customStyle: { top: '24px',               right: '-29px' }, external: true },
      ]}
    >
      {/* When result exists, show video fullscreen in node */}
      {status !== "running" && activeUrl ? (
      <div className="relative w-full h-full group/video">
        <video ref={videoRef} src={activeUrl} crossOrigin="anonymous" poster={activeThumbnail || undefined}
          className="w-full h-full object-cover rounded-xl"
          onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth > 0) handleLoadDimensions({ width: v.videoWidth, height: v.videoHeight }); if (shouldPlay) v.play().catch(() => {}) }}
          autoPlay={shouldPlay} muted loop={shouldPlay} playsInline />

        {/* Version badge - top left */}
        {results.length > 1 && (
          <button type="button"
            className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md z-10 opacity-0 group-hover/video:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }} title="Show versions">
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
        {/* Connection indicators */}
        {!hasConnections && status !== "running" && (
          <div className="flex flex-col items-center justify-center gap-1 py-4 text-muted-foreground/60">
            <MessageSquare className="w-8 h-8" />
            <span className="text-[10px] text-center">Connect image + audio + prompt</span>
          </div>
        )}

        {hasConnections && status !== "running" && status !== "failed" && (
          <div className="flex flex-col gap-1 px-3 pt-2">
            <div className="flex items-center gap-1.5">
              <ImageIcon className={`w-3 h-3 ${hasImageConnection ? "text-green-400" : "text-white/30"}`} />
              <span className="text-[10px] text-muted-foreground/60">{hasImageConnection ? "Image connected" : "Need image"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Volume2 className={`w-3 h-3 ${hasAudioConnection ? "text-green-400" : "text-white/30"}`} />
              <span className="text-[10px] text-muted-foreground/60">{hasAudioConnection ? "Audio connected" : "Need audio"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Type className={`w-3 h-3 ${textNodes.length > 0 ? "text-green-400" : "text-white/30"}`} />
              <span className="text-[10px] text-muted-foreground/60">{textNodes.length > 0 ? "Prompt connected" : "Using default prompt"}</span>
            </div>
          </div>
        )}

        {status === "running" && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/10 h-[180px]">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          </div>
        )}

        {status === "failed" && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-red-500/5 text-red-500 h-[180px]">
            <AlertCircle className="w-6 h-6" />
            {nodeData.errorMessage && (
              <p className="text-[10px] text-center text-red-400 px-2 line-clamp-2">{nodeData.errorMessage}</p>
            )}
          </div>
        )}

        {status !== "running" && status !== "failed" && hasRequiredInputs && (
          <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
            <MessageSquare className="w-10 h-10" />
          </div>
        )}
      </div>
      )}
    </BaseNode>

    <HandleWithPopover nodeId={id} nodeType="speech-to-video" handleId="prompt"         type="target" position={Position.Left}  label="Prompt"         color={TEXT_HANDLE_COLOR} icon={<Type />}      side="left"  top="calc(100% - 24px)"  accepts={ACCEPTS_PROMPT} />
    <HandleWithPopover nodeId={id} nodeType="speech-to-video" handleId="audio"          type="target" position={Position.Left}  label="Audio"          color={HANDLE_COLORS.audio} icon={<Volume2 />}   side="left"  top="calc(100% - 56px)"  accepts={ACCEPTS_AUDIO} />
    <HandleWithPopover nodeId={id} nodeType="speech-to-video" handleId="image"          type="target" position={Position.Left}  label="Portrait"       color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left"  top="calc(100% - 88px)"  accepts={ACCEPTS_IMAGE} />
    <HandleWithPopover nodeId={id} nodeType="speech-to-video" handleId="cinematography" type="target" position={Position.Left}  label="Cinematography" color={HANDLE_COLORS.look} icon={<Aperture />}  side="left"  top="calc(100% - 120px)" accepts={ACCEPTS_CINEMATOGRAPHY} />
    <HandleWithPopover nodeId={id} nodeType="speech-to-video" handleId="video"          type="source" position={Position.Right} label="Video"          color={HANDLE_COLORS.video} icon={<Film />}      side="right" top="24px" />

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

export const SpeechToVideoNode = memo(SpeechToVideoNodeComponent)
