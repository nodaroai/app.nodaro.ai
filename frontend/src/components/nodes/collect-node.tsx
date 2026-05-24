"use client"

import { memo, useMemo } from "react"
import {
  Handle,
  Position,
  type NodeProps,
} from "@xyflow/react"
import { Layers, Combine } from "lucide-react"
import {
  COLLECT_IN_HANDLE,
  groupHandleId,
  isCollectInEdge,
  presentTypes,
} from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useStaleHandleCleanup } from "@/hooks/use-stale-handle-cleanup"
import { AggregateHandleIcon, HandleIcon } from "@/components/nodes/handle-icon"
import { EditableNodeLabel } from "@/components/nodes/editable-node-label"
import { computeCollectBuckets } from "@/components/editor/workflow-editor/execution-graph"
import type { CollectNodeData, WorkflowNode, WorkflowEdge } from "@/types/nodes"

function CollectNodeComponent({ id, data }: NodeProps) {
  const nodeData = data as CollectNodeData
  const allNodes = useWorkflowStore((s) => s.nodes) as WorkflowNode[]
  const allEdges = useWorkflowStore((s) => s.edges) as WorkflowEdge[]
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const node = useMemo(() => allNodes.find((n) => n.id === id), [allNodes, id])
  const buckets = useMemo(
    () =>
      node
        ? computeCollectBuckets(node, allNodes, allEdges)
        : { text: [], image: [], video: [], audio: [] },
    [node, allNodes, allEdges],
  )
  const types = useMemo(() => presentTypes(buckets), [buckets])
  const incoming = useMemo(
    () => allEdges.filter((e) => e.target === id && isCollectInEdge(e)),
    [allEdges, id],
  )

  useStaleHandleCleanup(id, types)

  const minHeight = Math.max(96, 24 + types.length * 30 + 16)

  return (
    <div
      className="collect-node relative rounded-lg border border-[#2D2D2D] bg-[#1E1E1E] p-3 min-w-[160px]"
      style={{ minHeight }}
    >
      <EditableNodeLabel
        label={nodeData?.label || "Collect"}
        icon={<Layers className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      {/* Input handle — transparent hit-target + icon circle at the left edge. */}
      <Handle
        type="target"
        position={Position.Left}
        id={COLLECT_IN_HANDLE}
        isConnectable
        aria-label={COLLECT_IN_HANDLE}
        className="!w-7 !h-7 !bg-transparent !border-0 touch-manipulation"
        style={{ top: "24px", left: "-29px", transform: "translateY(-50%)", zIndex: 30 }}
      />
      <HandleIcon icon={<Combine />} color="steel" side="left" top="24px" />
      <div className="text-xs text-muted-foreground">
        {incoming.length === 0
          ? "Connect inputs"
          : `${incoming.length} connection${incoming.length === 1 ? "" : "s"}`}
      </div>
      {types.map((t, idx) => (
        <AggregateHandleIcon
          key={groupHandleId(t)}
          id={groupHandleId(t)}
          type={t}
          top={`${24 + idx * 30}px`}
        />
      ))}
    </div>
  )
}

export const CollectNode = memo(CollectNodeComponent)

// Re-export the data type for convenience.
export type { CollectNodeData }
