"use client"

import { memo, useState, useMemo, useEffect, useRef, useCallback, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import {
  Clapperboard,
  Loader2,
  AlertCircle,
  X,
  Image as ImageIcon,
  Images,
  Volume2,
  Download,
  Settings,
  LayoutGrid,
  Expand,
  Link,
  Scissors,
  Aperture,
} from "lucide-react"
import { HandleIcon } from "./handle-icon"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useConnectionCount } from "@/hooks/use-connection-count"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { copyToClipboard, computeDeleteResultUpdates } from "@/lib/utils"
const Kling3DirectorModal = lazy(() =>
  import("@/components/editor/kling3-director-modal").then((m) => ({
    default: m.Kling3DirectorModal,
  })),
)
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { CachedImage } from "@/components/ui/cached-image"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { EditableNodeLabel } from "./editable-node-label"
import type { ImageToVideoData } from "@/types/nodes"
import {
  PROVIDERS_WITH_REFERENCES,
  PROVIDERS_WITH_END_FRAME,
  VIDEO_PROVIDER_FALLBACKS,
} from "../editor/config-panels/model-options"
import {
  isSeedance2Provider,
  buildVideoCreditModelIdentifier,
  estimateLoopTrimAddonCredits,
} from "@nodaro/shared"

function ImageToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageToVideoData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playState = nodeData.videoPlayState ?? "loop"
  const shouldPlay = videoAutoplay && playState === "loop"
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const startFrameConnectionCount = useConnectionCount(id, "startFrame")
  const referencesConnectionCount = useConnectionCount(id, "references")

  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const activeThumbnail = activeResult?.thumbnailUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [directorOpen, setDirectorOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const provider = nodeData.provider ?? "seedance-2-fast"
  // Composite identifier — VEO 3.x prices vary by resolution, Seedance by
  // duration/resolution/ref, kling by duration/audio. Without this the
  // RunNodeButton + node badge would show stale credit cost on parameter
  // changes (e.g. switching VEO 3.1 from 720p → 1080p must shift 19 → 21).
  const creditIdentifier = buildVideoCreditModelIdentifier(
    provider,
    nodeData.duration,
    nodeData.sound as boolean | undefined,
    "image-to-video",
    nodeData.videoSize as string | undefined,
    nodeData.resolution,
    Array.isArray(nodeData.referenceVideoUrls) && (nodeData.referenceVideoUrls as unknown[]).length > 0,
  )
  const baseCredits = useModelCredits(creditIdentifier, VIDEO_PROVIDER_FALLBACKS[provider] ?? 25)
  const loopAddon = estimateLoopTrimAddonCredits(nodeData.loopTrim, nodeData.duration ?? 8)
  const credits = baseCredits + loopAddon
  // When the active result has stored width/height (captured the first
  // time it loaded), aspectRatio is available synchronously on switch —
  // no race with onLoadedMetadata. handleLoadDimensions writes captured
  // dims back to the result so subsequent switches stay synchronous.
  const { aspectRatio: resultAspect, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)
  const [thumbAspect, setThumbAspect] = useState<number | undefined>()
  useEffect(() => {
    setThumbAspect(undefined)
    if (!activeThumbnail) return
    let cancelled = false
    const img = new window.Image()
    const setRatio = () => { if (!cancelled && img.naturalWidth > 0) setThumbAspect(img.naturalWidth / img.naturalHeight) }
    img.onload = setRatio
    img.src = activeThumbnail
    if (img.complete) setRatio()
    return () => { cancelled = true }
  }, [activeThumbnail])
  // Prefer result-derived aspect (synchronous on switch) over the thumbnail
  // preload (async, may not be available on switch).
  const mediaAspectRatio = resultAspect ?? thumbAspect

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

  const listTotal = (nodeData as Record<string, unknown>).__listTotal as number | undefined
  const listCompleted = (nodeData as Record<string, unknown>).__listCompleted as number | undefined
  const listProgressPercent = (listTotal && listTotal > 0 && listCompleted !== undefined)
    ? Math.round((listCompleted / listTotal) * 100)
    : undefined

  const supportsEndFrame = PROVIDERS_WITH_END_FRAME.includes(provider)
  const isKling3 = provider === "kling-3.0"
  const isKling3MultiShot = isKling3 && nodeData.multiShot
  const supportsReferences = PROVIDERS_WITH_REFERENCES.includes(provider)
  const isVeo = provider === "veo3" || provider === "veo3.1" || provider === "veo3_lite"
  const isVeoRefMode = isVeo && nodeData.veoMode === "reference"
  const isSeedance2 = isSeedance2Provider(provider)
  const s2Mode: "frames" | "references" = isSeedance2 ? (nodeData.seedance2InputMode ?? "frames") : "frames"
  const isS2RefMode = isSeedance2 && s2Mode === "references"
  const showStartFrame = !isVeoRefMode && !isS2RefMode
  const showEndFrame = supportsEndFrame && !isKling3MultiShot && !isS2RefMode
  const showReferences = supportsReferences && (!isVeo || isVeoRefMode) && (!isSeedance2 || isS2RefMode)

  // Build ordered input handle list bottom-up (index 0 = slot 1 = bottom)
  const orderedInputHandleIds = useMemo(() => {
    const list: string[] = []
    if (showStartFrame) list.push("startFrame")
    else if (showReferences) list.push("references")
    if (showEndFrame && showStartFrame) list.push("endFrame")
    if (isS2RefMode) list.push("reference-audio", "reference-videos")
    list.push("audio", "cinematography")
    return list
  }, [showStartFrame, showReferences, showEndFrame, isS2RefMode])

  const getHandleTop = (id: string) => {
    const idx = orderedInputHandleIds.indexOf(id)
    return `calc(100% - ${20 + idx * 30}px)`
  }

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  const handles = useMemo(() => [
    ...(showStartFrame ? [{ id: "startFrame", type: "target" as const, position: Position.Left, customStyle: { top: getHandleTop("startFrame"), left: '-29px' }, hideHandle: true }] : []),
    ...(showReferences ? [{ id: "references", type: "target" as const, position: Position.Left, customStyle: { top: getHandleTop("references"), left: '-29px' }, hideHandle: true }] : []),
    ...((showEndFrame && showStartFrame) ? [{ id: "endFrame", type: "target" as const, position: Position.Left, customStyle: { top: getHandleTop("endFrame"), left: '-29px' }, hideHandle: true }] : []),
    ...(isS2RefMode ? [
      { id: "reference-audio", type: "target" as const, position: Position.Left, customStyle: { top: getHandleTop("reference-audio"), left: '-29px' }, hideHandle: true },
      { id: "reference-videos", type: "target" as const, position: Position.Left, customStyle: { top: getHandleTop("reference-videos"), left: '-29px' }, hideHandle: true },
    ] : []),
    { id: "audio", type: "target" as const, position: Position.Left, customStyle: { top: getHandleTop("audio"), left: '-29px' }, hideHandle: true },
    { id: "cinematography", type: "target" as const, position: Position.Left, customStyle: { top: getHandleTop("cinematography"), left: '-29px' }, hideHandle: true },
    { id: "video", type: "source" as const, position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
  ], [orderedInputHandleIds, showStartFrame, showReferences, showEndFrame, isS2RefMode])

  // Re-register handles with React Flow when they change — edges to new handles render unreliably otherwise
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, handles, updateNodeInternals])

  return (
    <div
      className="relative"
      style={{ width: "100%", height: "100%" }}
      onDoubleClick={isKling3 ? (e) => { e.stopPropagation(); setDirectorOpen(true) } : undefined}
    >
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Clapperboard className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Clapperboard className="h-4 w-4" />}
        category="i2v"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        className={activeUrl ? "!border-0 !shadow-none !bg-transparent" : undefined}
        hideHeader
        listCount={listTotal}
        listProgress={status === "running" && listTotal ? `${listCompleted ?? 0}/${listTotal}` : undefined}
        listProgressPercent={status === "running" ? listProgressPercent : undefined}
        minWidth={220}
        minHeight={200}
        imageAspectRatio={mediaAspectRatio}
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
        handles={handles}
      >
        <div className="relative w-full h-full group/video">
          {/* Running state */}
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[80px]">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {/* Video result */}
          {status !== "running" && activeUrl && (
            <>
              {results.length > 1 && (
                <button
                  type="button"
                  className="absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md opacity-0 group-hover/video:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
                >
                  <LayoutGrid className="w-3 h-3" />
                  <span>{results.length}</span>
                </button>
              )}
              <video
                ref={videoRef}
                src={activeUrl}
                crossOrigin="anonymous"
                autoPlay={shouldPlay}
                loop={shouldPlay}
                muted
                playsInline
                poster={activeThumbnail}
                className="w-full h-full object-cover rounded-xl"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget
                  if (v.videoWidth > 0) handleLoadDimensions({ width: v.videoWidth, height: v.videoHeight })
                  if (shouldPlay) v.play().catch(() => {})
                }}
              />
              {/* Top-right: delete */}
              {results.length > 0 && (
                <div className="absolute top-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
                  <button
                    type="button"
                    aria-label="Remove result"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}
                    title="Delete this result"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {/* Bottom-left: expand, download, copy, freecut */}
              <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <button type="button" aria-label="Expand preview"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }} title="Fullscreen">
                  <Expand className="w-3.5 h-3.5" />
                </button>
                <button type="button" aria-label="Download"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    const a = document.createElement('a')
                    a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`
                    a.download = `${nodeData.label || 'video'}.mp4`
                    a.click()
                  }} title="Download">
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
              {/* Bottom-right: settings */}
              <div className="absolute bottom-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <button type="button" aria-label="Settings"
                  className={`w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm${isSettingsOpen ? " ring-1 ring-white/30" : ""}`}
                  onClick={(e) => { e.stopPropagation(); selectNode(isSettingsOpen ? null : id) }} title="Settings">
                  <Settings className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}

          {/* Failed state */}
          {status === "failed" && !activeUrl && (
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl p-2 h-[180px] bg-red-500/5 text-red-500">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">Failed</span>
              </div>
              {nodeData.errorMessage && (
                <p className="text-[10px] text-center line-clamp-2 text-red-400" title={nodeData.errorMessage}>
                  {nodeData.errorMessage}
                </p>
              )}
            </div>
          )}

          {/* Idle state */}
          {status !== "running" && !activeUrl && status !== "failed" && (
            <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
              <Clapperboard className="w-10 h-10" />
            </div>
          )}
        </div>
      </BaseNode>

      {/* startFrame handle icon */}
      {showStartFrame && (
        <HandleIcon icon={<ImageIcon />} color="pink" side="left" top={getHandleTop("startFrame")} label="Start Frame">
          <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center pointer-events-none">+</div>
          {startFrameConnectionCount >= 2 && (
            <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center pointer-events-none">{startFrameConnectionCount}</div>
          )}
        </HandleIcon>
      )}

      {/* endFrame handle icon */}
      {showEndFrame && showStartFrame && (
        <HandleIcon icon={<ImageIcon />} color="pink" side="left" top={getHandleTop("endFrame")} label="End Frame" />
      )}

      {/* audio handle icon */}
      <HandleIcon icon={<Volume2 />} color="pink" side="left" top={getHandleTop("audio")} label="Audio" />

      {/* references handle icon */}
      {showReferences && (
        <HandleIcon icon={<Images />} color="pink" side="left" top={getHandleTop("references")} label="References">
          <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center pointer-events-none">+</div>
          {referencesConnectionCount >= 1 && (
            <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center pointer-events-none">{referencesConnectionCount}</div>
          )}
        </HandleIcon>
      )}

      {/* reference-audio handle icon (S2 ref mode) */}
      {isS2RefMode && (
        <HandleIcon icon={<Volume2 />} color="pink" side="left" top={getHandleTop("reference-audio")} label="Ref Audio" />
      )}

      {/* reference-videos handle icon (S2 ref mode) */}
      {isS2RefMode && (
        <HandleIcon icon={<Clapperboard />} color="pink" side="left" top={getHandleTop("reference-videos")} label="Ref Videos" />
      )}

      {/* cinematography handle icon */}
      <HandleIcon icon={<Aperture />} color="indigo" side="left" top={getHandleTop("cinematography")} label="Cinematography" />

      {/* video output handle icon */}
      <HandleIcon icon={<Clapperboard />} color="pink" side="right" top="20px" label="Video" />

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
        onConfirm={() => handleDeleteResult(deleteConfirm!)}
      />

      {directorOpen && (
        <Suspense fallback={null}>
          <Kling3DirectorModal
            isOpen={directorOpen}
            onClose={() => setDirectorOpen(false)}
            nodeId={id}
          />
        </Suspense>
      )}
    </div>
  )
}

export const ImageToVideoNode = memo(ImageToVideoNodeComponent)
