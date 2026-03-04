"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Webhook } from "lucide-react"
import { BaseNode } from "./base-node"
import type { WebhookTriggerData, WebhookParam } from "@/types/nodes"

function buildHandles(params: ReadonlyArray<WebhookParam>) {
  if (params.length === 0) {
    return [
      { id: "payload", type: "source" as const, position: Position.Right, label: "Payload" },
    ]
  }

  const startPct = 42
  const endPct = 88
  return params.map((p, i) => {
    const pct = params.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (params.length - 1)) * (endPct - startPct))
    return {
      id: p.id,
      type: "source" as const,
      position: Position.Right,
      label: p.name,
      top: `${pct}%`,
    }
  })
}

function WebhookTriggerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as WebhookTriggerData
  const updateNodeInternals = useUpdateNodeInternals()

  const params = nodeData.params ?? []
  const handles = useMemo(() => buildHandles(params), [params])

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, params.length, updateNodeInternals])

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Webhook className="h-4 w-4" />}
      category="input"
      credits={0}
      selected={selected}
      handles={handles}
    >
      <p className="text-sm text-muted-foreground line-clamp-2 break-all">
        {nodeData.webhookUrl || "Configure webhook..."}
      </p>
      {params.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-1">
          {params.length} param{params.length !== 1 ? "s" : ""}
        </p>
      )}
    </BaseNode>
  )
}

export const WebhookTriggerNode = memo(WebhookTriggerNodeComponent)
