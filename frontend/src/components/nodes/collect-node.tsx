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
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useStaleHandleCleanup } from "@/hooks/use-stale-handle-cleanup"
import { AggregateHandleVisual } from "@/components/nodes/handle-icon"
import { HandleWithPopover, HANDLE_COLORS } from "@/components/nodes/handle-with-popover"
import { EditableNodeLabel } from "@/components/nodes/editable-node-label"
import { BaseNode, type HandleConfig } from "@/components/nodes/base-node"
import { computeCollectBuckets } from "@/components/editor/workflow-editor/execution-graph"
import type { CollectNodeData, WorkflowNode, WorkflowEdge } from "@/types/nodes"

function CollectNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CollectNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  // computeCollectBuckets reads this node's `data.order`, its incoming `in`
  // edges, and each upstream source's type + output value (which changes
  // during polling). Subscribing to whole `s.nodes` / `s.edges` re-rendered
  // the collect node on every unrelated mutation. Instead derive a PRIMITIVE
  // fingerprint (incoming edges + source type/data + this node's order) plus
  // the incoming count; the heavy bucket computation reads live arrays from
  // getState() keyed on the fingerprint.
  const { collectFingerprint, incomingCount } = useWorkflowStore(
    useShallow((s) => {
      const self = s.nodes.find((n) => n.id === id)
      const order = ((self?.data as { order?: string[] } | undefined)?.order) ?? []
      let fp = `order:${order.join(",")}\x03`
      let count = 0
      for (const e of s.edges) {
        if (e.target !== id || !isCollectInEdge(e)) continue
        count++
        const src = s.nodes.find((n) => n.id === e.source)
        fp += `${e.id}\x01${e.source}\x01${e.sourceHandle ?? ""}\x01${src?.type ?? ""}\x01${JSON.stringify(src?.data ?? {})}\x02`
      }
      return { collectFingerprint: fp, incomingCount: count }
    }),
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const buckets = useMemo(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    const node = (nodes as WorkflowNode[]).find((n) => n.id === id)
    return node
      ? computeCollectBuckets(node, nodes as WorkflowNode[], edges as WorkflowEdge[])
      : { text: [], image: [], video: [], audio: [] }
  }, [id, collectFingerprint])
  const types = useMemo(() => presentTypes(buckets), [buckets])

  useStaleHandleCleanup(id, types)

  // Functional handles live in BaseNode's `handles` array (hidden); the colored
  // circles are drawn separately as visual-only overlays at the same anchors.
  const handles = useMemo<ReadonlyArray<HandleConfig>>(
    () => [
      {
        id: COLLECT_IN_HANDLE,
        type: "target",
        position: Position.Left,
        customStyle: { top: "24px", left: "-29px" },
        external: true,
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
          {incomingCount === 0
            ? "Connect inputs"
            : `${incomingCount} connection${incomingCount === 1 ? "" : "s"}`}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="collect" handleId={COLLECT_IN_HANDLE} type="target" position={Position.Left} label="Inputs" color={HANDLE_COLORS.control} icon={<Combine />} side="left" top="24px" />
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
