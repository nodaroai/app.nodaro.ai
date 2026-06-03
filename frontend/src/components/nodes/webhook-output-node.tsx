"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Webhook, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WebhookOutputData, WebhookParam } from "@/types/nodes"

const SOURCE_HANDLE = { id: "out", type: "source" as const, position: Position.Right, customStyle: { top: '24px', right: '-29px' }, external: true }

function buildHandles(params: ReadonlyArray<WebhookParam>) {
  if (params.length === 0) {
    return [
      { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
      SOURCE_HANDLE,
    ]
  }

  const startPct = 42
  const endPct = 88
  const targetHandles = params.map((p, i) => {
    const pct = params.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (params.length - 1)) * (endPct - startPct))
    return {
      id: p.id,
      type: "target" as const,
      position: Position.Left,
      label: p.name,
      customStyle: { top: `${pct}%`, left: '-29px' },
      external: true as const,
    }
  })
  return [...targetHandles, SOURCE_HANDLE]
}

function WebhookOutputNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as WebhookOutputData
  const updateNodeInternals = useUpdateNodeInternals()
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"

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
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
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
      {handles.filter(h => h.type === "target").map((h) => (
        <HandleWithPopover key={h.id} nodeId={id} nodeType="webhook-output" handleId={h.id} type="target" position={Position.Left} label={(h as { label?: string }).label ?? h.id} color={HANDLE_COLORS.approve} icon={<Type />} side="left" top={(h.customStyle?.top as string) ?? 'calc(100% - 24px)'} />
      ))}
      <HandleWithPopover nodeId={id} nodeType="webhook-output" handleId="out" type="source" position={Position.Right} label="Response" color={HANDLE_COLORS.approve} icon={<Webhook />} side="right" top="24px" />
    </div>
  )
}

export const WebhookOutputNode = memo(WebhookOutputNodeComponent)
