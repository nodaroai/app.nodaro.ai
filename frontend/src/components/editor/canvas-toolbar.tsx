"use client"

import { Plus, Search, Package, Film, StickyNote, Wand2, PanelLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSidebar } from "@/components/layout/sidebar-context"

interface CanvasToolbarProps {
  readonly onAddNode: () => void
  readonly onSearch: () => void
  readonly onAssetLibrary: () => void
  readonly onMediaLibrary: () => void
  readonly onAddStickyNote: () => void
  readonly onTidyUp: () => void
  readonly onToggleSidebar: () => void
  readonly sidebarVisible: boolean
}

interface ToolbarButtonProps {
  readonly icon: React.ReactNode
  readonly label: string
  readonly shortcut: string
  readonly onClick: () => void
  readonly active?: boolean
}

function ToolbarButton({ icon, label, shortcut, onClick, active }: ToolbarButtonProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            className={cn(
              "w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200",
              // Light mode: slate icons
              "text-[#64748B]",
              "hover:bg-[#F1F5F9] hover:text-[#0F172A]",
              // Dark mode: muted icons with dark hover
              "dark:text-[#94A3B8]",
              "dark:hover:bg-[#2D2D2D] dark:hover:text-white",
              // Active state (same for both modes)
              active && "bg-[#ff0073]/10 text-[#ff0073] dark:bg-[#ff0073]/20 dark:text-[#ff0073]"
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

function ToolbarDivider() {
  return <div className="w-6 h-px bg-[#E2E8F0] dark:bg-[#2D2D2D] mx-auto my-1" />
}

export function CanvasToolbar({
  onAddNode,
  onSearch,
  onAssetLibrary,
  onMediaLibrary,
  onAddStickyNote,
  onTidyUp,
  onToggleSidebar,
  sidebarVisible,
}: CanvasToolbarProps) {
  const { sidebarWidth } = useSidebar()
  // Position to the right of the sidebar + 12px gap
  const leftPosition = sidebarWidth + 12

  return (
    <div
      className={cn(
        "fixed top-1/2 -translate-y-1/2 z-50",
        "p-2 rounded-2xl",
        "flex flex-col gap-1",
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
        onClick={onAddNode}
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

      {/* View controls */}
      <ToolbarButton
        icon={<PanelLeft className="w-5 h-5" />}
        label="Toggle Sidebar"
        shortcut="Ctrl+B"
        onClick={onToggleSidebar}
        active={sidebarVisible}
      />
    </div>
  )
}
