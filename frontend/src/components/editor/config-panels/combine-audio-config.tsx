"use client"

import { useCallback, useRef } from "react"
import { GripVertical } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { CombineAudioData } from "@/types/nodes"
import type { WorkflowNode } from "@/types/nodes"
import type { ConfigProps } from "./types"

function getNodeLabel(node: WorkflowNode): string {
  return (node.data as Record<string, unknown>)?.label as string ?? node.type ?? node.id
}

export function CombineAudioConfig({ data, onUpdate, nodes }: ConfigProps<CombineAudioData>) {
  const edges = useWorkflowStore((s) => s.edges)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const dragItemRef = useRef<string | null>(null)

  const connectedNodeIds = edges
    .filter((e) => e.target === selectedNodeId)
    .map((e) => e.source)

  const connectedNodes = connectedNodeIds
    .map((id) => nodes?.find((n) => n.id === id))
    .filter(Boolean) as ReadonlyArray<WorkflowNode>

  // Maintain segment order: existing order + any new connections appended
  const existingOrder = data.segmentOrder ?? []
  const connectedSet = new Set(connectedNodes.map((n) => n.id))
  const orderedIds = [
    ...existingOrder.filter((id) => connectedSet.has(id)),
    ...connectedNodes.map((n) => n.id).filter((id) => !existingOrder.includes(id)),
  ]

  const orderedNodes = orderedIds
    .map((id) => connectedNodes.find((n) => n.id === id))
    .filter(Boolean) as ReadonlyArray<WorkflowNode>

  const segmentSettings = data.segmentSettings ?? {}

  const updateSegmentSetting = useCallback((nodeId: string, field: string, value: number | undefined) => {
    const current = segmentSettings[nodeId] ?? {}
    onUpdate({
      segmentSettings: {
        ...segmentSettings,
        [nodeId]: { ...current, [field]: value },
      },
    })
  }, [segmentSettings, onUpdate])

  const handleDragStart = useCallback((nodeId: string) => {
    dragItemRef.current = nodeId
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback((targetNodeId: string) => {
    const srcId = dragItemRef.current
    if (!srcId || srcId === targetNodeId) return
    const newOrder = [...orderedIds]
    const srcIdx = newOrder.indexOf(srcId)
    const tgtIdx = newOrder.indexOf(targetNodeId)
    if (srcIdx === -1 || tgtIdx === -1) return
    newOrder.splice(srcIdx, 1)
    newOrder.splice(tgtIdx, 0, srcId)
    onUpdate({ segmentOrder: newOrder })
    dragItemRef.current = null
  }, [orderedIds, onUpdate])

  return (
    <div className="flex flex-col gap-3">
      {connectedNodes.length === 0 && (
        <p className="text-xs text-muted-foreground">Connect audio nodes to add segments. Segments play in order from top to bottom.</p>
      )}
      {orderedNodes.map((node, idx) => {
        const settings = segmentSettings[node.id] ?? {}
        return (
          <div
            key={node.id}
            draggable
            onDragStart={() => handleDragStart(node.id)}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(node.id)}
            className="rounded-md border border-border p-2 bg-muted/30 cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-center gap-2 mb-2">
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium truncate flex-1">{idx + 1}. {getNodeLabel(node)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Start (s)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={settings.startTime ?? ""}
                  onChange={(e) => updateSegmentSetting(node.id, "startTime", e.target.value ? parseFloat(e.target.value) : undefined)}
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">End (s)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={settings.endTime ?? ""}
                  onChange={(e) => updateSegmentSetting(node.id, "endTime", e.target.value ? parseFloat(e.target.value) : undefined)}
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
