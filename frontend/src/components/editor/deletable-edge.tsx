"use client"

import { type FC } from "react"
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react"
import { X } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

export const DeletableEdge: FC<EdgeProps<Edge>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
}) => {
  const deleteEdge = useWorkflowStore((s) => s.deleteEdge)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: selected ? 3 : 2,
          stroke: selected ? "hsl(var(--primary))" : undefined,
        }}
      />
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
