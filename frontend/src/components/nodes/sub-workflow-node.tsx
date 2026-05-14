"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Workflow, Eye } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { WorkflowViewerModal } from "@/components/editor/workflow-viewer-modal"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getSubWorkflowViewMode } from "./sub-workflow-views/view-mode-registry"
import type { SubWorkflowData, SubWorkflowPort } from "@/types/nodes"

function buildHandles(
  inputPorts: ReadonlyArray<SubWorkflowPort>,
  outputPorts: ReadonlyArray<SubWorkflowPort>,
) {
  const startPct = 42
  const endPct = 88

  const targets = inputPorts.map((port, i) => {
    const pct = inputPorts.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (inputPorts.length - 1)) * (endPct - startPct))
    return {
      id: `in_${port.id}`,
      type: "target" as const,
      position: Position.Left,
      label: port.name,
      top: `${pct}%`,
      hideHandle: true,
      customStyle: { top: `${pct}%`, left: '-29px' },
    }
  })

  const sources = outputPorts.map((port, i) => {
    const pct = outputPorts.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (outputPorts.length - 1)) * (endPct - startPct))
    return {
      id: `out_${port.id}`,
      type: "source" as const,
      position: Position.Right,
      label: port.name,
      top: `${pct}%`,
      hideHandle: true,
      customStyle: { top: `${pct}%`, right: '-29px' },
    }
  })

  // Fallback handles if no snapshot
  if (targets.length === 0 && sources.length === 0) {
    return [
      { id: "in", type: "target" as const, position: Position.Left, label: "In", top: "calc(100% - 20px)", hideHandle: true, customStyle: { top: 'calc(100% - 20px)', left: '-29px' } },
      { id: "out", type: "source" as const, position: Position.Right, label: "Out", top: "20px", hideHandle: true, customStyle: { top: '20px', right: '-29px' } },
    ]
  }

  return [...targets, ...sources]
}

function SubWorkflowNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SubWorkflowData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()
  const status = nodeData.executionStatus ?? "idle"

  const inputPorts = nodeData.routeSnapshot?.inputPorts ?? []
  const outputPorts = nodeData.routeSnapshot?.outputPorts ?? []
  const handleKey = [...inputPorts, ...outputPorts].map(p => p.id).join(",")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handles = useMemo(() => buildHandles(inputPorts, outputPorts), [handleKey])

  const maxPorts = Math.max(inputPorts.length, outputPorts.length, 1)

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, inputPorts.length, outputPorts.length, updateNodeInternals])

  const [viewerOpen, setViewerOpen] = useState(false)

  const nodeMinHeight = Math.max(120, maxPorts * 36 + 60)

  const ViewMode = getSubWorkflowViewMode(nodeData.viewMode).Component

  return (
    <div className="relative group" style={{ maxWidth: '220px', minHeight: `${nodeMinHeight}px` }}>
      <EditableNodeLabel
        label={nodeData.routeSnapshot?.inputLabel || nodeData.label}
        icon={<Workflow className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.routeSnapshot?.inputLabel || nodeData.label}
        icon={<Workflow className="h-4 w-4" />}
        category="processing"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        topToolbarContent={
                      <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={handles}
        minHeight={nodeMinHeight}
      >
        <div style={{ minHeight: `${Math.max(60, maxPorts * 28 + 8)}px` }}>
          <ViewMode nodeId={id} data={nodeData} selected={selected ?? false} />
        </div>
      </BaseNode>
      {handles.filter(h => h.type === "target").map(h => (
        <HandleIcon key={h.id} icon={<Workflow />} color="steel" side="left" top={h.top ?? "calc(100% - 20px)"} />
      ))}
      {handles.filter(h => h.type === "source").map(h => (
        <HandleIcon key={h.id} icon={<Workflow />} color="steel" top={h.top ?? "20px"} />
      ))}
      {nodeData.referencedWorkflowId && status !== "running" && (
        <button
          type="button"
          aria-label="View referenced workflow"
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 p-1 rounded bg-[#1E1E1E]/80 hover:bg-[#2D2D2D] text-white/70 hover:text-white"
          onClick={(e) => { e.stopPropagation(); setViewerOpen(true) }}
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      )}
      {viewerOpen && nodeData.referencedWorkflowId && (
        <WorkflowViewerModal
          workflowId={nodeData.referencedWorkflowId}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  )
}

export const SubWorkflowNode = memo(SubWorkflowNodeComponent)
