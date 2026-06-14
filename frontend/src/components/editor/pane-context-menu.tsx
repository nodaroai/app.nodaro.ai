"use client"

import { useRef } from "react"
import { StickyNote } from "lucide-react"
import { SHORTCUTS, formatBinding, isMacPlatform } from "@/lib/shortcuts"
import { useClickOutside } from "@/hooks/use-click-outside"

interface PaneContextMenuProps {
  readonly x: number
  readonly y: number
  readonly onClose: () => void
  readonly onAddStickyNote: () => void
}

export function PaneContextMenu({ x, y, onClose, onAddStickyNote }: PaneContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isMac = isMacPlatform()

  useClickOutside(ref, onClose)

  function handleAddStickyNote() {
    onAddStickyNote()
    onClose()
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] bg-popover border rounded-md shadow-md py-1"
      style={{ left: x, top: y }}
    >
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-left"
        onClick={handleAddStickyNote}
      >
        <StickyNote className="h-3.5 w-3.5" />
        Add Sticky Note
        <span className="ml-auto text-xs text-muted-foreground">{formatBinding(SHORTCUTS.stickyNote.bindings[0], isMac)}</span>
      </button>
    </div>
  )
}
