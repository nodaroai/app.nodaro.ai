"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Webhook } from "lucide-react"
import { BaseNode } from "./base-node"
import type { WebhookTriggerData } from "@/types/nodes"

function WebhookTriggerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as WebhookTriggerData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Webhook className="h-4 w-4" />}
      category="input"
      credits={0}
      selected={selected}
      handles={[
        { id: "payload", type: "source", position: Position.Right, label: "Payload" },
      ]}
    >
      <p className="text-sm text-muted-foreground line-clamp-2 break-all">
        {nodeData.webhookUrl || "Configure webhook..."}
      </p>
    </BaseNode>
  )
}

export const WebhookTriggerNode = memo(WebhookTriggerNodeComponent)
