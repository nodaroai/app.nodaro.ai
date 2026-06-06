"use client"

import { useEffect, useRef } from "react"
import { Plus, StickyNote, Wand2, MousePointer2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { SHORTCUTS, formatBindingCaps, isMacPlatform } from "@/lib/shortcuts"
import { Kbd } from "@/components/ui/kbd"

interface MenuItemProps {
  readonly icon: React.ReactNode
  readonly label: string
  readonly shortcut?: readonly string[]
  readonly onClick: () => void
  readonly disabled?: boolean
}

function MenuItem({ icon, label, shortcut, onClick, disabled }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 text-left",
        "transition-colors",
        "hover:bg-[#F1F5F9] dark:hover:bg-[#2D2D2D]",
        disabled && "opacity-50 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent"
      )}
    >
      <span className="text-[#64748B] dark:text-[#94A3B8]">{icon}</span>
      <span className="flex-1 text-sm text-[#1E293B] dark:text-white">{label}</span>
      {shortcut && (
        <span className="flex items-center gap-1">
          {shortcut.map((cap, i) => (
            <Kbd key={i}>{cap}</Kbd>
          ))}
        </span>
      )}
    </button>
  )
}

function Separator() {
  return <div className="h-px bg-[#E2E8F0] dark:bg-[#2D2D2D] my-1" />
}

interface CanvasContextMenuProps {
  readonly open: boolean
  readonly position: { x: number; y: number }
  readonly onClose: () => void
  readonly onAddNode: () => void
  readonly onAddStickyNote: () => void
  readonly onTidyUp: () => void
  readonly onSelectAll: () => void
  readonly onClearSelection: () => void
  readonly hasSelection: boolean
}

export function CanvasContextMenu({
  open,
  position,
  onClose,
  onAddNode,
  onAddStickyNote,
  onTidyUp,
  onSelectAll,
  onClearSelection,
  hasSelection,
}: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const isMac = isMacPlatform()

  // Handle click outside
  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    function handleScroll() {
      onClose()
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("scroll", handleScroll, true)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("scroll", handleScroll, true)
    }
  }, [open, onClose])

  // Handle escape key
  useEffect(() => {
    if (!open) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  // Adjust position to prevent menu from going off-screen
  const adjustedPosition = { ...position }
  if (typeof window !== "undefined") {
    const menuWidth = 220
    const menuHeight = 200
    if (position.x + menuWidth > window.innerWidth) {
      adjustedPosition.x = window.innerWidth - menuWidth - 10
    }
    if (position.y + menuHeight > window.innerHeight) {
      adjustedPosition.y = window.innerHeight - menuHeight - 10
    }
  }

  return (
    <div
      ref={menuRef}
      className={cn(
        "fixed z-[100] min-w-[200px]",
        "bg-white dark:bg-[#1E1E1E]",
        "border border-[#E2E8F0] dark:border-[#2D2D2D]",
        "rounded-xl shadow-xl",
        "overflow-hidden py-1",
        "animate-in fade-in-0 zoom-in-95 duration-100"
      )}
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      <MenuItem
        icon={<Plus className="w-4 h-4" />}
        label="Add node"
        shortcut={formatBindingCaps(SHORTCUTS.addNode.bindings[0], isMac)}
        onClick={() => {
          onAddNode()
          onClose()
        }}
      />
      <MenuItem
        icon={<StickyNote className="w-4 h-4" />}
        label="Add sticky note"
        shortcut={formatBindingCaps(SHORTCUTS.stickyNote.bindings[0], isMac)}
        onClick={() => {
          onAddStickyNote()
          onClose()
        }}
      />

      <Separator />

      <MenuItem
        icon={<Wand2 className="w-4 h-4" />}
        label="Tidy up workflow"
        shortcut={formatBindingCaps(SHORTCUTS.tidyUp.bindings[0], isMac)}
        onClick={() => {
          onTidyUp()
          onClose()
        }}
      />

      <Separator />

      <MenuItem
        icon={<MousePointer2 className="w-4 h-4" />}
        label="Select all"
        shortcut={formatBindingCaps(SHORTCUTS.selectAll.bindings[0], isMac)}
        onClick={() => {
          onSelectAll()
          onClose()
        }}
      />
      <MenuItem
        icon={<XCircle className="w-4 h-4" />}
        label="Clear selection"
        onClick={() => {
          onClearSelection()
          onClose()
        }}
        disabled={!hasSelection}
      />
    </div>
  )
}
