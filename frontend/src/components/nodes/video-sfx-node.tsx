"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import {
  AlertCircle,
  Download,
  Expand,
  Film,
  Link,
  LayoutGrid,
  Loader2,
  Minus,
  Music2,
  Scissors,
  Settings,
  Type,
  X,
} from "lucide-react"
import { BaseNode } from "./base-node"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { EditableNodeLabel } from "./editable-node-label"
import { NodeJobProgress } from "./node-job-progress"
import { ResultsThumbnailsPanel } from "./results-thumbnails-panel"
import { VideoSfxQuickToolbar } from "./video-sfx-quick-toolbar"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { useUpstreamVideoDuration } from "@/hooks/use-upstream-video-duration"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { isValidVideoSfxConnection } from "@/lib/video-sfx-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { copyToClipboard, computeDeleteResultUpdates } from "@/lib/utils"
import type { GeneratedResult, VideoSfxNodeData } from "@/types/nodes"

// Stable, module-level `accepts` predicates for each typed handle. Defining
// these outside the component avoids creating fresh arrow refs on every
// render — HandleWithPopover's `useMemo([..., accepts])` would otherwise
// bust every render. Mirrors generate-video-node.tsx exactly.
const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_PROMPT   = (t: string) => isValidVideoSfxConnection("prompt",   t, isPickerType)
const ACCEPTS_NEGATIVE = (t: string) => isValidVideoSfxConnection("negative", t, isPickerType)
const ACCEPTS_VIDEO    = (t: string) => isValidVideoSfxConnection("video",    t, isPickerType)

// Vertical pip positions, anchored 24px from the BOTTOM of the node.
// Three input clusters intentionally separated by 40px gaps so that adding
// a future handle in any cluster won't shift the existing pips.
//
//   Text:  prompt(24) → negative(52)
//   Video: video(92)                                (gap 40 → 92)
const HANDLE_TOP = {
  prompt:   "calc(100% - 24px)",
  negative: "calc(100% - 52px)",
  video:    "calc(100% - 92px)",
} as const

// Duration-bucketed credit keys — mirrors `BUCKETS` in
// `backend/src/routes/video-sfx.ts` and `video-sfx-quick-toolbar.tsx`.
// The frontend re-derives the key from the upstream video's reported
// duration so any in-node credit display (if added later) and the
// toolbar's Run-button cost match what the route will actually charge
// once ffprobe measures the real file. ffprobe is authoritative; this
// is best-effort UI accuracy only.
const BUCKET_KEYS = [
  { upTo: 8,   key: "replicate-mmaudio:8s" },
  { upTo: 15,  key: "replicate-mmaudio:15s" },
  { upTo: 30,  key: "replicate-mmaudio:30s" },
  { upTo: 60,  key: "replicate-mmaudio:60s" },
  { upTo: 120, key: "replicate-mmaudio:120s" },
  { upTo: 300, key: "replicate-mmaudio:300s" },
] as const

function bucketKeyForDuration(duration: number | null): string {
  if (duration == null || duration <= 0) return "replicate-mmaudio:8s"
  return BUCKET_KEYS.find((b) => duration <= b.upTo)?.key ?? "replicate-mmaudio:300s"
}

function VideoSfxNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as VideoSfxNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)

  const [toolbarDropdownOpen, setToolbarDropdownOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const status = (nodeData.executionStatus as string | undefined) ?? "idle"
  const results = (nodeData.generatedResults as GeneratedResult[] | undefined) ?? []
  const activeIndex = (nodeData.activeResultIndex as number | undefined) ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? (nodeData.generatedVideoUrl as string | undefined)
  const activeThumbnail = activeResult?.thumbnailUrl
  const playState = (nodeData.videoPlayState as "loop" | "paused" | "stopped" | undefined) ?? "loop"
  const shouldPlay = videoAutoplay && playState === "loop"
  const videoRef = useRef<HTMLVideoElement>(null)

  // Credit display — duration-bucketed × versions multiplier. Best-effort
  // UI display only; the route's `probeDurationPreHandler` ffprobes the
  // resolved file at execute time and uses THAT for the actual reservation.
  // BaseNode header is hidden so this number isn't user-visible in the body
  // (the quick toolbar shows it via RunNodeButton), but we still compute
  // and pass it for forward-compat with any future header reveal.
  const upstreamDuration = useUpstreamVideoDuration(id, "video")
  const baseCredits = useModelCredits(bucketKeyForDuration(upstreamDuration), 1)
  const versions = Math.min(Math.max(1, nodeData.versions ?? 1), 4)
  const credits = baseCredits * versions

  // Result-aspect-ratio for the BaseNode minHeight calc + video-element sizing.
  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)

  // Video playback effects (loop / paused / stopped) — mirror generate-video.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !activeUrl) return
    if (playState === "paused") {
      v.pause()
      if (nodeData.pausedAtTime !== undefined) v.currentTime = nodeData.pausedAtTime as number
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

  // BaseNode handles array. `external: true` so BaseNode counts the handle
  // toward node sizing (handleMinHeight) but does NOT render a duplicate
  // <Handle> — the HandleWithPopover instances below own DOM rendering.
  const handles = useMemo(
    () => [
      { id: "prompt",   type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.prompt,   left: "-29px" }, external: true },
      { id: "negative", type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.negative, left: "-29px" }, external: true },
      { id: "video",    type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.video,    left: "-29px" }, external: true },
      { id: "video",    type: "source" as const, position: Position.Right, customStyle: { top: "24px",              right: "-29px" }, external: true },
    ],
    [],
  )

  // Re-register handles with React Flow on changes — edges to new handles
  // render unreliably otherwise.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, handles, updateNodeInternals])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={(nodeData.label as string) ?? "Video SFX"}
        icon={<Music2 className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={(nodeData.label as string) ?? "Video SFX"}
        icon={<Music2 className="h-4 w-4" />}
        category="i2v"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        className={activeUrl ? "!border-0 !shadow-none !bg-transparent" : undefined}
        hideHeader
        {...videoNodeSizing(mediaAspectRatio)}
        handles={handles}
        topToolbarContent={
          <VideoSfxQuickToolbar
            nodeId={id}
            data={nodeData}
            isRunning={status === "running"}
            onAnyOpenChange={setToolbarDropdownOpen}
          />
        }
        keepTopToolbarVisible={toolbarDropdownOpen}
        bottomToolbarContent={
          showThumbnails && results.length > 1 ? (
            <ResultsThumbnailsPanel
              results={results}
              activeIndex={activeIndex}
              // Either React Flow's `selected` (single-click in canvas) OR
              // the settings panel being open (gear icon — sets
              // `selectedNodeId` in Zustand independently of React Flow's
              // selection state). Both signal "user is currently
              // interacting with this node" → arrow keys browse results.
              nodeSelected={!!selected || isSettingsOpen}
              onSelect={(i) => updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: results[i].url })}
            />
          ) : undefined
        }
      >
        <div className="relative w-full h-full group/video">
          {/* Running state */}
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[80px]">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress as number | undefined} />
            </div>
          )}

          {/* Video result */}
          {status !== "running" && activeUrl && (
            <>
              {results.length > 1 && (
                <button
                  type="button"
                  className="absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md opacity-0 group-hover/video:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowThumbnails((v) => !v)
                  }}
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
                // Video SFX OUTPUT carries the generated audio mixed with the
                // source video — keep muted by default for autoplay
                // compatibility (browsers block autoplay-with-sound) and let
                // the user un-mute from the fullscreen lightbox.
                muted
                playsInline
                poster={activeThumbnail}
                className="w-full h-full object-cover rounded-xl"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget
                  if (v.videoWidth > 0) {
                    handleLoadDimensions({ width: v.videoWidth, height: v.videoHeight })
                  }
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
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConfirm(activeIndex)
                    }}
                    title="Delete this result"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {/* Bottom-left: expand, download, copy, freecut, save-to-library */}
              <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <button
                  type="button"
                  aria-label="Expand preview"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPreviewOpen(true)
                  }}
                  title="Fullscreen"
                >
                  <Expand className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Download"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    const a = document.createElement("a")
                    a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl)}&download=1`
                    a.download = `${(nodeData.label as string) || "video-sfx"}.mp4`
                    a.click()
                  }}
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Copy URL"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    copyToClipboard(activeUrl, "URL copied")
                  }}
                  title="Copy URL"
                >
                  <Link className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Edit in FreeCut"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    openFreeCut(id, activeUrl, activeResult?.freecutProjectUrl)
                  }}
                  title="Edit in FreeCut"
                >
                  <Scissors className="w-3.5 h-3.5" />
                </button>
                <SaveToLibraryButton url={activeUrl} type="video" />
              </div>
              {/* Bottom-right: settings */}
              <div className="absolute bottom-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <button
                  type="button"
                  aria-label="Settings"
                  className={`w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm${
                    isSettingsOpen ? " ring-1 ring-white/30" : ""
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    selectNode(isSettingsOpen ? null : id)
                  }}
                  title="Settings"
                >
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
              {nodeData.errorMessage ? (
                <p
                  className="text-[10px] text-center line-clamp-2 text-red-400"
                  title={nodeData.errorMessage as string}
                >
                  {nodeData.errorMessage as string}
                </p>
              ) : null}
            </div>
          )}

          {/* Idle state */}
          {status !== "running" && !activeUrl && status !== "failed" && (
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
              <Music2 className="w-10 h-10" />
              <span className="text-[10px] text-muted-foreground/60 px-2 text-center">
                Wire a video and run to add SFX
              </span>
            </div>
          )}
        </div>
      </BaseNode>

      {/* 3 typed input pips + 1 output pip — bottom-up cluster:
          text → video. Colors mirror the source node's category color so
          the wire endpoint reads as the source's brand:
            prompt   → brand pink   (#ff0073, text producers)
            negative → red          (negation)
            video    → purple       (video family)
          The output pip shares the purple video color since this node
          emits a video (source clip + SFX mixed in). */}
      <HandleWithPopover nodeId={id} nodeType="video-sfx" handleId="prompt"   type="target" position={Position.Left}  label="Prompt"   color={TEXT_HANDLE_COLOR} icon={<Type />}    side="left"  top={HANDLE_TOP.prompt}   accepts={ACCEPTS_PROMPT} />
      <HandleWithPopover nodeId={id} nodeType="video-sfx" handleId="negative" type="target" position={Position.Left}  label="Negative" color={HANDLE_COLORS.negative} icon={<Minus />}   side="left"  top={HANDLE_TOP.negative} accepts={ACCEPTS_NEGATIVE} />
      <HandleWithPopover nodeId={id} nodeType="video-sfx" handleId="video"    type="target" position={Position.Left}  label="Video"    color={HANDLE_COLORS.video} icon={<Film />}    side="left"  top={HANDLE_TOP.video}    accepts={ACCEPTS_VIDEO} />
      {/* Output pip — video. Shares Film + purple (video category color) for type identification. */}
      <HandleWithPopover nodeId={id} nodeType="video-sfx" handleId="video"    type="source" position={Position.Right} label="Video"    color={HANDLE_COLORS.video} icon={<Film />}    side="right" top="24px" />

      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="video"
          url={activeUrl}
          results={results}
          initialIndex={activeIndex}
          onIndexChange={(i) => updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: results[i]?.url })}
          onVideoStateChange={handleVideoStateChange}
          initialVideoPlayState={nodeData.videoPlayState as "loop" | "paused" | "stopped" | undefined}
          initialPausedAtTime={nodeData.pausedAtTime as number | undefined}
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

export const VideoSfxNode = memo(VideoSfxNodeComponent)
