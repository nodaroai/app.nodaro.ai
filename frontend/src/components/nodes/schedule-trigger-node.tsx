"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Clock, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { ScheduleTriggerData } from "@/types/nodes"

const HANDLES = [
  { id: "in",      type: "target" as const, position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
  { id: "payload", type: "source" as const, position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
] as const

function ScheduleTriggerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ScheduleTriggerData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const displayText = nodeData.cron || nodeData.interval || "Configure schedule..."

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Clock className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Clock className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={HANDLES}
      >
        <div className="p-3">
          <p className="text-sm text-muted-foreground line-clamp-2 break-words">
            {displayText}
          </p>
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="schedule-trigger" handleId="in"      type="target" position={Position.Left}  label="URL"     color="#38BDF8" icon={<Clock />} side="left"  top="calc(100% - 24px)" />
      <HandleWithPopover nodeId={id} nodeType="schedule-trigger" handleId="payload" type="source" position={Position.Right} label="Payload" color="#38BDF8" icon={<Type />}  side="right" top="24px" />
    </div>
  )
}

export const ScheduleTriggerNode = memo(ScheduleTriggerNodeComponent)
