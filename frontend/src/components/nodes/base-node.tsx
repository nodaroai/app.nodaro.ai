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
  readonly className?: string
  readonly imageAspectRatio?: number
}

// Light mode: white bg with colored top accent line, Dark mode: category-colored borders
const CATEGORY_STYLES: Record<string, string> = {
  input: "bg-white border-[#E2E8F0] dark:border-[#333333] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  parameter: "bg-white border-[#E2E8F0] dark:border-[#818CF8] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  ai: "bg-white border-[#E2E8F0] dark:border-[#333333] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  processing: "bg-white border-[#E2E8F0] dark:border-[#475569] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  output: "bg-white border-[#E2E8F0] dark:border-green-500 dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  scene: "bg-white border-[#E2E8F0] dark:border-[#ff0073] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  character: "bg-white border-[#E2E8F0] dark:border-[#F472B6] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  face: "bg-white border-[#E2E8F0] dark:border-[#FB923C] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  object: "bg-white border-[#E2E8F0] dark:border-[#34D399] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  location: "bg-white border-[#E2E8F0] dark:border-[#22D3EE] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  script: "bg-white border-[#E2E8F0] dark:border-[#ff0073] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  i2v: "bg-white border-[#E2E8F0] dark:border-[#ff0073] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
  component: "bg-white border-[#E2E8F0] dark:border-[#A855F7] dark:bg-[#101010]/90 dark:backdrop-blur-sm",
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
  className,
  imageAspectRatio,
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

  // Reactive subscription to the node's stored height — used to drive the
  // auto-fit effect below so it re-runs when Fit Content clears height.
  const storedHeight = useWorkflowStore((s) => s.nodes.find((n) => n.id === id)?.height)

  // Unified node-sizing effect. One source of truth — runs whenever the
  // aspect ratio, stored height, handle-derived minHeight, or minWidth
  // changes. Two cases:
  //
  //   1. `imageAspectRatio` known → fit box to content aspect. With explicit
  //      width: preserve it, derive height (letterbox via object-cover when
  //      mismatched). Without explicit width: promote to 320px, derive
  //      height. In either branch, floor-clamp height up to
  //      `effectiveMinHeight` so handle stacks stay visible. The width side
  //      of the floor-clamp only kicks in for non-resized nodes (avoids
  //      ballooning a user's deliberately compact width); it also respects
  //      `minWidth` so portrait images don't write a sub-minimum box.
  //
  //   2. No aspect ratio yet → just ensure stored height ≥ effectiveMinHeight
  //      for nodes the user hasn't explicitly resized (no `rf-resized`).
  //      Catches pre-handle-stack-change workflows where node.height was
  //      persisted below the new handle minimum.
  //
  // Either case triggers `useUpdateNodeInternals` (via the storedHeight
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
      let w = hasExplicitWidth ? node.width! : 320
      let correctH = w / imageAspectRatio
      if (correctH < effectiveMinHeight) {
        correctH = effectiveMinHeight
        if (!hasExplicitWidth) {
          w = Math.max(minWidth, effectiveMinHeight * imageAspectRatio)
        }
      }
      if (hasExplicitWidth && typeof node.height === "number" && Math.abs(node.height - correctH) < 2 && Math.abs((node.width ?? 0) - w) < 2) return
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
    const currentHeight = (node.height ?? node.measured?.height ?? 0) as number
    if (currentHeight >= effectiveMinHeight) return
    useWorkflowStore.setState({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, height: effectiveMinHeight } : n
      ),
    })
  }, [imageAspectRatio, id, storedHeight, effectiveMinHeight, minWidth])

  // After any size change above, re-measure handle bounds. Needed for nodes
  // whose handles use `top: calc(100% - Npx)` (typed-pip stacks anchored to
  // the bottom) so React Flow's cached `getHandleBounds` reflects the new
  // box. Cheap no-op for nodes with absolute top-positioned handles.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    if (id) updateNodeInternals(id)
  }, [id, storedHeight, updateNodeInternals])

  const { isMobile } = useMobileCanvas()
  const altPressed = useAltKeyStore((s) => s.pressed)
  const newNodeIds = useWorkflowStore((s) => s.newNodeIds)
  const clearNewNode = useWorkflowStore((s) => s.clearNewNode)
  const isEditing = useWorkflowStore((s) => s.selectedNodeId === id)
  const isSkipped = useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === id)
    return !!(node?.data as Record<string, unknown> | undefined)?.skipped
  })
  // Inner zoom wrapper bookkeeping. Combine into one selector with shallow
  // compare so we do ONE `nodes.find(...)` per store update (not three).
  // Resize fires the store at ~60Hz; with 100+ nodes on canvas, three
  // separate selectors meant 300 extra O(N) array iterations per frame.
  const { zoom, visualW, visualH } = useWorkflowStore(
    useShallow((s) => {
      const node = s.nodes.find((n) => n.id === id)
      const z = (node?.data as Record<string, unknown> | undefined)?.zoom
      return {
        zoom: typeof z === "number" ? z : 1.0,
        visualW: node?.width,
        visualH: node?.height,
      }
    }),
  )
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
  const dragRef = useRef<{
    mode: "zoom"
    startX: number
    startY: number
    zoom0: number
    logicalW: number
    logicalH: number
    handlePosition: "bottom-left" | "bottom-right"
  } | null>(null)

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
        leaveTimerRef.current = setTimeout(() => setIsHovered(false), 600)
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
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleMoreMenu}
            aria-label="More options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {toolbarActions}
        </div>
      </NodeToolbar>
      {/* Content above card (e.g. thumbnail gallery) */}
      {bottomToolbarContent && isHovered && (
        <div className="relative">
          <div className="absolute left-0 right-0 bottom-0 -translate-y-5 z-50 flex justify-center">
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
          isRunning && "node-running",
          isNew && !isRunning && "node-new-pulse",
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
          {category === "input" ? (
            <span className="w-6 h-6 rounded-md bg-[#007AFF]/10 dark:bg-white/20 flex items-center justify-center text-[#007AFF] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
              {icon}
            </span>
          ) : category === "parameter" ? (
            <span className="w-6 h-6 rounded-md bg-[#6366F1]/10 dark:bg-white/20 flex items-center justify-center text-[#6366F1] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
              {icon}
            </span>
          ) : category === "processing" ? (
            <span className="w-6 h-6 rounded-md bg-[#475569]/10 dark:bg-white/20 flex items-center justify-center text-[#475569] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
              {icon}
            </span>
          ) : category === "output" ? (
            <span className="w-6 h-6 rounded-md bg-[#22C55E]/10 dark:bg-white/20 flex items-center justify-center text-[#22C55E] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
              {icon}
            </span>
          ) : category === "character" ? (
            <span className="w-6 h-6 rounded-md bg-[#ff0073] dark:bg-white/20 flex items-center justify-center text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
              {icon}
            </span>
          ) : category === "location" ? (
            <span className="w-6 h-6 rounded-md bg-[#ff0073] dark:bg-white/20 flex items-center justify-center text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
              {icon}
            </span>
          ) : category === "object" ? (
            <span className="w-6 h-6 rounded-md bg-[#ff0073] dark:bg-white/20 flex items-center justify-center text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
              {icon}
            </span>
          ) : category === "component" ? (
            <span className="w-6 h-6 rounded-md bg-[#A855F7]/10 dark:bg-white/20 flex items-center justify-center text-[#A855F7] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
              {icon}
            </span>
          ) : (category === "ai" || category === "scene" || category === "script" || category === "i2v") ? (
            <span className="w-6 h-6 rounded-md bg-[#ff0073] dark:bg-white/20 flex items-center justify-center text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
              {icon}
            </span>
          ) : (
            <span className={cn("w-6 h-6 rounded-md flex items-center justify-center [&>svg]:w-3.5 [&>svg]:h-3.5", CATEGORY_ICON_COLOR[category])}>{icon}</span>
          )}
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
        <NodeToolbar align="center" isVisible={isHovered} position={Position.Bottom} offset={4}>
          {topToolbarContent}
        </NodeToolbar>
      )}

      {handles.map((h) => (
        <div key={h.id}>
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
      {/* Bottom-corner controls. Parameter nodes (cinematography) get the
          zoom magnifier on one corner + a single resize dot on the other
          (Alt-swappable). All other categories get plain resize dots on
          both corners — no per-node zoom. */}
      {!isMobile && (isHovered || !!selected) && (
        category === "parameter" ? (
          <>
            {/* Hold Alt to swap: resize moves to bottom-left, zoom to bottom-right. */}
            <NodeResizeControl
              nodeId={id}
              position={altPressed ? "bottom-left" : "bottom-right"}
              minWidth={minWidth}
              minHeight={effectiveMinHeight}
              keepAspectRatio={!!imageAspectRatio}
              className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-0 !rounded-full"
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
              className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-0 !rounded-full"
            />
            <NodeResizeControl
              nodeId={id}
              position="bottom-left"
              minWidth={minWidth}
              minHeight={effectiveMinHeight}
              keepAspectRatio={!!imageAspectRatio}
              className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-0 !rounded-full"
            />
          </>
        )
      )}
    </div>
    </>
  )
}

export const BaseNode = memo(BaseNodeComponent)
