"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { HardDrive } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SaveToStorageData } from "@/types/nodes"

function SaveToStorageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SaveToStorageData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<HardDrive className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<HardDrive className="h-4 w-4" />}
        category="output"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={[
          { id: "in",  type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "out", type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
        ]}
      >
        <p className="text-muted-foreground truncate max-w-[180px]">
          {nodeData.format} ({nodeData.quality})
        </p>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="save-to-storage" handleId="in"  type="target" position={Position.Left}  label="Input"  color={HANDLE_COLORS.approve} icon={<HardDrive />} side="left"  top="calc(100% - 24px)" />
      <HandleWithPopover nodeId={id} nodeType="save-to-storage" handleId="out" type="source" position={Position.Right} label="Output" color={HANDLE_COLORS.approve} icon={<HardDrive />} side="right" top="24px" />
    </div>
  )
}

export const SaveToStorageNode = memo(SaveToStorageNodeComponent)
