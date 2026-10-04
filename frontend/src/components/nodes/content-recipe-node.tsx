"use client"

import { memo, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Position, type NodeProps } from "@xyflow/react"
import { ChefHat, Braces, Type, Link2, FileText, Loader2, AlertCircle, Copy, Expand, X } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { ACCEPTS_CONTENT_MATERIAL, ACCEPTS_POST_LINK } from "@/lib/content-handles"
import { contentRecipeCreditId } from "@nodaro/shared"
import { useT } from "@/lib/i18n"
import { copyToClipboard } from "@/lib/utils"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import type { ContentRecipeNodeData } from "@/types/nodes"

function fmtSec(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "?"
  return Number.isInteger(n) ? `${n}` : n.toFixed(1)
}

function RecipeTextModal({
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
            <ChefHat className="w-4 h-4 text-muted-foreground" />
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

function ContentRecipeNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as ContentRecipeNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"
  const recipe = nodeData.generatedJson
  const text = nodeData.generatedText ?? ""
  const hasResult = recipe !== undefined && recipe !== null && typeof recipe === "object"

  // The same id the cloud route and the orchestrator reserve: the EFFECTIVE
  // model's tier (an unset model is the economy default, never the bare id).
  const creditModelId = useMemo(
    () => contentRecipeCreditId(nodeData.llmModel, nodeData.reasoningEffort),
    [nodeData.llmModel, nodeData.reasoningEffort],
  )
  const credits = useModelCredits(creditModelId)
  const [textOpen, setTextOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)

  const confidence = typeof recipe?.format?.confidence === "number" ? Math.round(recipe.format.confidence * 100) : undefined

  return (
    <div className="relative max-w-[280px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<ChefHat className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ChefHat className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        minWidth={280}
        hideHeader
        topToolbarContent={<NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />}
        handles={[
          { id: "in",   type: "target", position: Position.Left,  customStyle: { top: "24px", left: "-29px" },  external: true },
          { id: "link", type: "target", position: Position.Left,  customStyle: { top: "52px", left: "-29px" },  external: true },
          { id: "json", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
          { id: "text", type: "source", position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
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

          {status !== "running" && hasResult && (
            <div className="relative group flex-1 min-h-0 flex flex-col gap-1.5">
              {/* nowheel/nodrag/nopan: lets the recipe scroll inside the node
                  instead of panning the canvas (same as Video Analysis). */}
              <div className="rounded-md border bg-muted/30 flex-1 min-h-0 overflow-auto p-2 nowheel nodrag nopan scrollbar-reveal flex flex-col gap-1.5 text-[11px]">
                {recipe.topic && <div dir="auto" className="font-medium leading-snug">{recipe.topic}</div>}
                <div className="flex flex-wrap gap-1">
                  {recipe.format?.label && (
                    <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px]">
                      {recipe.format.label}
                      {confidence !== undefined && <span className="tabular-nums opacity-70"> · {confidence}%</span>}
                    </span>
                  )}
                  {typeof recipe.durationSec === "number" && recipe.durationSec > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] tabular-nums">{t("node.contentRecipeSeconds", { seconds: fmtSec(recipe.durationSec) })}</span>
                  )}
                  {recipe.pace && <span className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{recipe.pace}</span>}
                  {recipe.cta?.kind && recipe.cta.kind !== "none" && (
                    <span className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{t("node.contentRecipeCta", { kind: recipe.cta.kind })}</span>
                  )}
                </div>
                {recipe.hook && (
                  <div className="flex flex-col gap-0.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("node.contentRecipeHook")}
                      {recipe.hook.types && recipe.hook.types.length > 0 && <span className="normal-case"> · {recipe.hook.types.join(", ")}</span>}
                    </div>
                    {recipe.hook.spoken && <div dir="auto" className="italic">{t("common.quoted", { text: recipe.hook.spoken })}</div>}
                    {!recipe.hook.spoken && recipe.hook.onScreenText && <div dir="auto" className="italic">{t("common.quoted", { text: recipe.hook.onScreenText })}</div>}
                    {recipe.hook.whyItStops && <div dir="auto" className="text-muted-foreground">{recipe.hook.whyItStops}</div>}
                  </div>
                )}
                {recipe.beats && recipe.beats.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("node.contentRecipeBeats")}</div>
                    {recipe.beats.map((b, i) => (
                      <div key={i} dir="auto" className="leading-snug">
                        <span className="tabular-nums text-muted-foreground">{t("node.contentRecipeSpan", { start: fmtSec(b.start), end: fmtSec(b.end) })}</span>{" "}
                        <span className="font-medium">{b.purpose}</span>
                        {b.description && <span className="text-muted-foreground"> · {b.description}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {recipe.whyItWorks && recipe.whyItWorks.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("node.contentRecipeWhy")}</div>
                    {recipe.whyItWorks.map((w, i) => (
                      <div key={i} dir="auto" className="leading-snug">
                        <span className="font-medium">{w.reason}</span>
                        {w.detail && <span className="text-muted-foreground"> · {w.detail}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {recipe.source?.url && (
                  <div className="text-[10px] text-muted-foreground truncate" dir="ltr" title={recipe.source.url}>
                    {recipe.source.url}
                  </div>
                )}
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
                {/* The X every node has: clears the recipe so the node starts over. */}
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

          {status !== "running" && status !== "failed" && !hasResult && (
            <div
              className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40 px-2 text-center"
              style={{ minHeight: 120, flex: 1 }}
            >
              <ChefHat className="w-6 h-6" />
              <span className="text-[10px]">{t("node.contentRecipeEmpty")}</span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="content-recipe" handleId="in"   type="target" position={Position.Left}  label={t("node.contentRecipeMaterial")} color={DATA_HANDLE_COLORS.text} icon={<FileText />} side="left"  top="24px" accepts={ACCEPTS_CONTENT_MATERIAL} />
      <HandleWithPopover nodeId={id} nodeType="content-recipe" handleId="link" type="target" position={Position.Left}  label={t("node.contentRecipeSourcePost")} color={DATA_HANDLE_COLORS.text} icon={<Link2 />} side="left"  top="52px" accepts={ACCEPTS_POST_LINK} />
      <HandleWithPopover nodeId={id} nodeType="content-recipe" handleId="json" type="source" position={Position.Right} label={t("node.contentRecipeJson")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="content-recipe" handleId="text" type="source" position={Position.Right} label={t("node.contentRecipeText")} color={DATA_HANDLE_COLORS.text} icon={<Type />} side="right" top="52px" />
      {text && <RecipeTextModal isOpen={textOpen} onClose={() => setTextOpen(false)} title={nodeData.label} text={text} />}
      <DeleteConfirmationDialog
        isOpen={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={() => updateNodeData(id, { executionStatus: "idle", errorMessage: undefined, generatedJson: undefined, generatedText: undefined, runWarnings: undefined })}
      />
    </div>
  )
}

export const ContentRecipeNode = memo(ContentRecipeNodeComponent)
