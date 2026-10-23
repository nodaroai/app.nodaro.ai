"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { useT } from "@/lib/i18n"
import { AudioLines, Braces, Loader2, AlertCircle, VolumeX } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { ACCEPTS_MEDIA, FFMPEG_COLORS } from "@/lib/ffmpeg-handles"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import type { SilenceDetectNodeData } from "@/types/nodes"

interface SilenceResult {
  version?: number
  ranges?: Array<{ startMs: number; endMs: number }>
  durationMs?: number
}

function totalSilentMs(ranges: Array<{ startMs: number; endMs: number }>): number {
  return ranges.reduce((sum, r) => sum + Math.max(0, r.endMs - r.startMs), 0)
}

// Silence Detect: one local ffmpeg `silencedetect` pass over an audio OR video
// source → the silent spans as source-clock ranges on a single `json` handle.
// Keyless (community works); flat 1 credit. Modeled on the ffmpeg audio nodes
// for its media `in` handle, and on web-scrape for its json output.
function SilenceDetectNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as SilenceDetectNodeData
  const credits = useModelCredits("silence-detect", 10)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const result = nodeData.generatedJson as SilenceResult | undefined
  const ranges = result?.ranges ?? []

  return (
    <div className="relative" style={{ maxWidth: "220px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<VolumeX className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<VolumeX className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "json", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col gap-2 p-3" style={{ minHeight: 120 }}>
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 h-12 rounded-md bg-muted/30">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {status !== "running" && result && (
            <div className="flex flex-col gap-1 rounded-md bg-muted/30 p-2 text-xs">
              <div className="flex items-center gap-1.5 font-medium">
                <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />
                <span>{t("audiocfg.silenceRangeCount", { count: ranges.length })}</span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {(totalSilentMs(ranges) / 1000).toFixed(1)}s
                {result.durationMs ? ` / ${(result.durationMs / 1000).toFixed(1)}s` : ""}
              </span>
            </div>
          )}

          {status === "failed" && !result && (
            <div className="flex flex-col items-center justify-center gap-1 h-12 rounded-md bg-red-500/5 text-red-500 p-2 text-xs">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">{t("node.failed")}</span>
              </div>
              {nodeData.errorMessage && (
                <p className="text-[11px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                  {nodeData.errorMessage}
                </p>
              )}
            </div>
          )}

          {status !== "running" && !result && status !== "failed" && (
            <div className="flex items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground" style={{ minHeight: 80, flex: 1 }}>
              <AudioLines className="w-5 h-5" />
            </div>
          )}

          <span className="text-xs text-muted-foreground">{t("inputcfg.silenceDetect")}</span>
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="silence-detect" handleId="in"   type="target" position={Position.Left}  label="Audio or Video" color={FFMPEG_COLORS.media} icon={<AudioLines />} side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_MEDIA} />
      <HandleWithPopover nodeId={id} nodeType="silence-detect" handleId="json" type="source" position={Position.Right} label="Silences"        color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
    </div>
  )
}

export const SilenceDetectNode = memo(SilenceDetectNodeComponent)
