"use client"

import { useEffect, useRef } from "react"
import { Bot, Plus, StickyNote, Wand2, MousePointer2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/hooks/use-click-outside"
import { SHORTCUTS, formatBindingCaps, isMacPlatform } from "@/lib/shortcuts"
import { Kbd } from "@/components/ui/kbd"
import { useT } from "@/lib/i18n"
import { QUICK_ADD_NODE_TYPES, quickAddEntries } from "@/lib/quick-add-nodes"
import type { SceneNodeType } from "@/types/nodes"

interface MenuItemProps {
  readonly icon: React.ReactNode
  readonly label: string
  readonly shortcut?: readonly string[]
  readonly onClick: () => void
  readonly disabled?: boolean
  /** The Copilot's entry: the brand colour, so it reads as a different kind of action. */
  readonly accent?: boolean
}

function MenuItem({ icon, label, shortcut, onClick, disabled, accent }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 text-start",
        "transition-colors",
        "hover:bg-[#F1F5F9] dark:hover:bg-[#2D2D2D]",
        disabled && "opacity-50 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent"
      )}
    >
      <span className={accent ? "text-primary" : "text-[#64748B] dark:text-[#94A3B8]"}>{icon}</span>
      <span className={cn("flex-1 text-sm", accent ? "text-primary" : "text-[#1E293B] dark:text-white")}>{label}</span>
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
  /**
   * Adds a node of this type where the menu was opened. When given, the menu
   * leads with the quick-add list (QUICK_ADD_NODE_TYPES) and the full picker
   * becomes "More nodes…".
   */
  readonly onAddNodeType?: (type: SceneNodeType) => void
  /** "Ask Copilot…" at the bottom — only where the Copilot is surfaced. */
  readonly onAskCopilot?: () => void
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
  onAddNodeType,
  onAskCopilot,
}: CanvasContextMenuProps) {
  const t = useT()
  const quickNodes = onAddNodeType ? quickAddEntries(QUICK_ADD_NODE_TYPES) : []
  const menuRef = useRef<HTMLDivElement>(null)
  const isMac = isMacPlatform()

  // Close on outside click, or on any scroll (the menu is position-anchored).
  useClickOutside(menuRef, onClose, open)
  useEffect(() => {
    if (!open) return
    const handleScroll = () => onClose()
    document.addEventListener("scroll", handleScroll, true)
    return () => document.removeEventListener("scroll", handleScroll, true)
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
    const menuHeight = 200 + (quickNodes.length > 0 ? 36 * quickNodes.length + 40 : 0) + (onAskCopilot ? 44 : 0)
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
      {quickNodes.length > 0 && (
        <>
          <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#64748B] dark:text-[#94A3B8]">
            {t("canvas.addNode")}
          </div>
          {quickNodes.map((entry) => (
            <MenuItem
              key={entry.type}
              icon={
                <span className="flex w-4 h-4 items-center justify-center" aria-hidden>
                  <span className={cn("w-2 h-2 rounded-[2px]", entry.swatchClass)} />
                </span>
              }
              label={t(entry.labelKey)}
              onClick={() => {
                onAddNodeType?.(entry.type)
                onClose()
              }}
            />
          ))}
        </>
      )}
      <MenuItem
        icon={<Plus className="w-4 h-4" />}
        label={t(quickNodes.length > 0 ? "canvas.moreNodes" : "canvas.addNode")}
        shortcut={formatBindingCaps(SHORTCUTS.addNode.bindings[0], isMac)}
        onClick={() => {
          onAddNode()
          onClose()
        }}
      />
      <MenuItem
        icon={<StickyNote className="w-4 h-4" />}
        label={t("canvas.addStickyNote")}
        shortcut={formatBindingCaps(SHORTCUTS.stickyNote.bindings[0], isMac)}
        onClick={() => {
          onAddStickyNote()
          onClose()
        }}
      />

      <Separator />

      <MenuItem
        icon={<Wand2 className="w-4 h-4" />}
        label={t("canvas.tidyUp")}
        shortcut={formatBindingCaps(SHORTCUTS.tidyUp.bindings[0], isMac)}
        onClick={() => {
          onTidyUp()
          onClose()
        }}
      />

      <Separator />

      <MenuItem
        icon={<MousePointer2 className="w-4 h-4" />}
        label={t("canvas.selectAll")}
        shortcut={formatBindingCaps(SHORTCUTS.selectAll.bindings[0], isMac)}
        onClick={() => {
          onSelectAll()
          onClose()
        }}
      />
      <MenuItem
        icon={<XCircle className="w-4 h-4" />}
        label={t("canvas.clearSelection")}
        onClick={() => {
          onClearSelection()
          onClose()
        }}
        disabled={!hasSelection}
      />

      {onAskCopilot && (
        <>
          <Separator />
          <MenuItem
            accent
            icon={<Bot className="w-4 h-4" strokeWidth={1.8} />}
            label={t("canvas.askCopilot")}
            onClick={() => {
              onAskCopilot()
              onClose()
            }}
          />
        </>
      )}
    </div>
  )
}
