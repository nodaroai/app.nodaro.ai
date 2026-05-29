"use client"

import { memo, useCallback, useMemo, useState } from "react"
import {
  NodeResizer,
  type NodeProps,
} from "@xyflow/react"
import { Boxes } from "lucide-react"
import { groupHandleId, presentTypes } from "@nodaro/shared"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useStaleHandleCleanup } from "@/hooks/use-stale-handle-cleanup"
import { AggregateHandleIcon } from "@/components/nodes/handle-icon"
import { computeGroupBuckets } from "@/components/editor/workflow-editor/execution-graph"
import type { GroupNodeData, WorkflowNode } from "@/types/nodes"

function GroupNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GroupNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(nodeData.label)

  // computeGroupBuckets traverses this group's children (their parentId,
  // type, position.y and output values). Subscribing to the whole `s.nodes`
  // array re-rendered the group on every unrelated mutation. Instead derive a
  // PRIMITIVE fingerprint that changes only when a child's membership /
  // ordering / output actually changes; the heavy bucket computation reads
  // live nodes from getState() keyed on that fingerprint.
  const childFingerprint = useWorkflowStore(
    useShallow((s) => {
      let fp = ""
      for (const n of s.nodes) {
        if (n.parentId !== id) continue
        fp += `${n.id}\x01${n.type ?? ""}\x01${n.position?.y ?? 0}\x01${JSON.stringify(n.data ?? {})}\x02`
      }
      return fp
    }),
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const buckets = useMemo(() => {
    const { nodes } = useWorkflowStore.getState()
    const node = (nodes as WorkflowNode[]).find((n) => n.id === id)
    return node
      ? computeGroupBuckets(node, nodes as WorkflowNode[])
      : { text: [], image: [], video: [], audio: [] }
  }, [id, childFingerprint])
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

      {/* Floating label above the node — matches the standard node title location. */}
      <div
        className={`absolute -top-6 left-0 flex items-center gap-1.5 text-[12px] font-medium text-foreground/70 dark:text-white/70 ${editing ? "nopan nodrag nowheel" : "select-none"}`}
      >
        <Boxes className="w-3.5 h-3.5" />
        {editing ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation()
                commitLabel()
              } else if (e.key === "Escape") {
                e.stopPropagation()
                cancelLabel()
              }
            }}
            className="bg-white border border-border rounded-md px-2 py-0.5 text-foreground outline-none min-w-[8rem] max-w-[20rem] text-[12px] focus:ring-1 focus:ring-[#ff0073]/40 focus:border-[#ff0073] dark:bg-zinc-900 dark:border-white/20 dark:text-white/90"
          />
        ) : (
          <span
            className="truncate cursor-text hover:text-foreground dark:hover:text-white/90 transition-colors"
            onDoubleClick={enterEditMode}
            onMouseDown={(e) => e.stopPropagation()}
            title="Double-click to rename"
          >
            {nodeData.label || "New group"}
          </span>
        )}
      </div>

      {types.length === 0 && (
        <div className="empty-hint p-4 text-center text-xs text-muted-foreground">
          Drop nodes here
        </div>
      )}

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

export const GroupNode = memo(GroupNodeComponent)
