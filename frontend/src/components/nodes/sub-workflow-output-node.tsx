"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { LogOut } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"

const PORT_COLOR: Record<string, string> = {
  text: "#22D3EE", image: "#22D3EE", video: "#A78BFA", audio: "#FCD34D", any: "#475569",
}
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SubWorkflowOutputData, SubWorkflowPort } from "@/types/nodes"

const MEDIA_TYPE_COLORS: Record<string, string> = {
  text: "bg-blue-400",
  image: "bg-emerald-400",
  video: "bg-purple-400",
  audio: "bg-amber-400",
  any: "bg-gray-400",
}

const SOURCE_HANDLE = { id: "out", type: "source" as const, position: Position.Right, customStyle: { top: '24px', right: '-29px' }, external: true, mediaType: "any" as const }

function buildHandles(ports: ReadonlyArray<SubWorkflowPort>) {
  if (ports.length === 0) {
    return [{ id: "in", type: "target" as const, position: Position.Left, label: "In", top: "calc(100% - 24px)", customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true, mediaType: "any" as const }, SOURCE_HANDLE]
  }

  const startPct = 42
  const endPct = 88
  const targetHandles = ports.map((port, i) => {
    const pct = ports.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (ports.length - 1)) * (endPct - startPct))
    return {
      id: port.id,
      type: "target" as const,
      position: Position.Left,
      label: port.name,
      top: `${pct}%`,
      mediaType: port.mediaType,
      customStyle: { top: `${pct}%`, left: '-29px' },
      external: true,
    }
  })
  return [...targetHandles, SOURCE_HANDLE]
}

function SubWorkflowOutputNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SubWorkflowOutputData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()

  const ports = nodeData.ports ?? []
  const portKey = ports.map(p => `${p.id}:${p.name}`).join(",")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handles = useMemo(() => buildHandles(ports), [portKey])

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, ports.length, updateNodeInternals])

  const visiblePort = ports.find((p) => p.id === nodeData.visibleOutputPortId)

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<LogOut className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<LogOut className="h-4 w-4" />}
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
                  {port.id === nodeData.visibleOutputPortId && (
                    <span className="text-[10px] text-[#ff0073]">(visible)</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {visiblePort && (
            <p className="text-[10px] text-muted-foreground mt-1 opacity-60">
              Preview: {visiblePort.name}
            </p>
          )}
        </div>
      </BaseNode>
      {handles.filter(h => h.type === "target").map(h => (
        <HandleWithPopover key={h.id} nodeId={id} nodeType="sub-workflow-output" handleId={h.id} type="target" position={Position.Left} label={(h as { label?: string }).label ?? h.id} color={PORT_COLOR[(h as { mediaType?: string }).mediaType ?? "any"] ?? "#475569"} icon={<LogOut />} side="left" top={(h as { top?: string }).top ?? "calc(100% - 24px)"} />
      ))}
      <HandleWithPopover nodeId={id} nodeType="sub-workflow-output" handleId="out" type="source" position={Position.Right} label="Parent" color="#475569" icon={<LogOut />} side="right" top="24px" />
    </div>
  )
}

export const SubWorkflowOutputNode = memo(SubWorkflowOutputNodeComponent)
