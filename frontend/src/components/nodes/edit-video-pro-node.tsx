"use client"

import { memo, useState, useMemo, useEffect } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { useShallow } from "zustand/react/shallow"
import { Scissors, Loader2, AlertCircle, Type, Images, Video } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { EditableNodeLabel } from "./editable-node-label"
import { NodeJobProgress } from "./node-job-progress"
import { VideoResultOverlay } from "./video-result-overlay"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { isValidEditVideoProConnection } from "@/lib/edit-video-pro-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { EditVideoProNodeData, GeneratedResult, WorkflowNode } from "@/types/nodes"

// Stable, module-level `accepts` predicates — see generate-image-node.tsx /
// generate-video-node.tsx for why these live outside the component (avoids a
// fresh arrow ref on every render busting HandleWithPopover's useMemo).
const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_VIDEO      = (t: string) => isValidEditVideoProConnection("video",           t, isPickerType)
const ACCEPTS_PROMPT     = (t: string) => isValidEditVideoProConnection("prompt",          t, isPickerType)
const ACCEPTS_IMAGE_REFS = (t: string) => isValidEditVideoProConnection("imageReferences", t, isPickerType)

// Coarse popup-time credit ESTIMATE only, matching NODE_DEFINITIONS' documented
// default scenario (provider seedance-2, spanStart 0, spanEnd 8 — an 8s
// single-segment replace at 720p with a probed tail ref; see nodes.ts and
// ee/billing/edit-video-pro-credits.ts). UNLIKE generate-video-pro's badge —
// one buildVideoCreditModelIdentifier() lookup that IS the accurate
// default-case answer — edit-video-pro's real cost is a multi-term formula
// (fee + per-second ref-rate × (span + head/tail-loss + ref adjustments))
// with no single cache key to resolve it live client-side; the ONLY key that
// exists today ("edit-video-pro", the flat fee-base) resolves to just 10,
// which would understate the true charge by roughly an order of magnitude —
// worse than a clearly-labeled coarse constant. Task 14's
// estimateEditVideoProCredits(data) replaces this with the real per-render
// dynamic estimate; the true charge is always computed server-side at
// probe-at-reserve time regardless.
const EDIT_VIDEO_PRO_CREDIT_FALLBACK = 67

// Bottom-anchored 3-pip stack, 28px apart (mirrors generate-video-pro-node's
// spacing convention). `video` sits closest to the bottom — it's the
// required primary input (mirrors video-retake's own primary-first
// convention, where the single source-clip handle also anchors at 24px).
const HANDLE_TOP = {
  video: "calc(100% - 24px)",
  prompt: "calc(100% - 52px)",
  imageReferences: "calc(100% - 80px)",
} as const

function EditVideoProNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as EditVideoProNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)

  const status = (nodeData.executionStatus as string | undefined) ?? "idle"
  const results = (nodeData.generatedResults as GeneratedResult[] | undefined) ?? []
  const activeIndex = (nodeData.activeResultIndex as number | undefined) ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? (nodeData.generatedVideoUrl as string | undefined)
  const credits = EDIT_VIDEO_PRO_CREDIT_FALLBACK

  // Reset the video-error gate whenever the active result changes (mirrors
  // generate-video-pro-node.tsx / voice-changer-pro-node.tsx) so a stale
  // error doesn't hide a fresh result.
  useEffect(() => {
    setVideoError(false)
  }, [activeUrl])

  // Narrow subscription: a primitive fingerprint of the `video`-handle
  // source (id + full data) instead of whole-array `s.nodes` / `s.edges`.
  // Mirrors video-retake-node.tsx exactly — the only consumers are
  // upstreamVideoNode / upstreamVideoUrl below, which read the connected
  // source's data (changes during polling), so serialize that one source's
  // data wholesale to guarantee no missed field.
  const videoSourceFingerprint = useWorkflowStore(
    useShallow((s) => {
      const videoEdge = s.edges.find((e) => e.target === id && e.targetHandle === "video")
      if (!videoEdge) return ""
      const src = s.nodes.find((n) => n.id === videoEdge.source)
      if (!src) return `${videoEdge.id}\x01${videoEdge.source}`
      return `${videoEdge.id}\x01${src.id}\x01${src.type ?? ""}\x01${JSON.stringify(src.data ?? {})}`
    }),
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const upstreamVideoNode = useMemo(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    const videoEdge = edges.find((e) => e.target === id && e.targetHandle === "video")
    if (!videoEdge) return undefined
    return nodes.find((n) => n.id === videoEdge.source)
  }, [id, videoSourceFingerprint])

  const upstreamVideoUrl = useMemo(() => {
    if (!upstreamVideoNode) return undefined
    return extractNodeOutput(upstreamVideoNode as WorkflowNode)
  }, [upstreamVideoNode])

  // Clamp-on-source-change: the connected source video can change (a new
  // upstream upload/generation) out from under a previously-chosen span.
  // Re-validate spanStart/spanEnd against the freshly-probed duration
  // whenever it changes. Entirely-invalid spans (the chosen start is at or
  // past the new duration) are reset outright rather than mathematically
  // salvaged — silently sliding the user's start point far backward would
  // be more surprising than a clean reset to the default view.
  useEffect(() => {
    const D = nodeData.sourceDurationSec
    if (D === undefined) return
    const spanStart = nodeData.spanStart ?? 0
    const spanEnd = nodeData.spanEnd ?? spanStart + 8
    if (spanStart >= D) {
      updateNodeData(id, { spanStart: 0, spanEnd: Math.min(D, 8) })
      return
    }
    if (spanEnd > D + 0.05) {
      const newEnd = Math.min(spanEnd, D)
      const newStart = Math.min(spanStart, Math.max(0, newEnd - 4))
      updateNodeData(id, { spanEnd: newEnd, spanStart: newStart })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData.sourceDurationSec])

  // Result-aspect-ratio for the BaseNode minHeight calc + video-element sizing.
  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)

  // Video result fills the node transparently (no card chrome) once a
  // playable result exists — same convention as every other video node.
  const hasVideoResult = status !== "running" && !!activeUrl && !videoError

  // BaseNode handles array. `external: true` so BaseNode counts the handle
  // toward node sizing but does NOT render a duplicate <Handle> — the
  // HandleWithPopover instances below own DOM rendering.
  const handles = useMemo(
    () => [
      { id: "video",           type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.video,           left: "-29px" }, external: true },
      { id: "prompt",          type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.prompt,          left: "-29px" }, external: true },
      { id: "imageReferences", type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.imageReferences, left: "-29px" }, external: true },
      { id: "video",           type: "source" as const, position: Position.Right, customStyle: { top: "24px",                     right: "-29px" }, external: true },
    ],
    [],
  )

  // Re-register handles with React Flow on mount — edges to new handles
  // render unreliably otherwise (mirrors every other typed-handle node).
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, updateNodeInternals])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={(nodeData.label as string) ?? "Edit Video Pro"}
        icon={<Scissors className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={(nodeData.label as string) ?? "Edit Video Pro"}
        icon={<Scissors className="h-4 w-4" />}
        category="i2v"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        className={hasVideoResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        hideHeader
        // Shared video-node sizing: 16:9 @ VIDEO_NODE_MIN_HEIGHT (≈654×368) when
        // idle, snaps to the real result aspect once a result loads.
        {...videoNodeSizing(mediaAspectRatio)}
        handles={handles}
        // Standard quick strip (never rawToolbarContent) — never gated behind
        // !isRunning so Stop/Discard stays visible mid-run.
        topToolbarContent={
          <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />
        }
      >
        {hasVideoResult ? null : (
          <div className="relative w-full h-full group/video">
            {status === "running" && (
              <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[80px]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress as number | undefined} />
              </div>
            )}
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
            {/* Source-video preview — shows the connected upstream clip while
                the user picks a replace span (config panel's SpanRangeSlider)
                and stamps sourceDurationSec via loadedmetadata (mirrors
                video-retake-node.tsx's source-preview + duration probe). */}
            {status !== "running" && status !== "failed" && !activeUrl && upstreamVideoUrl && (
              <video
                src={upstreamVideoUrl}
                controls
                crossOrigin="anonymous"
                className="w-full h-full object-cover rounded-xl"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration
                  if (Number.isFinite(d) && d > 0 && d !== nodeData.sourceDurationSec) updateNodeData(id, { sourceDurationSec: d })
                }}
              />
            )}
            {status !== "running" && !activeUrl && status !== "failed" && !upstreamVideoUrl && (
              <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
                <Scissors className="w-10 h-10" />
              </div>
            )}
          </div>
        )}
      </BaseNode>

      {/* Video result: rich player overlay filling the transparent node —
          same shared component the other video-result nodes use (expand /
          download / copy / save / settings / edit-in-FreeCut). */}
      {hasVideoResult && (
        <VideoResultOverlay
          url={activeUrl!}
          videoAutoplay={videoAutoplay}
          label={(nodeData.label as string) ?? "Edit Video Pro"}
          hasResults={results.length > 0}
          onExpand={() => setPreviewOpen(true)}
          onDelete={() => setDeleteConfirm(activeIndex)}
          onEdit={() => openFreeCut(id, activeUrl!, activeResult?.freecutProjectUrl)}
          onRawDimensions={handleLoadDimensions}
          onVideoError={() => setVideoError(true)}
          onVideoLoad={() => setVideoError(false)}
          onSettings={() => selectNode(isSettingsOpen ? null : id)}
          isSettingsOpen={isSettingsOpen}
        />
      )}

      {/* 3 typed input pips + 1 output pip. `video` shares its color at both
          ends (violet) so the wire endpoint reads as "video" regardless of
          direction — mirrors video-retake's convention. */}
      <HandleWithPopover nodeId={id} nodeType="edit-video-pro" handleId="video"           type="target" position={Position.Left}  label="Video"       color={HANDLE_COLORS.video}    icon={<Video />}     side="left"  top={HANDLE_TOP.video}           accepts={ACCEPTS_VIDEO} />
      <HandleWithPopover nodeId={id} nodeType="edit-video-pro" handleId="prompt"          type="target" position={Position.Left}  label="Prompt"      color={TEXT_HANDLE_COLOR}      icon={<Type />}      side="left"  top={HANDLE_TOP.prompt}          accepts={ACCEPTS_PROMPT} />
      <HandleWithPopover nodeId={id} nodeType="edit-video-pro" handleId="imageReferences" type="target" position={Position.Left}  label="Image Refs"  color={HANDLE_COLORS.imageRef} icon={<Images />}    side="left"  top={HANDLE_TOP.imageReferences} orderMatters accepts={ACCEPTS_IMAGE_REFS} />
      <HandleWithPopover nodeId={id} nodeType="edit-video-pro" handleId="video"           type="source" position={Position.Right} label="Video"       color={HANDLE_COLORS.video}    icon={<Video />}     side="right" top="24px" />

      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="video"
          url={activeUrl}
          results={results}
          initialIndex={activeIndex}
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

export const EditVideoProNode = memo(EditVideoProNodeComponent)
