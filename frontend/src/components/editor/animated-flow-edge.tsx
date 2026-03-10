"use client"

import { memo, useState, useCallback, useRef, useEffect } from "react"
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, useStore, type Edge, type EdgeProps } from "@xyflow/react"
import { X } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { CSSProperties } from "react"

type AnimatedFlowEdgeData = {
  isRunning?: boolean       // Output animation: source node is running (pink)
  isInputRunning?: boolean  // Input animation: target node is running (blue)
  edgeLabel?: string        // Primary label (role or media type)
  edgeLabelColor?: string   // Source node color for badge background
  outputMode?: string       // Edge-level output mode: "last" | "each" | "all" | "item:N" (N is 0-indexed internally)
}

type AnimatedFlowEdgeProps = EdgeProps<Edge<AnimatedFlowEdgeData>>

const MODE_OPTIONS = [
  { value: "last", label: "Last" },
  { value: "each", label: "Each" },
  { value: "all", label: "All" },
] as const

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
  const updateEdgeData = useWorkflowStore((s) => s.updateEdgeData)
  const zoom = useStore((s) => s.transform[2])
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [itemIndex, setItemIndex] = useState("")
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!showModeMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowModeMenu(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowModeMenu(false)
    }
    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [showModeMenu])

  const handleLabelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setShowModeMenu((prev) => !prev)
  }, [])

  const handleModeSelect = useCallback((mode: string) => {
    updateEdgeData(id, { outputMode: mode })
    setShowModeMenu(false)
  }, [id, updateEdgeData])

  const handleItemSubmit = useCallback(() => {
    // User enters 1-based index, we store 0-based internally
    const userIdx = parseInt(itemIndex, 10)
    if (!isNaN(userIdx) && userIdx >= 1) {
      updateEdgeData(id, { outputMode: `item:${userIdx - 1}` })
      setShowModeMenu(false)
      setItemIndex("")
    }
  }, [id, itemIndex, updateEdgeData])

  // Use step routing for backward connections (target left of source)
  // to avoid edges cutting through nodes
  const pathParams = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }
  const [edgePath, labelX, labelY] = targetX < sourceX
    ? getSmoothStepPath({ ...pathParams, borderRadius: 8, offset: 30 })
    : getBezierPath(pathParams)

  const edgeData = data as AnimatedFlowEdgeData | undefined
  const isRunning = edgeData?.isRunning || false           // Pink: data flowing OUT from running node
  const isInputRunning = edgeData?.isInputRunning || false // Blue: data flowing IN to running node
  const currentMode = edgeData?.outputMode ?? ""

  // Display 1-based item index in the input field
  const currentItemDisplay = currentMode.startsWith("item:")
    ? String(parseInt(currentMode.split(":")[1], 10) + 1)
    : ""

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

      {/* Edge label badge — clickable to change output mode */}
      {edgeData?.edgeLabel && !selected && zoom >= 0.5 && (
        <EdgeLabelRenderer>
          <div
            ref={menuRef}
            className="nodrag nopan absolute select-none flex flex-col items-center gap-0.5"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              zIndex: showModeMenu ? 1000 : 0,
            }}
          >
            <span
              className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border backdrop-blur-sm leading-none cursor-pointer hover:opacity-80 transition-opacity"
              style={edgeData.edgeLabelColor ? {
                backgroundColor: `${edgeData.edgeLabelColor}18`,
                color: edgeData.edgeLabelColor,
                borderColor: `${edgeData.edgeLabelColor}30`,
              } : {
                backgroundColor: 'rgba(255,255,255,0.7)',
                color: '#6b7280',
                borderColor: 'rgba(229,231,235,0.5)',
              }}
              onClick={handleLabelClick}
            >
              {edgeData.edgeLabel}
            </span>

            {/* Mode selector dropdown */}
            {showModeMenu && (
              <div
                className="mt-1 rounded-lg border shadow-lg backdrop-blur-md overflow-hidden"
                style={{ backgroundColor: 'rgba(30,30,30,0.95)', borderColor: 'rgba(255,255,255,0.1)' }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`block w-full text-left px-3 py-1.5 text-[10px] transition-colors cursor-pointer ${currentMode === opt.value ? 'text-white bg-white/10' : 'text-white/70 hover:text-white hover:bg-white/5'}`}
                    onClick={(e) => { e.stopPropagation(); handleModeSelect(opt.value) }}
                  >
                    {opt.label}
                  </button>
                ))}
                {/* Item index option (1-based for user) */}
                <div className="flex items-center gap-1 px-3 py-1.5 border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                  <span className={`text-[10px] ${currentMode.startsWith("item:") ? 'text-white' : 'text-white/70'}`}>Item</span>
                  <input
                    type="number"
                    min="1"
                    value={itemIndex !== "" ? itemIndex : currentItemDisplay}
                    onChange={(e) => setItemIndex(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleItemSubmit() }}
                    placeholder="#"
                    className="w-10 text-[10px] text-white bg-white/10 border border-white/20 rounded px-1 py-0.5 outline-none focus:border-white/40"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    className="text-[10px] text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded px-1.5 py-0.5 transition-colors cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); handleItemSubmit() }}
                  >
                    Set
                  </button>
                </div>
              </div>
            )}
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
