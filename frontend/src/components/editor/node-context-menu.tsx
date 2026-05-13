"use client"

import { useEffect, useRef, useMemo, useState } from "react"
import { Play, FastForward, ListChecks, Copy, Trash2, CircleSlash, CircleCheck, ImageIcon, ZoomIn, Maximize2, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { useReactFlow } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_DEFINITIONS, type CharacterNodeData } from "@/types/nodes"
import { duplicateCharacter } from "@/lib/api"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"

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
  const projectId = useWorkflowStore((s) => s.projectId)
  const { screenToFlowPosition } = useReactFlow()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const ref = useRef<HTMLDivElement>(null)
  const [forking, setForking] = useState(false)

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

  /** "Duplicate as new character" is only meaningful on a character node that
   *  already has a DB id (i.e. the row exists). Without a DB id there's nothing
   *  to fork — the regular Duplicate handles that case. */
  const characterDbId = useMemo<string | null>(() => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node || node.type !== "character") return null
    const dbId = (node.data as CharacterNodeData).characterDbId
    return dbId && dbId.length > 0 ? dbId : null
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

  /**
   * Fork into a brand-new character row. Default Duplicate clones the canvas
   * node and clears `characterDbId` (use-workflow-store.duplicateNode), which
   * means the new node will lazy-insert a row on first generate — but using
   * the SAME name as the source, which then 409s on the unique constraint.
   * This action duplicates the node AND eagerly creates the new DB row with
   * an auto-suffixed "(copy)" name, rewiring the new node to point at it.
   */
  async function handleDuplicateAsNewCharacter() {
    if (!characterDbId) return
    setForking(true)
    try {
      const flowPos = screenToFlowPosition({ x, y })
      // duplicateNode returns void, so diff node ids before/after to find the
      // freshly-created node. (Modifying the store action's signature to
      // return the new id would be a sweeping change for one caller.)
      const before = new Set(useWorkflowStore.getState().nodes.map((n) => n.id))
      duplicateNode(nodeId, flowPos)
      const freshNode = useWorkflowStore
        .getState()
        .nodes.find((n) => !before.has(n.id) && n.type === "character")
      if (!freshNode) {
        toast.error("Couldn't duplicate node.")
        return
      }
      const { id: newDbId, name } = await duplicateCharacter(characterDbId, {
        nodeId: freshNode.id,
        projectId: projectId ?? undefined,
      })
      // Rewire the freshly-duplicated node to point at the new row.
      updateNodeWithData(
        freshNode.id,
        {},
        { characterDbId: newDbId, characterName: name },
      )
      // Library list needs to refresh so the new character shows up.
      queryClient.invalidateQueries({ queryKey: queryKeys.assets.characters(projectId ?? undefined, user?.id) })
      toast.success(`Forked to '${name}'`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to duplicate as new character.")
    } finally {
      setForking(false)
      onClose()
    }
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
      {characterDbId && (
        <button
          className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left disabled:opacity-50"
          onClick={handleDuplicateAsNewCharacter}
          disabled={forking}
          title="Create an independent character (default Duplicate shares the same library entry)"
        >
          <UserPlus className="h-3.5 w-3.5" />
          {forking ? "Forking…" : "Duplicate as new character"}
        </button>
      )}
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
