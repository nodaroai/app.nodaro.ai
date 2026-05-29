"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Position, type NodeProps, NodeResizeControl, NodeToolbar, useUpdateNodeInternals } from "@xyflow/react"
import { isDataProducer } from "@/lib/data-handles"
import { isVisualPickerType } from "@/lib/parameter-picker-types"
import { CustomHandle } from "./custom-handle"
import { computeZoomFromDrag, computeVisualSize, applyMagnet } from "./zoom-math"
import { Type, FastForward, Maximize2, AArrowUp, AArrowDown, MoreHorizontal } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useShallow } from "zustand/react/shallow"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { X } from "lucide-react"
import { TagTextarea } from "@/components/editor/config-panels/tag-textarea"
import { PromptHelperButton } from "@/components/editor/config-panels/prompt-helper-button"
import { SUNO_LYRICS_SUGGESTION_ITEMS } from "@/lib/suno-tags"
import { getUpstreamNodes } from "@/lib/node-refs"
import { NODE_COLORS, getEffectiveColor } from "@/lib/node-colors"
import { hasCredits } from "@/lib/edition"
import { estimateNodeCredits, EXECUTABLE_TYPES } from "@/components/editor/workflow-editor/types"
import { getPickerOutputMeta } from "@/lib/picker-handles"
import type { TextPromptData } from "@/types/nodes"

// Module-level so HandleWithPopover's useConnection memo keeps a stable
// reference. Mirrors the list-node pattern; defining the arrow inside the
// component would create a fresh fn ref on every render.
const ACCEPTS_IN = (t: string) => isDataProducer(t, isVisualPickerType)

function TextPromptNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TextPromptData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const isEditing = useWorkflowStore((s) => s.selectedNodeId === id)
  const [isHovered, setIsHovered] = useState(false)
  // Track DOM focus on the textarea: when NOT focused, the textarea body is
  // a node-drag area (click without drag focuses; drag moves the node);
  // when focused, typing/text-select wins and node drag is suppressed.
  const [isFocused, setIsFocused] = useState(false)
  // Ref to the textarea wrapper so we can find the textarea + ScrollArea
  // viewport for cursor-follow (the textarea autosizes; the Viewport scrolls).
  const textWrapperRef = useRef<HTMLDivElement>(null)
  // Track mousedown → drag-vs-click on the textarea body so a drag that
  // releases doesn't focus the textarea (and trap the node in edit mode).
  // `didMove` is set when the cursor passes the React Flow drag threshold.
  const dragGestureRef = useRef<{ down: boolean; didMove: boolean; downX: number; downY: number }>({ down: false, didMove: false, downX: 0, downY: 0 })
  // Fullscreen prompt modal — mirrors the config-panel maximize, but
  // shows only the prompt textarea (no other config chrome).
  const [promptExpanded, setPromptExpanded] = useState(false)
  // Inline-edit state for the modal's header title. Defaults to the node
  // label; commits to the store on blur/Enter, reverts on Escape.
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(nodeData.label ?? "Text Prompt")
  useEffect(() => { setTitleDraft(nodeData.label ?? "Text Prompt") }, [nodeData.label])
  // Font-size control for the fullscreen prompt — bigger default than the
  // canvas node's 14px so the modal reads as a "writing surface", not a
  // zoomed copy of the chip on the canvas. Clamped to keep tag pills and
  // the backdrop scroll-sync legible.
  const [fontSize, setFontSize] = useState(20)
  const lineHeight = Math.round(fontSize * 1.5)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  // Only subscribe to full nodes/edges for nodeRefs + downstream credits,
  // but memoize the nodeRefs result by serializing to avoid unnecessary TagTextarea re-renders
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const nodeRefsRaw = useMemo(() => getUpstreamNodes(id, nodes, edges), [id, nodes, edges])
  const nodeRefsKey = useMemo(() => nodeRefsRaw.map(r => r.id).join(","), [nodeRefsRaw])
  // Stable reference: only changes when the actual upstream node IDs change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nodeRefs = useMemo(() => nodeRefsRaw, [nodeRefsKey])
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // `null`/undefined = "no color" — re-pressing the active swatch clears
  // it, and the card renders transparent so the canvas shows through.
  const color = nodeData.color
  const effectiveColor = color ? getEffectiveColor(color, isDark) : undefined
  // Read visual width/height from the React Flow node-level properties so
  // `updateNodeWithData(... { width, height } ...)` from the zoom drag
  // resizes the outer wrapper live (BaseNode line 252-261 pattern). Fall
  // back to the legacy nodeData fields then default constants for nodes
  // created before this migration.
  const { visualW, visualH, zoomFromStore } = useWorkflowStore(useShallow((s) => {
    const node = s.nodes.find((n) => n.id === id)
    const z = (node?.data as Record<string, unknown> | undefined)?.zoom
    return {
      visualW: node?.width,
      visualH: node?.height,
      zoomFromStore: typeof z === "number" ? z : 1,
    }
  }))
  const width = visualW ?? (nodeData as { width?: number }).width ?? 220
  const height = visualH ?? (nodeData as { height?: number }).height ?? 160
  const zoom = zoomFromStore
  // Outer wrapper uses box-sizing: border-box and has a 2px border, so
  // its inner content area is (width - 4) × (height - 4). The scale
  // wrapper must size to the CONTENT area (not the full visual W/H), or
  // the scaled inner card would overshoot by the border total and
  // cover the right + bottom borders.
  const OUTER_BORDER = 2 // px per side; mirrored in the JSX className "border-2"
  const contentW = width - OUTER_BORDER * 2
  const contentH = height - OUTER_BORDER * 2
  const logicalW = zoom !== 1 ? contentW / zoom : contentW
  const logicalH = zoom !== 1 ? contentH / zoom : contentH
  const updateNodeWithData = useWorkflowStore((s) => s.updateNodeWithData)
  // Drag-state ref for the zoom handle — snapshots zoom + logical size at
  // pointer-down so move math is anchored to a stable starting point.
  const zoomDragRef = useRef<{ startX: number; startY: number; zoom0: number; logicalW: number; logicalH: number } | null>(null)

  // Local state buffer — preserves browser-native Cmd+Z and debounces store writes
  const [localText, setLocalText] = useState(nodeData.text ?? "")
  const storeTextRef = useRef(nodeData.text ?? "")
  const localTextRef = useRef(nodeData.text ?? "")
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const storeText = nodeData.text ?? ""
    // Only sync from store if the change came from outside (not from our own debounce)
    if (storeText !== storeTextRef.current && storeText !== localTextRef.current) {
      storeTextRef.current = storeText
      localTextRef.current = storeText
      setLocalText(storeText)
    } else {
      storeTextRef.current = storeText
    }
  }, [nodeData.text])

  const handleTextChange = useCallback((value: string) => {
    setLocalText(value)
    localTextRef.current = value
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      storeTextRef.current = value
      updateNodeData(id, { text: value })
    }, 300)
  }, [id, updateNodeData])

  // Flush (not just clear) pending debounce on unmount so last keystrokes aren't lost
  useEffect(() => () => {
    clearTimeout(debounceRef.current)
    if (localTextRef.current !== storeTextRef.current) {
      updateNodeData(id, { text: localTextRef.current })
    }
  }, [id, updateNodeData])

  // Cursor-follow: when the user types and the caret sits at the end of
  // the value, scroll the Radix ScrollArea viewport so the new text stays
  // visible. The textarea autosizes (field-sizing: content), so it never
  // scrolls itself; the viewport is what scrolls. Mid-text edits don't
  // trigger this — the user manually scrolled there on purpose.
  useEffect(() => {
    const wrapper = textWrapperRef.current
    if (!wrapper) return
    const ta = wrapper.querySelector<HTMLTextAreaElement>("textarea")
    if (!ta || ta.selectionEnd !== ta.value.length) return
    const viewport = wrapper.querySelector<HTMLDivElement>("[data-radix-scroll-area-viewport]")
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [localText])

  const handleResize = useCallback(
    (_event: unknown, params: { width: number; height: number }) => {
      // NodeResizeControl already writes width/height to React Flow's
      // node-level on every frame (silent for undo). Mirror that into the
      // store so width/height/zoom share a single source of truth, and
      // also persist a `nodeData` copy for backward compatibility with
      // existing nodes that were saved against the old read path.
      updateNodeWithData(id, { width: params.width, height: params.height }, { width: params.width, height: params.height })
    },
    [id, updateNodeWithData],
  )

  // Bottom-left zoom corner — mirrors BaseNode's `handleZoomDrag*` set, but
  // inlined so text-prompt (which doesn't use BaseNode) can keep its own
  // outer chrome. Snapshots zoom + logical size on pointerdown, recomputes
  // both on each move, writes one undo snapshot on release.
  const handleZoomDragStart = useCallback((e: ReactPointerEvent) => {
    // logical = content area / zoom; mirrors the render math so a zoom
    // change keeps the on-screen content stable (the outer border adds
    // 4px that aren't part of the scaled content).
    zoomDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      zoom0: zoom,
      logicalW: (width - OUTER_BORDER * 2) / zoom,
      logicalH: (height - OUTER_BORDER * 2) / zoom,
    }
  }, [zoom, width, height])
  const handleZoomDragMove = useCallback((e: ReactPointerEvent) => {
    const ds = zoomDragRef.current
    if (!ds) return
    // text-prompt allows zooming up to 8× (vs the shared 2× default) so
    // the prompt can be enlarged to a writing-surface size on the canvas.
    const zRaw = computeZoomFromDrag(ds.zoom0, { x: ds.startX, y: ds.startY }, { x: e.clientX, y: e.clientY }, "bottom-left", 0.5, 8)
    const z = applyMagnet(zRaw, ds.zoom0)
    // `computeVisualSize` returns content-area visual; add the border
    // back to get the outer wrapper's React-Flow-level width/height.
    const visual = computeVisualSize({ w: ds.logicalW, h: ds.logicalH }, z)
    visual.w += OUTER_BORDER * 2
    visual.h += OUTER_BORDER * 2
    // Mirror width/height into `data` as well as React Flow's node-level
    // properties. The workflow persistence only restores `node.data`
    // after a refresh — without this, the zoomed visual size would
    // revert to whatever was last written by the bottom-right resize.
    updateNodeWithData(id, { width: visual.w, height: visual.h }, { width: visual.w, height: visual.h, zoom: z })
  }, [id, updateNodeWithData])
  const handleZoomDragEnd = useCallback(() => {
    const ds = zoomDragRef.current
    zoomDragRef.current = null
    if (!ds) return
    const finalNode = useWorkflowStore.getState().nodes.find((n) => n.id === id)
    if (!finalNode) return
    const finalZoom = (finalNode.data as Record<string, unknown> | undefined)?.zoom
    if (typeof finalZoom === "number" && finalZoom !== ds.zoom0) {
      useWorkflowStore.getState().updateNode(id, {
        data: { ...finalNode.data, zoom: finalZoom } as typeof finalNode.data,
      })
    }
  }, [id])

  // BFS forward to find downstream executable nodes and sum their credit cost
  const { hasDownstream, downstreamCredits } = useMemo(() => {
    const outEdges = edges.filter((e) => e.source === id)
    if (outEdges.length === 0) return { hasDownstream: false, downstreamCredits: 0 }

    const visited = new Set<string>([id])
    const queue = outEdges.map((e) => e.target)
    let totalCredits = 0

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)

      const node = nodes.find((n) => n.id === current)
      if (!node) continue

      if (EXECUTABLE_TYPES.has(node.type ?? "")) {
        totalCredits += estimateNodeCredits(node as { type?: string; data?: Record<string, unknown> })
      }

      for (const edge of edges) {
        if (edge.source === current && !visited.has(edge.target)) {
          queue.push(edge.target)
        }
      }
    }

    return { hasDownstream: true, downstreamCredits: totalCredits }
  }, [id, nodes, edges])

  const outputTarget: "text" | "voice" | "lyrics" =
    nodeData.outputTarget === "voice" || nodeData.outputTarget === "lyrics" ? nodeData.outputTarget : "text"

  // Typed source pip — text-prompt registers as a hint-producer in
  // picker-handles so it lights up Generate Image's `prompt` handle and
  // camera-motion / transition state handles during drag-to-connect. The
  // visible cyan pip is owned by HandleWithPopover.
  //
  // text-prompt is pinned in REGISTRY by an explicit drift-catcher test
  // in `picker-handles.test.ts` (the "text-prompt is in REGISTRY"
  // assertion), so in any reachable build pickerMeta is non-null. The
  // explicit defaults below replace a previous `!` force-unwrap: even if
  // a future REGISTRY refactor briefly leaves text-prompt missing, the
  // node renders with sensible cyan/Text defaults instead of crashing
  // the editor — the drift-test fails CI before that ships.
  const pickerMeta = getPickerOutputMeta("text-prompt") ?? {
    family: "text" as const,
    color: "#22D3EE",
    label: "Text",
  }

  // The typed pip's CSS position (`right: -29px` on the rendered
  // <Handle>) shifted compared to the pre-typed-pip layout (`right: -43px`
  // on the invisible Handle). React Flow caches per-handle pixel offsets
  // for edge endpoint geometry — without an explicit `updateNodeInternals`
  // call on mount, edges drawn against the pre-migration position would
  // float for a frame after layout. Empty deps fires once on mount,
  // recomputing handle positions for any cached layouts.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, updateNodeInternals])

  return (
    <div
      className={cn(
        // The visual border lives on this OUTER wrapper (not the inner
        // scaled card) so its width stays a true 2px regardless of node
        // zoom — Chrome snaps fractional `border-width` on the inner
        // card and made the previous approach jitter across zooms.
        "relative rounded-xl border-2",
        "hover:border-black/40 dark:hover:border-white/40 transition-colors duration-200",
        "!border-[#E2E8F0] dark:!border-[#333333]",
        selected && !isEditing && "border-blue-400",
        isEditing && "border-[#ff0073]",
      )}
      style={{ width, height, overflow: 'visible', boxSizing: 'border-box' }}
      onMouseEnter={() => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
        setIsHovered(true)
      }}
      onMouseLeave={() => {
        hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 600)
      }}
    >
      {/* Color swatches — centered above the label */}
      {(selected || isHovered) && (
        <div
          className="absolute flex items-center gap-1 px-2 py-[4px] bg-white border border-border dark:bg-[#1a1a1a] dark:border-white/10 rounded-xl shadow-xl backdrop-blur-sm z-10"
          style={{ top: -54, left: '50%', transform: 'translateX(-50%)' }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
            setIsHovered(true)
          }}
          onMouseLeave={() => {
            hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 300)
          }}
        >
          {NODE_COLORS.map((c) => (
            <div
              key={c}
              onClick={(e) => {
                e.stopPropagation()
                // Toggle: re-pressing the active swatch clears the color
                // and the node falls back to a canvas-matching transparent
                // background.
                updateNodeData(id, { color: color === c ? null : c })
              }}
              className={`w-4 h-4 rounded-full cursor-pointer border-2 transition-transform hover:scale-110 ${color === c ? "border-foreground dark:border-white" : "border-foreground/15 dark:border-white/20"}`}
              style={{ backgroundColor: getEffectiveColor(c, isDark) }}
            />
          ))}
          {/* Divider between swatches and action buttons */}
          <div className="mx-1 h-4 w-px bg-border dark:bg-white/10" />
          {/* AI prompt enhancer — same component used in the config panel.
              The shared button has a `min-h-[32px] sm:min-h-0` rule for
              touch targets that fattens this row; the wrapper here is
              `inline-flex leading-none` so its line-box collapses to the
              child's actual height (16px), matching the swatch row. */}
          <div className="inline-flex items-center leading-none [&_button]:!min-h-0 [&_button]:!h-4 [&_button]:!px-1.5 [&_button]:!leading-none">
            <PromptHelperButton
              nodeType="text-prompt"
              currentPrompt={localText}
              onAccept={(prompt) => {
                handleTextChange(prompt)
              }}
            />
          </div>
          {/* Open the prompt in a fullscreen modal */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPromptExpanded(true) }}
            className="inline-flex items-center justify-center w-4 h-4 rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Expand prompt"
            title="Expand prompt"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Floating label above node */}
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Type className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />

      {/* 3-dots "More options" — top-right. This node uses custom chrome
          instead of BaseNode, so it must reproduce BaseNode's overflow
          button itself: dispatch the same `open-node-context-menu` event
          the canvas listens for, so text-prompt gets the identical context
          menu (duplicate / skip / delete / …) every other node exposes on
          hover. Without this the menu was only reachable via right-click. */}
      <NodeToolbar align="end" isVisible={selected || isHovered} position={Position.Top} offset={4}>
        <div
          className="flex items-center"
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
            setIsHovered(true)
          }}
          onMouseLeave={() => {
            hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 300)
          }}
        >
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              window.dispatchEvent(new CustomEvent("open-node-context-menu", {
                detail: { nodeId: id, x: e.clientX, y: e.clientY },
              }))
            }}
            aria-label="More options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </NodeToolbar>

      {/* Two corner controls, matching the person/parameter family in
          BaseNode: bottom-right resizes the box only; bottom-left zooms
          the whole node so the inner text scales with the box. */}
      {(isHovered || !!selected) && (
        <>
          <NodeResizeControl
            nodeId={id}
            position="bottom-right"
            minWidth={160}
            minHeight={80}
            className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-0 !rounded-full"
            onResize={handleResize}
          />
          <CustomHandle
            visible
            position="bottom-left"
            onDragStart={handleZoomDragStart}
            onDragMove={handleZoomDragMove}
            onDragEnd={handleZoomDragEnd}
          />
        </>
      )}

      {/* Run from here button — below node, only when connected downstream */}
      {hasDownstream && (
        <NodeToolbar isVisible={selected || isHovered} position={Position.Bottom} offset={4}>
          <div
            className="flex items-center"
            onMouseEnter={() => {
              if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
              setIsHovered(true)
            }}
            onMouseLeave={() => {
              hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 300)
            }}
          >
            <button
              type="button"
              className="flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium text-white rounded-lg whitespace-nowrap bg-[#ff0073] hover:bg-[#e60068] shadow-sm transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                runFromHere?.(id)
              }}
            >
              <FastForward className="w-3 h-3" />
              Run from here
              {hasCredits() && downstreamCredits > 0 && (
                <span className="ml-0.5 opacity-80">({downstreamCredits} CR)</span>
              )}
            </button>
          </div>
        </NodeToolbar>
      )}

      {/* Zoom wrapper — mirrors BaseNode line 387: at zoom=1 it dissolves
          into the outer flex layout via `display: contents`, so the DOM
          tree stays byte-for-byte the pre-zoom shape. At zoom!=1 it
          becomes a real flex column at LOGICAL dimensions with a
          scale-transform for visual sizing, so the textarea, scrollbar,
          and prompt text all scale together. */}
      <div
        className={cn("origin-top-left relative", zoom !== 1 && "flex flex-col h-full")}
        style={{
          display: zoom !== 1 ? undefined : "contents",
          width: zoom !== 1 ? logicalW : undefined,
          height: zoom !== 1 ? logicalH : undefined,
          transform: zoom !== 1 ? `scale(${zoom})` : undefined,
        }}
      >
      {/* Container — with selection/editing glow matching BaseNode */}
      <div
        className={cn(
          "text-prompt-card w-full h-full rounded-xl overflow-hidden flex flex-col py-1 pr-1 transition-colors duration-200",
          // Focused (selected, config panel closed): blue glow only.
          // Border is rendered on the unscaled outer wrapper so it
          // stays a flat 2px at any node zoom (Chrome's fractional
          // border-width snapping made the inner approach inconsistent).
          selected && !isEditing && "shadow-[0_0_20px_rgba(96,165,250,0.6)]",
          // Editing (selected + config panel open) — pink glow only;
          // border lives on the outer wrapper, see above.
          isEditing && "shadow-[0_0_20px_rgba(255,0,115,0.5)] dark:shadow-[0_0_25px_rgba(255,0,115,0.5)]",
        )}
        style={{
          // "No color" mode uses `var(--background)` so the card paints
          // an opaque fill that matches the canvas exactly — no grid
          // dots show through, but the node still blends seamlessly
          // until the border / selection glow defines its shape.
          backgroundColor: effectiveColor ?? "var(--background)",
          boxShadow: (!selected && !isEditing && effectiveColor) ? `0 0 16px ${effectiveColor}15` : undefined,
          // Border-radius still counter-scales (no Chrome snapping
          // for fractional radius); border-width is now on the outer
          // wrapper so we don't override it here.
          borderRadius: 14 / zoom,
        }}
      >
        <div
          ref={textWrapperRef}
          className={`text-prompt-tag-textarea w-full flex-1 min-h-0 nopan ${isFocused ? "nodrag" : ""}`}
          onMouseDown={(e) => {
            // Scrollbar interactions pass through untouched.
            const target = e.target as HTMLElement | null
            if (!target?.closest(".tag-textarea-container")) return
            // Already focused — let textarea own the gesture (text select).
            if (isFocused) {
              e.stopPropagation()
              return
            }
            // Defer browser-default focus so we can tell click from drag.
            dragGestureRef.current = { down: true, didMove: false, downX: e.clientX, downY: e.clientY }
            e.preventDefault()
          }}
          onMouseMove={(e) => {
            const g = dragGestureRef.current
            if (!g.down) return
            if (Math.abs(e.clientX - g.downX) > 2 || Math.abs(e.clientY - g.downY) > 2) g.didMove = true
          }}
          onMouseUp={(e) => {
            const g = dragGestureRef.current
            if (!g.down) return
            const didMove = g.didMove
            dragGestureRef.current = { down: false, didMove: false, downX: 0, downY: 0 }
            const target = e.target as HTMLElement | null
            if (!target?.closest(".tag-textarea-container")) return
            // A drag: don't enter edit mode. A click: focus textarea.
            if (didMove) return
            e.currentTarget.querySelector<HTMLTextAreaElement>("textarea")?.focus()
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        >
          <ScrollArea className="h-full w-full">
            {outputTarget === "lyrics" ? (
              <TagTextarea
                value={localText}
                onChange={handleTextChange}
                placeholder="Write your lyrics..."
                className="!bg-transparent !border-none !shadow-none !ring-0 !outline-none !resize-none"
                tagMode="suno"
                customTags={SUNO_LYRICS_SUGGESTION_ITEMS}
                nodeRefs={nodeRefs}
              />
            ) : outputTarget === "voice" ? (
              <TagTextarea
                value={localText}
                onChange={handleTextChange}
                placeholder="Write the spoken text..."
                className="!bg-transparent !border-none !shadow-none !ring-0 !outline-none !resize-none"
                tagMode="audio"
                nodeRefs={nodeRefs}
              />
            ) : (
              <TagTextarea
                value={localText}
                onChange={handleTextChange}
                placeholder="Enter your prompt..."
                className="!bg-transparent !border-none !shadow-none !ring-0 !outline-none !resize-none"
                tagMode="none"
                nodeRefs={nodeRefs}
              />
            )}
          </ScrollArea>
        </div>
      </div>
      </div>

      {/* Typed target pip — migrated from the legacy invisible <Handle>
          + decorative icon pair. Renders the visible cyan pip, the React
          Flow <Handle>, AND the popover. `accepts` matches any data
          producer (text/list/json/picker), so source-direction popovers
          on those nodes light up this pip during drag-to-connect. */}
      <HandleWithPopover
        nodeId={id}
        handleId="in"
        nodeType="text-prompt"
        type="target"
        position={Position.Left}
        label="Text"
        color={pickerMeta.color}
        icon={<Type />}
        side="left"
        top="calc(100% - 20px)"
        accepts={ACCEPTS_IN}
      />

      {/* Typed source pip — HandleWithPopover renders the visible cyan pip,
          the React Flow <Handle>, AND the popover for managing downstream
          connections. text-prompt is pinned to REGISTRY by an explicit
          drift-catcher test (see the pickerMeta declaration above); the
          inline defaults there keep this branch safe even if the
          registry briefly drifts. */}
      <HandleWithPopover
        nodeId={id}
        handleId="prompt"
        nodeType="text-prompt"
        type="source"
        position={Position.Right}
        label={pickerMeta.label}
        color={pickerMeta.color}
        icon={<Type />}
        side="right"
        top="20px"
      />

      {/* Fullscreen prompt modal — mirrors the in-node DOM exactly so every
          shared style (text-prompt-card scrollbar, text-prompt-tag-textarea
          padding/cursor/caret, backdrop) applies identically. The only
          differences from the canvas node: outer size and no swatch UI. */}
      <Dialog open={promptExpanded} onOpenChange={setPromptExpanded}>
        <DialogContent
          showCloseButton={false}
          className="!max-w-[min(95vw,1200px)] !w-[min(95vw,1200px)] h-[85vh] p-6 pt-12 flex flex-col"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {/* Accessible title for Radix Dialog — visually replaced by the
              editable header below. */}
          <VisuallyHidden>
            <DialogTitle>{nodeData.label ?? "Text Prompt"}</DialogTitle>
          </VisuallyHidden>
          {/* Header: icon + editable title, top-left. */}
          <div className="absolute top-2 left-3 flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 dark:text-white/70">
            <Type className="w-3.5 h-3.5" />
            {titleEditing ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  setTitleEditing(false)
                  const next = titleDraft.trim()
                  if (next && next !== nodeData.label) updateNodeData(id, { label: next })
                  else setTitleDraft(nodeData.label ?? "Text Prompt")
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                  if (e.key === "Escape") { setTitleDraft(nodeData.label ?? "Text Prompt"); setTitleEditing(false) }
                }}
                className="bg-white border border-border rounded-md px-2 py-0.5 text-foreground outline-none min-w-[8rem] max-w-[20rem] text-[14px] focus:ring-1 focus:ring-[#ff0073]/40 focus:border-[#ff0073] dark:bg-zinc-900 dark:border-white/20 dark:text-white/90"
                style={{ width: `${Math.max(8, titleDraft.length * 0.65 + 2)}ch` }}
              />
            ) : (
              <span
                className="truncate cursor-text hover:text-foreground dark:hover:text-white/90 transition-colors"
                onClick={() => setTitleEditing(true)}
                title="Click to rename"
              >
                {nodeData.label ?? "Text Prompt"}
              </span>
            )}
          </div>
          {/* Font-size controls — right side of header. */}
          <div className="absolute top-2 right-10 flex items-center gap-1 text-muted-foreground">
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.max(12, s - 2))}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Decrease font size"
              title="Decrease font size"
            >
              <AArrowDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.min(40, s + 2))}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Increase font size"
              title="Increase font size"
            >
              <AArrowUp className="w-4 h-4" />
            </button>
          </div>
          {/* Close — pushed flush to the corner. */}
          <button
            type="button"
            onClick={() => setPromptExpanded(false)}
            className="absolute top-1 right-1 inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
          <div
            className="text-prompt-card text-prompt-card-fullscreen w-full h-full rounded-xl overflow-hidden flex flex-col border-2 border-transparent py-1 pr-1"
            style={{
              backgroundColor: effectiveColor ?? "var(--background)",
              ["--prompt-fs" as string]: `${fontSize}px`,
              ["--prompt-lh" as string]: `${lineHeight}px`,
            }}
          >
            <div className="text-prompt-tag-textarea w-full flex-1 min-h-0 nopan nodrag">
              <ScrollArea className="h-full w-full">
                {outputTarget === "lyrics" ? (
                  <TagTextarea
                    value={localText}
                    onChange={handleTextChange}
                    placeholder="Write your lyrics..."
                    className="!bg-transparent !border-none !shadow-none !ring-0 !outline-none !resize-none"
                    tagMode="suno"
                    customTags={SUNO_LYRICS_SUGGESTION_ITEMS}
                    nodeRefs={nodeRefs}
                  />
                ) : outputTarget === "voice" ? (
                  <TagTextarea
                    value={localText}
                    onChange={handleTextChange}
                    placeholder="Write the spoken text..."
                    className="!bg-transparent !border-none !shadow-none !ring-0 !outline-none !resize-none"
                    tagMode="audio"
                    nodeRefs={nodeRefs}
                  />
                ) : (
                  <TagTextarea
                    value={localText}
                    onChange={handleTextChange}
                    placeholder="Enter your prompt..."
                    className="!bg-transparent !border-none !shadow-none !ring-0 !outline-none !resize-none"
                    tagMode="none"
                    nodeRefs={nodeRefs}
                  />
                )}
              </ScrollArea>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const TextPromptNode = memo(TextPromptNodeComponent)
