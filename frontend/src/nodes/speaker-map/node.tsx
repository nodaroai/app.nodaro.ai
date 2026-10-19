import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AlertCircle, AlertTriangle, AudioLines, Braces, Loader2, Users } from "lucide-react"
import { speakerMapResultOf } from "@nodaro/shared/edl"
import { BaseNode } from "@/components/nodes/base-node"
import { EditableNodeLabel } from "@/components/nodes/editable-node-label"
import { HandleWithPopover } from "@/components/nodes/handle-with-popover"
import { NodeJobProgress } from "@/components/nodes/node-job-progress"
import { RunNodeButton } from "@/components/nodes/run-node-button"
import { useUnitNodeKit } from "@/components/nodes/use-unit-node-kit"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { ACCEPTS_MEDIA, FFMPEG_COLORS } from "@/lib/ffmpeg-handles"
import { ACCEPTS_JSON, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { useT } from "@/lib/i18n"
import type { UnitNodeComponent } from "../kit"
import type { SpeakerMapData } from "./types"

/**
 * One line per speaker of a Speaker Map result, in first-heard order:
 * "Speaker 1 → Camera 2", or "no clear camera". A camera is numbered by its
 * place among the run's recordings (the result's edit lists them in the order
 * the run read them — the Cameras list's order); without that edit, by id.
 */
function speakerMapLines(raw: unknown): { lines: Array<{ speaker: number; camera: string | null }>; notes: readonly string[] } | null {
  const result = speakerMapResultOf(raw)
  if (!result) return null
  const order = (result.edl?.sources ?? []).map((s) => s.id)
  const lines = Object.values(result.speakerMap).map((camera, i) => {
    const at = order.indexOf(camera)
    return { speaker: i + 1, camera: camera === "" ? null : at >= 0 ? String(at + 1) : camera }
  })
  return { lines, notes: result.notes }
}

// The pips render beside BaseNode (its handles are `external`), as every
// media node's do: handle-color-guard resolves their colours, and
// unit.json handles is the one declaration they must match.
function SpeakerMapNode({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as SpeakerMapData
  // The workflow store's services, bound to this node (the unit kit — a unit never imports the store).
  const kit = useUnitNodeKit(id)
  const credits = useModelCredits("speaker-map", 10)
  const status = nodeData.executionStatus ?? "idle"
  const shown = status === "running" ? null : speakerMapLines(nodeData.generatedJson)
  return (
    <div className="relative" style={{ maxWidth: "260px" }}>
      <EditableNodeLabel label={nodeData.label} icon={<Users className="w-3.5 h-3.5" />} onSave={(label) => kit.updateNodeData({ label })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Users className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={240}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={() => kit.run()} />}
        handles={[
          { id: "sources", type: "target", position: Position.Left, customStyle: { top: "24px", left: "-29px" }, external: true },
          { id: "offsets", type: "target", position: Position.Left, customStyle: { top: "50%", left: "-29px" }, external: true },
          { id: "transcript", type: "target", position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "json", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
          { id: "edl", type: "source", position: Position.Right, customStyle: { top: "calc(100% - 24px)", right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col gap-2 p-3" style={{ minHeight: 120 }}>
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 h-12 rounded-md bg-muted/30">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {shown && (
            <div className="flex flex-col gap-1 rounded-md bg-muted/30 p-2 text-xs">
              {shown.lines.map((l) => (
                <span key={l.speaker} className={l.camera === null ? "text-amber-500" : undefined}>
                  {l.camera === null
                    ? t("node.speakerMapNoCamera", { speaker: l.speaker })
                    : t("node.speakerMapLine", { speaker: l.speaker, camera: l.camera })}
                </span>
              ))}
              {shown.notes.length > 0 && (
                <div className="flex items-start gap-1 pt-1 text-[10px] text-amber-500" title={shown.notes.join("\n")}>
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                  <span className="line-clamp-2">{t("node.speakerMapNotes", { count: shown.notes.length })}</span>
                </div>
              )}
            </div>
          )}

          {status === "failed" && !shown && (
            <div className="flex flex-col items-center justify-center gap-1 h-12 rounded-md bg-red-500/5 text-red-500 p-2 text-xs">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">{t("node.failed")}</span>
              </div>
              {nodeData.errorMessage && (
                <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>
              )}
            </div>
          )}

          {status !== "running" && status !== "failed" && !shown && (
            <div className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40" style={{ minHeight: 80, flex: 1 }}>
              <Users className="w-5 h-5" />
              <span className="text-[10px] text-center px-2">{t("node.speakerMapConnect")}</span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="speaker-map" handleId="sources" type="target" position={Position.Left} label="Cameras" color={FFMPEG_COLORS.media} icon={<AudioLines />} side="left" top="24px" accepts={ACCEPTS_MEDIA} orderMatters />
      <HandleWithPopover nodeId={id} nodeType="speaker-map" handleId="offsets" type="target" position={Position.Left} label="Offsets" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left" top="50%" accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="speaker-map" handleId="transcript" type="target" position={Position.Left} label="Transcript" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left" top="calc(100% - 24px)" accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="speaker-map" handleId="json" type="source" position={Position.Right} label={t("node.speakerMapResult")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="speaker-map" handleId="edl" type="source" position={Position.Right} label={t("node.speakerMapEdit")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="calc(100% - 24px)" />
    </div>
  )
}

export const NodeComponent: UnitNodeComponent = memo(SpeakerMapNode)
