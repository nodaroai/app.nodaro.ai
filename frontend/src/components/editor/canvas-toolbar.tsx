"use client"

import { Plus, Search, ScanSearch, Package, Film, StickyNote, Wand2, PanelLeft, Undo2, Redo2, ChevronLeft, Puzzle, Keyboard, History, GripHorizontal } from "lucide-react"
import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { SHORTCUTS, formatBinding, isMacPlatform } from "@/lib/shortcuts"
import { useCopilotRailWidth } from "@/hooks/use-copilot-ui-store"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSidebar } from "@/components/layout/sidebar-context"
import { MARKETPLACE_POPUP_WIDTH } from "./marketplace-popup-geometry"

interface CanvasToolbarProps {
  readonly onAddNode: (position?: { x: number; y: number }, placeAtCenter?: boolean) => void
  readonly onComponents: () => void
  readonly onSearch: () => void
  /** Open the "find inside this workflow" node-search modal (Ctrl+F). */
  readonly onFindInWorkflow: () => void
  /** Toggle focus between the last two focused nodes (Alt+B). */
  readonly onPreviousFocus: () => void
  readonly onAssetLibrary: () => void
  readonly onMediaLibrary: () => void
  readonly onAddStickyNote: () => void
  readonly onTidyUp: () => void
  readonly onToggleSidebar: () => void
  readonly sidebarVisible: boolean
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly onShowShortcuts: () => void
}

interface ToolbarButtonProps {
  readonly icon: React.ReactNode
  readonly label: string
  readonly shortcut: string
  readonly onClick: (e: React.MouseEvent) => void
  readonly active?: boolean
  readonly disabled?: boolean
}

function ToolbarButton({ icon, label, shortcut, onClick, active, disabled }: ToolbarButtonProps) {
  // The tooltip opens away from the edge the rail is anchored to.
  const side = useAppDir() === "rtl" ? "left" : "right"
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={disabled ? undefined : onClick}
            className={cn(
              "w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200",
              // Light mode: slate icons
              "text-[#64748B]",
              "hover:bg-[#F1F5F9] hover:text-[#0F172A]",
              // Dark mode: muted icons with dark hover
              "dark:text-[#94A3B8]",
              "dark:hover:bg-[#2D2D2D] dark:hover:text-white",
              // Active state (same for both modes)
              active && "bg-[#ff0073]/10 text-[#ff0073] dark:bg-[#ff0073]/20 dark:text-[#ff0073]",
              // Disabled state
              disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-[#64748B] dark:hover:bg-transparent dark:hover:text-[#94A3B8]"
            )}
          >
            {icon}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          sideOffset={8}
          className={cn(
            "rounded-lg px-3 py-2 flex items-center gap-2",
            // Light mode: white tooltip with subtle shadow
            "bg-white text-[#1E293B] border border-[#E2E8F0] shadow-sm",
            // Dark mode: dark tooltip with deeper shadow
            "dark:bg-[#2D2D2D] dark:text-[#E2E8F0] dark:border-[#3D3D3D] dark:shadow-xl"
          )}
        >
          <span className="text-sm">{label}</span>
          <span className={cn(
            "text-xs px-1.5 py-0.5 rounded font-mono",
            // Light mode: light gray badge
            "bg-[#F1F5F9] text-[#64748B]",
            // Dark mode: dark badge
            "dark:bg-[#121212] dark:text-[#94A3B8]"
          )}>
            {shortcut}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function MobileToolbarButton({ icon, label, onClick, active, disabled }: Omit<ToolbarButtonProps, "shortcut">) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={disabled ? undefined : onClick}
      className={cn(
        "w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 touch-manipulation",
        "text-[#64748B] dark:text-[#94A3B8]",
        "active:bg-[#F1F5F9] active:text-[#0F172A]",
        "dark:active:bg-[#2D2D2D] dark:active:text-white",
        active && "bg-[#ff0073]/10 text-[#ff0073] dark:bg-[#ff0073]/20 dark:text-[#ff0073]",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      {icon}
    </button>
  )
}

function ToolbarDivider() {
  return <div className="w-6 h-px bg-[#E2E8F0] dark:bg-[#2D2D2D] mx-auto my-1" />
}

const isMac = isMacPlatform()

/** Where a dragged toolbar position is remembered. Per-device by nature —
 *  it is a viewport pixel coordinate — so localStorage, not user settings. */
const TOOLBAR_POS_KEY = "nodaro:canvas-toolbar-pos"

export function CanvasToolbar({
  onAddNode,
  onComponents,
  onSearch,
  onFindInWorkflow,
  onPreviousFocus,
  onAssetLibrary,
  onMediaLibrary,
  onAddStickyNote,
  onTidyUp,
  onToggleSidebar,
  sidebarVisible,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onShowShortcuts,
}: CanvasToolbarProps) {
  const t = useT()
  const { sidebarWidth } = useSidebar()
  const navigate = useNavigate()
  // Under RTL the app sidebar (`start-0`) sits on the physical RIGHT, so the
  // never-dragged rail anchors to that edge by the same offset — otherwise it
  // floats sidebar-width px into the canvas, away from the Add Node panel it
  // toggles (node-toolbar.tsx, `start-16`). Read live, never a `rtl:` variant.
  const isRtl = useAppDir() === "rtl"
  // This bar is `position: fixed`, so it does not participate in the editor's
  // flex row and has to be told about anything occupying the left edge. The
  // Copilot rail is a real column there; without its width the bar floats on
  // top of the chat.
  const copilotRailWidth = useCopilotRailWidth()
  // Inline-start offset past the sidebar and the rail + 12px gap
  const leftPosition = sidebarWidth + copilotRailWidth + 12

  // Draggable rail. Once the user drags it, `pos` (viewport coordinates) takes
  // over from the sidebar-anchored, vertically-centered default and survives a
  // reload. Drag by the grip at the top; double-click the grip to reset.
  //
  // A dragged bar DELIBERATELY ignores `leftPosition`, so it can be parked over
  // the Copilot rail — the overlap the automatic placement exists to avoid.
  // That is the point: an explicit placement by the user outranks the default.
  // Do not "fix" this by clamping x to leftPosition.
  const railRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(TOOLBAR_POS_KEY)
      return raw ? (JSON.parse(raw) as { x: number; y: number }) : null
    } catch {
      return null
    }
  })
  const onDragStart = (e: React.PointerEvent) => {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY, ox: rect.left, oy: rect.top }
  }
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const rect = railRef.current?.getBoundingClientRect()
    const w = rect?.width ?? 56
    const h = rect?.height ?? 400
    const nx = dragRef.current.ox + (e.clientX - dragRef.current.px)
    const ny = dragRef.current.oy + (e.clientY - dragRef.current.py)
    // Clamped to a 4px viewport inset so the bar cannot be thrown off-screen
    // in the direction being dragged.
    setPos({
      x: Math.max(4, Math.min(nx, window.innerWidth - w - 4)),
      y: Math.max(4, Math.min(ny, window.innerHeight - h - 4)),
    })
  }
  const onDragEnd = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    // Persist on release only — writing every pointermove would hammer
    // localStorage for a value nothing reads until the next mount.
    setPos((p) => {
      if (p) {
        try {
          localStorage.setItem(TOOLBAR_POS_KEY, JSON.stringify(p))
        } catch {
          /* a storage-blocked browser still drags, it just does not remember */
        }
      }
      return p
    })
  }
  const resetPos = () => {
    setPos(null)
    try {
      localStorage.removeItem(TOOLBAR_POS_KEY)
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      {/* Mobile: horizontal top bar */}
      <div
        className={cn(
          "absolute top-2 inset-x-2 z-10 md:hidden",
          "p-1.5 rounded-xl",
          "flex items-center gap-1",
          "backdrop-blur-md",
          "bg-white/80 border border-[#E2E8F0] shadow-lg",
          "dark:bg-[#1E1E1E]/90 dark:border-[#2D2D2D] dark:shadow-2xl dark:shadow-black/20"
        )}
      >
        <MobileToolbarButton
          icon={<ChevronLeft className={cn("w-5 h-5", isRtl && "rotate-180")} />}
          label={t("common.back")}
          onClick={() => navigate(-1)}
        />
        <div className="w-px h-5 bg-[#E2E8F0] dark:bg-[#2D2D2D]" />
        <MobileToolbarButton
          icon={<Plus className="w-5 h-5" />}
          label={t("toolbar.addNode")}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const x = isRtl ? rect.left - 8 - MARKETPLACE_POPUP_WIDTH : rect.right + 8
            onAddNode({ x, y: rect.bottom + 8 }, true)
          }}
        />
        <MobileToolbarButton
          icon={<Puzzle className="w-5 h-5" />}
          label={t("marketplace.title")}
          onClick={onComponents}
        />
        <MobileToolbarButton
          icon={<Undo2 className="w-5 h-5" />}
          label={t("ctb.undo")}
          onClick={onUndo}
          disabled={!canUndo}
        />
        <MobileToolbarButton
          icon={<Redo2 className="w-5 h-5" />}
          label={t("ctb.redo")}
          onClick={onRedo}
          disabled={!canRedo}
        />
        <MobileToolbarButton
          icon={<Package className="w-5 h-5" />}
          label={t("canvas.myLibrary")}
          onClick={onAssetLibrary}
        />
        <MobileToolbarButton
          icon={<Film className="w-5 h-5" />}
          label={t("canvas.mediaLibrary")}
          onClick={onMediaLibrary}
        />
        <MobileToolbarButton
          icon={<Wand2 className="w-5 h-5" />}
          label={t("ctb.tidyUp")}
          onClick={onTidyUp}
        />
        <MobileToolbarButton
          icon={<PanelLeft className="w-5 h-5" />}
          label={t("ctb.toggleSidebar")}
          onClick={onToggleSidebar}
          active={sidebarVisible}
        />
      </div>

      {/* Desktop: vertical left bar (draggable by the grip at the top) */}
      <div
        ref={railRef}
        className={cn(
          "fixed z-50",
          // The centered default and its transition apply only until the user
          // drags: afterwards `pos` drives placement and the transition would
          // make every pointermove lag behind the cursor.
          !pos && "top-1/2 -translate-y-1/2 transition-all duration-300 ease-in-out",
          "hidden md:flex",
          "p-2 rounded-2xl",
          "flex-col gap-1",
          "backdrop-blur-md",
          // Light mode: frosted white glass with subtle shadow
          "bg-white/80 border border-[#E2E8F0] shadow-xl shadow-slate-200/50",
          // Dark mode: dark glass with deeper shadow
          "dark:bg-[#1E1E1E]/90 dark:border-[#2D2D2D] dark:shadow-2xl dark:shadow-black/20"
        )}
        style={
          pos
            // A dragged position is explicit viewport coordinates — physical by design.
            ? { left: `${pos.x}px`, top: `${pos.y}px` }
            : isRtl
              ? { right: `${leftPosition}px` }
              : { left: `${leftPosition}px` }
        }
      >
        {/* Drag handle */}
        <button
          type="button"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onDoubleClick={resetPos}
          className="flex items-center justify-center h-4 mb-0.5 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground transition-colors touch-none"
          aria-label={t("ctb.dragAria")}
          title={t("ctb.dragTitle")}
        >
          <GripHorizontal className="w-4 h-4" />
        </button>

        {/* Primary actions */}
        <ToolbarButton
          icon={<Plus className="w-5 h-5" />}
          label={t("toolbar.addNode")}
          shortcut={formatBinding(SHORTCUTS.addNode.bindings[0], isMac)}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            // Forwarded through the (viewport-centred) node picker to the
            // component browser popup, which grows rightward from the x it is
            // given: beside a right-anchored rail its LEFT edge must sit a popup
            // width (plus the gap) before the rail; beside a left-anchored one,
            // just past it.
            const x = isRtl ? rect.left - 8 - MARKETPLACE_POPUP_WIDTH : rect.right + 8
            onAddNode({ x, y: rect.top }, true)
          }}
        />

        <ToolbarButton
          icon={<Puzzle className="w-5 h-5" />}
          label={t("marketplace.title")}
          shortcut=""
          onClick={onComponents}
        />

        <ToolbarButton
          icon={<Search className="w-5 h-5" />}
          label={t("ctb.searchWorkflows")}
          shortcut={formatBinding(SHORTCUTS.search.bindings[0], isMac)}
          onClick={onSearch}
        />

        <ToolbarButton
          icon={<ScanSearch className="w-5 h-5" />}
          label={t("ctb.findInWorkflow")}
          shortcut={formatBinding(SHORTCUTS.findNode.bindings[0], isMac)}
          onClick={onFindInWorkflow}
        />

        <ToolbarButton
          icon={<History className="w-5 h-5" />}
          label={t("ctb.previousFocus")}
          shortcut={formatBinding(SHORTCUTS.previousFocus.bindings[0], isMac)}
          onClick={onPreviousFocus}
        />

        <ToolbarButton
          icon={<Package className="w-5 h-5" />}
          label={t("canvas.myLibrary")}
          shortcut={formatBinding(SHORTCUTS.myLibrary.bindings[0], isMac)}
          onClick={onAssetLibrary}
        />

        <ToolbarButton
          icon={<Film className="w-5 h-5" />}
          label={t("canvas.mediaLibrary")}
          shortcut={formatBinding(SHORTCUTS.mediaLibrary.bindings[0], isMac)}
          onClick={onMediaLibrary}
        />

        <ToolbarDivider />

        {/* Canvas tools */}
        <ToolbarButton
          icon={<StickyNote className="w-5 h-5" />}
          label={t("ctb.addStickyNote")}
          shortcut={formatBinding(SHORTCUTS.stickyNote.bindings[0], isMac)}
          onClick={onAddStickyNote}
        />

        <ToolbarButton
          icon={<Wand2 className="w-5 h-5" />}
          label={t("ctb.tidyUp")}
          shortcut={formatBinding(SHORTCUTS.tidyUp.bindings[0], isMac)}
          onClick={onTidyUp}
        />

        <ToolbarDivider />

        {/* Undo / Redo */}
        <ToolbarButton
          icon={<Undo2 className="w-5 h-5" />}
          label={t("ctb.undo")}
          shortcut={formatBinding(SHORTCUTS.undo.bindings[0], isMac)}
          onClick={onUndo}
          disabled={!canUndo}
        />

        <ToolbarButton
          icon={<Redo2 className="w-5 h-5" />}
          label={t("ctb.redo")}
          shortcut={formatBinding(SHORTCUTS.redo.bindings[0], isMac)}
          onClick={onRedo}
          disabled={!canRedo}
        />

        <ToolbarDivider />

        {/* View controls */}
        <ToolbarButton
          icon={<PanelLeft className="w-5 h-5" />}
          label={t("ctb.toggleSidebar")}
          shortcut={formatBinding(SHORTCUTS.sidebar.bindings[0], isMac)}
          onClick={onToggleSidebar}
          active={sidebarVisible}
        />

        <ToolbarDivider />

        {/* Help */}
        <ToolbarButton
          icon={<Keyboard className="w-5 h-5" />}
          label={t("ctb.keyboardShortcuts")}
          shortcut={formatBinding(SHORTCUTS.help.bindings[0], isMac)}
          onClick={onShowShortcuts}
        />
      </div>
    </>
  )
}
