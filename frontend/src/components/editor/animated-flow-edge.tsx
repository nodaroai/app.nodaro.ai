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

  return (
    <>
      {/* Base edge line */}
      <BaseEdge id={id} path={edgePath} style={style as CSSProperties} markerEnd={markerEnd as string | undefined} />

      {/* Animated dot that travels along the path when running */}
      {isRunning && (
        <circle r="5" fill="#ff0073" filter="url(#glow)">
          <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}

      {/* SVG filter for glow effect */}
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </>
  )
}
