"use client"

import { memo } from "react"
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useStore, type Edge, type EdgeProps } from "@xyflow/react"
import { X } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { CSSProperties } from "react"

type AnimatedFlowEdgeData = {
  isRunning?: boolean       // Output animation: source node is running (pink)
  isInputRunning?: boolean  // Input animation: target node is running (blue)
  edgeLabel?: string        // Primary label (role or media type)
  edgeLabelColor?: string   // Source node color for badge background
}

type AnimatedFlowEdgeProps = EdgeProps<Edge<AnimatedFlowEdgeData>>

function AnimatedFlowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
  selected,
}: AnimatedFlowEdgeProps) {
  const deleteEdge = useWorkflowStore((s) => s.deleteEdge)
  const zoom = useStore((s) => s.transform[2])
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const edgeData = data as AnimatedFlowEdgeData | undefined
  const isRunning = edgeData?.isRunning || false           // Pink: data flowing OUT from running node
  const isInputRunning = edgeData?.isInputRunning || false // Blue: data flowing IN to running node

  // Unique filter IDs per edge to avoid conflicts
  const pinkGlowFilterId = `glow-pink-${id}`
  const blueGlowFilterId = `glow-blue-${id}`

  return (
    <>
      {/* Base edge line */}
      <BaseEdge id={id} path={edgePath} style={{ ...style, strokeWidth: selected ? 3 : (style as CSSProperties)?.strokeWidth, stroke: selected ? "#ff0073" : (style as CSSProperties)?.stroke } as CSSProperties} markerEnd={markerEnd as string | undefined} />

      {/* SVG filters for glow effects */}
      <defs>
        <filter id={pinkGlowFilterId} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={blueGlowFilterId} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Blue animated dot: data flowing IN to the running node (input edges) */}
      {isInputRunning && !isRunning && (
        <circle r="8" fill="#3b82f6" filter={`url(#${blueGlowFilterId})`}>
          <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}

      {/* Pink animated dot: data flowing OUT from the running node (output edges) */}
      {isRunning && (
        <circle r="8" fill="#ff0073" filter={`url(#${pinkGlowFilterId})`}>
          <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}

      {/* Edge label badge — hidden at low zoom or when delete button is shown */}
      {edgeData?.edgeLabel && !selected && zoom >= 0.5 && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute pointer-events-none select-none flex flex-col items-center gap-0.5"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            <span
              className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border backdrop-blur-sm leading-none"
              style={edgeData.edgeLabelColor ? {
                backgroundColor: `${edgeData.edgeLabelColor}18`,
                color: edgeData.edgeLabelColor,
                borderColor: `${edgeData.edgeLabelColor}30`,
              } : {
                backgroundColor: 'rgba(255,255,255,0.7)',
                color: '#6b7280',
                borderColor: 'rgba(229,231,235,0.5)',
              }}
            >
              {edgeData.edgeLabel}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Delete button on selected edge */}
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="nodrag nopan absolute flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 cursor-pointer"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            onClick={(e) => {
              e.stopPropagation()
              deleteEdge(id)
            }}
            aria-label="Delete connection"
          >
            <X className="h-3 w-3" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const AnimatedFlowEdge = memo(AnimatedFlowEdgeComponent)
