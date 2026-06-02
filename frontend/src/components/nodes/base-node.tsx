"use client"

import { memo, useState, useEffect, useRef, useCallback, type ReactNode, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react"
import { Handle, Position, NodeToolbar, useUpdateNodeInternals, NodeResizeControl } from "@xyflow/react"
import { MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useShallow } from "zustand/react/shallow"
import { useAltKeyStore } from "@/hooks/use-alt-key"
import { useMobileCanvas } from "@/components/editor/mobile-canvas-context"
import { CustomHandle } from "./custom-handle"
import { computeZoomFromDrag, computeVisualSize, applyMagnet } from "./zoom-math"
import { useNodeInsertAnimation } from "@/components/editor/workflow-editor/use-node-insert-animation"

export interface HandleConfig {
  readonly id: string
  readonly type: "source" | "target"
  readonly position: Position
  readonly label?: string
  readonly top?: string
  readonly hideHandle?: boolean
  /** When true, BaseNode does NOT render a `<Handle>` for this entry — the
   *  node component owns rendering (e.g. via `HandleWithPopover`). The entry
   *  still counts toward node sizing (`leftCount` / `rightCount`). */
  readonly external?: boolean
  readonly customStyle?: React.CSSProperties
}

interface BaseNodeProps {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly category: "input" | "parameter" | "ai" | "processing" | "output" | "scene" | "character" | "face" | "object" | "location" | "script" | "i2v" | "component"
  readonly credits?: number
  readonly handles: ReadonlyArray<HandleConfig>
  readonly children?: ReactNode
  readonly selected?: boolean
  readonly minWidth?: number
  readonly minHeight?: number
  readonly isRunning?: boolean
  readonly listCount?: number
  readonly listProgress?: string
  readonly listProgressPercent?: number
  readonly toolbarActions?: ReactNode
  readonly hideHeader?: boolean
  readonly bottomToolbarContent?: ReactNode
  readonly topToolbarContent?: ReactNode
  /** Force `topToolbarContent`'s NodeToolbar to stay visible regardless of
   *  hover. Used when the toolbar contains dropdowns/popovers whose portaled
   *  content lands outside the node's hover boundary — without this the
   *  bar disappears mid-pick after the 600ms leave delay. */
  readonly keepTopToolbarVisible?: boolean
  readonly className?: string
  readonly imageAspectRatio?: number
  /** Opt a non-`parameter` node into the bottom-left zoom magnifier
   *  (`CustomHandle`) instead of a second plain resize dot. Reuses
   *  BaseNode's existing 2× zoom-drag handlers. */
  readonly enableZoomHandle?: boolean
}

// Card border + background. The CARD BORDER is uniform across every category
// (light #E2E8F0 / dark #333333) — category identity is carried by the header
// color (CATEGORY_HEADER) and icon, NOT the border, so all nodes read as one
// family on the canvas. (Selected/running states still override the border via
// their own classes below.) Kept as a per-category map so a category can opt
// into a distinct background later without reintroducing border drift.
const NEUTRAL_CARD_STYLE = "bg-white border-[#E2E8F0] dark:border-[#333333] dark:bg-[#101010]/90 dark:backdrop-blur-sm"
const CATEGORY_STYLES: Record<string, string> = {
  input: NEUTRAL_CARD_STYLE,
  parameter: NEUTRAL_CARD_STYLE,
  ai: NEUTRAL_CARD_STYLE,
  processing: NEUTRAL_CARD_STYLE,
  output: NEUTRAL_CARD_STYLE,
  scene: NEUTRAL_CARD_STYLE,
  character: NEUTRAL_CARD_STYLE,
  face: NEUTRAL_CARD_STYLE,
  object: NEUTRAL_CARD_STYLE,
  location: NEUTRAL_CARD_STYLE,
  script: NEUTRAL_CARD_STYLE,
  i2v: NEUTRAL_CARD_STYLE,
  component: NEUTRAL_CARD_STYLE,
}

// Light mode: light gray header with colored icon, Dark mode: colored headers
// AI/Scene/Script nodes keep dark header in both modes for prominence
const CATEGORY_HEADER: Record<string, string> = {
  input: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#007AFF] dark:bg-[#38BDF8] dark:text-white dark:border-t-0",
  parameter: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#6366F1] dark:bg-[#818CF8] dark:text-white dark:border-t-0",
  ai: "bg-[#282828] text-white dark:bg-[#ff0073] dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
  processing: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#475569] dark:bg-[#475569] dark:text-white dark:border-t-0",
  output: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#22C55E] dark:bg-green-600 dark:text-white dark:border-t-0",
  scene: "bg-[#282828] text-white dark:bg-[#ff0073] dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
  character: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#EC4899] dark:bg-[#F472B6] dark:text-white dark:border-t-0",
  face: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#F97316] dark:bg-[#FB923C] dark:text-white dark:border-t-0",
  object: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#10B981] dark:bg-[#34D399] dark:text-white dark:border-t-0",
  location: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#06B6D4] dark:bg-[#22D3EE] dark:text-white dark:border-t-0",
  script: "bg-[#282828] text-white dark:bg-[#ff0073] dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
  i2v: "bg-[#282828] text-white dark:bg-[#ff0073] dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
  component: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#A855F7] dark:bg-[#A855F7] dark:text-white dark:border-t-0",
}

// Icon colors for light mode (category-specific)
const CATEGORY_ICON_COLOR: Record<string, string> = {
  input: "text-[#007AFF] dark:text-white",
  parameter: "text-[#6366F1] dark:text-white",
  ai: "text-white",
  processing: "text-[#475569] dark:text-white",
  output: "text-[#22C55E] dark:text-white",
  scene: "text-white",
  character: "text-[#EC4899] dark:text-white",
  face: "text-[#F97316] dark:text-white",
  object: "text-[#10B981] dark:text-white",
  location: "text-[#06B6D4] dark:text-white",
  script: "text-white",
  i2v: "text-white",
  component: "text-[#A855F7] dark:text-white",
}

function BaseNodeComponent({
  id,
  label,
  icon,
  category,
  credits,
  handles,
  children,
  selected,
  minWidth = 200,
  minHeight = 100,
  isRunning = false,
  listCount,
  listProgress,
  listProgressPercent,
  toolbarActions,
  hideHeader = false,
  bottomToolbarContent,
  topToolbarContent,
  keepTopToolbarVisible,
  className,
  imageAspectRatio,
  enableZoomHandle,
}: BaseNodeProps) {
  // Auto-compute minHeight from handle count: handles need 30px each + 20px padding
  const leftCount = handles.filter((h) => h.position === Position.Left).length
  const rightCount = handles.filter((h) => h.position === Position.Right).length
  const handleMinHeight = (leftCount + rightCount) * 30 + 20
  const effectiveMinHeight = Math.max(minHeight, handleMinHeight)

  const [isHovered, setIsHovered] = useState(false)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    }
  }, [])

  // Inner zoom wrapper bookkeeping + per-node flags + stored height. Combine
  // into ONE selector with shallow compare so we do a single `nodes.find(...)`
  // per store update (not one per flag). Resize fires the store at ~60Hz; with
  // 100+ nodes on canvas, separate selectors meant hundreds of extra O(N) array
  // iterations per frame. `visualH` doubles as the stored-height subscription
  // that drives the auto-fit effect below (re-runs when Fit Content clears
  // height) — keep it as the single source so we don't reintroduce a second
  // O(N) `nodes.find` scan. `isPending` drives the active "node-running" border
  // the instant Run is clicked (the optimistic flip writes
  // data.executionStatus:"pending" before the backend execution even starts).
  // `measuredH` is React Flow's own ResizeObserver measurement (written via
  // applyNodeChanges / onNodesChange). Subscribing to it lets the floor-clamp
  // effect re-fire once RF completes the first measurement of a new node,
  // instead of prematurely pinning the node before measurement arrives.
  const { zoom, visualW, visualH, measuredH, isSkipped, isPending } = useWorkflowStore(
    useShallow((s) => {
      const node = s.nodes.find((n) => n.id === id)
      const data = node?.data as Record<string, unknown> | undefined
      const z = data?.zoom
      return {
        zoom: typeof z === "number" ? z : 1.0,
        visualW: node?.width,
        visualH: node?.height,
        measuredH: node?.measured?.height,
        isSkipped: !!data?.skipped,
        isPending: data?.executionStatus === "pending",
      }
    }),
  )

  // Unified node-sizing effect. One source of truth — runs whenever the
  // aspect ratio, stored height, handle-derived minHeight, or minWidth
  // changes. Two cases:
  //
  //   1. `imageAspectRatio` known → fit box to content aspect. With explicit
  //      width: preserve it, derive height (letterbox via object-cover when
  //      mismatched). Without explicit width: start at `minWidth` and let
  //      `proportionalMinWidth` bump it up only as far as the aspect
  //      requires — gives the snuggest fit for the first generation
  //      instead of inflating portrait/square nodes to a fixed 320px box.
  //      In either branch, floor-clamp height up to `effectiveMinHeight`
  //      so handle stacks stay visible. The width side of the floor-clamp
  //      ALWAYS runs (even when an explicit width is persisted), because
  //      any width below `effectiveMinHeight × aspect` would force the
  //      height clamp into a letterboxed dead-space layout — never a
  //      useful state. Width is bumped to the proportional minimum,
  //      respecting `minWidth` so portrait images don't write a
  //      sub-minimum box.
  //
  //   2. No aspect ratio yet → just ensure stored height ≥ effectiveMinHeight
  //      for nodes the user hasn't explicitly resized (no `rf-resized`).
  //      Catches pre-handle-stack-change workflows where node.height was
  //      persisted below the new handle minimum.
  //
  // Either case triggers `useUpdateNodeInternals` (via the visualH
  // dep on the effect below) so React Flow re-measures handle bounds after
  // any size change.
  useEffect(() => {
    if (!id) return
    const state = useWorkflowStore.getState()
    const node = state.nodes.find((n) => n.id === id)
    if (!node) return
    const hasExplicitResize = typeof node.className === "string" && node.className.includes("rf-resized")
    const hasExplicitWidth = typeof node.width === "number"

    if (imageAspectRatio) {
      // Proportional minimum width — the narrowest a box can be while keeping
      // both `effectiveMinHeight` AND the requested aspect. Anything narrower
      // would either clip handles (height < minHeight) or letterbox the
      // result (height stays at minHeight, width too small for aspect).
      const proportionalMinWidth = Math.max(minWidth, effectiveMinHeight * imageAspectRatio)
      const baseW = hasExplicitWidth ? node.width! : minWidth
      // Always floor-clamp width to the proportional minimum. Existing nodes
      // that were persisted at the OLD minWidth (e.g., legacy 240px) get
      // bumped here even though they have a stored width — without this, a
      // 240×368 box on a 16:9 result stays 240 wide and the result area
      // letterboxes with vertical dead space.
      const w = Math.max(baseW, proportionalMinWidth)
      const correctH = Math.max(effectiveMinHeight, w / imageAspectRatio)
      if (
        typeof node.width === "number" &&
        typeof node.height === "number" &&
        Math.abs(node.width - w) < 2 &&
        Math.abs(node.height - correctH) < 2
      ) return
      const cls = node.className?.includes("rf-resized")
        ? node.className
        : ((node.className ?? "") + " rf-resized").trim()
      useWorkflowStore.setState({
        nodes: state.nodes.map((n) =>
          n.id === id ? { ...n, width: w, height: correctH, className: cls } : n
        ),
      })
      return
    }

    // No aspect ratio: only floor-clamp height for non-resized nodes.
    if (hasExplicitResize) return
    // Guard: if neither an explicit height nor a RF-measured height exists yet,
    // the node just mounted and React Flow's ResizeObserver hasn't fired. Skip
    // now — `measuredH` in the dep array will re-trigger the effect once RF
    // writes the first measurement. Without this guard the effect resolves
    // `0 < effectiveMinHeight` and pins the node at 100px before its natural
    // content height is known, causing picker nodes (h-full layout) to clip
    // content until the user manually invokes "Fit Content".
    if (node.height === undefined && node.measured?.height === undefined) return
    const currentHeight = (node.height ?? node.measured?.height ?? 0) as number
    if (currentHeight >= effectiveMinHeight) return
    useWorkflowStore.setState({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, height: effectiveMinHeight } : n
      ),
    })
  }, [imageAspectRatio, id, visualH, measuredH, effectiveMinHeight, minWidth])

  // After any size change above, re-measure handle bounds. Needed for nodes
  // whose handles use `top: calc(100% - Npx)` (typed-pip stacks anchored to
  // the bottom) so React Flow's cached `getHandleBounds` reflects the new
  // box. Cheap no-op for nodes with absolute top-positioned handles.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    if (id) updateNodeInternals(id)
  }, [id, visualH, updateNodeInternals])

  const { isMobile } = useMobileCanvas()
  const altPressed = useAltKeyStore((s) => s.pressed)
  const newNodeIds = useWorkflowStore((s) => s.newNodeIds)
  const clearNewNode = useWorkflowStore((s) => s.clearNewNode)
  const isEditing = useWorkflowStore((s) => s.selectedNodeId === id)
  const logicalW = visualW != null ? visualW / zoom : undefined
  const logicalH = visualH != null ? visualH / zoom : undefined
  const isNew = newNodeIds.has(id)

  useEffect(() => {
    if (!isNew) return
    const timer = setTimeout(() => clearNewNode(id), 4000)
    return () => clearTimeout(timer)
  }, [isNew, id, clearNewNode])

  // Defensive insurance: when interactive zoom changes width/height + zoom together,
  // React Flow re-measures handle positions automatically. But if width/height happen
  // not to change (e.g. floor clamp), force a re-measure so connection handles stay
  // visually aligned with the zoomed wrapper edges. (Reuses the
  // `updateNodeInternals` declared in the sizing-effect block above.)
  useEffect(() => {
    // Only force re-measurement when zoom is non-identity. At zoom=1 React
    // Flow's native auto-measure handles handle positions correctly — calling
    // updateNodeInternals here would be an extra signal that didn't exist
    // in the pre-feature-branch code, breaking strict identity.
    if (zoom === 1) return
    updateNodeInternals(id)
  }, [id, zoom, updateNodeInternals])

  // Drag state for the bottom-left zoom corner. Snapshot once at drag start.
  // Resize is now handled by <NodeResizeControl> from @xyflow/react and uses
  // its own internal drag state — we don't track it here.
  const updateNodeWithData = useWorkflowStore((s) => s.updateNodeWithData)
  const openFullscreenSettings = useWorkflowStore((s) => s.openFullscreenSettings)
  const dragRef = useRef<{
    mode: "zoom"
    startX: number
    startY: number
    zoom0: number
    logicalW: number
    logicalH: number
    handlePosition: "bottom-left" | "bottom-right"
  } | null>(null)

  function handleIconClick(e: MouseEvent) {
    e.stopPropagation()
    openFullscreenSettings(id)
  }

  function handleMoreMenu(e: MouseEvent) {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent("open-node-context-menu", {
      detail: { nodeId: id, x: e.clientX, y: e.clientY },
    }))
  }

  // -----------------------------------------------------------------------
  // Zoom-handle (bottom-left) drag handlers
  // -----------------------------------------------------------------------
  const handleZoomDragStart = useCallback((e: ReactPointerEvent) => {
    const node = useWorkflowStore.getState().nodes.find((n) => n.id === id)
    // Prefer explicit width if set; fall back to React Flow's auto-measured
    // size (populated by the resize observer once the node renders); finally
    // fall back to minWidth. Matches XYResizer's snapshot behavior.
    const measured = node?.measured as { width?: number; height?: number } | undefined
    const w = node?.width ?? measured?.width ?? minWidth
    const h = node?.height ?? measured?.height ?? effectiveMinHeight
    const z = zoom
    dragRef.current = {
      mode: "zoom",
      startX: e.clientX,
      startY: e.clientY,
      zoom0: z,
      logicalW: Math.round(w / z),
      logicalH: Math.round(h / z),
      // Snapshot which corner the zoom handle is at so the drag-direction
      // math stays consistent even if the user releases Alt mid-drag.
      handlePosition: altPressed ? "bottom-right" : "bottom-left",
    }
  }, [id, zoom, minWidth, effectiveMinHeight, altPressed])

  const handleZoomDragMove = useCallback((e: ReactPointerEvent) => {
    const ds = dragRef.current
    if (!ds || ds.mode !== "zoom") return
    const zRaw = computeZoomFromDrag(
      ds.zoom0,
      { x: ds.startX, y: ds.startY },
      { x: e.clientX, y: e.clientY },
      ds.handlePosition,
    )
    const z = applyMagnet(zRaw, ds.zoom0)
    const visual = computeVisualSize({ w: ds.logicalW, h: ds.logicalH }, z)
    updateNodeWithData(id, { width: visual.w, height: visual.h }, { zoom: z })
  }, [id, updateNodeWithData])

  const handleZoomDragEnd = useCallback((_e: ReactPointerEvent) => {
    const ds = dragRef.current
    dragRef.current = null
    if (!ds) return
    const finalNode = useWorkflowStore.getState().nodes.find((n) => n.id === id)
    if (!finalNode) return
    const finalZoom = (finalNode.data as Record<string, unknown> | undefined)?.zoom
    if (typeof finalZoom === "number" && finalZoom !== ds.zoom0) {
      // Capture exactly one undo snapshot for the entire drag.
      // Using updateNode (not updateNodeData) bypasses the EXECUTION_DATA_KEYS
      // skip wrap; writing a new data reference triggers the undo subscription.
      useWorkflowStore.getState().updateNode(id, {
        data: { ...finalNode.data, zoom: finalZoom } as typeof finalNode.data,
      })
    }
  }, [id])

  // Note: 7 standard resize handles are now rendered via React Flow's
  // <NodeResizeControl>, which encapsulates pointer math, viewport-zoom
  // compensation, min/max clamping, aspect-ratio locking, and corner-anchored
  // position adjustment. We no longer need any of that custom code here.

  // Entrance animation: fade-in + scale-up the first time this node id is
  // seen on the canvas. Powers the Film Director "watch the studio build
  // itself" UX where each per-stage workflow update reveals new nodes live.
  // Idempotent — re-mounting an already-seen node is a no-op.
  const insertStyle = useNodeInsertAnimation(id)

  return (
    <>
    <div
      ref={outerRef}
      className="w-full h-full relative flex flex-col"
      style={insertStyle}
      onMouseEnter={() => {
        if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
        setIsHovered(true)
      }}
      onMouseLeave={() => {
        leaveTimerRef.current = setTimeout(() => setIsHovered(false), 1200)
      }}
    >
      <div
        className={cn(
          "origin-top-left relative",
          // At zoom=1, `display: contents` removes this wrapper from layout
          // entirely — children participate in outerRef's flex column as if
          // the wrapper didn't exist. DOM is byte-for-byte the pre-zoom tree,
          // so nodes with media using `w-full h-full object-cover` (text-to-
          // video, image generation) render exactly as before.
          // At zoom!=1, the wrapper becomes a real flex column at logical
          // dimensions with `transform: scale(zoom)` for visual sizing.
          zoom !== 1 && "flex flex-col h-full",
        )}
        style={{
          display: zoom !== 1 ? undefined : "contents",
          width: zoom !== 1 ? (logicalW != null ? logicalW : "100%") : undefined,
          height: zoom !== 1 ? (logicalH != null ? logicalH : "100%") : undefined,
          transform: zoom !== 1 ? `scale(${zoom})` : undefined,
        }}
      >
      <NodeToolbar align="end" isVisible={isHovered} position={Position.Top} offset={4}>
        <div
          className="flex items-center gap-1"
          onMouseEnter={() => {
            if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
            setIsHovered(true)
          }}
          onMouseLeave={() => {
            leaveTimerRef.current = setTimeout(() => setIsHovered(false), 300)
          }}
        >
          <button
            className="node-more-menu-btn text-muted-foreground transition-colors"
            onClick={handleMoreMenu}
            aria-label="More options"
          >
            <MoreHorizontal size={Math.round(zoom * 13)} />
          </button>
          {toolbarActions}
        </div>
      </NodeToolbar>
      {/* Content above card (e.g. thumbnail gallery) — floats 4px higher than
          the card's top edge gap (-translate-y-6 = 24px vs the prior 20px) so
          the results strip clears the node with a touch more breathing room. */}
      {bottomToolbarContent && isHovered && (
        <div className="relative">
          <div className="absolute left-0 right-0 bottom-0 -translate-y-6 z-50 flex justify-center">
            {bottomToolbarContent}
          </div>
        </div>
      )}
      <div
        className={cn(
          "group relative rounded-xl border-2 shadow-[0_4px_6px_-1px_rgb(0_0_0/0.05)] min-w-[200px] bg-card text-card-foreground flex-auto overflow-hidden flex flex-col",
          "hover:border-black/40 dark:hover:border-white/40 transition-colors duration-200",
          CATEGORY_STYLES[category],
          // Focused (selected, no settings): blue glow
          selected && !isEditing && "border-blue-400 shadow-[0_0_20px_rgba(96,165,250,0.6)]",
          // Editing (selected + settings open): brand pink glow
          isEditing && "border-[#ff0073] shadow-[0_0_20px_rgba(255,0,115,0.5)]",
          isEditing && category === "input" && "dark:shadow-[0_0_20px_rgba(56,189,248,0.4)]",
          isEditing && category === "parameter" && "dark:shadow-[0_0_20px_rgba(129,140,248,0.4)]",
          isEditing && (category === "ai" || category === "scene" || category === "script" || category === "i2v") && "dark:shadow-[0_0_25px_rgba(255,0,115,0.5)]",
          isEditing && category === "processing" && "dark:shadow-[0_0_20px_rgba(71,85,105,0.4)]",
          isEditing && category === "character" && "dark:shadow-[0_0_20px_rgba(244,114,182,0.4)]",
          isEditing && category === "location" && "dark:shadow-[0_0_20px_rgba(34,211,238,0.4)]",
          isEditing && category === "object" && "dark:shadow-[0_0_20px_rgba(52,211,153,0.4)]",
          isEditing && category === "output" && "dark:shadow-[0_0_20px_rgba(34,197,94,0.4)]",
          isEditing && category === "component" && "dark:shadow-[0_0_20px_rgba(168,85,247,0.4)]",
          (isRunning || isPending) && "node-running",
          isNew && !isRunning && !isPending && "node-new-pulse",
          isSkipped && "opacity-40 border-dashed",
          className,
        )}
        style={{ minHeight: effectiveMinHeight }}
        /* Selection handled by onNodeClick in workflow-canvas (has drag guard) */
      >
      {(!hideHeader || isSkipped) && (
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-t-md font-sans text-[11px] font-semibold uppercase tracking-[0.05em]",
            CATEGORY_HEADER[category],
          )}
        >
          <button
            type="button"
            onClick={handleIconClick}
            className={cn(
              // `[&>svg]:size-4` keeps the header icon in lockstep with the
              // floating-label icon (EditableNodeLabel) — same 16px glyph in a
              // 24px box across every node, regardless of the per-node size.
              "w-6 h-6 rounded-md flex items-center justify-center [&>svg]:size-4 cursor-pointer transition-colors",
              // Light-bg categories: tint icon to brand pink on hover
              // Dark/brand-pink-bg categories: dim on hover (white icon on pink bg
              // would vanish if we applied hover:text-[#ff0073])
              category === "input"      ? "bg-[#007AFF]/10 dark:bg-white/20 text-[#007AFF] dark:text-white hover:text-[#ff0073]" :
              category === "parameter"  ? "bg-[#6366F1]/10 dark:bg-white/20 text-[#6366F1] dark:text-white hover:text-[#ff0073]" :
              category === "processing" ? "bg-[#475569]/10 dark:bg-white/20 text-[#475569] dark:text-white hover:text-[#ff0073]" :
              category === "output"     ? "bg-[#22C55E]/10 dark:bg-white/20 text-[#22C55E] dark:text-white hover:text-[#ff0073]" :
              category === "component"  ? "bg-[#A855F7]/10 dark:bg-white/20 text-[#A855F7] dark:text-white hover:text-[#ff0073]" :
              (category === "character" || category === "location" || category === "object" ||
               category === "ai"        || category === "scene"    || category === "script" || category === "i2v")
                                        ? "bg-[#ff0073] dark:bg-white/20 text-white hover:opacity-70" :
              cn(CATEGORY_ICON_COLOR[category], "hover:text-[#ff0073]")
            )}
          >
            {icon}
          </button>
          <span className="flex-1 truncate">{label}</span>
          {listProgress && (
            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 animate-pulse">
              {listProgress}
            </span>
          )}
          {!listProgress && listCount !== undefined && listCount > 1 && (
            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              x{listCount}
            </span>
          )}
          {credits !== undefined && credits > 0 && (
            <span className={cn(
              "font-mono text-[10px]",
              (category === "ai" || category === "scene" || category === "script" || category === "i2v")
                ? "text-white/70 dark:text-[#ff0073]"
                : "text-[#64748B] dark:text-[#ff0073]"
            )}>{credits}cr</span>
          )}
          {isSkipped && (
            <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30">
              SKIP
            </span>
          )}
        </div>
      )}

      {!hideHeader && listProgressPercent !== undefined && listProgressPercent > 0 && (
        <div className="w-full px-3 py-1.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-mono text-cyan-300">
              {listProgressPercent < 100 ? "Processing list..." : "Complete"}
            </span>
            <span className="text-[10px] font-mono text-cyan-300">
              {listProgressPercent}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-black/30 dark:bg-white/10 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                listProgressPercent < 100
                  ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 animate-pulse"
                  : "bg-cyan-400"
              )}
              style={{ width: `${listProgressPercent}%` }}
            />
          </div>
        </div>
      )}

      {children && (
        hideHeader
          ? <div className="text-xs overflow-hidden flex-1 min-h-0">{children}</div>
          : <div className="px-3 py-2 text-xs overflow-hidden flex-1 min-h-0 bg-white dark:bg-transparent text-[#1E293B] dark:text-card-foreground">{children}</div>
      )}
    </div>
      {/* Content below card (e.g. run button) */}
      {topToolbarContent && (
        <NodeToolbar align="center" isVisible={isHovered || !!keepTopToolbarVisible || isRunning || isPending} position={Position.Bottom} offset={4}>
          <div
            // The bottom toolbar renders in a portal outside the node's DOM
            // subtree, so hovering it doesn't trigger the node's
            // onMouseEnter. Bridge the gap: keep `isHovered` true while the
            // cursor sits over the toolbar itself, and start a fresh
            // leave-timer when it exits.
            onMouseEnter={() => {
              if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
              setIsHovered(true)
            }}
            onMouseLeave={() => {
              leaveTimerRef.current = setTimeout(() => setIsHovered(false), 600)
            }}
          >
            {topToolbarContent}
          </div>
        </NodeToolbar>
      )}

      {handles.map((h) => (
        // Composite key: a node can legitimately have the same handle id on
        // both sides (e.g. audio-isolation's input `audio` + output `audio`),
        // so keying by id alone would collide in React's keyed reconciliation.
        <div key={`${h.type}-${h.id}`}>
          {!h.external && <Handle
            id={h.id}
            type={h.type}
            position={h.position}
            isConnectable
            className="!w-7 !h-7 !bg-transparent !border-0 touch-manipulation"
            style={{
              ...(h.customStyle ?? (h.top ? { top: h.top } : undefined)),
              ...(h.hideHandle ? { background: 'transparent', opacity: 0 } : undefined),
              // Center the 28px handle on its `top` anchor so its measured
              // center coincides with the HandleIcon (which also uses -50%).
              // -60% left the edge endpoint ~2.8px above each icon center.
              transform: 'translateY(-50%)',
              zIndex: 30,
            }}
          />}
          {h.label && h.top && (
            <span
              className={cn(
                "absolute text-[9px] font-medium pointer-events-none select-none leading-none px-1 py-0.5 rounded",
                "text-muted-foreground bg-background/80 dark:bg-muted/60",
                h.type === "target" ? "left-3" : "right-3",
              )}
              style={{ top: h.top, transform: "translateY(-50%)" }}
            >
              {h.label}
            </span>
          )}
        </div>
      ))}

      </div>
      {/* Bottom-corner controls. Parameter nodes (cinematography) and any
          node that opts in via `enableZoomHandle` get the zoom magnifier on
          one corner + a single resize dot on the other (Alt-swappable). All
          other categories get plain resize dots on both corners — no
          per-node zoom. */}
      {!isMobile && (isHovered || !!selected) && (
        (category === "parameter" || enableZoomHandle) ? (
          <>
            {/* Hold Alt to swap: resize moves to bottom-left, zoom to bottom-right. */}
            <NodeResizeControl
              nodeId={id}
              position={altPressed ? "bottom-left" : "bottom-right"}
              minWidth={minWidth}
              minHeight={effectiveMinHeight}
              keepAspectRatio={!!imageAspectRatio}
              className="!w-2.5 !h-2.5 !border-0 !rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--muted-foreground) 40%, transparent)" }}
            />
            <CustomHandle
              visible
              position={altPressed ? "bottom-right" : "bottom-left"}
              onDragStart={handleZoomDragStart}
              onDragMove={handleZoomDragMove}
              onDragEnd={handleZoomDragEnd}
            />
          </>
        ) : (
          <>
            <NodeResizeControl
              nodeId={id}
              position="bottom-right"
              minWidth={minWidth}
              minHeight={effectiveMinHeight}
              keepAspectRatio={!!imageAspectRatio}
              className="!w-2.5 !h-2.5 !border-0 !rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--muted-foreground) 40%, transparent)" }}
            />
            <NodeResizeControl
              nodeId={id}
              position="bottom-left"
              minWidth={minWidth}
              minHeight={effectiveMinHeight}
              keepAspectRatio={!!imageAspectRatio}
              className="!w-2.5 !h-2.5 !border-0 !rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--muted-foreground) 40%, transparent)" }}
            />
          </>
        )
      )}
    </div>
    </>
  )
}

export const BaseNode = memo(BaseNodeComponent)
