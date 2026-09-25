"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { useT } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { AudioLines, Braces, Loader2, AlertCircle, AlertTriangle, AudioWaveform } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { ACCEPTS_MEDIA, FFMPEG_COLORS } from "@/lib/ffmpeg-handles"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { AUDIO_SYNC_SOURCES_HANDLE, audioSyncCreditId, audioSyncWiredSourceCount } from "@/lib/audio-sync"
import type { AudioSyncNodeData, AudioSyncResult } from "@/types/nodes"

/** `+7.500 s` / `−40.000 s` — the offset in the D19 sign, with an explicit
 *  sign so a zero-looking row still says which way it moves. */
function formatOffset(ms: number): string {
  const sign = ms > 0 ? "+" : ms < 0 ? "−" : "±"
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)} s`
}

// Audio Sync: measures how far apart the clocks of 2–6 recordings of one
// conversation are, by cross-correlating their audio (local ffmpeg decode +
// in-process correlation, keyless). The recordings wire into ONE `sources`
// handle (audio or video, order matters: the first is the default reference);
// the offsets leave on a single `json` handle, like silence-detect's ranges.
// Priced per source aligned to the reference — the pill counts the wired
// sources through the same helper every run-level estimate uses.
function AudioSyncNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const localizeNode = useLocalizeNodeLabel()
  const nodeData = data as AudioSyncNodeData
  // A primitive selector (the count), so the node re-renders only when its own
  // wiring changes, not on every store tick.
  const wiredCount = useWorkflowStore((s) => audioSyncWiredSourceCount(id, s.edges) ?? 0)
  const credits = useModelCredits(audioSyncCreditId(wiredCount), 10)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const result = nodeData.generatedJson as AudioSyncResult | undefined
  const offsets = Array.isArray(result?.offsets) ? result.offsets : []
  const notes = Array.isArray(result?.notes) ? result.notes : []
  // Labels of the measured sources, as ONE primitive string (id → label pairs)
  // so this subscription stays cheap.
  const labelsKey = useWorkflowStore((s) =>
    offsets.map((o) => (s.nodes.find((n) => n.id === o.sourceId)?.data as { label?: string } | undefined)?.label ?? o.sourceId).join("\u0000"),
  )
  const labels = labelsKey ? labelsKey.split("\u0000") : []

  return (
    <div className="relative" style={{ maxWidth: "240px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<AudioWaveform className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<AudioWaveform className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={[
          { id: AUDIO_SYNC_SOURCES_HANDLE, type: "target", position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
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

          {status !== "running" && offsets.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md bg-muted/30 p-2 text-xs">
              {offsets.map((o, i) => (
                <div key={o.sourceId} className="flex items-center justify-between gap-2">
                  <span className="truncate" title={localizeNode(labels[i] ?? o.sourceId)}>
                    {localizeNode(labels[i] ?? o.sourceId)}
                  </span>
                  <span className={`shrink-0 tabular-nums ${o.confidence < 0.5 ? "text-amber-500" : "text-muted-foreground"}`} dir="ltr">
                    {o.sourceId === result?.reference ? t("node.audioSyncReference") : formatOffset(o.offsetMs)}
                  </span>
                </div>
              ))}
              {notes.length > 0 && (
                <div className="flex items-start gap-1 pt-1 text-[10px] text-amber-500" title={notes.join("\n")}>
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                  <span className="line-clamp-2">{t("node.audioSyncNotes", { count: notes.length })}</span>
                </div>
              )}
            </div>
          )}

          {status === "failed" && offsets.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-1 h-12 rounded-md bg-red-500/5 text-red-500 p-2 text-xs">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">{t("node.failed")}</span>
              </div>
              {nodeData.errorMessage && (
                <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                  {nodeData.errorMessage}
                </p>
              )}
            </div>
          )}

          {status !== "running" && offsets.length === 0 && status !== "failed" && (
            <div className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40" style={{ minHeight: 80, flex: 1 }}>
              <AudioLines className="w-5 h-5" />
              <span className="text-[10px] text-center px-2">{t("node.audioSyncConnect")}</span>
            </div>
          )}

          <span className="text-xs text-muted-foreground">{t("inputcfg.audioSync")}</span>
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="audio-sync" handleId={AUDIO_SYNC_SOURCES_HANDLE} type="target" position={Position.Left}  label="Sources" color={FFMPEG_COLORS.media} icon={<AudioLines />} side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_MEDIA} orderMatters />
      <HandleWithPopover nodeId={id} nodeType="audio-sync" handleId="json"                     type="source" position={Position.Right} label="Offsets" color={DATA_HANDLE_COLORS.json} icon={<Braces />}    side="right" top="24px" />
    </div>
  )
}

export const AudioSyncNode = memo(AudioSyncNodeComponent)
