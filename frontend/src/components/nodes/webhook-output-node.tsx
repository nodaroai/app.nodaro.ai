"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Webhook } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WebhookOutputData, WebhookParam } from "@/types/nodes"

function buildHandles(params: ReadonlyArray<WebhookParam>) {
  if (params.length === 0) {
    return [
      { id: "in", type: "target" as const, position: Position.Left, label: "Input" },
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
      type: "target" as const,
      position: Position.Left,
      label: p.name,
      top: `${pct}%`,
    }
  })
}

function WebhookOutputNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as WebhookOutputData
  const updateNodeInternals = useUpdateNodeInternals()
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const params = nodeData.params ?? []
  const handles = useMemo(() => buildHandles(params), [params])

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, params.length, updateNodeInternals])

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Webhook className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Webhook className="h-4 w-4" />}
        category="output"
        credits={0}
        selected={selected}
        hideHeader
        minWidth={220}
        handles={handles}
      >
      <p className="text-muted-foreground truncate max-w-[180px]">
        {nodeData.url || "Set webhook URL..."}
      </p>
      {params.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-1">
          {params.length} param{params.length !== 1 ? "s" : ""}
        </p>
      )}
      </BaseNode>
    </div>
  )
}

export const WebhookOutputNode = memo(WebhookOutputNodeComponent)
