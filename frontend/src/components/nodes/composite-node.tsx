import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Layers, Film, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { CompositeData } from "@/types/nodes"

function CompositeNodeComponent({ id, data, selected }: NodeProps) {
  const currentNodeData = useWorkflowStore((s) => s.nodes.find((n) => n.id === id)?.data) as CompositeData | undefined
  const nodeData = currentNodeData ?? (data as CompositeData)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const isRunning = status === "running"
  const compositePlan = nodeData.compositePlan as Record<string, unknown> | undefined

  const layerCount = compositePlan
    ? ((compositePlan.layers as unknown[])?.length ?? 0)
    : 0

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Layers className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Layers className="h-4 w-4" />}
      category="processing"
      selected={selected}
      isRunning={isRunning}
      hideHeader
      minWidth={220}
      toolbarActions={
        !isRunning ? (
          <RunNodeButton nodeId={id} credits={0} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      handles={[
        { id: "video1", type: "target", position: Position.Left, customStyle: { top: '20%', left: '-29px' }, hideHandle: true },
        { id: "video2", type: "target", position: Position.Left, customStyle: { top: '40%', left: '-29px' }, hideHandle: true },
        { id: "video3", type: "target", position: Position.Left, customStyle: { top: '60%', left: '-29px' }, hideHandle: true },
        { id: "video4", type: "target", position: Position.Left, customStyle: { top: '80%', left: '-29px' }, hideHandle: true },
        { id: "composition", type: "source", position: Position.Right, customStyle: { top: '50%', right: '-29px' }, hideHandle: true },
      ]}
    >
      <div className="flex flex-col gap-1">
        {isRunning && (
          <div className="flex items-center justify-center h-16 rounded-md bg-muted/30">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isRunning && compositePlan && (
          <div className="flex items-center justify-center h-16 rounded-md bg-[#475569]/10 border border-[#475569]/30">
            <div className="text-center">
              <div className="text-sm font-medium text-[#475569]">
                {layerCount} layer{layerCount !== 1 ? "s" : ""}
              </div>
              <div className="text-[10px] text-muted-foreground">{nodeData.durationSeconds}s</div>
            </div>
          </div>
        )}

        {status === "failed" && !compositePlan && (
          <div className="flex flex-col items-center justify-center gap-1 h-16 rounded-md bg-red-500/5 text-red-500 p-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">Failed</span>
            </div>
            {nodeData.errorMessage && (
              <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                {nodeData.errorMessage}
              </p>
            )}
          </div>
        )}

        {!isRunning && !compositePlan && status !== "failed" && (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Layers className="w-5 h-5" />
          </div>
        )}

        <div className="text-muted-foreground text-[10px] line-clamp-1">
          {nodeData.layers.length > 0
            ? `${nodeData.layers.length} layer${nodeData.layers.length !== 1 ? "s" : ""} configured`
            : "Connect videos to compose"}
        </div>
      </div>
    </BaseNode>
    <HandleIcon icon={<Film />} color="steel" side="left" top="20%" />
    <HandleIcon icon={<Film />} color="steel" side="left" top="40%" />
    <HandleIcon icon={<Film />} color="steel" side="left" top="60%" />
    <HandleIcon icon={<Film />} color="steel" side="left" top="80%" />
    <HandleIcon icon={<Film />} color="steel" />
    </div>
  )
}

export const CompositeNode = memo(CompositeNodeComponent)
