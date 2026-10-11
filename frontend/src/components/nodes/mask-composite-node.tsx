"use client"

import { useT } from "@/lib/i18n"
import { memo, useState, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Blend, Loader2, AlertCircle, Film, Clapperboard } from "lucide-react"
import { resolveMaskCompositeSettings } from "@nodaro/shared"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { VideoResultOverlay } from "./video-result-overlay"
import { videoNodeSizing } from "./video-node-defaults"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { isValidMaskCompositeConnection } from "@/lib/video-producer-handles"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { MaskCompositeData } from "@/types/nodes"

// Module-level `accepts` predicates (stable refs for HandleWithPopover's memo).
const ACCEPTS_FOREGROUND = (t: string) => isValidMaskCompositeConnection("video", t)
const ACCEPTS_BACKGROUND = (t: string) => isValidMaskCompositeConnection("background-video", t)
const ACCEPTS_MASK = (t: string) => isValidMaskCompositeConnection("mask-video", t)

// Inputs anchored from the bottom, read top-down as Foreground / Background / Mask.
const HANDLE_TOP = {
  mask: "calc(100% - 24px)",
  "background-video": "calc(100% - 56px)",
  foreground: "calc(100% - 88px)",
} as const

function MaskCompositeNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as MaskCompositeData
  // The id its route reserves (a flat row — local ffmpeg).
  const credits = useModelCredits("mask-composite", 20)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)

  useEffect(() => {
    setVideoError(false)
  }, [activeUrl])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  const settings = resolveMaskCompositeSettings(nodeData)
  const hasResult = status !== "running" && !!activeUrl && !videoError

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel label={nodeData.label} icon={<Blend className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode id={id} label={nodeData.label} icon={<Blend className="h-4 w-4" />} category="processing" credits={credits} selected={selected} isRunning={status === "running"}
        hideHeader
        {...videoNodeSizing(mediaAspectRatio)}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        topToolbarContent={<NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />}
        handles={[
          { id: "mask-video", type: "target", position: Position.Left,  customStyle: { top: HANDLE_TOP.mask,       left: "-29px" }, external: true },
          { id: "background-video", type: "target", position: Position.Left,  customStyle: { top: HANDLE_TOP["background-video"], left: "-29px" }, external: true },
          { id: "video",      type: "target", position: Position.Left,  customStyle: { top: HANDLE_TOP.foreground, left: "-29px" }, external: true },
          { id: "video",      type: "source", position: Position.Right, customStyle: { top: "24px",                right: "-29px" }, external: true },
        ]}
      >
        {hasResult ? null : (
          <div className="flex flex-col gap-1 h-full">
            {status === "running" && (
              <div className="flex flex-col items-center justify-center gap-2 h-28 rounded-md bg-muted/30">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress} />
              </div>
            )}
            {status !== "running" && activeUrl && videoError && (
              <div className="w-full h-28 rounded-md bg-amber-500/10 border border-amber-500/30 flex flex-col items-center justify-center gap-1">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <span className="text-[10px] text-amber-500">{t("node.videoLoadFailed")}</span>
                <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 underline" onClick={(e) => e.stopPropagation()}>{t("node.openUrl")}</a>
              </div>
            )}
            {status === "failed" && !activeUrl && (
              <div className="flex flex-col items-center justify-center gap-1 h-16 rounded-md bg-red-500/5 text-red-500 p-2">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{t("node.failed")}</span>
                </div>
                {nodeData.errorMessage && (
                  <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>
                    {nodeData.errorMessage}
                  </p>
                )}
              </div>
            )}
            {status !== "running" && !activeUrl && status !== "failed" && (
              <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px]">
                <Blend className="w-10 h-10" />
                <span className="text-[10px] text-muted-foreground/60 px-2 text-center">{t("node.maskCompositeIdleHint")}</span>
                {settings.invertMask && (
                  <span className="text-[10px] text-muted-foreground/60">{t("node.maskCompositeInverted")}</span>
                )}
              </div>
            )}
          </div>
        )}
      </BaseNode>
      {hasResult && (
        <VideoResultOverlay
          url={activeUrl}
          onEdit={() => openFreeCut(id, activeUrl!, activeResult?.freecutProjectUrl)}
          videoAutoplay={videoAutoplay}
          label={nodeData.label}
          hasResults={results.length > 0}
          onExpand={() => setPreviewOpen(true)}
          onDelete={() => setDeleteConfirm(activeIndex)}
          onRawDimensions={handleLoadDimensions}
          onVideoError={() => setVideoError(true)}
          onVideoLoad={() => setVideoError(false)}
        />
      )}
      <HandleWithPopover nodeId={id} nodeType="mask-composite" handleId="video"      type="target" position={Position.Left}  label="Foreground" color={HANDLE_COLORS.video} icon={<Film />}         side="left"  top={HANDLE_TOP.foreground} accepts={ACCEPTS_FOREGROUND} />
      <HandleWithPopover nodeId={id} nodeType="mask-composite" handleId="background-video" type="target" position={Position.Left}  label="Background" color={HANDLE_COLORS.video} icon={<Film />}         side="left"  top={HANDLE_TOP["background-video"]} accepts={ACCEPTS_BACKGROUND} />
      <HandleWithPopover nodeId={id} nodeType="mask-composite" handleId="mask-video" type="target" position={Position.Left}  label="Mask"       color={HANDLE_COLORS.mask}  icon={<Clapperboard />} side="left"  top={HANDLE_TOP.mask}       accepts={ACCEPTS_MASK} />
      <HandleWithPopover nodeId={id} nodeType="mask-composite" handleId="video"      type="source" position={Position.Right} label="Video"      color={HANDLE_COLORS.video} icon={<Film />}         side="right" top="24px" />
      {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} results={results} initialIndex={activeIndex} />}
      <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const MaskCompositeNode = memo(MaskCompositeNodeComponent)
