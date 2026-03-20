"use client"

import { memo, useState, useCallback, useRef, useEffect } from "react"
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, useStore, type Edge, type EdgeProps } from "@xyflow/react"
import { X, ChevronDown } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { CSSProperties } from "react"

type AnimatedFlowEdgeData = {
  isRunning?: boolean       // Output animation: source node is running (pink)
  isInputRunning?: boolean  // Input animation: target node is running (blue)
  edgeLabel?: string        // Primary label (role or media type)
  edgeLabelColor?: string   // Source node color for badge background
  edgeModeLabel?: string    // Output mode label: "each", "all", "last", "item"
  edgeRangeLabel?: string   // Range pill text: "2..last-1 +2", "3", etc.
  outputMode?: string       // Edge-level output mode: "last" | "each" | "all" | "item"
  rangeFrom?: string        // "1", "2", "last", "last-1" — default "1"
  rangeTo?: string          // "1", "last", "last-2" — default "last"
  rangeStep?: number        // only for "each" — default 1, supports negative
  itemIndex?: string        // for "item" mode: "3", "last", "last-1"
}

type AnimatedFlowEdgeProps = EdgeProps<Edge<AnimatedFlowEdgeData>>

const MODE_OPTIONS = [
  { value: "last", label: "Last", desc: "Only the most recent output" },
  { value: "each", label: "Each", desc: "Iterate over outputs in range" },
  { value: "all", label: "All", desc: "Pass all outputs at once" },
  { value: "item", label: "Item", desc: "Pick a single output by index" },
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
  const [isHovered, setIsHovered] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close dropdown when edge is deselected
  useEffect(() => {
    if (!selected && showModeMenu) {
      setShowModeMenu(false)
    }
  }, [selected, showModeMenu])

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

  const handleModeSelect = useCallback((mode: string) => {
    // When switching to item mode, set a default itemIndex if none exists
    if (mode === "item") {
      const edgeData = data as AnimatedFlowEdgeData | undefined
      const currentItem = edgeData?.itemIndex
      updateEdgeData(id, {
        outputMode: mode,
        itemIndex: currentItem || "1",
      })
    } else {
      updateEdgeData(id, { outputMode: mode })
    }
  }, [id, data, updateEdgeData])

  const handleRangeChange = useCallback((field: string, value: string) => {
    updateEdgeData(id, { [field]: value || undefined })
  }, [id, updateEdgeData])

  const handleStepChange = useCallback((value: string) => {
    const num = parseInt(value, 10)
    updateEdgeData(id, { rangeStep: isNaN(num) ? undefined : num })
  }, [id, updateEdgeData])

  const handleItemIndexChange = useCallback((value: string) => {
    updateEdgeData(id, { itemIndex: value || undefined })
  }, [id, updateEdgeData])

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

  // Normalize mode — handle legacy "item:N" format
  const normalizedMode = currentMode.startsWith("item:") ? "item" : currentMode

  // Unique filter IDs per edge to avoid conflicts
  const pinkGlowFilterId = `glow-pink-${id}`
  const blueGlowFilterId = `glow-blue-${id}`

  const hasLabel = !!(edgeData?.edgeLabel || edgeData?.edgeModeLabel)
  const showButtons = isHovered || selected || showModeMenu

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

      {/* Edge label with hover/select interaction */}
      {hasLabel && zoom >= 0.5 && (
        <EdgeLabelRenderer>
          <div
            ref={menuRef}
            className="nodrag nopan absolute select-none flex flex-col items-center"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              zIndex: showModeMenu ? 1000 : 0,
            }}
          >
            {/* Label row: [delete] [label + mode pill] [chevron] */}
            <div
              className="flex items-center gap-1"
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => { if (!showModeMenu) setIsHovered(false) }}
            >
              {/* Delete button — visible when selected */}
              {selected && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteEdge(id)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  aria-label="Delete connection"
                  style={{
                    background: "#3a1a1a",
                    border: "1px solid #ef4444",
                    borderRadius: 5,
                    width: 22,
                    height: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <X style={{ width: 12, height: 12, color: "#ef4444" }} />
                </button>
              )}

              {/* Label badge */}
              <span
                className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border backdrop-blur-sm leading-none flex items-center"
                style={edgeData?.edgeLabelColor ? {
                  backgroundColor: `${edgeData.edgeLabelColor}18`,
                  color: edgeData.edgeLabelColor,
                  borderColor: `${edgeData.edgeLabelColor}30`,
                } : {
                  backgroundColor: 'rgba(255,255,255,0.7)',
                  color: '#6b7280',
                  borderColor: 'rgba(229,231,235,0.5)',
                }}
              >
                {edgeData?.edgeLabel && <span>{edgeData.edgeLabel}</span>}
                {edgeData?.edgeModeLabel && (
                  <>
                    {edgeData.edgeLabel && <span style={{ margin: "0 3px", opacity: 0.5 }}>{"\u00B7"}</span>}
                    <span style={{ color: "#a78bfa" }}>{edgeData.edgeModeLabel}</span>
                  </>
                )}
                {edgeData?.edgeRangeLabel && (
                  <span style={{
                    background: "#3a2a5a",
                    color: "#c4b5fd",
                    borderRadius: 3,
                    padding: "0 4px",
                    fontFamily: "monospace",
                    fontSize: "0.75em",
                    marginLeft: 4,
                  }}>
                    {edgeData.edgeRangeLabel}
                  </span>
                )}
              </span>

              {/* Mode chevron button — visible on hover or selected */}
              {showButtons && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowModeMenu((prev) => !prev)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  aria-label="Change output mode"
                  style={{
                    background: showModeMenu ? "#a78bfa" : "#3a2a5a",
                    border: "1px solid #a78bfa",
                    borderRadius: 5,
                    width: 22,
                    height: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "background 0.15s",
                  }}
                >
                  <ChevronDown style={{
                    width: 12,
                    height: 12,
                    color: showModeMenu ? "#fff" : "#c4b5fd",
                    transition: "transform 0.15s",
                    transform: showModeMenu ? "rotate(180deg)" : "rotate(0deg)",
                  }} />
                </button>
              )}
            </div>

            {/* Mode dropdown */}
            {showModeMenu && (
              <div
                className="mt-1.5"
                style={{
                  background: "#1e1e3a",
                  border: "1px solid #555",
                  borderRadius: 8,
                  padding: 0,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                  minWidth: 180,
                  overflow: "hidden",
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* Mode radio buttons */}
                <div style={{ padding: "8px 0" }}>
                  {MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className="flex items-center gap-2 w-full text-left cursor-pointer transition-colors"
                      style={{
                        padding: "6px 14px",
                        background: normalizedMode === opt.value ? "rgba(167, 139, 250, 0.1)" : "transparent",
                        border: "none",
                        color: normalizedMode === opt.value ? "#e2e8f0" : "#94a3b8",
                        fontSize: 11,
                      }}
                      onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)" }}
                      onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = normalizedMode === opt.value ? "rgba(167, 139, 250, 0.1)" : "transparent" }}
                      onClick={(e) => { e.stopPropagation(); handleModeSelect(opt.value) }}
                    >
                      {/* Radio circle */}
                      <span style={{
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        border: normalizedMode === opt.value ? "2px solid #a78bfa" : "2px solid #555",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        {normalizedMode === opt.value && (
                          <span style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#a78bfa",
                          }} />
                        )}
                      </span>
                      <span style={{ fontWeight: normalizedMode === opt.value ? 600 : 400 }}>
                        {opt.label}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Separator */}
                <div style={{ height: 1, background: "#555", margin: "0" }} />

                {/* Conditional config section based on mode */}
                <div style={{ padding: "10px 14px" }}>
                  {normalizedMode === "last" && (
                    <span style={{ color: "#64748b", fontSize: 10, fontStyle: "italic" }}>
                      No configuration needed
                    </span>
                  )}

                  {normalizedMode === "each" && (
                    <RangeConfig
                      rangeFrom={edgeData?.rangeFrom}
                      rangeTo={edgeData?.rangeTo}
                      rangeStep={edgeData?.rangeStep}
                      showStep
                      onFromChange={(v) => handleRangeChange("rangeFrom", v)}
                      onToChange={(v) => handleRangeChange("rangeTo", v)}
                      onStepChange={handleStepChange}
                    />
                  )}

                  {normalizedMode === "all" && (
                    <RangeConfig
                      rangeFrom={edgeData?.rangeFrom}
                      rangeTo={edgeData?.rangeTo}
                      showStep={false}
                      onFromChange={(v) => handleRangeChange("rangeFrom", v)}
                      onToChange={(v) => handleRangeChange("rangeTo", v)}
                    />
                  )}

                  {normalizedMode === "item" && (
                    <ItemConfig
                      itemIndex={edgeData?.itemIndex}
                      onChange={handleItemIndexChange}
                    />
                  )}

                  {/* No mode selected yet — hint */}
                  {!normalizedMode && (
                    <span style={{ color: "#64748b", fontSize: 10, fontStyle: "italic" }}>
                      Select a mode above
                    </span>
                  )}
                </div>

                {/* Negative step hint */}
                {normalizedMode === "each" && edgeData?.rangeStep != null && edgeData.rangeStep < 0 && (
                  <>
                    <div style={{ height: 1, background: "#555" }} />
                    <div style={{ padding: "8px 14px" }}>
                      <span style={{ color: "#f59e0b", fontSize: 9.5 }}>
                        Negative step iterates backwards — set From &gt; To
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

/** Range config fields (FROM, TO, optional STEP) */
function RangeConfig({
  rangeFrom,
  rangeTo,
  rangeStep,
  showStep,
  onFromChange,
  onToChange,
  onStepChange,
}: {
  rangeFrom?: string
  rangeTo?: string
  rangeStep?: number
  showStep: boolean
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onStepChange?: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <FieldInput label="FROM" value={rangeFrom ?? ""} placeholder="1" onChange={onFromChange} />
        <span style={{ color: "#64748b", fontSize: 10, marginTop: 14 }}>&rarr;</span>
        <FieldInput label="TO" value={rangeTo ?? ""} placeholder="last" onChange={onToChange} />
        {showStep && onStepChange && (
          <>
            <span style={{ color: "#64748b", fontSize: 10, marginTop: 14 }}>+</span>
            <FieldInput
              label="STEP"
              value={rangeStep != null ? String(rangeStep) : ""}
              placeholder="1"
              onChange={onStepChange}
              width={40}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** Single item index config */
function ItemConfig({
  itemIndex,
  onChange,
}: {
  itemIndex?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <FieldInput label="INDEX" value={itemIndex ?? ""} placeholder="1" onChange={onChange} width={70} />
    </div>
  )
}

/** Small labeled input field for range/item config */
function FieldInput({
  label,
  value,
  placeholder,
  onChange,
  width = 52,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  width?: number
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span style={{
        color: "#64748b",
        fontSize: 8.5,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}>
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width,
          background: "#1e1e3a",
          border: "1px solid #555",
          borderRadius: 4,
          color: "#e2e8f0",
          fontSize: 11,
          fontFamily: "monospace",
          padding: "3px 6px",
          outline: "none",
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "#a78bfa" }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "#555" }}
      />
    </div>
  )
}

export const AnimatedFlowEdge = memo(AnimatedFlowEdgeComponent)
