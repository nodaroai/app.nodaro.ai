"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Clock } from "lucide-react"
import { BaseNode } from "./base-node"
import type { ScheduleTriggerData } from "@/types/nodes"

function ScheduleTriggerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ScheduleTriggerData

  const displayText = nodeData.cron || nodeData.interval || "Configure schedule..."

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Clock className="h-4 w-4" />}
      category="input"
      credits={0}
      selected={selected}
      handles={[
        { id: "payload", type: "source", position: Position.Right, label: "Payload" },
      ]}
    >
      <p className="text-sm text-muted-foreground line-clamp-2 break-words">
        {displayText}
      </p>
    </BaseNode>
  )
}

export const ScheduleTriggerNode = memo(ScheduleTriggerNodeComponent)
