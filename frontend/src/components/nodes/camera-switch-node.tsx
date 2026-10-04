"use client"

import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { SwitchCamera, Braces, Loader2, AlertCircle } from "lucide-react"
import { JsonTree, type JsonValue } from "@/components/ui/json-tree"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { ACCEPTS_JSON, DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { CAMERA_SWITCH_CREDIT_ID } from "@nodaro/shared"
import { useT } from "@/lib/i18n"
import type { CameraSwitchNodeData } from "@/types/nodes"

/** Cuts per camera in a switched edit: [sourceId, cuts][] in first-use order. */
function cutsPerCamera(edl: unknown): Array<[string, number]> {
  const segments = (edl as { segments?: Array<{ video?: unknown }> } | null | undefined)?.segments
  if (!Array.isArray(segments)) return []
  const counts = new Map<string, number>()
  let prev: string | undefined
  for (const seg of segments) {
    const video = typeof seg?.video === "string" ? seg.video : undefined
    if (video && video !== prev) counts.set(video, (counts.get(video) ?? 0) + 1)
    prev = video
  }
  return [...counts]
}

function CameraSwitchNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as CameraSwitchNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const nodes = useWorkflowStore((s) => s.nodes)
  const status = nodeData.executionStatus ?? "idle"
  const edl = nodeData.generatedJson?.edl
  const credits = useModelCredits(CAMERA_SWITCH_CREDIT_ID, 10)
  // Show each camera by its canvas node's label (the EDL source id is the node id).
  const perCamera = useMemo(() => {
    const labelOf = (nodeId: string) => (nodes.find((n) => n.id === nodeId)?.data as { label?: string } | undefined)?.label ?? nodeId
    return cutsPerCamera(edl).map(([sourceId, cuts]) => [labelOf(sourceId), cuts] as const)
  }, [edl, nodes])

  return (
    <div className="relative max-w-[240px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<SwitchCamera className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<SwitchCamera className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        minWidth={240}
        hideHeader
        topToolbarContent={<NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />}
        handles={[
          { id: "edl",        type: "target", position: Position.Left,  customStyle: { top: "24px", left: "-29px" },  external: true },
          { id: "transcript", type: "target", position: Position.Left,  customStyle: { top: "52px", left: "-29px" },  external: true },
          { id: "edl",        type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
          { id: "transcript", type: "source", position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col gap-2 p-3 h-full" style={{ minHeight: 140 }}>
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

          {status !== "running" && edl !== undefined && edl !== null && (
            <div className="flex flex-col gap-1.5 flex-1 min-h-0">
              {perCamera.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {perCamera.map(([name, cuts]) => (
                    <span key={name} className="text-[10px] rounded bg-muted px-1.5 py-0.5 tabular-nums">
                      {t("node.cameraSwitchCuts", { camera: name, count: cuts })}
                    </span>
                  ))}
                </div>
              )}
              <div className="rounded-md border bg-muted/30 flex-1 min-h-0 overflow-auto p-1.5 nowheel nodrag nopan scrollbar-reveal" style={{ maxHeight: 180 }}>
                <JsonTree value={edl as JsonValue} />
              </div>
            </div>
          )}

          {status !== "running" && status !== "failed" && (edl === undefined || edl === null) && (
            <div
              className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40"
              style={{ minHeight: 110, flex: 1 }}
            >
              <SwitchCamera className="w-6 h-6" />
              <span className="text-[10px] text-center">{t("node.cameraSwitchConnect")}</span>
            </div>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="camera-switch" handleId="edl"        type="target" position={Position.Left}  label={t("node.cameraSwitchEdlIn")}   color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left"  top="24px" accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="camera-switch" handleId="transcript" type="target" position={Position.Left}  label={t("node.transcript")}         color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="left"  top="52px" accepts={ACCEPTS_JSON} />
      <HandleWithPopover nodeId={id} nodeType="camera-switch" handleId="edl"        type="source" position={Position.Right} label={t("node.cameraSwitchEdlOut")}  color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="camera-switch" handleId="transcript" type="source" position={Position.Right} label={t("node.cameraSwitchTranscriptOut")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="52px" />
    </div>
  )
}

export const CameraSwitchNode = memo(CameraSwitchNodeComponent)
