"use client"

import { memo, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Position, type NodeProps } from "@xyflow/react"
import { Lightbulb, ChefHat, Building2, List, Loader2, AlertCircle, Copy, Expand, X } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { ACCEPTS_BRAND_TEXT, ACCEPTS_RECIPE } from "@/lib/content-handles"
import { contentIdeasCreditId } from "@nodaro/shared"
import { useT } from "@/lib/i18n"
import { copyToClipboard } from "@/lib/utils"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import type { ContentIdeasNodeData } from "@/types/nodes"

function IdeasTextModal({
  isOpen, onClose, title, text,
}: {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly title: string
  readonly text: string
}) {
  const t = useT()
  if (!isOpen) return null
  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-8" onClick={onClose}>
      <div
        className="relative w-full max-w-3xl max-h-[85vh] bg-background rounded-lg border border-border shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
              onClick={() => copyToClipboard(text, t("node.textCopied"))}
            >
              {t("node.copyText")}
            </button>
            <button type="button" aria-label={t("common.close")} className="text-muted-foreground hover:text-foreground" onClick={onClose}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <pre dir="auto" className="overflow-auto p-4 text-xs whitespace-pre-wrap font-sans">{text}</pre>
      </div>
    </div>,
    document.body,
  )
}

function ContentIdeasNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as ContentIdeasNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"
  const ideas = Array.isArray(nodeData.generatedJson) ? nodeData.generatedJson : []
  const text = nodeData.generatedText ?? (nodeData.ideaBriefs ?? []).join("\n\n")

  // Charged per batch of up to five ideas — the same id the cloud route and
  // the orchestrator reserve for this count and the EFFECTIVE model.
  const creditModelId = useMemo(
    () => contentIdeasCreditId(nodeData.count, nodeData.llmModel, nodeData.reasoningEffort),
    [nodeData.count, nodeData.llmModel, nodeData.reasoningEffort],
  )
  const credits = useModelCredits(creditModelId)
  const [textOpen, setTextOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)

  return (
    <div className="relative max-w-[280px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Lightbulb className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Lightbulb className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        minWidth={280}
        hideHeader
        topToolbarContent={<NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />}
        handles={[
          { id: "recipes",     type: "target", position: Position.Left,  customStyle: { top: "24px", left: "-29px" },  external: true },
          { id: "field-brand", type: "target", position: Position.Left,  customStyle: { top: "52px", left: "-29px" },  external: true },
          { id: "ideas",       type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col gap-2 p-3 h-full" style={{ minHeight: 160 }}>
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 h-16 rounded-md bg-muted/30">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {status === "failed" && (
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

          {status !== "running" && ideas.length > 0 && (
            <div className="relative group flex-1 min-h-0 flex flex-col gap-1.5">
              <div className="text-[10px] text-muted-foreground tabular-nums">
                {ideas.length === 1 ? t("node.contentIdeasCountOne") : t("node.contentIdeasCount", { count: ideas.length })}
              </div>
              {/* nowheel/nodrag/nopan: the list scrolls inside the node instead of
                  panning the canvas (same as Video Analysis). */}
              <div className="rounded-md border bg-muted/30 flex-1 min-h-0 overflow-auto p-2 nowheel nodrag nopan scrollbar-reveal flex flex-col gap-2 text-[11px]">
                {ideas.map((idea, i) => (
                  <div key={i} className="flex flex-col gap-0.5">
                    <div dir="auto" className="font-medium leading-snug">
                      <span className="tabular-nums text-muted-foreground me-1">{i + 1}</span>{idea.title}
                    </div>
                    {idea.format && (
                      <div>
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px]">{idea.format}</span>
                      </div>
                    )}
                    {idea.hook?.line && <div dir="auto" className="italic text-muted-foreground">{t("common.quoted", { text: idea.hook.line })}</div>}
                  </div>
                ))}
              </div>
              {nodeData.runWarnings && nodeData.runWarnings.length > 0 && (
                <div className="text-[10px] text-amber-500 leading-snug" dir="auto">
                  {nodeData.runWarnings.join(" ")}
                </div>
              )}
              <div className="absolute -top-1 -right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {text && (<>
                  <button
                    type="button"
                    aria-label={t("node.expandResult")}
                    className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => { e.stopPropagation(); setTextOpen(true) }}
                  >
                    <Expand className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("node.copyText")}
                    className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyToClipboard(text, t("node.textCopied"))
                    }}
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </>)}
                {/* The X every node has: clears the ideas so the node starts over. */}
                <button
                  type="button"
                  aria-label={t("node.deleteResult")}
                  title={t("node.deleteResult")}
                  className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); setClearOpen(true) }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {status !== "running" && status !== "failed" && ideas.length === 0 && (
            <div
              className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40 px-2 text-center"
              style={{ minHeight: 120, flex: 1 }}
            >
              <Lightbulb className="w-6 h-6" />
              <span className="text-[10px]">{t("node.contentIdeasEmpty")}</span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="content-ideas" handleId="recipes"     type="target" position={Position.Left}  label={t("node.contentIdeasRecipes")} color={DATA_HANDLE_COLORS.text} icon={<ChefHat />}   side="left"  top="24px" accepts={ACCEPTS_RECIPE} />
      <HandleWithPopover nodeId={id} nodeType="content-ideas" handleId="field-brand" type="target" position={Position.Left}  label={t("node.contentIdeasBrand")}   color={DATA_HANDLE_COLORS.text} icon={<Building2 />} side="left"  top="52px" accepts={ACCEPTS_BRAND_TEXT} />
      <HandleWithPopover nodeId={id} nodeType="content-ideas" handleId="ideas"       type="source" position={Position.Right} label={t("node.contentIdeasIdeas")}   color={DATA_HANDLE_COLORS.list} icon={<List />}      side="right" top="24px" />
      {text && <IdeasTextModal isOpen={textOpen} onClose={() => setTextOpen(false)} title={nodeData.label} text={text} />}
      <DeleteConfirmationDialog
        isOpen={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={() => updateNodeData(id, { executionStatus: "idle", errorMessage: undefined, generatedJson: undefined, generatedText: undefined, ideaBriefs: undefined, runWarnings: undefined })}
      />
    </div>
  )
}

export const ContentIdeasNode = memo(ContentIdeasNodeComponent)
