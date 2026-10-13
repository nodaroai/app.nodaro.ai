"use client"

import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AlertCircle, Braces, Loader2, ScrollText, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { NodeQuickStrip } from "./node-quick-strip"
import { UgcInputPips, ugcNodeHandles, ugcPipTop } from "./ugc-node-pips"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useT } from "@/lib/i18n"
import { scriptLines } from "@/lib/ugc-script-edit"
import { ugcNodeMessageText } from "@/lib/ugc-copy"
import { NODE_DEF_MAP, type UgcScriptData } from "@/types/nodes"

const OUTPUTS = ["plan", "category"] as const

function UgcScriptNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const d = data as UgcScriptData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = d.executionStatus ?? "idle"
  const running = status === "running"
  // The platform's own price row; the definition's figure until it loads.
  const credits = useModelCredits("ugc-script", NODE_DEF_MAP.get("ugc-script")?.creditCost ?? 0)
  const plan = d.result?.plan
  const example = d.exampleLines
  // The public lines only (hook, each beat's line, the closer); the rest of the plan is never read.
  // A template's example run shows its spoken lines until the node's own first script.
  const lines = useMemo(() => {
    if (!plan || typeof plan !== "object") return Array.isArray(example) ? example.filter((line): line is string => typeof line === "string" && line.trim() !== "") : []
    const { hook, beats, closer } = scriptLines(plan)
    return [hook, ...beats, closer].filter((line) => line.trim() !== "")
  }, [plan, example])

  return (
    <div className="relative max-w-[300px]">
      <EditableNodeLabel
        label={d.label}
        icon={<ScrollText className="w-3.5 h-3.5" />}
        onSave={(label) => updateNodeData(id, { label })}
      />
      <BaseNode
        id={id}
        label={d.label}
        icon={<ScrollText className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={running}
        minWidth={280}
        hideHeader
        topToolbarContent={<NodeQuickStrip nodeId={id} credits={credits} isRunning={running} />}
        handles={ugcNodeHandles("ugc-script", OUTPUTS)}
      >
        <div className="flex flex-col gap-2 p-3 h-full" style={{ minHeight: 160 }}>
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
                <p dir="auto" className="text-[10px] text-center text-red-400 line-clamp-3" title={ugcNodeMessageText(d.errorMessage)}>
                  {ugcNodeMessageText(d.errorMessage)}
                </p>
              )}
            </div>
          )}
          {!running && lines.length > 0 && (
            <div className="flex flex-1 min-h-0 flex-col gap-1.5">
              {d.keepResult && (
                <span className="self-start rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary" data-testid="ugc-script-kept">
                  {t("ugc.script.kept")}
                </span>
              )}
              {/* nowheel/nodrag/nopan: the lines scroll inside the node instead of panning the canvas. */}
              <ol className="flex-1 min-h-0 overflow-auto rounded-md border bg-muted/30 p-2 nowheel nodrag nopan scrollbar-reveal flex flex-col gap-1 text-[11px]">
                {lines.map((line, i) => (
                  <li key={i} dir="auto" className="leading-snug">
                    {line}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {!running && lines.length === 0 && status !== "failed" && (
            <div
              className="flex flex-1 items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40"
              style={{ minHeight: 120 }}
            >
              <ScrollText className="w-6 h-6" />
            </div>
          )}
        </div>
      </BaseNode>
      <UgcInputPips nodeId={id} nodeType="ugc-script" />
      <HandleWithPopover nodeId={id} nodeType="ugc-script" handleId="plan" type="source" position={Position.Right} label="Script" color={HANDLE_COLORS.look} icon={<Braces />} side="right" top={ugcPipTop(0)} />
      <HandleWithPopover nodeId={id} nodeType="ugc-script" handleId="category" type="source" position={Position.Right} label="Category" color={HANDLE_COLORS.text} icon={<Type />} side="right" top={ugcPipTop(1)} />
    </div>
  )
}

export const UgcScriptNode = memo(UgcScriptNodeComponent)
