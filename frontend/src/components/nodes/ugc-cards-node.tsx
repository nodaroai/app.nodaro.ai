"use client"

import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AlertCircle, Braces, LayoutPanelTop, Loader2, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { NodeQuickStrip } from "./node-quick-strip"
import { UgcInputPips, ugcNodeHandles, ugcPipTop } from "./ugc-node-pips"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useT } from "@/lib/i18n"
import { useLocalizeHandleLabel } from "@/lib/i18n/labels"
import { ugcCardsCounts } from "@/lib/ugc-node-cards"
import { ugcNodeMessageText } from "@/lib/ugc-copy"
import type { UgcCardsData } from "@/types/nodes"

const OUTPUTS = ["layerPlan", "captionPlan", "report"] as const

function UgcCardsNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const localizeHandle = useLocalizeHandleLabel()
  const d = data as UgcCardsData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = d.executionStatus ?? "idle"
  const running = status === "running"
  const result = d.result
  const report = typeof result?.report === "string" ? result.report : ""
  const counts = useMemo(() => ugcCardsCounts(result), [result])
  const hasResult = !!result && typeof result === "object"

  return (
    <div className="relative max-w-[300px]">
      <EditableNodeLabel
        label={d.label}
        icon={<LayoutPanelTop className="w-3.5 h-3.5" />}
        onSave={(label) => updateNodeData(id, { label })}
      />
      <BaseNode
        id={id}
        label={d.label}
        icon={<LayoutPanelTop className="h-4 w-4" />}
        category="ai"
        selected={selected}
        isRunning={running}
        minWidth={260}
        hideHeader
        topToolbarContent={<NodeQuickStrip nodeId={id} isRunning={running} />}
        handles={ugcNodeHandles("ugc-cards", OUTPUTS)}
      >
        <div className="flex flex-col gap-2 p-3 h-full" style={{ minHeight: 140 }}>
          {running && (
            <div className="flex flex-col items-center justify-center gap-2 h-16 rounded-md bg-muted/30">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={d.currentJobProgress} />
            </div>
          )}
          {status === "failed" && (
            <div className="flex flex-col items-center justify-center gap-1 rounded-md bg-red-500/5 text-red-500 p-2">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">{t("node.failed")}</span>
              </div>
              {d.errorMessage && (
                <p dir="auto" className="text-[11px] text-center text-red-400 line-clamp-3" title={ugcNodeMessageText(d.errorMessage)}>
                  {ugcNodeMessageText(d.errorMessage)}
                </p>
              )}
            </div>
          )}
          {!running && hasResult && (
            <div className="flex flex-1 min-h-0 flex-col gap-1.5 text-[11px]" data-testid="ugc-cards-result">
              <div className="flex flex-wrap gap-1 tabular-nums">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  {counts.cards === 1 ? t("ugc.cards.cardsOne", { n: 1 }) : t("ugc.cards.cardsMany", { n: counts.cards })}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  {counts.captionWords === 1 ? t("ugc.cards.captionWordsOne", { n: 1 }) : t("ugc.cards.captionWordsMany", { n: counts.captionWords })}
                </span>
              </div>
              {report && (
                <div className="flex flex-1 min-h-0 flex-col gap-0.5">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{localizeHandle("Notes")}</span>
                  {/* nowheel/nodrag/nopan: the Notes scroll inside the node instead of panning the canvas. */}
                  <p dir="auto" className="flex-1 min-h-0 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-2 leading-snug nowheel nodrag nopan scrollbar-reveal">
                    {report}
                  </p>
                </div>
              )}
            </div>
          )}
          {!running && !hasResult && status !== "failed" && (
            <div className="flex flex-1 items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground" style={{ minHeight: 100 }}>
              <LayoutPanelTop className="w-6 h-6" />
            </div>
          )}
        </div>
      </BaseNode>
      <UgcInputPips nodeId={id} nodeType="ugc-cards" />
      <HandleWithPopover nodeId={id} nodeType="ugc-cards" handleId="layerPlan" type="source" position={Position.Right} label="Layer plan" color={HANDLE_COLORS.look} icon={<Braces />} side="right" top={ugcPipTop(0)} />
      <HandleWithPopover nodeId={id} nodeType="ugc-cards" handleId="captionPlan" type="source" position={Position.Right} label="Caption plan" color={HANDLE_COLORS.look} icon={<Braces />} side="right" top={ugcPipTop(1)} />
      <HandleWithPopover nodeId={id} nodeType="ugc-cards" handleId="report" type="source" position={Position.Right} label="Notes" color={HANDLE_COLORS.text} icon={<Type />} side="right" top={ugcPipTop(2)} />
    </div>
  )
}

export const UgcCardsNode = memo(UgcCardsNodeComponent)
