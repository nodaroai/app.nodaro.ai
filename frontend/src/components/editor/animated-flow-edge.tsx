"use client"

import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react"
import type { CSSProperties } from "react"

type AnimatedFlowEdgeProps = EdgeProps<Edge<{ isRunning?: boolean }>>

export function AnimatedFlowEdge({
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
}: AnimatedFlowEdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const isRunning = (data as { isRunning?: boolean })?.isRunning || false

  // Unique filter ID per edge to avoid conflicts
  const glowFilterId = `glow-${id}`

  return (
    <>
      {/* Base edge line */}
      <BaseEdge id={id} path={edgePath} style={style as CSSProperties} markerEnd={markerEnd as string | undefined} />

      {/* SVG filter for glow effect - always defined */}
      <defs>
        <filter id={glowFilterId} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Animated dot when edge source node is running */}
      {isRunning && (
        <circle r="8" fill="#ff0073" filter={`url(#${glowFilterId})`}>
          <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
    </>
  )
}
