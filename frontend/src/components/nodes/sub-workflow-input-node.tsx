"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { LogIn } from "lucide-react"
import { BaseNode } from "./base-node"
import type { SubWorkflowInputData, SubWorkflowPort } from "@/types/nodes"

const MEDIA_TYPE_COLORS: Record<string, string> = {
  text: "bg-blue-400",
  image: "bg-emerald-400",
  video: "bg-purple-400",
  audio: "bg-amber-400",
  any: "bg-gray-400",
}

function buildHandles(ports: ReadonlyArray<SubWorkflowPort>) {
  if (ports.length === 0) {
    return [{ id: "out", type: "source" as const, position: Position.Right, label: "Out" }]
  }

  const startPct = 42
  const endPct = 88
  return ports.map((port, i) => {
    const pct = ports.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (ports.length - 1)) * (endPct - startPct))
    return {
      id: port.id,
      type: "source" as const,
      position: Position.Right,
      label: port.name,
      top: `${pct}%`,
    }
  })
}

function SubWorkflowInputNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SubWorkflowInputData
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
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<LogIn className="h-4 w-4" />}
      category="processing"
      credits={0}
      selected={selected}
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
  )
}

export const SubWorkflowInputNode = memo(SubWorkflowInputNodeComponent)
