"use client"

import { memo, useState, useCallback, useMemo, useRef, useEffect } from "react"
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, useStore, type Edge, type EdgeProps } from "@xyflow/react"
import { X, ChevronDown } from "lucide-react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { parseListExpression, describeEdgeBehavior, type SelectorMode } from "@nodaro/shared"
import type { CSSProperties } from "react"
import { useEdgeInsertAnimation } from "./workflow-editor/use-edge-insert-animation"

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
  selectorMode?: SelectorMode  // Selector tab: "range" (default) or "list"
  listExpression?: string   // List-mode expression: comma-separated indices/ranges, e.g. "1,3,5..last-1"
  sourceNodeType?: string   // Source node's type — used to hide modes that don't apply (e.g. Selected for list/loop)
  targetNodeType?: string   // Target node's type — used to hide Each when feeding into list/loop columns
}

type AnimatedFlowEdgeProps = EdgeProps<Edge<AnimatedFlowEdgeData>>

// NOTE: outputMode "last" is semantically "the currently selected result"
// (reads activeResultIndex from the source node). This is DIFFERENT from the
// word "last" appearing inside range/list expressions (e.g. rangeTo: "last",
// listExpression: "1, 3, last"), where "last" means "the final index in the
// array." Same word, different meanings.
const MODE_OPTIONS = [
  { value: "last", label: "Selected", desc: "The selected result" },
  { value: "item", label: "Item", desc: "Pick one item" },
  { value: "each", label: "Each", desc: "All items, one by one" },
  { value: "all", label: "Bundle", desc: "All items at once" },
] as const

// List/loop/split-text produce inherent items with no user-selection concept,
// so "Selected" doesn't apply — those edges default to "Each" (fan-out).
const LIST_LIKE_SOURCE_TYPES = new Set(["list", "loop", "split-text"])

// When feeding INTO a list/loop column, Each (fan-out) doesn't apply — the
// target accumulates items into the column as a bundle. Hide Each, default
// to All. At runtime, resolveEdgeValuesForTableColumn treats Each and All
// identically for list-like targets, so pre-existing "each" edges still
// work while the UI steers new ones to "all".
const LIST_LIKE_TARGET_TYPES = new Set(["list", "loop"])

// Target node types that accept multiple items in a single invocation
// (arrays/bundles). Only these can meaningfully receive Bundle mode — the
// multiple items land in referenceImageUrls / videoUrls / audioUrls etc.
// All other nodes collapse a Bundle to a single value, so offering it is
// misleading; we hide it from the dropdown.
const MULTI_INPUT_TARGET_TYPES = new Set([
  // Image generators accept multiple reference images
  "generate-image", "edit-image", "image-to-image", "modify-image",
  // Audio mixers / combiners
  "mix-audio", "combine-audio", "suno-mashup",
  // Video combiners
  "combine-videos",
  // Manual edit / composite accept multiple inputs
  "manual-edit", "composite",
  // Text combiners
  "combine-text",
  // List/loop targets collect into a column
  "list", "loop",
  // Social posts — carousels/galleries/threads accept multiple media items.
  // The single-post modes collapse to one; users switch via the node's
  // action field, so it's safe to allow Bundle here.
  "instagram-post", "tiktok-post", "facebook-post", "x-post", "linkedin-post",
])

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
  const menuRef = useRef<HTMLDivElement>(null)
  // Film Director D2: stretch new edges in over 500ms on first mount.
  // Idempotent per-edge-id (module-level Set), so existing edges loaded
  // from a saved workflow don't replay the animation.
  const edgeInsertAnim = useEdgeInsertAnimation(id)

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

  const handleSelectorModeChange = (mode: SelectorMode) => { updateEdgeData(id, { selectorMode: mode }) }
  const handleListExpressionChange = (value: string) => { updateEdgeData(id, { listExpression: value }) }

  // Use step routing for backward connections (target left of source)
  // to avoid edges cutting through nodes
  const pathParams = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }
  const [edgePath, labelX, labelY] = targetX < sourceX
    ? getSmoothStepPath({ ...pathParams, borderRadius: 8, offset: 30 })
    : getBezierPath(pathParams)

  const edgeData = data as AnimatedFlowEdgeData | undefined
  const isRunning = edgeData?.isRunning || false           // Pink: data flowing OUT from running node
  const isInputRunning = edgeData?.isInputRunning || false // Blue: data flowing IN to running node
  // Default mode matches runtime semantics:
  //   - Target is list/loop column → "all" (bundle items into the column)
  //   - Source is list/loop/split-text → "each" (fan-out downstream)
  //   - Otherwise → "last" (Selected)
  // workflow-canvas.tsx already resolves list-like-source edges to "each"
  // before passing edge data in, but we re-derive defaults here so the
  // fallback is explicit and target-aware.
  const isListLikeSource = LIST_LIKE_SOURCE_TYPES.has(edgeData?.sourceNodeType ?? "")
  const isListLikeTarget = LIST_LIKE_TARGET_TYPES.has(edgeData?.targetNodeType ?? "")
  const targetAcceptsMulti = MULTI_INPUT_TARGET_TYPES.has(edgeData?.targetNodeType ?? "")
  const defaultMode = isListLikeTarget ? "all" : isListLikeSource ? "each" : "last"
  // If an edge has a mode that's been hidden for this target/source combo
  // (e.g. legacy "each" on a list-target edge), fall back to the default so
  // the dropdown shows something highlighted.
  const rawMode = edgeData?.outputMode
  const modeOptions = MODE_OPTIONS.filter((opt) => {
    if (opt.value === "last" && isListLikeSource) return false
    if (opt.value === "each" && isListLikeTarget) return false
    // Bundle only makes sense when the target accepts multiple items.
    // Hide it elsewhere — otherwise users pick "all", the value gets
    // collapsed to a joined string or dropped, and the result is unexpected.
    if (opt.value === "all" && !targetAcceptsMulti) return false
    return true
  })
  const modeOptionValues = new Set<string>(modeOptions.map((o) => o.value))
  const currentMode = rawMode && modeOptionValues.has(rawMode.startsWith("item:") ? "item" : rawMode)
    ? rawMode
    : defaultMode

  // Normalize mode — handle legacy "item:N" format
  const normalizedMode = currentMode.startsWith("item:") ? "item" : currentMode

  const listExpression = edgeData?.listExpression ?? ""
  const selectorMode: SelectorMode = edgeData?.selectorMode ?? "range"

  // edgeData is a stable reference in React Flow unless the user edits
  // config, so memoing by it avoids recomputing the tooltip on every render.
  const tooltipText = useMemo(
    () => describeEdgeBehavior(edgeData),
    [edgeData],
  )

  // Unique filter IDs per edge to avoid conflicts
  const pinkGlowFilterId = `glow-pink-${id}`
  const blueGlowFilterId = `glow-blue-${id}`

  const hasLabel = !!(edgeData?.edgeLabel || edgeData?.edgeModeLabel || edgeData?.edgeRangeLabel)
  const showButtons = selected || showModeMenu
  const showEdgeUI = (hasLabel || selected || showModeMenu) && zoom >= 0.25
  // Keep labels readable when zoomed out: scale up inversely below zoom 0.6
  const labelScale = zoom < 0.6 ? Math.min(0.6 / zoom, 2.5) : 1

  return (
    <>
      {/* Base edge line */}
      <BaseEdge id={id} path={edgePath} style={{ ...style, strokeWidth: selected ? 3 : (style as CSSProperties)?.strokeWidth, stroke: selected ? "#ff0073" : (style as CSSProperties)?.stroke, ...edgeInsertAnim.style } as CSSProperties} markerEnd={markerEnd as string | undefined} />

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

      {/* Edge label with select interaction */}
      {showEdgeUI && (
        <EdgeLabelRenderer>
          <div
            ref={menuRef}
            className="nodrag nopan absolute select-none flex flex-col items-center"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)${labelScale !== 1 ? ` scale(${labelScale})` : ""}`,
              pointerEvents: "all",
              zIndex: showModeMenu ? 1000 : 0,
            }}
          >
            {/* Label row: [delete] [label + mode pill] [chevron] */}
            <div className="flex items-center gap-1">
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

              {/* Label badge — only render when there's label content */}
              {hasLabel && (
                <TooltipPrimitive.Provider delayDuration={2000}>
                  <TooltipPrimitive.Root>
                    <TooltipPrimitive.Trigger asChild>
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
                            display: "inline-flex",
                            flexWrap: "wrap",
                            maxWidth: 280,
                            gap: 2,
                          }}>
                            {edgeData.edgeRangeLabel.split(" → ").map((part, i, arr) => (
                              <span key={i} style={{ whiteSpace: "nowrap" }}>
                                {part}{i < arr.length - 1 ? " →" : ""}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </TooltipPrimitive.Trigger>
                    <TooltipPrimitive.Portal>
                      <TooltipPrimitive.Content
                        side="top"
                        sideOffset={6}
                        style={{
                          background: "#1e1e3a",
                          color: "#e2e8f0",
                          padding: "6px 10px",
                          fontSize: 11,
                          borderRadius: 6,
                          border: "1px solid #555",
                          maxWidth: 260,
                          boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
                        }}
                      >
                        {tooltipText}
                      </TooltipPrimitive.Content>
                    </TooltipPrimitive.Portal>
                  </TooltipPrimitive.Root>
                </TooltipPrimitive.Provider>
              )}

              {/* Mode chevron button — visible only when edge is selected */}
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
                  // Fixed width so the menu doesn't resize between modes —
                  // sized to comfortably fit the List tab with its example hint.
                  width: 300,
                  overflow: "hidden",
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    padding: "8px 14px 6px",
                    color: "#64748b",
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Output
                </div>
                {/* Mode radio buttons */}
                <div style={{ padding: "8px 0" }}>
                  {modeOptions.map((opt) => {
                    const isActive = normalizedMode === opt.value
                    const showInlineItemInput = opt.value === "item" && isActive
                    const showInlineRangeConfig = (opt.value === "each" || opt.value === "all") && isActive
                    return (
                      <div key={opt.value}>
                        <button
                          className="flex items-center gap-2 w-full text-left cursor-pointer transition-colors"
                          style={{
                            padding: "6px 14px",
                            background: isActive ? "rgba(167, 139, 250, 0.1)" : "transparent",
                            border: "none",
                            color: isActive ? "#e2e8f0" : "#94a3b8",
                            fontSize: 11,
                          }}
                          onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)" }}
                          onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = isActive ? "rgba(167, 139, 250, 0.1)" : "transparent" }}
                          onClick={(e) => { e.stopPropagation(); handleModeSelect(opt.value) }}
                        >
                          {/* Radio circle */}
                          <span style={{
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            border: isActive ? "2px solid #a78bfa" : "2px solid #555",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}>
                            {isActive && (
                              <span style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: "#a78bfa",
                              }} />
                            )}
                          </span>
                          <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                            <span
                              style={{
                                fontWeight: isActive ? 600 : 400,
                                fontSize: 11,
                              }}
                            >
                              {opt.label}
                            </span>
                            <span style={{ color: "#64748b", fontSize: 10 }}>{opt.desc}</span>
                          </span>
                          {/* Reserved slot — always present so every row has
                              the same width; only Item's active state fills it. */}
                          <span
                            onClick={showInlineItemInput ? (e) => e.stopPropagation() : undefined}
                            onMouseDown={showInlineItemInput ? (e) => e.stopPropagation() : undefined}
                            style={{ flexShrink: 0, width: 56, height: 22 }}
                          >
                            {showInlineItemInput && (
                              <input
                                type="text"
                                value={edgeData?.itemIndex ?? ""}
                                onChange={(e) => handleItemIndexChange(e.target.value)}
                                placeholder="1"
                                style={{
                                  width: "100%",
                                  padding: "3px 6px",
                                  fontFamily: "monospace",
                                  fontSize: 11,
                                  background: "#0f0f26",
                                  color: "#e2e8f0",
                                  border: "1px solid #444",
                                  borderRadius: 4,
                                  outline: "none",
                                  textAlign: "center",
                                  boxSizing: "border-box",
                                }}
                              />
                            )}
                          </span>
                        </button>
                        {showInlineRangeConfig && (
                          <div style={{ padding: "4px 14px 10px 36px" }}>
                            <div style={{ display: "flex", gap: 16, paddingBottom: 8 }}>
                              {(["range", "list"] as const).map((tab) => {
                                const active = selectorMode === tab
                                return (
                                  <button
                                    key={tab}
                                    type="button"
                                    onClick={() => handleSelectorModeChange(tab)}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    style={{
                                      padding: "4px 2px",
                                      fontSize: 11,
                                      background: "transparent",
                                      border: "none",
                                      borderBottom: active ? "2px solid #a78bfa" : "2px solid transparent",
                                      color: active ? "#e2e8f0" : "#94a3b8",
                                      fontWeight: active ? 600 : 400,
                                      cursor: "pointer",
                                    }}
                                  >
                                    {tab === "range" ? "Range" : "List"}
                                  </button>
                                )
                              })}
                            </div>
                            {selectorMode === "range" && (
                              <RangeConfig
                                rangeFrom={edgeData?.rangeFrom}
                                rangeTo={edgeData?.rangeTo}
                                rangeStep={edgeData?.rangeStep}
                                onFromChange={(v) => handleRangeChange("rangeFrom", v)}
                                onToChange={(v) => handleRangeChange("rangeTo", v)}
                                onStepChange={handleStepChange}
                              />
                            )}
                            {selectorMode === "list" && (
                              <ListConfig value={listExpression} onChange={handleListExpressionChange} containerPadding="0" />
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Negative step hint */}
                {(normalizedMode === "each" || normalizedMode === "all") && edgeData?.rangeStep != null && edgeData.rangeStep < 0 && (
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

function RangeConfig({
  rangeFrom,
  rangeTo,
  rangeStep,
  onFromChange,
  onToChange,
  onStepChange,
}: {
  rangeFrom?: string
  rangeTo?: string
  rangeStep?: number
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onStepChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <FieldInput label="FROM" value={rangeFrom ?? ""} placeholder="1" onChange={onFromChange} />
        <span style={{ color: "#64748b", fontSize: 10, marginTop: 14 }}>&rarr;</span>
        <FieldInput label="TO" value={rangeTo ?? ""} placeholder="last" onChange={onToChange} />
        <span style={{ color: "#64748b", fontSize: 10, marginTop: 14 }}>+</span>
        <FieldInput
          label="STEP"
          value={rangeStep != null ? String(rangeStep) : ""}
          placeholder="1"
          onChange={onStepChange}
          width={40}
        />
      </div>
    </div>
  )
}

function ListConfig({
  value,
  onChange,
  placeholder = "1, 2, last",
  containerPadding = "0 14px 10px",
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  containerPadding?: string
}) {
  const validation = parseListExpression(value)
  const isInvalid = !validation.ok
  return (
    <div style={{ padding: containerPadding }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        placeholder={placeholder}
        title={isInvalid ? (validation as { error: string }).error : undefined}
        style={{
          width: "100%",
          padding: "4px 8px",
          fontFamily: "monospace",
          fontSize: 11,
          background: "#0f0f26",
          color: "#e2e8f0",
          border: `1px solid ${isInvalid ? "#ef4444" : "#444"}`,
          borderRadius: 4,
          outline: "none",
        }}
      />
      <div style={{ color: "#64748b", fontSize: 9.5, marginTop: 4 }}>
        Examples: <code>1, 2, last</code> · <code>1..5</code> · <code>1..10:2</code> · <code>1..last-1</code>
      </div>
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
          background: "#0f0f26",
          border: "1px solid #444",
          borderRadius: 4,
          color: "#e2e8f0",
          fontSize: 11,
          fontFamily: "monospace",
          padding: "3px 6px",
          outline: "none",
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "#a78bfa" }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "#444" }}
      />
    </div>
  )
}

export const AnimatedFlowEdge = memo(AnimatedFlowEdgeComponent)
