"use client"

import { Plus, Search, Package, StickyNote, Wand2, PanelLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface CanvasToolbarProps {
  readonly onAddNode: () => void
  readonly onSearch: () => void
  readonly onAssetLibrary: () => void
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
              "text-[#94A3B8]",
              "hover:bg-[#2D2D2D] hover:text-white",
              active && "bg-[#ff0073]/20 text-[#ff0073]"
            )}
          >
            {icon}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={8}
          className="bg-[#2D2D2D] text-[#E2E8F0] rounded-lg px-3 py-2 flex items-center gap-2 border border-[#3D3D3D] shadow-xl"
        >
          <span className="text-sm">{label}</span>
          <span className="bg-[#121212] text-[#94A3B8] text-xs px-1.5 py-0.5 rounded font-mono">
            {shortcut}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function ToolbarDivider() {
  return <div className="w-6 h-px bg-[#2D2D2D] mx-auto my-1" />
}

export function CanvasToolbar({
  onAddNode,
  onSearch,
  onAssetLibrary,
  onAddStickyNote,
  onTidyUp,
  onToggleSidebar,
  sidebarVisible,
}: CanvasToolbarProps) {
  return (
    <div
      className={cn(
        "fixed left-3 top-1/2 -translate-y-1/2 z-50",
        "bg-[#1E1E1E]/90 backdrop-blur-md",
        "border border-[#2D2D2D]",
        "p-2 rounded-2xl",
        "flex flex-col gap-1",
        "shadow-2xl"
      )}
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
        label="Asset Library"
        shortcut="Ctrl+L"
        onClick={onAssetLibrary}
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
