"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { LogIn } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"

const PORT_COLOR: Record<string, string> = {
  text: "#22D3EE", image: "#22D3EE", video: "#A78BFA", audio: "#FCD34D", any: "#475569",
}
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SubWorkflowInputData, SubWorkflowPort } from "@/types/nodes"

const MEDIA_TYPE_COLORS: Record<string, string> = {
  text: "bg-blue-400",
  image: "bg-emerald-400",
  video: "bg-purple-400",
  audio: "bg-amber-400",
  any: "bg-gray-400",
}

const TARGET_HANDLE = { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true, mediaType: "any" as const }

function buildHandles(ports: ReadonlyArray<SubWorkflowPort>) {
  if (ports.length === 0) {
    return [TARGET_HANDLE, { id: "out", type: "source" as const, position: Position.Right, label: "Out", top: "24px", customStyle: { top: '24px', right: '-29px' }, external: true, mediaType: "any" as const }]
  }

  const startPct = 42
  const endPct = 88
  const sourceHandles = ports.map((port, i) => {
    const pct = ports.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (ports.length - 1)) * (endPct - startPct))
    return {
      id: port.id,
      type: "source" as const,
      position: Position.Right,
      label: port.name,
      top: `${pct}%`,
      mediaType: port.mediaType,
      customStyle: { top: `${pct}%`, right: '-29px' },
      external: true,
    }
  })
  return [TARGET_HANDLE, ...sourceHandles]
}

function SubWorkflowInputNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SubWorkflowInputData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()

  const ports = nodeData.ports ?? []
  // Stable key for useMemo — serialized port IDs (same pattern as loop-node columns)
  const portKey = ports.map(p => `${p.id}:${p.name}`).join(",")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handles = useMemo(() => buildHandles(ports), [portKey])

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, ports.length, updateNodeInternals])

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<LogIn className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<LogIn className="h-4 w-4" />}
        category="processing"
        credits={0}
        selected={selected}
        hideHeader
        minWidth={220}
        handles={handles}
        minHeight={Math.max(100, ports.length * 36 + 50)}
      >
        <div style={{ minHeight: `${Math.max(40, ports.length * 28 + 8)}px` }}>
          {ports.length === 0 ? (
            <p className="text-sm text-muted-foreground">Click to add ports...</p>
          ) : (
            <div className="flex flex-col gap-1">
              {ports.map((port) => (
                <div key={port.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={`w-2 h-2 rounded-full ${MEDIA_TYPE_COLORS[port.mediaType] ?? MEDIA_TYPE_COLORS.any}`} />
                  <span>{port.name}</span>
                  <span className="text-[10px] opacity-60">({port.mediaType})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="sub-workflow-input" handleId="in" type="target" position={Position.Left} label="Parent" color="#475569" icon={<LogIn />} side="left" top="calc(100% - 24px)" />
      {handles.filter(h => h.type === "source").map(h => (
        <HandleWithPopover key={h.id} nodeId={id} nodeType="sub-workflow-input" handleId={h.id} type="source" position={Position.Right} label={(h as { label?: string }).label ?? h.id} color={PORT_COLOR[(h as { mediaType?: string }).mediaType ?? "any"] ?? "#475569"} icon={<LogIn />} side="right" top={(h as { top?: string }).top ?? "24px"} />
      ))}
    </div>
  )
}

export const SubWorkflowInputNode = memo(SubWorkflowInputNodeComponent)
