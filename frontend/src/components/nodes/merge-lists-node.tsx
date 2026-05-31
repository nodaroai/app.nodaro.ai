"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { GitMerge, FileText, Braces } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAutoExecute } from "@/hooks/use-auto-execute"
import type { MergeListsNodeData } from "@/types/nodes"
import { isValidMergeListsConnection, DATA_HANDLE_COLORS } from "@/lib/data-handles"

const ACCEPTS_IN = (t: string) => isValidMergeListsConnection("in", t)

function MergeListsNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MergeListsNodeData
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"

  useAutoExecute(id, data as Record<string, unknown>)

  const listResults = nodeData.__listResults ?? nodeData.listResults
  const itemCount = listResults?.length ?? 0
  const hasResult = status === "completed" && listResults !== undefined
  const dedupeOn = nodeData.deduplicate === true

  return (
    <div className="relative" style={{ maxWidth: "220px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<GitMerge className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<GitMerge className="h-4 w-4" />}
        category="processing"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runFromHere?.(nid)} runFromHere />
        }
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: "calc(100% - 20px)", left: "-29px" }, external: true },
          { id: "out", type: "source", position: Position.Right, customStyle: { top: "20px", right: "-29px" }, external: true },
        ]}
      >
        <div className="flex flex-col gap-1">
          {hasResult ? (
            <div className="w-full rounded-md bg-muted/30 p-2">
              <p className="text-xs text-foreground/80">
                {itemCount} item{itemCount === 1 ? "" : "s"} merged
              </p>
              <span className="text-[10px] text-muted-foreground mt-0.5 block">
                {dedupeOn ? "Deduplicated" : "Raw concat"}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-12 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <FileText className="w-5 h-5" />
              <span className="text-[10px] mt-0.5">
                {dedupeOn ? "Deduplicated" : "Raw concat"}
              </span>
            </div>
          )}
        </div>
      </BaseNode>
      {/* `orderMatters` because concat semantics depend on edge order — the
          user wires List A then List B and expects A's items first. */}
      <HandleWithPopover nodeId={id} nodeType="merge-lists" handleId="in"  type="target" position={Position.Left}  label="Lists"  color={DATA_HANDLE_COLORS.list} icon={<Braces />}   side="left"  top="calc(100% - 20px)" orderMatters accepts={ACCEPTS_IN} />
      <HandleWithPopover nodeId={id} nodeType="merge-lists" handleId="out" type="source" position={Position.Right} label="Merged" color={DATA_HANDLE_COLORS.list} icon={<FileText />} side="right" top="20px" />
    </div>
  )
}

export const MergeListsNode = memo(MergeListsNodeComponent)
