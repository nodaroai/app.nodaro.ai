"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Webhook } from "lucide-react"
import { BaseNode } from "./base-node"
import type { WebhookOutputData } from "@/types/nodes"

function WebhookOutputNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as WebhookOutputData

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Webhook className="h-4 w-4" />}
      category="output"
      credits={0}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
      ]}
    >
      <p className="text-muted-foreground truncate max-w-[180px]">
        {nodeData.webhookId || "Set webhook..."}
      </p>
    </BaseNode>
  )
}

export const WebhookOutputNode = memo(WebhookOutputNodeComponent)
