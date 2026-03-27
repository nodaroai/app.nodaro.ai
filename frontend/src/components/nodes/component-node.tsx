"use client"

import { memo, useMemo, useEffect } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Puzzle, ImageIcon, Video, AudioLines, FileText } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { ComponentNodeData } from "@/types/nodes"
import type { ComponentHandle } from "@nodaro-shared/component-types"

const HANDLE_TYPE_ICON: Record<ComponentHandle["type"], React.ReactNode> = {
  image: <ImageIcon />,
  video: <Video />,
  audio: <AudioLines />,
  text: <FileText />,
}

function buildHandles(
  inputs: ReadonlyArray<ComponentHandle>,
  outputs: ReadonlyArray<ComponentHandle>,
) {
  const startPct = 42
  const endPct = 88

  const targets = inputs.map((h, i) => {
    const pct = inputs.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (inputs.length - 1)) * (endPct - startPct))
    return {
      id: `in_${h.id}`,
      type: "target" as const,
      position: Position.Left,
      label: h.name,
      top: `${pct}%`,
      hideHandle: true,
      customStyle: { top: `${pct}%`, left: "-29px" },
      handleType: h.type,
    }
  })

  const sources = outputs.map((h, i) => {
    const pct = outputs.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (outputs.length - 1)) * (endPct - startPct))
    return {
      id: `out_${h.id}`,
      type: "source" as const,
      position: Position.Right,
      label: h.name,
      top: `${pct}%`,
      hideHandle: true,
      customStyle: { top: `${pct}%`, right: "-29px" },
      handleType: h.type,
    }
  })

  // Fallback handles if no metadata
  if (targets.length === 0 && sources.length === 0) {
    return [
      { id: "in", type: "target" as const, position: Position.Left, label: "In", top: "calc(100% - 20px)", hideHandle: true, customStyle: { top: "calc(100% - 20px)", left: "-29px" }, handleType: "text" as const },
      { id: "out", type: "source" as const, position: Position.Right, label: "Out", top: "20px", hideHandle: true, customStyle: { top: "20px", right: "-29px" }, handleType: "text" as const },
    ]
  }

  return [...targets, ...sources]
}

function ComponentNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ComponentNodeData
  const metadata = nodeData.componentMetadata ?? { inputs: [], outputs: [], exposedSettings: [] }
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()
  const useFull = useFullResolution(id)
  const status = nodeData.executionStatus ?? "idle"

  const inputHandles = metadata.inputs ?? []
  const outputHandles = metadata.outputs ?? []
  const handleKey = [...inputHandles, ...outputHandles].map((h) => h.id).join(",")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handles = useMemo(() => buildHandles(inputHandles, outputHandles), [handleKey])

  const maxPorts = Math.max(inputHandles.length, outputHandles.length, 1)
  const nodeMinHeight = Math.max(120, maxPorts * 36 + 60)

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, inputHandles.length, outputHandles.length, updateNodeInternals])

  // Find the mediaPreview output for result display
  const previewHandle = outputHandles.find((o) => o.mediaPreview)
  const previewValue = previewHandle && nodeData.outputResults?.[previewHandle.id]

  const isImage = typeof previewValue === "string" && /\.(jpg|jpeg|png|webp|gif)$/i.test(previewValue)
  const isVideo = typeof previewValue === "string" && /\.(mp4|webm|mov)$/i.test(previewValue)
  const isAudio = typeof previewValue === "string" && /\.(mp3|wav|ogg|flac|aac|m4a|webm)$/i.test(previewValue) && !isVideo

  return (
    <div className="relative group" style={{ maxWidth: "220px", minHeight: `${nodeMinHeight}px` }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Puzzle className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label || "Component"}
        icon={<Puzzle className="h-4 w-4" />}
        category="component"
        credits={nodeData.estimatedCredits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        minHeight={nodeMinHeight}
        topToolbarContent={
          <RunNodeButton
            nodeId={id}
            credits={nodeData.estimatedCredits ?? 0}
            isRunning={status === "running"}
            onRun={(nid) => runSingleNode?.(nid)}
          />
        }
        handles={handles}
      >
        <div style={{ minHeight: `${Math.max(60, maxPorts * 28 + 8)}px` }}>
          {!nodeData.appSlug ? (
            <p className="text-sm text-muted-foreground">Select a component...</p>
          ) : (
            <>
              {/* Result preview area */}
              <div
                className="rounded-lg border border-dashed border-border/50 bg-muted/30 flex items-center justify-center overflow-hidden"
                style={{ minHeight: 64 }}
              >
                {previewValue ? (
                  isImage ? (
                    <CachedImage
                      src={previewValue}
                      alt="Result"
                      className="w-full h-20 object-cover rounded-lg"
                      thumbnail={!useFull}
                      thumbnailWidth={320}
                    />
                  ) : isVideo ? (
                    <video
                      src={previewValue}
                      crossOrigin="anonymous"
                      className="w-full h-20 object-cover rounded-lg"
                      muted
                    />
                  ) : isAudio ? (
                    <audio
                      src={previewValue}
                      crossOrigin="anonymous"
                      controls
                      className="w-full h-8"
                    />
                  ) : (
                    <p className="text-[10px] text-muted-foreground truncate px-2">
                      {previewValue}
                    </p>
                  )
                ) : (
                  <span className="text-xs text-muted-foreground">Result preview</span>
                )}
              </div>

              {status === "failed" && nodeData.errorMessage && (
                <p className="text-[10px] text-red-400 mt-1 truncate">{nodeData.errorMessage}</p>
              )}

              {/* Creator footer */}
              <div className="border-t border-border/30 mt-2 pt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="truncate">by {nodeData.creatorName || "unknown"}</span>
                {nodeData.pinnedVersion > 0 && (
                  <span className="ml-auto flex-shrink-0">v{nodeData.pinnedVersion}</span>
                )}
              </div>
            </>
          )}
        </div>
      </BaseNode>

      {/* Handle icons */}
      {handles.filter((h) => h.type === "target").map((h) => (
        <HandleIcon
          key={h.id}
          icon={HANDLE_TYPE_ICON[h.handleType as ComponentHandle["type"]] ?? <FileText />}
          color="purple"
          side="left"
          top={h.top ?? "calc(100% - 20px)"}
        />
      ))}
      {handles.filter((h) => h.type === "source").map((h) => (
        <HandleIcon
          key={h.id}
          icon={HANDLE_TYPE_ICON[h.handleType as ComponentHandle["type"]] ?? <FileText />}
          color="purple"
          top={h.top ?? "20px"}
        />
      ))}
    </div>
  )
}

export const ComponentNode = memo(ComponentNodeComponent)
