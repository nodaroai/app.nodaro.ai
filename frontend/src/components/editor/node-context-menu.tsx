"use client"

import { useEffect, useRef, useMemo } from "react"
import { Play, FastForward, ListChecks, Copy, Trash2, CircleSlash, CircleCheck } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

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
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
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

  function handleToggleSkip() {
    toggleSkipNode(nodeId)
    onClose()
  }

  function handleDuplicate() {
    duplicateNode(nodeId)
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
