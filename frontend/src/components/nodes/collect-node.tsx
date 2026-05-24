"use client"

import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Layers, Combine } from "lucide-react"
import {
  COLLECT_IN_HANDLE,
  groupHandleId,
  isCollectInEdge,
  presentTypes,
} from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useStaleHandleCleanup } from "@/hooks/use-stale-handle-cleanup"
import { AggregateHandleVisual, HandleIcon } from "@/components/nodes/handle-icon"
import { EditableNodeLabel } from "@/components/nodes/editable-node-label"
import { BaseNode, type HandleConfig } from "@/components/nodes/base-node"
import { computeCollectBuckets } from "@/components/editor/workflow-editor/execution-graph"
import type { CollectNodeData, WorkflowNode, WorkflowEdge } from "@/types/nodes"

function CollectNodeComponent({ id, data, selected }: NodeProps) {
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

  // Functional handles live in BaseNode's `handles` array (hidden); the colored
  // circles are drawn separately as visual-only overlays at the same anchors.
  const handles = useMemo<ReadonlyArray<HandleConfig>>(
    () => [
      {
        id: COLLECT_IN_HANDLE,
        type: "target",
        position: Position.Left,
        hideHandle: true,
        customStyle: { top: "24px", left: "-29px" },
      },
      ...types.map((t, idx) => ({
        id: groupHandleId(t),
        type: "source" as const,
        position: Position.Right,
        hideHandle: true,
        customStyle: { top: `${24 + idx * 30}px`, right: "-29px" },
      })),
    ],
    [types],
  )

  const label = nodeData?.label || "Collect"

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={label}
        icon={<Layers className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={label}
        icon={<Layers className="h-4 w-4" />}
        category="processing"
        selected={selected}
        minWidth={180}
        hideHeader
        handles={handles}
      >
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {incoming.length === 0
            ? "Connect inputs"
            : `${incoming.length} connection${incoming.length === 1 ? "" : "s"}`}
        </div>
      </BaseNode>
      {/* Visual handle circles — the functional <Handle>s live in BaseNode. */}
      <HandleIcon icon={<Combine />} color="steel" side="left" top="24px" />
      {types.map((t, idx) => (
        <AggregateHandleVisual
          key={groupHandleId(t)}
          type={t}
          top={`${24 + idx * 30}px`}
          side="right"
        />
      ))}
    </div>
  )
}

export const CollectNode = memo(CollectNodeComponent)

// Re-export the data type for convenience.
export type { CollectNodeData }
