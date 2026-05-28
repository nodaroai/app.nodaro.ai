"use client"

import { memo, useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import {
  Scissors,
  Video,
  Type,
  Aperture,
  Loader2,
  AlertCircle,
  ShieldAlert,
  LayoutGrid,
  X,
  Download,
  Settings,
  Expand,
  Link,
  Frame,
} from "lucide-react"
import { BaseNode } from "./base-node"
import { HandleWithPopover } from "./handle-with-popover"
import { EditableNodeLabel } from "./editable-node-label"
import { VideoRetakeQuickToolbar } from "./video-retake-quick-toolbar"
import { NodeJobProgress } from "./node-job-progress"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { RetakeRangeSlider } from "@/components/editor/config-panels/retake-range-slider"
import { isValidVideoRetakeConnection } from "@/lib/video-retake-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { getHandleConnectionLimit } from "@/lib/handle-limits"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { copyToClipboard, computeDeleteResultUpdates } from "@/lib/utils"
import type { VideoRetakeData, GeneratedResult, WorkflowNode } from "@/types/nodes"

// Stable, module-level `accepts` predicates per typed handle — hoisting
// keeps the predicate ref stable across renders. Inline arrows bust
// HandleWithPopover's `useConnection` memo on every render (see playbook
// Feature 1 + the "inline accepts arrow" pitfall row).
const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_VIDEO  = (t: string) => isValidVideoRetakeConnection("video",  t, isPickerType)
const ACCEPTS_PROMPT = (t: string) => isValidVideoRetakeConnection("prompt", t, isPickerType)
const ACCEPTS_LOOK   = (t: string) => isValidVideoRetakeConnection("look",   t, isPickerType)

// Vertical stack (bottom-up), 32px gaps — canonical handle stacking from
// the playbook. 3 input pips → top-most ends at `calc(100% - 88px)`.
//
//   video    (24)   primary video to retake
//   prompt   (56)   retake guidance
//   look     (88)   Look picker family
const HANDLE_TOP = {
  video: "calc(100% - 24px)",
  prompt: "calc(100% - 56px)",
  look: "calc(100% - 88px)",
} as const

function VideoRetakeNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as VideoRetakeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const edges = useWorkflowStore((s) => s.edges)
  const nodes = useWorkflowStore((s) => s.nodes)

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

  // Resolve the upstream video URL via the `video` target handle. We mirror
  // the lip-sync-node pattern (edges + nodes + extractNodeOutput) so the
  // retake node shows the source clip inside its body while the user picks
  // a retake window. lip-sync-node also auto-selects the first upstream
  // video node into `selectedVideoNodeId` — we do the same so downstream
  // execution-graph hydration matches the visible preview.
  const upstreamVideoNode = useMemo(() => {
    const videoEdge = edges.find((e) => e.target === id && e.targetHandle === "video")
    if (!videoEdge) return undefined
    return nodes.find((n) => n.id === videoEdge.source)
  }, [edges, nodes, id])

  // Sync selectedVideoNodeId to whatever is currently connected to the
  // `video` handle (mirrors lip-sync-node's auto-selection effect).
  useEffect(() => {
    const nextId = upstreamVideoNode?.id
    if (nextId === nodeData.selectedVideoNodeId) return
    updateNodeData(id, { selectedVideoNodeId: nextId })
  }, [upstreamVideoNode?.id, nodeData.selectedVideoNodeId, id, updateNodeData])

  const upstreamVideoUrl = useMemo(() => {
    if (!upstreamVideoNode) return undefined
    return extractNodeOutput(upstreamVideoNode as WorkflowNode)
  }, [upstreamVideoNode])

  // Probe the upstream video's duration via `loadedmetadata` so the
  // retake-range slider can clamp to a valid window. Persisted on data
  // so the execution-time payload-builder can read the same value.
  const handleSourceLoadedMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const dur = e.currentTarget.duration
      if (Number.isFinite(dur) && dur > 0 && dur !== nodeData.videoDurationSec) {
        updateNodeData(id, { videoDurationSec: dur })
      }
    },
    [id, nodeData.videoDurationSec, updateNodeData],
  )

  // Credit math — LTX retake is per-second. `STATIC_CREDIT_COSTS` has
  // `ltx-2.3-pro-retake:per-second` = 50; multiply by the user-chosen
  // retake duration to get the per-press cost. RunNodeButton already
  // multiplies by repeatCount + list fan-out.
  const perSecondCost = useModelCredits("ltx-2.3-pro-retake:per-second", 50)
  const retakeDuration = Math.max(2, nodeData.retakeDuration ?? 2)
  const credits = Math.ceil(perSecondCost * retakeDuration)

  // Result-aspect-ratio for the BaseNode minHeight calc + video sizing.
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

  // BaseNode handles array — `external: true` reserves vertical sizing
  // budget but defers DOM rendering to the <HandleWithPopover> below.
  const handles = useMemo(
    () => [
      { id: "video",  type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.video,  left: "-29px" }, external: true },
      { id: "prompt", type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.prompt, left: "-29px" }, external: true },
      { id: "look",   type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.look,   left: "-29px" }, external: true },
      { id: "video",  type: "source" as const, position: Position.Right, customStyle: { top: "24px",            right: "-29px" }, external: true },
    ],
    [],
  )

  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, handles, updateNodeInternals])

  // Per-handle "cap 0" set — mirrors generate-video-node. Currently the
  // limits registry's only retake rule is the `video` handle cap of 1
  // (single primary input), which doesn't make the handle disabled — it
  // just caps how many connections can land on it. So this set typically
  // stays empty; we keep the scaffolding for forward-compat.
  const disabledHandles = useMemo(() => {
    const fakeNode = {
      type: "video-retake",
      data: { provider: nodeData.provider },
    } as unknown as WorkflowNode
    const set = new Set<string>()
    for (const hid of ["video", "prompt", "look"] as const) {
      const lim = getHandleConnectionLimit(fakeNode, hid)
      if (lim?.limit === 0) set.add(hid)
    }
    return set
  }, [nodeData.provider])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  // Failure routing — content-policy gets the amber ShieldAlert visual.
  // Detection mirrors generate-image-node's keyword check on errorMessage.
  const errorMessage = nodeData.errorMessage as string | undefined
  const isContentPolicyFail =
    status === "failed" &&
    !!errorMessage &&
    /content policy|prohibited|safety|blocked/i.test(errorMessage)

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={(nodeData.label as string) ?? "Retake Video"}
        icon={<Scissors className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={(nodeData.label as string) ?? "Retake Video"}
        icon={<Scissors className="h-4 w-4" />}
        category="i2v"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        className={activeUrl ? "!border-0 !shadow-none !bg-transparent" : undefined}
        hideHeader
        minWidth={240}
        // 3 input pips + 1 output. Top-most input (look) sits at
        // top: calc(100% - 88px); reserve ~116px (28 + 88) of vertical
        // room minimum so all pips stay within the body.
        minHeight={mediaAspectRatio ? Math.max(160, Math.round(240 / mediaAspectRatio)) : 160}
        imageAspectRatio={mediaAspectRatio ?? 16 / 9}
        handles={handles}
        topToolbarContent={
          <VideoRetakeQuickToolbar
            nodeId={id}
            data={nodeData}
            credits={credits}
            isRunning={status === "running"}
            onAnyOpenChange={setToolbarDropdownOpen}
          />
        }
        keepTopToolbarVisible={toolbarDropdownOpen}
        bottomToolbarContent={
          showThumbnails && results.length > 1 ? (
            <div className="flex gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
              {results.slice(0, 8).map((r, i) => (
                <div key={`${r.jobId ?? "r"}-${i}`} className="relative shrink-0">
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
      >
        <div className="relative w-full h-full group/video">
          {/* Running state — Loader + progress overlay */}
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[80px]">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress as number | undefined} />
            </div>
          )}

          {/* Source-video preview + retake-range slider — shows ONLY when
              the upstream video resolves AND we don't yet have an active
              result + we're not running/failed. Once a retake completes,
              the result video replaces this preview. */}
          {status !== "running" && status !== "failed" && !activeUrl && upstreamVideoUrl && (
            <div className="space-y-2 p-2">
              <video
                src={upstreamVideoUrl}
                controls
                crossOrigin="anonymous"
                className="w-full rounded"
                onLoadedMetadata={handleSourceLoadedMetadata}
              />
              <RetakeRangeSlider
                videoDuration={nodeData.videoDurationSec ?? 0}
                startTime={nodeData.retakeStartTime ?? 0}
                duration={nodeData.retakeDuration ?? 2}
                onChange={({ startTime, duration }) =>
                  updateNodeData(id, { retakeStartTime: startTime, retakeDuration: duration })
                }
              />
            </div>
          )}

          {/* Result video */}
          {status !== "running" && activeUrl && (
            <>
              {/* Top-left: counter chip when ≥2 results */}
              {results.length > 1 && (
                <button
                  type="button"
                  className="absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md opacity-0 group-hover/video:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowThumbnails((v) => !v)
                  }}
                  aria-pressed={showThumbnails}
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
                  if (v.videoWidth > 0) {
                    handleLoadDimensions({ width: v.videoWidth, height: v.videoHeight })
                  }
                  if (shouldPlay) v.play().catch(() => {})
                }}
              />
              {/* Top-right: extract-frame + delete this result */}
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <button
                  type="button"
                  aria-label="Extract frame"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    // Spawn an extract-frame node to the right and wire
                    // this retake's video output into it. Mirrors the
                    // canonical "extract references" affordance from
                    // Generate Image but for video — the per-media-type
                    // equivalent called out in the playbook.
                    const store = useWorkflowStore.getState()
                    const self = store.nodes.find((n) => n.id === id)
                    if (!self) return
                    const pos = {
                      x: (self.position.x ?? 0) + 360,
                      y: self.position.y ?? 0,
                    }
                    const newId = store.addNode("extract-frame", pos)
                    if (newId) {
                      store.onConnect({
                        source: id,
                        sourceHandle: "video",
                        target: newId,
                        targetHandle: "in",
                      })
                    }
                  }}
                  title="Extract frame"
                >
                  <Frame className="w-3.5 h-3.5" />
                </button>
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
              {/* Bottom-left: fullscreen + download + copy URL */}
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
                    a.download = `${(nodeData.label as string) || "retake"}.mp4`
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

          {/* Failed (content policy) state — amber ShieldAlert */}
          {status === "failed" && !activeUrl && isContentPolicyFail && (
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl p-2 h-[180px] bg-amber-500/5 text-amber-500">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span className="font-medium">Prohibited</span>
              </div>
              {errorMessage ? (
                <p
                  className="text-[10px] text-center line-clamp-2 text-amber-400"
                  title={errorMessage}
                >
                  {errorMessage}
                </p>
              ) : null}
            </div>
          )}

          {/* Failed (other) state — red AlertCircle */}
          {status === "failed" && !activeUrl && !isContentPolicyFail && (
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl p-2 h-[180px] bg-red-500/5 text-red-500">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">Failed</span>
              </div>
              {errorMessage ? (
                <p
                  className="text-[10px] text-center line-clamp-2 text-red-400"
                  title={errorMessage}
                >
                  {errorMessage}
                </p>
              ) : null}
            </div>
          )}

          {/* Empty state — no result, no upstream video */}
          {status !== "running" && !activeUrl && status !== "failed" && !upstreamVideoUrl && (
            <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
              <Scissors className="w-10 h-10" />
            </div>
          )}
        </div>
      </BaseNode>

      {/* Typed input + output pips. Canonical color/icon convention:
            video   → violet (#8B5CF6, video producer)
            prompt  → brand pink (#ff0073, text producers + pickers)
            look    → indigo (#818CF8, Look picker family) */}
      <HandleWithPopover
        nodeId={id}
        nodeType="video-retake"
        handleId="video"
        type="target"
        position={Position.Left}
        label="Video"
        color="#8B5CF6"
        icon={<Video />}
        side="left"
        top={HANDLE_TOP.video}
        accepts={ACCEPTS_VIDEO}
        disabled={disabledHandles.has("video")}
      />
      <HandleWithPopover
        nodeId={id}
        nodeType="video-retake"
        handleId="prompt"
        type="target"
        position={Position.Left}
        label="Prompt"
        color="#ff0073"
        icon={<Type />}
        side="left"
        top={HANDLE_TOP.prompt}
        accepts={ACCEPTS_PROMPT}
        disabled={disabledHandles.has("prompt")}
      />
      <HandleWithPopover
        nodeId={id}
        nodeType="video-retake"
        handleId="look"
        type="target"
        position={Position.Left}
        label="Look"
        color="#818CF8"
        icon={<Aperture />}
        side="left"
        top={HANDLE_TOP.look}
        accepts={ACCEPTS_LOOK}
        disabled={disabledHandles.has("look")}
      />
      {/* Output pip — video result. Shares the input video color so the
          wire endpoint reads as "video" at both ends. */}
      <HandleWithPopover
        nodeId={id}
        nodeType="video-retake"
        handleId="video"
        type="source"
        position={Position.Right}
        label="Video"
        color="#8B5CF6"
        icon={<Video />}
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

export const VideoRetakeNode = memo(VideoRetakeNodeComponent)
