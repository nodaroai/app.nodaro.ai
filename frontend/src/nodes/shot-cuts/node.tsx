import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AlertCircle, Braces, Film, Loader2, ScanLine } from "lucide-react"
import { BaseNode } from "@/components/nodes/base-node"
import { EditableNodeLabel } from "@/components/nodes/editable-node-label"
import { HandleWithPopover } from "@/components/nodes/handle-with-popover"
import { NodeJobProgress } from "@/components/nodes/node-job-progress"
import { RunNodeButton } from "@/components/nodes/run-node-button"
import { useUnitNodeKit } from "@/components/nodes/use-unit-node-kit"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { ACCEPTS_VIDEO, FFMPEG_COLORS } from "@/lib/ffmpeg-handles"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { useT } from "@/lib/i18n"
import type { UnitNodeComponent } from "../kit"
import { formatShotTime, shotCutsResultOf, type ShotCutsData } from "./types"

/** How many shots the card lists (the rest are in the config panel and the outputs). */
const SHOWN_SHOTS = 6

// The pips render beside BaseNode (its handles are `external`), as every
// media node's do: handle-color-guard resolves their colours, and
// unit.json handles is the one declaration they must match.
function ShotCutsNode({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as ShotCutsData
  // The workflow store's services, bound to this node (the unit kit — a unit never imports the store).
  const kit = useUnitNodeKit(id)
  const credits = useModelCredits("shot-cuts", 1)
  const status = nodeData.executionStatus ?? "idle"
  const result = status === "running" ? null : shotCutsResultOf(nodeData.generatedJson)
  return (
    <div className="relative" style={{ maxWidth: "280px" }}>
      <EditableNodeLabel label={nodeData.label} icon={<ScanLine className="w-3.5 h-3.5" />} onSave={(label) => kit.updateNodeData({ label })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ScanLine className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={240}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={() => kit.run()} />}
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: "50%", left: "-29px" }, external: true },
          { id: "json", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
          { id: "firstFrames", type: "source", position: Position.Right, customStyle: { top: "50%", right: "-29px" }, external: true },
          { id: "lastFrames", type: "source", position: Position.Right, customStyle: { top: "calc(100% - 24px)", right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col gap-2 p-3" style={{ minHeight: 120 }}>
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 h-12 rounded-md bg-muted/30">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-1 rounded-md bg-muted/30 p-2 text-xs">
              <span className="font-medium">{t("node.shotCutsCount", { count: result.shotCount })}</span>
              {result.shots.slice(0, SHOWN_SHOTS).map((s) => (
                <div key={s.index} className="flex items-center gap-2">
                  {s.firstFrameUrl && <img src={s.firstFrameUrl} alt="" className="h-6 w-10 shrink-0 rounded object-cover" loading="lazy" />}
                  <span className="tabular-nums">
                    {t("node.shotCutsLine", { n: s.index + 1, start: formatShotTime(s.startSec), end: formatShotTime(s.endSec) })}
                  </span>
                </div>
              ))}
              {result.shots.length > SHOWN_SHOTS && (
                <span className="text-[11px] text-muted-foreground">{t("node.shotCutsMore", { count: result.shots.length - SHOWN_SHOTS })}</span>
              )}
            </div>
          )}

          {status === "failed" && !result && (
            <div className="flex flex-col items-center justify-center gap-1 h-12 rounded-md bg-red-500/5 text-red-500 p-2 text-xs">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">{t("node.failed")}</span>
              </div>
              {nodeData.errorMessage && (
                <p className="text-[11px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>
              )}
            </div>
          )}

          {status !== "running" && status !== "failed" && !result && (
            <div className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground" style={{ minHeight: 80, flex: 1 }}>
              <ScanLine className="w-5 h-5" />
              <span className="text-[11px] text-center px-2">{t("node.shotCutsConnect")}</span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="shot-cuts" handleId="in" type="target" position={Position.Left} label="Video" color={FFMPEG_COLORS.video} icon={<Film />} side="left" top="50%" accepts={ACCEPTS_VIDEO} />
      <HandleWithPopover nodeId={id} nodeType="shot-cuts" handleId="json" type="source" position={Position.Right} label={t("node.shotCutsShots")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="shot-cuts" handleId="firstFrames" type="source" position={Position.Right} label={t("node.shotCutsFirstFrames")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="50%" />
      <HandleWithPopover nodeId={id} nodeType="shot-cuts" handleId="lastFrames" type="source" position={Position.Right} label={t("node.shotCutsLastFrames")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="calc(100% - 24px)" />
    </div>
  )
}

export const NodeComponent: UnitNodeComponent = memo(ShotCutsNode)
