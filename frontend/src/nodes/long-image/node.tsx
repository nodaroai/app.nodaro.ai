import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AlertCircle, Expand, Image as ImageIcon, Loader2, PanelTop, RotateCcw, Type, X } from "lucide-react"
import { longImageMode } from "@nodaro/render-rules"
import { BaseNode } from "@/components/nodes/base-node"
import { EditableNodeLabel } from "@/components/nodes/editable-node-label"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "@/components/nodes/handle-with-popover"
import { NodeJobProgress } from "@/components/nodes/node-job-progress"
import { RunNodeButton } from "@/components/nodes/run-node-button"
import { useUnitNodeKit } from "@/components/nodes/use-unit-node-kit"
import { imageNodeSizing } from "@/components/nodes/video-node-defaults"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { unitInputConnectionAccepted } from "@/lib/ffmpeg-handles"
import { useT } from "@/lib/i18n"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { UnitNodeComponent } from "../kit"
import { definition } from "./definition.generated"
import type { LongImageData } from "./types"
import { useRunCredits, useWiredInputs } from "./config"

// The pip glow follows the manifest's declared inputs — the same rule the canvas
// and the add-node popup judge a wire into them by (unit-connections.ts).
const ACCEPTS_TEXT = (t: string) => unitInputConnectionAccepted(definition, "prompt", t)
const ACCEPTS_PRODUCT_1 = (t: string) => unitInputConnectionAccepted(definition, "productImage1", t)
const ACCEPTS_PRODUCT_2 = (t: string) => unitInputConnectionAccepted(definition, "productImage2", t)
const ACCEPTS_PRODUCT_3 = (t: string) => unitInputConnectionAccepted(definition, "productImage3", t)
const ACCEPTS_STYLE = (t: string) => unitInputConnectionAccepted(definition, "styleImage", t)
const ACCEPTS_SUBJECT = (t: string) => unitInputConnectionAccepted(definition, "subjectImage", t)

/**
 * The card's shape. A long picture is far taller than it is wide (a whole page
 * in one image), so the card shows its top at a portrait shape and never grows
 * past it; the full picture opens in the preview. Before a run the card is
 * that portrait shape too.
 */
const CARD_ASPECT = 9 / 16
const cardAspect = (aspect: number | undefined): number => Math.max(aspect ?? CARD_ASPECT, CARD_ASPECT)

/**
 * Where each input pip sits down the left side: the prompt, then the three
 * product pictures, then the webpage pictures (the ids unit.json declares;
 * HandleWithPopover shows each manifest label in the interface language).
 */
const PIP_TOP = {
  prompt: "12%",
  productImage1: "27%",
  productImage2: "42%",
  productImage3: "57%",
  styleImage: "72%",
  subjectImage: "87%",
} as const

function LongImageNode({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as LongImageData
  // The workflow store's services, bound to this node (the unit kit — a unit never imports the store).
  const kit = useUnitNodeKit(id)
  const { updateNodeData } = kit
  const wired = useWiredInputs(id)
  // What a run with the pictures wired now costs (its mode, size, length and pictures).
  const credits = useRunCredits(nodeData, wired)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  // A preview the image service cannot shrink (a very tall picture) is shown from the file itself.
  const [thumbFailed, setThumbFailed] = useState<string | null>(null)

  const mode = longImageMode(nodeData.mode)
  const status = nodeData.executionStatus ?? "idle"
  const isRunning = status === "running"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const rawUrl = activeResult?.url ?? nodeData.generatedImageUrl
  const activeUrl = rawUrl && rawUrl.trim() ? rawUrl : undefined
  const { aspectRatio: resultAspect, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const hasResult = !isRunning && !!activeUrl

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedImageUrl"))
  }

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel label={nodeData.label} icon={<PanelTop className="w-3.5 h-3.5" />} onSave={(label) => updateNodeData({ label })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<PanelTop className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={isRunning}
        hideHeader
        {...imageNodeSizing(cardAspect(resultAspect), CARD_ASPECT)}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={isRunning} onRun={() => kit.run()} />}
        bottomToolbarContent={
          results.length > 1 ? (
            <div className="flex gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
              {results.slice(0, 8).map((r, i) => (
                <button key={`${r.jobId}-${i}`} type="button" aria-label={t("node.switchToResultN", { n: i + 1 })}
                  className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff0073]"
                  onClick={(e) => { e.stopPropagation(); updateNodeData({ activeResultIndex: i, generatedImageUrl: r.url }) }}>
                  <CachedImage src={r.url} alt={t("node.resultN", { n: i + 1 })} thumbnail thumbnailWidth={128}
                    className={`w-14 h-14 object-cover object-top rounded-lg ${i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"}`} />
                </button>
              ))}
            </div>
          ) : undefined
        }
        handles={[
          { id: "prompt", type: "target", position: Position.Left, customStyle: { top: PIP_TOP.prompt, left: "-29px" }, external: true },
          { id: "productImage1", type: "target", position: Position.Left, customStyle: { top: PIP_TOP.productImage1, left: "-29px" }, external: true },
          { id: "productImage2", type: "target", position: Position.Left, customStyle: { top: PIP_TOP.productImage2, left: "-29px" }, external: true },
          { id: "productImage3", type: "target", position: Position.Left, customStyle: { top: PIP_TOP.productImage3, left: "-29px" }, external: true },
          { id: "styleImage", type: "target", position: Position.Left, customStyle: { top: PIP_TOP.styleImage, left: "-29px" }, external: true },
          { id: "subjectImage", type: "target", position: Position.Left, customStyle: { top: PIP_TOP.subjectImage, left: "-29px" }, external: true },
          { id: "image", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
        ]}
      >
        <div className="relative w-full h-full group">
          {/* The picture's top, as a page opens; the whole of it in the preview */}
          {hasResult && (
            <CachedImage src={activeUrl} alt={nodeData.label} className="w-full h-full object-cover object-top rounded-xl"
              {...(thumbFailed === activeUrl ? { raw: true } : { thumbnail: true, thumbnailWidth: 480 })}
              onError={() => setThumbFailed(activeUrl)} onLoadDimensions={onLoadDimensions} />
          )}

          {/* Running: the job's progress */}
          {isRunning && (
            <div className="h-full min-h-24 flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/30">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {/* Failed */}
          {status === "failed" && !activeUrl && (
            <div className="h-full min-h-24 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-red-500/5 p-3 text-center">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <span className="text-[11px] text-red-400 font-medium">{t("node.failed")}</span>
              {nodeData.errorMessage && <p className="text-[11px] text-muted-foreground line-clamp-3" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>}
              <button type="button" className="nodrag mt-1 h-7 px-3 rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 flex items-center gap-1.5"
                onClick={(e) => { e.stopPropagation(); kit.run() }}>
                <RotateCcw className="w-3 h-3" /> {t("editor.retry")}
              </button>
            </div>
          )}

          {/* Idle: what the node makes in its mode */}
          {!isRunning && !activeUrl && status !== "failed" && (
            <div className="h-full min-h-24 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/20 p-3 text-center">
              <PanelTop className="w-6 h-6 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">{mode === "webpage" ? t("longImage.modeWebpage") : t("longImage.modeEcommerce")}</span>
              <span className="text-[11px] text-muted-foreground">{mode === "webpage" ? t("longImage.emptyHintWebpage") : t("longImage.emptyHintEcommerce")}</span>
            </div>
          )}

          {/* On the picture: open it whole, or delete this take */}
          {hasResult && (
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button type="button" aria-label={t("node.expandPreview")} title={t("node.expandPreview")}
                className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
                onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}>
                <Expand className="w-3.5 h-3.5" />
              </button>
              {results.length > 0 && (
                <button type="button" aria-label={t("node.removeResult")} title={t("node.deleteThisResult")}
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </BaseNode>

      <HandleWithPopover nodeId={id} nodeType="long-image" handleId="prompt" type="target" position={Position.Left} label="Prompt" color={TEXT_HANDLE_COLOR} icon={<Type />} side="left" top={PIP_TOP.prompt} accepts={ACCEPTS_TEXT} />
      <HandleWithPopover nodeId={id} nodeType="long-image" handleId="productImage1" type="target" position={Position.Left} label="Product image 1" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left" top={PIP_TOP.productImage1} accepts={ACCEPTS_PRODUCT_1} />
      <HandleWithPopover nodeId={id} nodeType="long-image" handleId="productImage2" type="target" position={Position.Left} label="Product image 2" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left" top={PIP_TOP.productImage2} accepts={ACCEPTS_PRODUCT_2} />
      <HandleWithPopover nodeId={id} nodeType="long-image" handleId="productImage3" type="target" position={Position.Left} label="Product image 3" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left" top={PIP_TOP.productImage3} accepts={ACCEPTS_PRODUCT_3} />
      <HandleWithPopover nodeId={id} nodeType="long-image" handleId="styleImage" type="target" position={Position.Left} label="Style image" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left" top={PIP_TOP.styleImage} accepts={ACCEPTS_STYLE} />
      <HandleWithPopover nodeId={id} nodeType="long-image" handleId="subjectImage" type="target" position={Position.Left} label="Subject image" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left" top={PIP_TOP.subjectImage} accepts={ACCEPTS_SUBJECT} />
      <HandleWithPopover nodeId={id} nodeType="long-image" handleId="image" type="source" position={Position.Right} label="Image" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="right" top="24px" />

      {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="image" url={activeUrl} results={results} initialIndex={activeIndex} />}
      <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const NodeComponent: UnitNodeComponent = memo(LongImageNode)
