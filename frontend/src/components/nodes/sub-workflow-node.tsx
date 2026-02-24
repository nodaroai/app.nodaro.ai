"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Workflow, Loader2 } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SubWorkflowData, SubWorkflowPort, GeneratedResult } from "@/types/nodes"

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
    }
  })

  // Fallback handles if no snapshot
  if (targets.length === 0 && sources.length === 0) {
    return [
      { id: "in", type: "target" as const, position: Position.Left, label: "In" },
      { id: "out", type: "source" as const, position: Position.Right, label: "Out" },
    ]
  }

  return [...targets, ...sources]
}

function SubWorkflowNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SubWorkflowData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
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

  // Show preview for visible output
  const visibleOutputPortId = nodeData.routeSnapshot?.visibleOutputPortId
  const visibleResult = visibleOutputPortId && nodeData.outputResults?.[visibleOutputPortId]
  const generatedResults = (nodeData.generatedResults ?? []) as GeneratedResult[]
  const activeIdx = nodeData.activeResultIndex ?? 0
  const previewUrl = generatedResults[activeIdx]?.url ?? visibleResult

  const progress = nodeData.subWorkflowProgress
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const isImage = typeof previewUrl === "string" && /\.(jpg|jpeg|png|webp|gif)$/i.test(previewUrl)
  const isVideo = typeof previewUrl === "string" && /\.(mp4|webm|mov)$/i.test(previewUrl)

  return (
    <div className="relative group/run">
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Workflow className="h-4 w-4" />}
        category="processing"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        handles={handles}
        minHeight={Math.max(120, maxPorts * 32 + 60)}
      >
        <div style={{ minHeight: `${Math.max(60, maxPorts * 26 + 8)}px` }}>
          {!nodeData.referencedWorkflowId ? (
            <p className="text-sm text-muted-foreground">Select a workflow...</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium truncate">{nodeData.referencedWorkflowName || "Unnamed"}</p>
              {nodeData.routeSnapshot && (
                <p className="text-[10px] text-muted-foreground">
                  {nodeData.routeSnapshot.inputLabel}
                </p>
              )}
            </div>
          )}

          {status === "running" && progress && (
            <div className="mt-2">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{progress.completed}/{progress.total}</span>
              </div>
              <div className="mt-1 h-1 bg-[#2D2D2D] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ff0073] transition-all duration-300"
                  style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {status === "failed" && nodeData.errorMessage && (
            <p className="text-[10px] text-red-400 mt-1 truncate">{nodeData.errorMessage}</p>
          )}

          {status === "completed" && previewUrl && (
            <div className="mt-2 cursor-pointer" onClick={() => setLightboxOpen(true)}>
              {isImage ? (
                <img src={previewUrl} alt="Output" className="w-full h-20 object-cover rounded hover:opacity-80 transition-opacity" />
              ) : isVideo ? (
                <video src={previewUrl} className="w-full h-20 object-cover rounded hover:opacity-80 transition-opacity" muted />
              ) : (
                <p className="text-[10px] text-muted-foreground truncate">{previewUrl}</p>
              )}
            </div>
          )}
        </div>
      </BaseNode>
      <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
      {lightboxOpen && isImage && (
        <ImageLightbox src={previewUrl as string} onClose={() => setLightboxOpen(false)} />
      )}
      {lightboxOpen && isVideo && (
        <MediaPreviewModal isOpen type="video" url={previewUrl as string} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  )
}

export const SubWorkflowNode = memo(SubWorkflowNodeComponent)
