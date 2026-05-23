"use client"

import { memo, useMemo } from "react"
import {
  Handle,
  Position,
  type NodeProps,
} from "@xyflow/react"
import {
  COLLECT_IN_HANDLE,
  groupHandleId,
  isCollectInEdge,
  presentTypes,
} from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useStaleHandleCleanup } from "@/hooks/use-stale-handle-cleanup"
import { AGGREGATE_HANDLE_COLORS } from "@/components/nodes/handle-colors"
import { computeCollectBuckets } from "@/components/editor/workflow-editor/execution-graph"
import type { CollectNodeData, WorkflowNode, WorkflowEdge } from "@/types/nodes"

function CollectNodeComponent({ id }: NodeProps) {
  const allNodes = useWorkflowStore((s) => s.nodes) as WorkflowNode[]
  const allEdges = useWorkflowStore((s) => s.edges) as WorkflowEdge[]

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

  return (
    <div className="collect-node rounded-lg border border-[#2D2D2D] bg-[#1E1E1E] p-3 min-w-[160px]">
      <Handle type="target" position={Position.Left} id={COLLECT_IN_HANDLE} />
      <div className="mb-2 text-sm font-medium text-foreground dark:text-white">
        Collect
      </div>
      <div className="text-xs text-muted-foreground">
        {incoming.length === 0
          ? "Connect inputs"
          : `${incoming.length} connection${incoming.length === 1 ? "" : "s"}`}
      </div>
      {types.map((t, idx) => (
        <Handle
          key={groupHandleId(t)}
          type="source"
          position={Position.Right}
          id={groupHandleId(t)}
          style={{
            top: `${20 + idx * 24}px`,
            background: AGGREGATE_HANDLE_COLORS[t],
          }}
          aria-label={groupHandleId(t)}
        />
      ))}
    </div>
  )
}

export const CollectNode = memo(CollectNodeComponent)

// Re-export the data type for convenience.
export type { CollectNodeData }
