"use client"

import { memo, useState, useRef, useEffect, useCallback } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Clapperboard, Loader2, AlertCircle, Film, Type, Expand, Download, Link, X, LayoutGrid, Scissors, Settings } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { CachedImage } from "@/components/ui/cached-image"
import { resolveCinematicCreditId } from "@nodaro/shared"
import type { CinematicAvatarData } from "@/types/nodes"

function CinematicAvatarNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CinematicAvatarData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)

  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const activeThumbnail = activeResult?.thumbnailUrl

  const videoRef = useRef<HTMLVideoElement>(null)
  const playState = nodeData.videoPlayState ?? "loop"
  const shouldPlay = videoAutoplay && playState === "loop"

  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showThumbnails, setShowThumbnails] = useState(false)

  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)

  // EXACT-duration reserve id — same single source of truth the route's
  // creditGuard uses (resolveCinematicCreditId). The seeded ids are
  // `cinematic-avatar:<res>:<dur>s`; deriving the display id here keeps the
  // shown estimate in lockstep with the actual reserve and can't drift.
  const creditModelId = resolveCinematicCreditId(nodeData)
  const credits = useModelCredits(creditModelId, 9)

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

  const handleVideoStateChange = useCallback(
    (state: { playState: "loop" | "paused" | "stopped"; currentTime: number }) => {
      updateNodeData(id, { videoPlayState: state.playState, pausedAtTime: state.currentTime })
    },
    [id, updateNodeData],
  )

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Clapperboard className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />

      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Clapperboard className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        {...videoNodeSizing(mediaAspectRatio)}
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
          { id: "prompt", type: "target", position: Position.Left,  customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "video",  type: "source", position: Position.Right, customStyle: { top: "24px",              right: "-29px" }, external: true },
        ]}
      >
        {/* Video result view */}
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

            {/* Version badge */}
            {results.length > 1 && (
              <button type="button"
                className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md z-10 opacity-0 group-hover/video:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setShowThumbnails((v) => !v) }}
                title="Show versions">
                <LayoutGrid className="w-3 h-3" />
                <span className="text-[11px] font-medium">{results.length}</span>
              </button>
            )}

            {/* Delete */}
            {results.length > 0 && (
              <div className="absolute top-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <button type="button" aria-label="Remove result"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}
                  title="Delete this result">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Bottom left: fullscreen + download + copy + freeCut */}
            <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
              <button type="button" aria-label="Expand preview"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}
                title="Fullscreen">
                <Expand className="w-3.5 h-3.5" />
              </button>
              <button type="button" aria-label="Download"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); const a = document.createElement("a"); a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`; a.download = `${nodeData.label || "cinematic-avatar"}.mp4`; a.click() }}
                title="Download">
                <Download className="w-3.5 h-3.5" />
              </button>
              <button type="button" aria-label="Copy URL"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); copyToClipboard(activeUrl!, "URL copied") }}
                title="Copy URL">
                <Link className="w-3.5 h-3.5" />
              </button>
              <button type="button" aria-label="Edit in FreeCut"
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); openFreeCut(id, activeUrl!, activeResult?.freecutProjectUrl) }}
                title="Edit in FreeCut">
                <Scissors className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Bottom right: settings */}
            <div className="absolute bottom-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
              <button type="button" aria-label="Settings"
                className={`w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm${isSettingsOpen ? " ring-1 ring-white/30" : ""}`}
                onClick={(e) => { e.stopPropagation(); selectNode(isSettingsOpen ? null : id) }}
                title="Settings">
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 h-full">
            {/* Placeholder body — prompt + avatar-look picker live in the config panel */}
            {status !== "running" && status !== "failed" && (
              <div className="flex flex-col items-center justify-center gap-2 py-4 text-muted-foreground/60">
                <Clapperboard className="w-8 h-8" />
                <span className="text-[10px] text-center">
                  Describe the scene + pick 1–3 avatar looks
                </span>
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
          </div>
        )}
      </BaseNode>

      {/*
        Handles are ALWAYS mounted (never unmount a handle — there is no
        edge-pruner and unmounting would orphan existing edges). The `prompt`
        handle is a generative-prompt text input; `video` is the clip output.
      */}
      <HandleWithPopover
        nodeId={id}
        nodeType="cinematic-avatar"
        handleId="prompt"
        type="target"
        position={Position.Left}
        label="Prompt"
        color={TEXT_HANDLE_COLOR}
        icon={<Type />}
        side="left"
        top="calc(100% - 24px)"
      />
      <HandleWithPopover
        nodeId={id}
        nodeType="cinematic-avatar"
        handleId="video"
        type="source"
        position={Position.Right}
        label="Video"
        color={HANDLE_COLORS.video}
        icon={<Film />}
        side="right"
        top="24px"
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

export const CinematicAvatarNode = memo(CinematicAvatarNodeComponent)
