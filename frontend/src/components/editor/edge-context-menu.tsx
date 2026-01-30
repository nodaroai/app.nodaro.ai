"use client"

import { useEffect, useRef } from "react"
import { Trash2 } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

interface EdgeContextMenuProps {
  readonly edgeId: string
  readonly x: number
  readonly y: number
  readonly onClose: () => void
}

export function EdgeContextMenu({ edgeId, x, y, onClose }: EdgeContextMenuProps) {
  const deleteEdge = useWorkflowStore((s) => s.deleteEdge)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [onClose])

  function handleDelete() {
    deleteEdge(edgeId)
    onClose()
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] bg-popover border rounded-md shadow-md py-1"
      style={{ left: x, top: y }}
    >
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left text-destructive"
        onClick={handleDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete connection
        <span className="ml-auto text-xs text-muted-foreground">Del</span>
      </button>
    </div>
  )
}
