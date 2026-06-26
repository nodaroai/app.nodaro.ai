"use client"

import { memo, useState, useEffect, useRef, useCallback } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Wand2, Film, Image as ImageIcon, Layers, Clapperboard, Type, Loader2, AlertCircle, X, Download, LayoutGrid, Expand, Link, Settings, Scissors } from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { isValidSwitchXConnection } from "@/lib/video-producer-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { EditableNodeLabel } from "./editable-node-label"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import { SwitchXAttribution } from "@/components/switchx-attribution"
import { isInputWarningCode } from "@/lib/input-warning-codes"
import type { SwitchXData } from "@/types/nodes"

const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_VIDEO      = (t: string) => isValidSwitchXConnection("video", t, isPickerType)
const ACCEPTS_IMAGE      = (t: string) => isValidSwitchXConnection("image", t, isPickerType)
const ACCEPTS_MASK       = (t: string) => isValidSwitchXConnection("mask", t, isPickerType)
const ACCEPTS_MASK_VIDEO = (t: string) => isValidSwitchXConnection("mask-video", t, isPickerType)
const ACCEPTS_PROMPT     = (t: string) => isValidSwitchXConnection("prompt", t, isPickerType)

function SwitchXNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SwitchXData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playState = nodeData.videoPlayState ?? "loop"
  const shouldPlay = videoAutoplay && playState === "loop"
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const status = nodeData.executionStatus ?? "idle"
  // A "too long / too large" failure is a user-fixable WARNING (orange), not a
  // red system error — the run poller tags it via errorCode.
  const isInputWarning = isInputWarningCode((nodeData as Record<string, unknown>).errorCode)
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const activeThumbnail = activeResult?.thumbnailUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  // Cost = frame-block tier × resolution, but the editor can't know the source's
  // frame count until the job runs (the server ffprobes + reserves the real,
  // ≤240-frame tier). Show the WORST-CASE (240-frame) tier for the chosen
  // resolution: a SAFE UPPER bound the charge can never exceed, exact for ~8s
  // clips. MUST match getModelIdentifier("switchx") so the run-button pill, the
  // run-confirm gate (>100cr) and the precheck all show ONE consistent number.
  const estRes = nodeData.maxResolution === 720 ? 720 : 1080
  const credits = useModelCredits(`beeble-switchx:240f:${estRes}p`, estRes === 720 ? 40 : 120)
  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)

  // Conditional mask handles depend on alphaMode — React Flow v12 needs an
  // explicit remeasure when the handle set changes (modify-image pattern).
  const mode = nodeData.alphaMode ?? "auto"
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => { updateNodeInternals(id) }, [id, mode, updateNodeInternals])

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
  const isNodeRunning = nodeData.executionStatus === "running"
  const listProgressPercent = (listTotal && listTotal > 0 && listCompleted !== undefined)
    ? Math.round((listCompleted / listTotal) * 100)
    : undefined

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Wand2 className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Wand2 className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      {...videoNodeSizing(mediaAspectRatio)}
      listCount={listTotal}
      listProgress={isNodeRunning && listTotal ? `${listCompleted ?? 0}/${listTotal}` : undefined}
      listProgressPercent={isNodeRunning ? listProgressPercent : undefined}
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
        // Inputs bottom-anchored. Prompt sits at the very bottom; the conditional
        // mask handle is at the TOP so auto/fill mode leaves no mid-stack gap.
        { id: "prompt", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
        { id: "video", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 56px)', left: '-29px' }, external: true },
        { id: "image", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 88px)', left: '-29px' }, external: true },
        ...(mode === "select" ? [{ id: "mask", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 120px)', left: '-29px' }, external: true }] : []),
        ...(mode === "custom" ? [{ id: "mask-video", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 120px)', left: '-29px' }, external: true }] : []),
        { id: "video", type: "source", position: Position.Right, customStyle: { top: '24px', right: '-29px' }, external: true },
      ]}
    >
      <div className="relative w-full h-full group/video">
        {activeUrl && status !== "running" && (
          <video
            ref={videoRef}
            src={activeUrl}
            crossOrigin="anonymous"
            poster={activeThumbnail || undefined}
            className="w-full h-full object-cover rounded-xl cursor-pointer"
            onClick={() => selectNode(id)}
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
        )}

        {/* Required brand attribution (Beeble) — always visible on the result.
            developer.beeble.ai/docs/brand-attribution. */}
        {activeUrl && status !== "running" && (
          <div className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2">
            <SwitchXAttribution />
          </div>
        )}

        {!activeUrl && status !== "running" && status !== "failed" && (
          <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
            <Wand2 className="w-10 h-10" />
          </div>
        )}

        {status === "running" && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/10 h-[180px]">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          </div>
        )}

        {status === "failed" && !activeUrl && (
          <div className={`flex flex-col items-center justify-center gap-2 rounded-xl h-[180px] ${isInputWarning ? "bg-orange-500/5 text-orange-500" : "bg-red-500/5 text-red-500"}`}>
            <AlertCircle className="w-6 h-6" />
            {nodeData.errorMessage && (
              <p className={`text-[10px] text-center px-2 line-clamp-2 ${isInputWarning ? "text-orange-400" : "text-red-400"}`}>{nodeData.errorMessage}</p>
            )}
          </div>
        )}

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
              onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`; a.download = `${nodeData.label || 'switchx'}.mp4`; a.click() }}
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
    </BaseNode>
    <HandleWithPopover nodeId={id} nodeType="switchx" handleId="prompt" type="target" position={Position.Left}  label="Prompt"       color={TEXT_HANDLE_COLOR}  icon={<Type />}     side="left"  top="calc(100% - 24px)"  accepts={ACCEPTS_PROMPT} />
    <HandleWithPopover nodeId={id} nodeType="switchx" handleId="video"  type="target" position={Position.Left}  label="Source video" color={HANDLE_COLORS.video} icon={<Film />}      side="left"  top="calc(100% - 56px)"  accepts={ACCEPTS_VIDEO} />
    <HandleWithPopover nodeId={id} nodeType="switchx" handleId="image"  type="target" position={Position.Left}  label="Reference"    color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left"  top="calc(100% - 88px)"  accepts={ACCEPTS_IMAGE} />
    {mode === "select" && (
      <HandleWithPopover nodeId={id} nodeType="switchx" handleId="mask"       type="target" position={Position.Left} label="Mask"       color={HANDLE_COLORS.mask}  icon={<Layers />}      side="left" top="calc(100% - 120px)" accepts={ACCEPTS_MASK} />
    )}
    {mode === "custom" && (
      <HandleWithPopover nodeId={id} nodeType="switchx" handleId="mask-video" type="target" position={Position.Left} label="Mask video" color={HANDLE_COLORS.mask}  icon={<Clapperboard />} side="left" top="calc(100% - 120px)" accepts={ACCEPTS_MASK_VIDEO} />
    )}
    <HandleWithPopover nodeId={id} nodeType="switchx" handleId="video"  type="source" position={Position.Right} label="Video"        color={HANDLE_COLORS.video} icon={<Film />}     side="right" top="24px" />

    <DeleteConfirmationDialog
      isOpen={deleteConfirm !== null}
      onClose={() => setDeleteConfirm(null)}
      onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }}
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

export const SwitchXNode = memo(SwitchXNodeComponent)
