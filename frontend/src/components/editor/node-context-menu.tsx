"use client"

import { useEffect, useRef, useMemo } from "react"
import { Play, FastForward, ListChecks, Copy, Trash2, CircleSlash, CircleCheck, ImageIcon, ZoomIn, Maximize2 } from "lucide-react"
import { useReactFlow } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_DEFINITIONS } from "@/types/nodes"

interface NodeContextMenuProps {
  readonly nodeId: string
  readonly x: number
  readonly y: number
  readonly onClose: () => void
}

export function NodeContextMenu({ nodeId, x, y, onClose }: NodeContextMenuProps) {
  const duplicateNode = useWorkflowStore((s) => s.duplicateNode)
  const deleteNode = useWorkflowStore((s) => s.deleteNode)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const runSelected = useWorkflowStore((s) => s.runSelected)
  const toggleSkipNode = useWorkflowStore((s) => s.toggleSkipNode)
  const setWorkflowThumbnail = useWorkflowStore((s) => s.setWorkflowThumbnail)
  const updateNode = useWorkflowStore((s) => s.updateNode)
  const updateNodeWithData = useWorkflowStore((s) => s.updateNodeWithData)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const { screenToFlowPosition } = useReactFlow()
  const ref = useRef<HTMLDivElement>(null)

  const hasDownstream = useMemo(() => {
    return edges.some((e) => e.source === nodeId)
  }, [nodeId, edges])

  const selectedCount = useMemo(() => {
    return nodes.filter((n) => n.selected).length
  }, [nodes])

  const isRunning = useMemo(() => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return false
    return (node.data as Record<string, unknown>).executionStatus === "running"
  }, [nodeId, nodes])

  const isSkipped = useMemo(() => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return false
    return !!(node.data as Record<string, unknown>).skipped
  }, [nodeId, nodes])

  const thumbnailUrl = useMemo(() => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return null
    const d = node.data as Record<string, unknown>
    return (d.generatedImageUrl as string) ?? (d.generatedVideoUrl as string) ?? null
  }, [nodeId, nodes])

  const zoom = useMemo(() => {
    const node = nodes.find((n) => n.id === nodeId)
    const z = (node?.data as Record<string, unknown> | undefined)?.zoom
    return typeof z === "number" ? z : 1.0
  }, [nodeId, nodes])

  // Per-node zoom is only available on parameter (cinematography) nodes —
  // matches BaseNode which renders the zoom magnifier handle for those
  // categories only. Other nodes get plain resize on both bottom corners
  // and the menu hides the zoom row.
  const showZoom = useMemo(() => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return false
    const def = NODE_DEFINITIONS.find((d) => d.type === node.type)
    return def?.category === "parameter"
  }, [nodeId, nodes])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [onClose])

  function handleRun() {
    runSingleNode?.(nodeId)
    onClose()
  }

  function handleRunFromHere() {
    runFromHere?.(nodeId)
    onClose()
  }

  function handleRunSelected() {
    runSelected?.()
    onClose()
  }

  function handleSetThumbnail() {
    if (thumbnailUrl) {
      setWorkflowThumbnail(thumbnailUrl)
    }
    onClose()
  }

  function handleToggleSkip() {
    toggleSkipNode(nodeId)
    onClose()
  }

  function handleSetZoom(newZoom: number) {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return
    const z0 = zoom
    if (newZoom === z0) return
    // Preserve logical size, scale the visual box by the new zoom.
    const measured = node.measured as { width?: number; height?: number } | undefined
    const w0 = node.width ?? measured?.width ?? 200
    const h0 = node.height ?? measured?.height ?? 100
    const logicalW = Math.round(w0 / z0)
    const logicalH = Math.round(h0 / z0)
    const newW = Math.round(logicalW * newZoom)
    const newH = Math.round(logicalH * newZoom)
    // Single batched write via the action that bypasses undo for zoom-only data.
    updateNodeWithData(nodeId, { width: newW, height: newH }, { zoom: newZoom })
    // Follow-up via updateNode to capture exactly one undo snapshot
    // (data ref change). Mirrors the BaseNode handleZoomDragEnd pattern.
    const refreshed = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
    if (refreshed) {
      useWorkflowStore.getState().updateNode(nodeId, {
        data: { ...refreshed.data, zoom: newZoom } as typeof refreshed.data,
      })
    }
    // Don't close the menu — let the user keep adjusting.
  }

  function handleFitContent() {
    // Clear height only — preserves user's chosen width and zoom. The
    // useAutoMeasureForZoom hook in parameter-node-shell handles the
    // visual = logical × zoom write-back at non-identity zoom.
    updateNode(nodeId, { height: undefined })
    onClose()
  }

  function handleDuplicate() {
    const flowPos = screenToFlowPosition({ x, y })
    duplicateNode(nodeId, flowPos)
    onClose()
  }

  function handleDelete() {
    deleteNode(nodeId)
    onClose()
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] bg-popover border rounded-md shadow-md py-1"
      style={{ left: x, top: y }}
    >
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left disabled:opacity-50"
        onClick={handleRun}
        disabled={isRunning}
      >
        <Play className="h-3.5 w-3.5" />
        Run
      </button>
      {hasDownstream && (
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left disabled:opacity-50"
          onClick={handleRunFromHere}
          disabled={isRunning}
        >
          <FastForward className="h-3.5 w-3.5" />
          Run from here
        </button>
      )}
      {selectedCount >= 2 && (
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left disabled:opacity-50"
          onClick={handleRunSelected}
          disabled={isRunning}
        >
          <ListChecks className="h-3.5 w-3.5" />
          Run selected ({selectedCount})
        </button>
      )}
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
        onClick={handleToggleSkip}
      >
        {isSkipped ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleSlash className="h-3.5 w-3.5" />}
        {isSkipped ? "Unskip Node" : "Skip Node"}
      </button>
      {thumbnailUrl && (
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
          onClick={handleSetThumbnail}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          Set as Thumbnail
        </button>
      )}
      {/* Zoom row: shows current zoom with - / + / reset buttons inline.
          Only rendered for nodes that have the zoom magnifier handle —
          see `showZoom` above. */}
      {showZoom && (
        <div className="flex items-center gap-1 px-3 py-1.5 text-sm">
          <ZoomIn className="h-3.5 w-3.5" />
          <span className="flex-1">Zoom: {Math.round(zoom * 100)}%</span>
          {/* Fixed-width buttons so different glyph widths (−, +, ↺) and
              disabled-state changes don't shift sibling buttons sideways. */}
          <button
            className="w-6 h-5 flex items-center justify-center hover:bg-accent rounded text-xs"
            onClick={() => handleSetZoom(Math.max(0.5, Math.round((zoom - 0.25) * 100) / 100))}
            title="Decrease zoom"
          >−</button>
          <button
            className="w-6 h-5 flex items-center justify-center hover:bg-accent rounded text-xs"
            onClick={() => handleSetZoom(Math.min(2.0, Math.round((zoom + 0.25) * 100) / 100))}
            title="Increase zoom"
          >+</button>
          <button
            className="w-6 h-5 flex items-center justify-center hover:bg-accent rounded text-xs disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            disabled={zoom === 1}
            onClick={() => handleSetZoom(1)}
            title="Reset to 100%"
          >↺</button>
        </div>
      )}
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
        onClick={handleFitContent}
      >
        <Maximize2 className="h-3.5 w-3.5" />
        Fit Content
      </button>
      <div className="my-1 border-t" />
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
        onClick={handleDuplicate}
      >
        <Copy className="h-3.5 w-3.5" />
        Duplicate
        <span className="ml-auto text-xs text-muted-foreground">Ctrl+D</span>
      </button>
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left text-destructive"
        onClick={handleDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
        <span className="ml-auto text-xs text-muted-foreground">Del</span>
      </button>
    </div>
  )
}
