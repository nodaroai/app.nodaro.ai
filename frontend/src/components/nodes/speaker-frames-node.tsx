"use client"

import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ScanFace, Braces, Film, Loader2, AlertCircle } from "lucide-react"
import { SPEAKER_FRAMES_PRICED } from "@nodaro/render-rules"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { ACCEPTS_JSON, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { ACCEPTS_VIDEO } from "@/lib/ffmpeg-handles"
import { speakerFramesResultSummary, speakerFramesSourcesOf } from "@/lib/speaker-frames-panel"
import { useT } from "@/lib/i18n"
import type { SpeakerFramesNodeData } from "@/types/nodes"

/**
 * Speaker Frames (P3.6): where each speaker's face is, per camera. The face
 * shows the cameras the wired edit samples and their frames before a run, the
 * tracks per camera after one (read after the node's corrections), and — until
 * P3.7 — that it is not priced yet, with the quick strip's Run disabled.
 */
function SpeakerFramesNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as SpeakerFramesNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const status = nodeData.executionStatus ?? "idle"
  const sources = useMemo(() => speakerFramesSourcesOf(id, nodes, edges), [id, nodes, edges])
  const result = useMemo(() => speakerFramesResultSummary(nodeData.generatedJson, nodeData.trackAssignments), [nodeData.generatedJson, nodeData.trackAssignments])
  const ticked = sources.filter((s) => s.ticked)
  const frames = ticked.reduce((n, s) => n + s.frames, 0)
  const labelOf = (sourceId: string) => {
    const label = (nodes.find((n) => n.id === sourceId)?.data as { label?: unknown } | undefined)?.label
    return typeof label === "string" && label ? label : sourceId
  }

  return (
    <div className="relative max-w-[260px]">
      <EditableNodeLabel label={nodeData.label} icon={<ScanFace className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ScanFace className="h-4 w-4" />}
        category="processing"
        selected={selected}
        isRunning={status === "running"}
        minWidth={240}
        hideHeader
        topToolbarContent={
          <NodeQuickStrip
            nodeId={id}
            isRunning={status === "running"}
            disabled={!SPEAKER_FRAMES_PRICED}
            disabledReason={!SPEAKER_FRAMES_PRICED ? t("speakerFrames.notPriced") : undefined}
          />
        }
        handles={[
          { id: "edl",        type: "target", position: Position.Left,  customStyle: { top: "24px", left: "-29px" },  external: true },
          { id: "video",      type: "target", position: Position.Left,  customStyle: { top: "52px", left: "-29px" },  external: true },
          { id: "transcript", type: "target", position: Position.Left,  customStyle: { top: "80px", left: "-29px" },  external: true },
          { id: "tracks",     type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col gap-2 p-3 h-full" style={{ minHeight: 120 }}>
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
                <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>
              )}
            </div>
          )}

          {status !== "running" && result && (
            <div className="flex flex-col gap-1" data-testid="speaker-frames-node-result">
              {result.sources.map((s) => (
                <span key={s.sourceId} className="text-[10px] rounded bg-muted px-1.5 py-0.5">
                  {labelOf(s.sourceId)}: {t("speakerFrames.tracks", { count: s.tracks })}
                  {s.speakers.length > 0 && ` · ${s.speakers.join(", ")}`}
                </span>
              ))}
            </div>
          )}

          {status !== "running" && status !== "failed" && !result && (
            <div className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/60 p-2" style={{ minHeight: 90, flex: 1 }}>
              <ScanFace className="w-5 h-5" />
              {ticked.length > 0 ? (
                <span className="text-[10px] text-center tabular-nums" data-testid="speaker-frames-node-summary">{t("speakerFrames.total", { frames, cameras: ticked.length })}</span>
              ) : (
                <span className="text-[10px] text-center px-2">{t("speakerFrames.connect")}</span>
              )}
            </div>
          )}

          {!SPEAKER_FRAMES_PRICED && (
            <span data-testid="speaker-frames-node-not-priced" className="text-[10px] text-center px-2 text-amber-700 dark:text-amber-400">{t("speakerFrames.notPriced")}</span>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="speaker-frames" handleId="edl"        type="target" position={Position.Left}  label={t("node.applyEdlEdlIn")}     color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left"  top="24px" accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="speaker-frames" handleId="video"      type="target" position={Position.Left}  label={t("speakerFrames.videoIn")}  color={HANDLE_COLORS.video}     icon={<Film />}   side="left"  top="52px" accepts={ACCEPTS_VIDEO} />
      <HandleWithPopover nodeId={id} nodeType="speaker-frames" handleId="transcript" type="target" position={Position.Left}  label={t("node.transcript")}        color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left"  top="80px" accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="speaker-frames" handleId="tracks"     type="source" position={Position.Right} label={t("speakerFrames.tracksOut")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
    </div>
  )
}

export const SpeakerFramesNode = memo(SpeakerFramesNodeComponent)
