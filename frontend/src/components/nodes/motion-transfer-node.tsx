"use client"

import { memo, useState, useEffect, useRef, useCallback } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Waypoints, Loader2, AlertCircle, X, Clapperboard, LayoutGrid, Expand, Download, Link, Settings, Scissors } from "lucide-react"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useConnectionCount } from "@/hooks/use-connection-count"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { useModelCredits } from "@/hooks/use-model-credits"
import { buildMotionCreditModelIdentifier } from "@nodaro-shared/credit-identifiers"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { EditableNodeLabel } from "./editable-node-label"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import type { MotionTransferData } from "@/types/nodes"

function MotionTransferNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MotionTransferData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playState = nodeData.videoPlayState ?? "loop"
  const shouldPlay = videoAutoplay && playState === "loop"
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const inConnectionCount = useConnectionCount(id)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const activeThumbnail = activeResult?.thumbnailUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const provider = nodeData.provider || "kling"
  const resolution = nodeData.resolution || "720p"
  const modelId = buildMotionCreditModelIdentifier(provider, resolution, nodeData.videoDuration)
  const credits = useModelCredits(modelId, 38)
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | undefined>()
  useEffect(() => {
    const url = activeThumbnail || activeUrl
    if (!url) { setMediaAspectRatio(undefined); return }
    if (activeThumbnail) {
      let cancelled = false
      const img = new window.Image()
      const setRatio = () => { if (!cancelled && img.naturalWidth > 0) setMediaAspectRatio(img.naturalWidth / img.naturalHeight) }
      img.onload = setRatio
      img.src = activeThumbnail
      if (img.complete) setRatio()
      return () => { cancelled = true }
    }
  }, [activeThumbnail, activeUrl])

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

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  const maxDuration = nodeData.characterOrientation === "image" ? 10 : 30

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Waypoints className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Waypoints className="h-4 w-4" />}
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
        { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
        { id: "out", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
      ]}
    >
      <div className="relative w-full h-full group/video">
        {/* Video / thumbnail */}
        {activeUrl && status !== "running" && (
          <>
            <video
              ref={videoRef}
              src={activeUrl}
              crossOrigin="anonymous"
              poster={activeThumbnail || undefined}
              className="w-full h-full object-cover rounded-xl"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                if (v.videoWidth > 0) setMediaAspectRatio(v.videoWidth / v.videoHeight)
                if (shouldPlay) v.play().catch(() => {})
              }}
              autoPlay={shouldPlay}
              muted
              loop={shouldPlay}
              playsInline
            />
          </>
        )}

        {/* Empty state */}
        {!activeUrl && status !== "running" && status !== "failed" && (
          <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
            <Waypoints className="w-10 h-10" />
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

        {/* Version badge - top left */}
        {results.length > 1 && (
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
        {activeUrl && results.length > 0 && (
          <div className="absolute top-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              aria-label="Remove result"
              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Bottom left: fullscreen + download */}
        {activeUrl && (
          <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              aria-label="Expand preview"
              onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}
            >
              <Expand className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              aria-label="Download"
              onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`; a.download = `${nodeData.label || 'video'}.mp4`; a.click() }}
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Copy URL"
              className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => {
                e.stopPropagation()
                copyToClipboard(activeUrl!, "URL copied")
              }}
            >
              <Link className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Edit in FreeCut"
              className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); openFreeCut(id, activeUrl!, activeResult?.freecutProjectUrl) }}
              title="Edit in FreeCut"
            >
              <Scissors className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Bottom right: settings */}
        {activeUrl && (
          <div className="absolute bottom-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
            <button
              type="button"
              aria-label="Settings"
              className={`w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm${isSettingsOpen ? " ring-1 ring-white/30" : ""}`}
              onClick={(e) => { e.stopPropagation(); selectNode(isSettingsOpen ? null : id) }}
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Bottom info bar */}
      <div className="flex justify-between text-[10px] text-muted-foreground px-2">
        <span>{nodeData.characterOrientation === "image" ? "Image Orient" : "Video Orient"}</span>
        <span>{nodeData.resolution} (max {maxDuration}s)</span>
      </div>
    </BaseNode>

    {/* Video input handle icon (TYPE 1) */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: 'calc(100% - 20px)', left: '-29px', transform: 'translateY(-50%)' }}
    >
      <Clapperboard className="w-3.5 h-3.5 text-white" />
      <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center">+</div>
      {inConnectionCount >= 2 && (
        <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center">
          {inConnectionCount}
        </div>
      )}
    </div>

    {/* Video output handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: '20px', right: '-29px', transform: 'translateY(-50%)' }}
    >
      <Clapperboard className="w-3.5 h-3.5 text-white" />
    </div>

    <DeleteConfirmationDialog
      isOpen={deleteConfirm !== null}
      onClose={() => setDeleteConfirm(null)}
      onConfirm={() => {
        if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
      }}
    />
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
    </div>
  )
}

export const MotionTransferNode = memo(MotionTransferNodeComponent)
