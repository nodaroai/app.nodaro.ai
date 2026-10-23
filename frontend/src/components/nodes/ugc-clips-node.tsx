"use client"

import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AlertCircle, Braces, Loader2, Scissors, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { NodeQuickStrip } from "./node-quick-strip"
import { UgcClipsQuote } from "./ugc-clips-quote"
import { UgcInputPips, ugcNodeHandles, ugcPipTop } from "./ugc-node-pips"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { hasCredits } from "@/lib/edition"
import { useT } from "@/lib/i18n"
import { ugcClipLengths, ugcSeconds } from "@/lib/ugc-node-cards"
import { ugcNodeMessageText } from "@/lib/ugc-copy"
import type { UgcClipsData } from "@/types/nodes"

const OUTPUTS = ["clips", "plan-out", "transcript"] as const

function UgcClipsNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const d = data as UgcClipsData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = d.executionStatus ?? "idle"
  const running = status === "running"
  // Each ticket is read for its number and length only.
  const clips = useMemo(() => ugcClipLengths(d.__listResults), [d.__listResults])

  return (
    <div className="relative max-w-[300px]">
      <EditableNodeLabel
        label={d.label}
        icon={<Scissors className="w-3.5 h-3.5" />}
        onSave={(label) => updateNodeData(id, { label })}
      />
      <BaseNode
        id={id}
        label={d.label}
        icon={<Scissors className="h-4 w-4" />}
        category="ai"
        selected={selected}
        isRunning={running}
        minWidth={260}
        hideHeader
        topToolbarContent={<NodeQuickStrip nodeId={id} isRunning={running} />}
        handles={ugcNodeHandles("ugc-clips", OUTPUTS)}
      >
        <div className="flex flex-col gap-2 p-3 h-full" style={{ minHeight: 120 }}>
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
          {!running && clips.length > 0 && (
            <div className="flex flex-col gap-1 text-[11px]" data-testid="ugc-clips-list">
              <span className="font-medium">
                {clips.length === 1 ? t("ugc.clips.countOne", { n: 1 }) : t("ugc.clips.countMany", { n: clips.length })}
              </span>
              <ul className="flex flex-col gap-0.5 text-muted-foreground">
                {clips.map((c) => (
                  <li key={c.clip} className="tabular-nums">
                    {t("ugc.clips.clipLength", { n: c.clip, seconds: ugcSeconds(c.durationSec) })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasCredits() && <UgcClipsQuote quote={d.quote} status={status} />}
          {!running && clips.length === 0 && status !== "failed" && (
            <div className="flex flex-1 items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground" style={{ minHeight: 80 }}>
              <Scissors className="w-6 h-6" />
            </div>
          )}
        </div>
      </BaseNode>
      <UgcInputPips nodeId={id} nodeType="ugc-clips" />
      <HandleWithPopover nodeId={id} nodeType="ugc-clips" handleId="clips" type="source" position={Position.Right} label="Clips" color={HANDLE_COLORS.look} icon={<Braces />} side="right" top={ugcPipTop(0)} />
      <HandleWithPopover nodeId={id} nodeType="ugc-clips" handleId="plan-out" type="source" position={Position.Right} label="Script (sized)" color={HANDLE_COLORS.look} icon={<Braces />} side="right" top={ugcPipTop(1)} />
      <HandleWithPopover nodeId={id} nodeType="ugc-clips" handleId="transcript" type="source" position={Position.Right} label="Transcript" color={HANDLE_COLORS.text} icon={<Type />} side="right" top={ugcPipTop(2)} />
    </div>
  )
}

export const UgcClipsNode = memo(UgcClipsNodeComponent)
