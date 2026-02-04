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
              "w-10 h-10 flex items-center justify-center rounded-lg transition-all",
              "text-[#64748B] dark:text-[#94A3B8]",
              "hover:bg-[#F1F5F9] dark:hover:bg-[#2D2D2D]",
              "hover:text-[#0F172A] dark:hover:text-white",
              active && "bg-[#F1F5F9] dark:bg-[#2D2D2D] text-[#0F172A] dark:text-white"
            )}
          >
            {icon}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          <span>{label}</span>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-[#F1F5F9] dark:bg-[#2D2D2D] rounded border border-[#E2E8F0] dark:border-[#3D3D3D]">
            {shortcut}
          </kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
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
        "fixed left-0 top-1/2 -translate-y-1/2 z-50",
        "bg-white dark:bg-[#1E1E1E]",
        "border-r border-[#E2E8F0] dark:border-[#2D2D2D]",
        "p-2 rounded-r-xl",
        "flex flex-col gap-1",
        "shadow-lg"
      )}
    >
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

      <div className="h-px bg-[#E2E8F0] dark:bg-[#2D2D2D] my-1" />

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
