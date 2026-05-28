"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Webhook, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WebhookTriggerData, WebhookParam } from "@/types/nodes"

const TARGET_HANDLE = { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true }

function buildHandles(params: ReadonlyArray<WebhookParam>) {
  if (params.length === 0) {
    return [
      TARGET_HANDLE,
      { id: "payload", type: "source" as const, position: Position.Right, customStyle: { top: '24px', right: '-29px' }, external: true },
    ]
  }

  const startPct = 30
  const endPct = 80
  const sourceHandles = params.map((p, i) => {
    const pct = params.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (params.length - 1)) * (endPct - startPct))
    return {
      id: p.id,
      type: "source" as const,
      position: Position.Right,
      label: p.name,
      top: `${pct}%`,
      customStyle: { top: `${pct}%`, right: '-29px' },
      external: true,
    }
  })
  return [TARGET_HANDLE, ...sourceHandles]
}

function WebhookTriggerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as WebhookTriggerData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()

  const params = nodeData.params ?? []
  const handles = useMemo(() => buildHandles(params), [params])

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, params.length, updateNodeInternals])

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Webhook className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Webhook className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={handles}
      >
        <div className="p-3" style={{ minHeight: params.length > 1 ? `${params.length * 22 + 8}px` : undefined }}>
          <p className="text-sm text-muted-foreground line-clamp-2 break-all">
            {nodeData.webhookUrl || "Configure webhook..."}
          </p>
          {params.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              {params.length} param{params.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="webhook-trigger" handleId="in" type="target" position={Position.Left} label="URL" color="#38BDF8" icon={<Webhook />} side="left" top="calc(100% - 24px)" />
      {handles.filter(h => h.type === "source").map((h) => (
        <HandleWithPopover key={h.id} nodeId={id} nodeType="webhook-trigger" handleId={h.id} type="source" position={Position.Right} label={(h as { label?: string }).label ?? h.id} color="#38BDF8" icon={<Type />} side="right" top={h.customStyle?.top as string ?? '50%'} />
      ))}
    </div>
  )
}

export const WebhookTriggerNode = memo(WebhookTriggerNodeComponent)
