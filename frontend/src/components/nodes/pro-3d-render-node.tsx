"use client"

import { useT } from "@/lib/i18n"
import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Boxes, Images, Loader2, AlertCircle, Film, X, RotateCcw } from "lucide-react"
import { PRO3D_RENDER_CREDIT_ID } from "@nodaro/shared"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { NodeJobProgress } from "./node-job-progress"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { VideoResultOverlay } from "./video-result-overlay"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { computeDeleteResultUpdates } from "@/lib/utils"
import { planObjects, planRevisionId } from "@/lib/scene3d/plan-view"
import { isValidScene3DConnection } from "@/lib/scene3d-handles"
import type { Pro3DRenderData } from "@/types/nodes"

const ACCEPTS_REFERENCE = (t: string) => isValidScene3DConnection("references", t)
const ACCEPTS_SCENE = (t: string) => isValidScene3DConnection("scene", t)

/**
 * 3D Render Pro — one operation, two outputs.
 *
 * The card is a VIDEO card (it sizes through the shared media helper like every
 * other video node, and the finished MP4 fills it), with the composition
 * reported alongside rather than in a second node: the run produces both, and a
 * user who has to look in two places to see what one run made will assume one
 * of them failed.
 */
function Pro3DRenderNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as Pro3DRenderData
  // The LIVE configured price. 0 = not resolved (or an install that has not
  // configured one) → no badge, rather than a fabricated flat number.
  const credits = useModelCredits(PRO3D_RENDER_CREDIT_ID, 0)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)

  const status = nodeData.executionStatus ?? "idle"
  const isRunning = status === "running"
  const scenePlan = nodeData.scenePlan as Record<string, unknown> | undefined
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const { aspectRatio: mediaAspectRatio, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)

  const hasResult = !isRunning && !!activeUrl && !videoError
  // What this node will DO on Run, said plainly: an existing scene with no
  // edit instruction is an export, and that is a different price from
  // authoring one. The card must not look identical in the two cases.
  const isSceneSource = nodeData.sourceMode === "scene"
  const summary = isSceneSource
    ? nodeData.editPrompt?.trim()
      ? nodeData.editPrompt
      : t("pro3d.renderOnly")
    : nodeData.scenePrompt?.trim() || t("pro3d.noPrompt")
  const objectCount = scenePlan ? planObjects(scenePlan).length : 0
  const revision = planRevisionId(scenePlan)

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Boxes className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Boxes className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={isRunning}
        hideHeader
        {...videoNodeSizing(mediaAspectRatio)}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        topToolbarContent={<NodeQuickStrip nodeId={id} credits={credits} isRunning={isRunning} />}
        handles={[
          { id: "scene",       type: "target", position: Position.Left,  customStyle: { top: "24px", left: "-29px" }, external: true },
          { id: "references",  type: "target", position: Position.Left,  customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "composition", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
          { id: "video",       type: "source", position: Position.Right, customStyle: { top: "calc(100% - 24px)", right: "-29px" }, external: true },
        ]}
      >
        {hasResult ? null : (
          <div className="h-full flex flex-col gap-1.5">
            {isRunning && (
              <div className="flex-1 min-h-24 flex flex-col items-center justify-center gap-2 rounded-md bg-muted/30">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress} />
                <span className="text-[10px] text-muted-foreground">{t("node.buildingAndRendering")}</span>
              </div>
            )}

            {/* A finished composition with no playable video yet still says what
                exists — the scene is the durable half of the result. */}
            {!isRunning && scenePlan && !activeUrl && (
              <div className="flex-1 min-h-24 flex flex-col items-center justify-center rounded-md bg-[#ff0073]/5 border border-[#ff0073]/20">
                <div className="text-sm font-medium text-[#ff0073]">{objectCount} objects</div>
                <div className="text-[10px] text-muted-foreground">
                  {revision ? `rev ${revision.slice(0, 6)}` : "scene ready"}
                </div>
              </div>
            )}

            {!isRunning && activeUrl && videoError && (
              <div className="flex-1 min-h-24 rounded-md bg-amber-500/10 border border-amber-500/30 flex flex-col items-center justify-center gap-1">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <span className="text-[10px] text-amber-500">{t("node.videoLoadFailed")}</span>
                <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 underline" onClick={(e) => e.stopPropagation()}>
                  {t("node.openUrl")}
                </a>
              </div>
            )}

            {status === "failed" && !activeUrl && (
              <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                <div className="flex-1 min-h-24 flex flex-col items-center justify-center gap-1.5 rounded-md bg-red-500/5 p-2 text-center">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  <span className="text-[11px] text-red-400 font-medium">{t("node.failed")}</span>
                  {nodeData.errorMessage && (
                    <p className="text-[9px] font-mono text-muted-foreground line-clamp-2" title={nodeData.errorMessage}>
                      {nodeData.errorMessage}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="nodrag w-full h-8 rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 transition-colors flex items-center justify-center gap-1.5"
                  onClick={(e) => { e.stopPropagation(); runSingleNode?.(id) }}
                >
                  <RotateCcw className="w-3 h-3" /> {t("editor.retry")}
                </button>
              </div>
            )}

            {!isRunning && !scenePlan && !activeUrl && status !== "failed" && (
              <div className="flex-1 min-h-24 flex items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                <Boxes className="w-5 h-5" />
              </div>
            )}

            {results.length > 1 && (
              <div className="flex gap-1 overflow-x-auto">
                {results.slice(0, 5).map((r, i) => (
                  <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                    <video
                      src={r.url}
                      crossOrigin="anonymous"
                      muted
                      playsInline
                      className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`}
                      onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url }) }}
                    />
                    <button
                      type="button"
                      aria-label={t("node.removeResult")}
                      className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(i) }}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-muted-foreground text-[10px] line-clamp-1">
              {summary}
            </p>
            {/* The quoted CEILING, not a charge. Shown where the canvas already
                shows what a run costs, so the user sees the most this run may
                spend before committing to it. */}
            {typeof nodeData.lastQuoteMaxCredits === "number" && (
              <p className="text-muted-foreground text-[10px]">
                {t("pro3d.ceiling", { credits: String(nodeData.lastQuoteMaxCredits) })}
              </p>
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
          onRawDimensions={onLoadDimensions}
          onVideoError={() => setVideoError(true)}
          onVideoLoad={() => setVideoError(false)}
        />
      )}
      <HandleWithPopover nodeId={id} nodeType="pro-3d-render" handleId="scene"       type="target" position={Position.Left}  label="Scene"       color={HANDLE_COLORS.control}   icon={<Boxes />}  side="left"  top="24px" accepts={ACCEPTS_SCENE} />
      <HandleWithPopover nodeId={id} nodeType="pro-3d-render" handleId="references"  type="target" position={Position.Left}  label="References"  color={HANDLE_COLORS.reference} icon={<Images />} side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_REFERENCE} />
      <HandleWithPopover nodeId={id} nodeType="pro-3d-render" handleId="composition" type="source" position={Position.Right} label="Composition" color={HANDLE_COLORS.control}   icon={<Boxes />}  side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="pro-3d-render" handleId="video"       type="source" position={Position.Right} label="Video"       color={HANDLE_COLORS.video}     icon={<Film />}   side="right" top="calc(100% - 24px)" />
      {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} results={results} initialIndex={activeIndex} />}
      <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const Pro3DRenderNode = memo(Pro3DRenderNodeComponent)
