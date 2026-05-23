"use client"

import { memo, useCallback, useMemo, useState } from "react"
import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
} from "@xyflow/react"
import { groupHandleId, presentTypes } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useStaleHandleCleanup } from "@/hooks/use-stale-handle-cleanup"
import { AGGREGATE_HANDLE_COLORS } from "@/components/nodes/handle-colors"
import { computeGroupBuckets } from "@/components/editor/workflow-editor/execution-graph"
import type { GroupNodeData, WorkflowNode } from "@/types/nodes"

function GroupNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GroupNodeData
  const allNodes = useWorkflowStore((s) => s.nodes) as WorkflowNode[]
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(nodeData.label)

  const node = useMemo(() => allNodes.find((n) => n.id === id), [allNodes, id])
  const buckets = useMemo(
    () =>
      node
        ? computeGroupBuckets(node, allNodes)
        : { text: [], image: [], video: [], audio: [] },
    [node, allNodes],
  )
  const types = useMemo(() => presentTypes(buckets), [buckets])

  useStaleHandleCleanup(id, types)

  const commitLabel = useCallback(() => {
    const next = labelDraft.trim() || "New group"
    updateNodeData(id, { label: next })
    setEditing(false)
  }, [id, labelDraft, updateNodeData])

  const cancelLabel = useCallback(() => {
    setLabelDraft(nodeData.label)
    setEditing(false)
  }, [nodeData.label])

  const enterEditMode = useCallback(() => {
    setLabelDraft(nodeData.label)
    setEditing(true)
  }, [nodeData.label])

  return (
    <div
      className="group-node relative rounded-lg border border-[#2D2D2D] bg-[#1E1E1E]/40"
      style={{ width: "100%", height: "100%" }}
    >
      <NodeResizer
        isVisible={!!selected}
        minWidth={240}
        minHeight={160}
        lineClassName="!border-[#ff0073]"
        handleClassName="!w-2.5 !h-2.5 !bg-[#ff0073] !border-none !rounded-sm"
      />

      <div className="title-bar border-b border-[#2D2D2D] px-3 py-2">
        {editing ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation()
                commitLabel()
              } else if (e.key === "Escape") {
                e.stopPropagation()
                cancelLabel()
              }
            }}
            className="w-full bg-transparent text-sm font-medium text-foreground outline-none dark:text-white"
          />
        ) : (
          <div
            className="cursor-text text-sm font-medium text-foreground dark:text-white"
            onDoubleClick={enterEditMode}
            title="Double-click to rename"
          >
            {nodeData.label || "New group"}
          </div>
        )}
      </div>

      {types.length === 0 && (
        <div className="empty-hint p-4 text-center text-xs text-muted-foreground">
          Drop nodes here
        </div>
      )}

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

export const GroupNode = memo(GroupNodeComponent)
