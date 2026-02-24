"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { LogOut } from "lucide-react"
import { BaseNode } from "./base-node"
import type { SubWorkflowOutputData, SubWorkflowPort } from "@/types/nodes"

const MEDIA_TYPE_COLORS: Record<string, string> = {
  text: "bg-blue-400",
  image: "bg-emerald-400",
  video: "bg-purple-400",
  audio: "bg-amber-400",
  any: "bg-gray-400",
}

function buildHandles(ports: ReadonlyArray<SubWorkflowPort>) {
  if (ports.length === 0) {
    return [{ id: "in", type: "target" as const, position: Position.Left, label: "In" }]
  }

  const startPct = 42
  const endPct = 88
  return ports.map((port, i) => {
    const pct = ports.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (ports.length - 1)) * (endPct - startPct))
    return {
      id: port.id,
      type: "target" as const,
      position: Position.Left,
      label: port.name,
      top: `${pct}%`,
    }
  })
}

function SubWorkflowOutputNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SubWorkflowOutputData
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
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<LogOut className="h-4 w-4" />}
      category="processing"
      credits={0}
      selected={selected}
      handles={handles}
    >
      <div style={{ minHeight: ports.length > 1 ? `${ports.length * 22 + 8}px` : undefined }}>
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
  )
}

export const SubWorkflowOutputNode = memo(SubWorkflowOutputNodeComponent)
