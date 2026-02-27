"use client"

import { Plus, Search, Package, Film, StickyNote, Wand2, PanelLeft, Undo2, Redo2, ChevronLeft } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-is-mobile"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSidebar } from "@/components/layout/sidebar-context"

interface CanvasToolbarProps {
  readonly onAddNode: (position?: { x: number; y: number }, placeAtCenter?: boolean) => void
  readonly onSearch: () => void
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
          side="right"
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

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

export function CanvasToolbar({
  onAddNode,
  onSearch,
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
}: CanvasToolbarProps) {
  const { sidebarWidth } = useSidebar()
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  // Position to the right of the sidebar + 12px gap
  const leftPosition = sidebarWidth + 12

  return (
    <>
      {/* Mobile: horizontal top bar */}
      <div
        className={cn(
          "absolute top-2 left-2 right-2 z-10 md:hidden",
          "p-1.5 rounded-xl",
          "flex items-center gap-1",
          "backdrop-blur-md",
          "bg-white/80 border border-[#E2E8F0] shadow-lg",
          "dark:bg-[#1E1E1E]/90 dark:border-[#2D2D2D] dark:shadow-2xl dark:shadow-black/20"
        )}
      >
        <MobileToolbarButton
          icon={<ChevronLeft className="w-5 h-5" />}
          label="Back"
          onClick={() => navigate(-1)}
        />
        <div className="w-px h-5 bg-[#E2E8F0] dark:bg-[#2D2D2D]" />
        <MobileToolbarButton
          icon={<Plus className="w-5 h-5" />}
          label="Add Node"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onAddNode({ x: rect.right + 8, y: rect.bottom + 8 }, true)
          }}
        />
        <MobileToolbarButton
          icon={<Undo2 className="w-5 h-5" />}
          label="Undo"
          onClick={onUndo}
          disabled={!canUndo}
        />
        <MobileToolbarButton
          icon={<Redo2 className="w-5 h-5" />}
          label="Redo"
          onClick={onRedo}
          disabled={!canRedo}
        />
        <MobileToolbarButton
          icon={<Wand2 className="w-5 h-5" />}
          label="Tidy Up"
          onClick={onTidyUp}
        />
        <MobileToolbarButton
          icon={<PanelLeft className="w-5 h-5" />}
          label="Toggle Sidebar"
          onClick={onToggleSidebar}
          active={sidebarVisible}
        />
      </div>

      {/* Desktop: vertical left bar */}
      <div
        className={cn(
          "fixed top-1/2 -translate-y-1/2 z-50",
          "hidden md:flex",
          "p-2 rounded-2xl",
          "flex-col gap-1",
          "backdrop-blur-md",
          "transition-all duration-300 ease-in-out",
          // Light mode: frosted white glass with subtle shadow
          "bg-white/80 border border-[#E2E8F0] shadow-xl shadow-slate-200/50",
          // Dark mode: dark glass with deeper shadow
          "dark:bg-[#1E1E1E]/90 dark:border-[#2D2D2D] dark:shadow-2xl dark:shadow-black/20"
        )}
        style={{ left: `${leftPosition}px` }}
      >
        {/* Primary actions */}
        <ToolbarButton
          icon={<Plus className="w-5 h-5" />}
          label="Add Node"
          shortcut="Tab"
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onAddNode({ x: rect.right + 8, y: rect.top }, true)
          }}
        />

        <ToolbarButton
          icon={<Search className="w-5 h-5" />}
          label="Search"
          shortcut="Ctrl+K"
          onClick={onSearch}
        />

        <ToolbarButton
          icon={<Package className="w-5 h-5" />}
          label="My Library"
          shortcut="Ctrl+L"
          onClick={onAssetLibrary}
        />

        <ToolbarButton
          icon={<Film className="w-5 h-5" />}
          label="Media Library"
          shortcut="Ctrl+M"
          onClick={onMediaLibrary}
        />

        <ToolbarDivider />

        {/* Canvas tools */}
        <ToolbarButton
          icon={<StickyNote className="w-5 h-5" />}
          label="Add Sticky Note"
          shortcut="Shift+S"
          onClick={onAddStickyNote}
        />

        <ToolbarButton
          icon={<Wand2 className="w-5 h-5" />}
          label="Tidy Up"
          shortcut="Alt+T"
          onClick={onTidyUp}
        />

        <ToolbarDivider />

        {/* Undo / Redo */}
        <ToolbarButton
          icon={<Undo2 className="w-5 h-5" />}
          label="Undo"
          shortcut={isMac ? "\u2318Z" : "Ctrl+Z"}
          onClick={onUndo}
          disabled={!canUndo}
        />

        <ToolbarButton
          icon={<Redo2 className="w-5 h-5" />}
          label="Redo"
          shortcut={isMac ? "\u2318\u21e7Z" : "Ctrl+Y"}
          onClick={onRedo}
          disabled={!canRedo}
        />

        <ToolbarDivider />

        {/* View controls */}
        <ToolbarButton
          icon={<PanelLeft className="w-5 h-5" />}
          label="Toggle Sidebar"
          shortcut="Ctrl+B"
          onClick={onToggleSidebar}
          active={sidebarVisible}
        />
      </div>
    </>
  )
}
