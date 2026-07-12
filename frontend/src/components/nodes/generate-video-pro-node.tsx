"use client"

import { memo, useState, useMemo, useEffect } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Clapperboard, Loader2, AlertCircle, Type, Image as ImageIcon, Images, Film } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { EditableNodeLabel } from "./editable-node-label"
import { NodeJobProgress } from "./node-job-progress"
import { VideoResultOverlay } from "./video-result-overlay"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { isValidGenerateVideoProConnection } from "@/lib/generate-video-pro-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { GenerateVideoProNodeData, GeneratedResult } from "@/types/nodes"

// Stable, module-level `accepts` predicates — see generate-image-node.tsx /
// generate-video-node.tsx for why these live outside the component (avoids a
// fresh arrow ref on every render busting HandleWithPopover's useMemo).
const isPickerType = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_PROMPT      = (t: string) => isValidGenerateVideoProConnection("prompt", t, isPickerType)
const ACCEPTS_START_FRAME = (t: string) => isValidGenerateVideoProConnection("startFrame", t, isPickerType)
const ACCEPTS_IMAGE_REFS  = (t: string) => isValidGenerateVideoProConnection("imageReferences", t, isPickerType)

// Trimmed 3-pip stack (vs. generate-video's 11) — bottom-anchored, 28px apart,
// mirroring the offset convention used across the video-node family.
const HANDLE_TOP = {
  prompt: "calc(100% - 24px)",
  startFrame: "calc(100% - 52px)",
  imageReferences: "calc(100% - 80px)",
} as const

function GenerateVideoProNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateVideoProNodeData
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
  const provider = nodeData.provider ?? "seedance-2"

  // Reset the video-error gate whenever the active result changes (mirrors
  // voice-changer-pro-node.tsx) so a stale error doesn't hide a fresh result.
  useEffect(() => {
    setVideoError(false)
  }, [activeUrl])

  // Coarse popup-time credit ESTIMATE only — matches the `text-to-video`,
  // no-video-ref call shape `computeGenerateVideoProPricing`'s single-segment
  // path uses server-side (ee/billing/generate-video-pro-credits.ts). Seedance
  // 2 pricing has exactly one seeded duration tier (8s), so any `duration`
  // value collapses to the same composite — the badge is deliberately an
  // approximation; the real (possibly multi-segment) charge is always
  // computed server-side at run time.
  const creditIdentifier = buildVideoCreditModelIdentifier(
    provider,
    nodeData.duration,
    false,
    "text-to-video",
    undefined,
    nodeData.resolution,
    false,
  )
  const credits = useModelCredits(creditIdentifier, 82)

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
      { id: "prompt",          type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.prompt,          left: "-29px" }, external: true },
      { id: "startFrame",      type: "target" as const, position: Position.Left,  customStyle: { top: HANDLE_TOP.startFrame,      left: "-29px" }, external: true },
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
        label={(nodeData.label as string) ?? "Generate Video Pro"}
        icon={<Clapperboard className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={(nodeData.label as string) ?? "Generate Video Pro"}
        icon={<Clapperboard className="h-4 w-4" />}
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
            {status !== "running" && !activeUrl && status !== "failed" && (
              <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
                <Clapperboard className="w-10 h-10" />
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
          label={(nodeData.label as string) ?? "Generate Video Pro"}
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

      {/* 3 typed input pips + 1 output pip. Colors mirror generate-video's
          category-color scheme: prompt → brand pink (text), startFrame →
          cyan (image), imageReferences → emerald (image-ref), video → purple. */}
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="prompt"          type="target" position={Position.Left}  label="Prompt"      color={TEXT_HANDLE_COLOR}      icon={<Type />}      side="left"  top={HANDLE_TOP.prompt}          accepts={ACCEPTS_PROMPT} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="startFrame"      type="target" position={Position.Left}  label="Start Frame" color={HANDLE_COLORS.image}    icon={<ImageIcon />} side="left"  top={HANDLE_TOP.startFrame}      accepts={ACCEPTS_START_FRAME} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="imageReferences" type="target" position={Position.Left}  label="Image Refs"  color={HANDLE_COLORS.imageRef} icon={<Images />}    side="left"  top={HANDLE_TOP.imageReferences} orderMatters accepts={ACCEPTS_IMAGE_REFS} />
      <HandleWithPopover nodeId={id} nodeType="generate-video-pro" handleId="video"           type="source" position={Position.Right} label="Video"       color={HANDLE_COLORS.video}    icon={<Film />}      side="right" top="24px" />

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

export const GenerateVideoProNode = memo(GenerateVideoProNodeComponent)
