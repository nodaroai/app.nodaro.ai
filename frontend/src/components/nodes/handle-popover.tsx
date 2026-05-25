"use client"

import { useCallback } from "react"
import { useReactFlow } from "@xyflow/react"
import { ArrowRight, X, Plus } from "lucide-react"
import { useHandleConnections, type HandleConnection } from "@/hooks/use-handle-connections"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { cn } from "@/lib/utils"

interface HandlePopoverProps {
  readonly nodeId: string
  readonly handleId: string
  readonly direction: "source" | "target"
  readonly label: string
  readonly orderMatters?: boolean
  readonly onAddNew?: () => void
  readonly onClose?: () => void
}

/** Popover content listing connected upstream/downstream nodes with
 *  jump/disconnect/add affordances. Node-agnostic — works for any handle. */
export function HandlePopover({
  nodeId,
  handleId,
  direction,
  label,
  orderMatters,
  onAddNew,
  onClose,
}: HandlePopoverProps) {
  const connections = useHandleConnections(nodeId, handleId, direction)
  const { setCenter, getNode } = useReactFlow()
  const deleteEdge = useWorkflowStore((s) => s.deleteEdge)
  const selectNode = useWorkflowStore((s) => s.selectNode)

  const handleJump = useCallback(
    (otherNodeId: string) => {
      const target = getNode(otherNodeId)
      if (!target) return
      const w = (target.measured?.width ?? 200) as number
      const h = (target.measured?.height ?? 150) as number
      setCenter(target.position.x + w / 2, target.position.y + h / 2, { zoom: 1, duration: 400 })
      selectNode(otherNodeId)
      onClose?.()
    },
    [getNode, setCenter, selectNode, onClose],
  )

  return (
    <div className="min-w-[220px] max-w-[300px]">
      <div className="px-1 pb-2 text-xs font-semibold text-muted-foreground flex items-center justify-between gap-2">
        <span className="flex-1 truncate">
          {label}
          {connections.length > 0 && <span className="ml-1.5 opacity-60">{connections.length}</span>}
        </span>
        {onClose && (
          <button
            type="button"
            aria-label="Close"
            className="p-0.5 hover:bg-accent rounded opacity-60 hover:opacity-100 transition-opacity"
            onClick={onClose}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {connections.length === 0 ? (
        <div className="px-1 py-1.5 text-xs text-muted-foreground/70">Nothing connected</div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {connections.map((c) => (
            <ConnectionRow
              key={c.edgeId}
              connection={c}
              orderMatters={orderMatters}
              onJump={() => handleJump(c.otherNodeId)}
              onDisconnect={() => deleteEdge(c.edgeId)}
            />
          ))}
        </ul>
      )}
      {onAddNew && (
        <>
          <div className="border-t border-border my-2" />
          <button
            type="button"
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent rounded-sm transition-colors"
            onClick={() => {
              onAddNew()
              onClose?.()
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add new
          </button>
        </>
      )}
    </div>
  )
}

function ConnectionRow({
  connection,
  orderMatters,
  onJump,
  onDisconnect,
}: {
  connection: HandleConnection
  orderMatters?: boolean
  onJump: () => void
  onDisconnect: () => void
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-1 px-1.5 py-1 text-xs rounded-sm hover:bg-accent group",
      )}
    >
      <span className="flex-1 truncate text-foreground" title={connection.otherNodeLabel}>
        {connection.otherNodeLabel}
      </span>
      <button
        type="button"
        aria-label={`Jump to ${connection.otherNodeLabel}`}
        className="p-1 hover:bg-background rounded opacity-60 hover:opacity-100 transition-opacity"
        onClick={onJump}
      >
        <ArrowRight className="w-3 h-3" />
      </button>
      <button
        type="button"
        aria-label={`Disconnect ${connection.otherNodeLabel}`}
        className="p-1 hover:bg-background hover:text-destructive rounded opacity-60 hover:opacity-100 transition-opacity"
        onClick={onDisconnect}
      >
        <X className="w-3 h-3" />
      </button>
      {orderMatters && <span className="sr-only">order matters</span>}
    </li>
  )
}
