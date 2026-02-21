"use client"

import { memo, useEffect, type ReactNode, type MouseEvent } from "react"
import { Handle, Position, NodeResizer } from "@xyflow/react"
import { Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

interface HandleConfig {
  readonly id: string
  readonly type: "source" | "target"
  readonly position: Position
  readonly label: string
  readonly top?: string
}

interface BaseNodeProps {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly category: "input" | "parameter" | "ai" | "processing" | "output" | "scene" | "character" | "face" | "object" | "location" | "script" | "i2v"
  readonly credits?: number
  readonly handles: ReadonlyArray<HandleConfig>
  readonly children?: ReactNode
  readonly selected?: boolean
  readonly minWidth?: number
  readonly minHeight?: number
  readonly isRunning?: boolean
  readonly listCount?: number
  readonly listProgress?: string
  readonly listProgressPercent?: number
}

// Light mode: white bg with colored top accent line, Dark mode: category-colored borders
const CATEGORY_STYLES: Record<string, string> = {
  input: "bg-white border-[#E2E8F0] dark:border-[#38BDF8] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  parameter: "bg-white border-[#E2E8F0] dark:border-[#818CF8] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  ai: "bg-white border-[#E2E8F0] dark:border-[#ff0073] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  processing: "bg-white border-[#E2E8F0] dark:border-[#475569] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  output: "bg-white border-[#E2E8F0] dark:border-green-500 dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  scene: "bg-white border-[#E2E8F0] dark:border-[#ff0073] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  character: "bg-white border-[#E2E8F0] dark:border-[#F472B6] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  face: "bg-white border-[#E2E8F0] dark:border-[#FB923C] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  object: "bg-white border-[#E2E8F0] dark:border-[#34D399] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  location: "bg-white border-[#E2E8F0] dark:border-[#22D3EE] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  script: "bg-white border-[#E2E8F0] dark:border-[#ff0073] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  i2v: "bg-white border-[#E2E8F0] dark:border-[#ff0073] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
}

// Light mode: light gray header with colored icon, Dark mode: colored headers
// AI/Scene/Script nodes keep dark header in both modes for prominence
const CATEGORY_HEADER: Record<string, string> = {
  input: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#007AFF] dark:bg-[#38BDF8] dark:text-white dark:border-t-0",
  parameter: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#6366F1] dark:bg-[#818CF8] dark:text-white dark:border-t-0",
  ai: "bg-[#282828] text-white dark:bg-[#ff0073] dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
  processing: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#475569] dark:bg-[#475569] dark:text-white dark:border-t-0",
  output: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#22C55E] dark:bg-green-600 dark:text-white dark:border-t-0",
  scene: "bg-[#282828] text-white dark:bg-[#ff0073] dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
  character: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#EC4899] dark:bg-[#F472B6] dark:text-white dark:border-t-0",
  face: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#F97316] dark:bg-[#FB923C] dark:text-white dark:border-t-0",
  object: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#10B981] dark:bg-[#34D399] dark:text-white dark:border-t-0",
  location: "bg-[#F8FAFC] text-[#1E293B] border-t-2 border-t-[#06B6D4] dark:bg-[#22D3EE] dark:text-white dark:border-t-0",
  script: "bg-[#282828] text-white dark:bg-[#ff0073] dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
  i2v: "bg-[#282828] text-white dark:bg-[#ff0073] dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
}

// Icon colors for light mode (category-specific)
const CATEGORY_ICON_COLOR: Record<string, string> = {
  input: "text-[#007AFF] dark:text-white",
  parameter: "text-[#6366F1] dark:text-white",
  ai: "text-white",
  processing: "text-[#475569] dark:text-white",
  output: "text-[#22C55E] dark:text-white",
  scene: "text-white",
  character: "text-[#EC4899] dark:text-white",
  face: "text-[#F97316] dark:text-white",
  object: "text-[#10B981] dark:text-white",
  location: "text-[#06B6D4] dark:text-white",
  script: "text-white",
  i2v: "text-white",
}

function BaseNodeComponent({
  id,
  label,
  icon,
  category,
  credits,
  handles,
  children,
  selected,
  minWidth = 200,
  minHeight = 80,
  isRunning = false,
  listCount,
  listProgress,
  listProgressPercent,
}: BaseNodeProps) {
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const duplicateNode = useWorkflowStore((s) => s.duplicateNode)
  const newNodeIds = useWorkflowStore((s) => s.newNodeIds)
  const clearNewNode = useWorkflowStore((s) => s.clearNewNode)
  const isSkipped = useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === id)
    return !!(node?.data as Record<string, unknown> | undefined)?.skipped
  })
  const isNew = newNodeIds.has(id)

  useEffect(() => {
    if (!isNew) return
    const timer = setTimeout(() => clearNewNode(id), 4000)
    return () => clearTimeout(timer)
  }, [isNew, id, clearNewNode])

  function handleDuplicate(e: MouseEvent) {
    e.stopPropagation()
    duplicateNode(id)
  }

  return (
    <>
      <NodeResizer
        minWidth={minWidth}
        minHeight={minHeight}
        isVisible={selected}
        lineClassName="!border-blue-400"
        handleClassName="!w-3 !h-3 !bg-blue-500 !border-2 !border-white !rounded"
      />
      <div
        className={cn(
          "group relative rounded-xl border-2 shadow-[0_4px_6px_-1px_rgb(0_0_0/0.05)] min-w-[200px] max-w-[320px] bg-card text-card-foreground h-full overflow-hidden",
          CATEGORY_STYLES[category],
          selected && "ring-2 ring-primary shadow-[0_4px_12px_-2px_rgb(0_0_0/0.1)]",
          selected && category === "input" && "dark:shadow-[0_0_20px_rgba(56,189,248,0.4)]",
          selected && category === "parameter" && "dark:shadow-[0_0_20px_rgba(129,140,248,0.4)]",
          selected && (category === "ai" || category === "scene" || category === "script" || category === "i2v") && "dark:shadow-[0_0_25px_rgba(255,0,115,0.5)]",
          selected && category === "processing" && "dark:shadow-[0_0_20px_rgba(71,85,105,0.4)]",
          selected && category === "character" && "dark:shadow-[0_0_20px_rgba(244,114,182,0.4)]",
          selected && category === "location" && "dark:shadow-[0_0_20px_rgba(34,211,238,0.4)]",
          selected && category === "object" && "dark:shadow-[0_0_20px_rgba(52,211,153,0.4)]",
          selected && category === "output" && "dark:shadow-[0_0_20px_rgba(34,197,94,0.4)]",
          isRunning && "node-running",
          isNew && !isRunning && "node-new-pulse",
          isSkipped && "opacity-40 border-dashed",
        )}
        onClick={() => selectNode(id)}
      >
      <button
        className="absolute -top-3 -right-3 z-10 hidden group-hover:flex items-center justify-center w-6 h-6 rounded-full bg-white dark:bg-card border border-[#E2E8F0] dark:border-border shadow-sm hover:bg-[#F1F5F9] dark:hover:bg-accent text-[#64748B] dark:text-muted-foreground"
        onClick={handleDuplicate}
        aria-label="Duplicate node"
      >
        <Copy className="h-3 w-3" />
      </button>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-t-md font-sans text-[11px] font-semibold uppercase tracking-[0.05em]",
          CATEGORY_HEADER[category],
        )}
      >
        {category === "input" ? (
          <span className="w-6 h-6 rounded-md bg-[#007AFF]/10 dark:bg-white/20 flex items-center justify-center text-[#007AFF] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
            {icon}
          </span>
        ) : category === "parameter" ? (
          <span className="w-6 h-6 rounded-md bg-[#6366F1]/10 dark:bg-white/20 flex items-center justify-center text-[#6366F1] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
            {icon}
          </span>
        ) : category === "processing" ? (
          <span className="w-6 h-6 rounded-md bg-[#475569]/10 dark:bg-white/20 flex items-center justify-center text-[#475569] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
            {icon}
          </span>
        ) : category === "output" ? (
          <span className="w-6 h-6 rounded-md bg-[#22C55E]/10 dark:bg-white/20 flex items-center justify-center text-[#22C55E] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
            {icon}
          </span>
        ) : category === "character" ? (
          <span className="w-6 h-6 rounded-md bg-[#ff0073] dark:bg-white/20 flex items-center justify-center text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
            {icon}
          </span>
        ) : category === "location" ? (
          <span className="w-6 h-6 rounded-md bg-[#ff0073] dark:bg-white/20 flex items-center justify-center text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
            {icon}
          </span>
        ) : category === "object" ? (
          <span className="w-6 h-6 rounded-md bg-[#ff0073] dark:bg-white/20 flex items-center justify-center text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
            {icon}
          </span>
        ) : (category === "ai" || category === "scene" || category === "script" || category === "i2v") ? (
          <span className="w-6 h-6 rounded-md bg-[#ff0073] dark:bg-white/20 flex items-center justify-center text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
            {icon}
          </span>
        ) : (
          <span className={cn("w-6 h-6 rounded-md flex items-center justify-center [&>svg]:w-3.5 [&>svg]:h-3.5", CATEGORY_ICON_COLOR[category])}>{icon}</span>
        )}
        <span className="flex-1 truncate">{label}</span>
        {listProgress && (
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 animate-pulse">
            {listProgress}
          </span>
        )}
        {!listProgress && listCount !== undefined && listCount > 1 && (
          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
            ×{listCount}
          </span>
        )}
        {credits !== undefined && credits > 0 && (
          <span className={cn(
            "font-mono text-[10px]",
            (category === "ai" || category === "scene" || category === "script" || category === "i2v")
              ? "text-white/70 dark:text-[#ff0073]"
              : "text-[#64748B] dark:text-[#ff0073]"
          )}>{credits}cr</span>
        )}
        {isSkipped && (
          <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30">
            SKIP
          </span>
        )}
      </div>

      {listProgressPercent !== undefined && listProgressPercent > 0 && (
        <div className="w-full px-3 py-1.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-mono text-cyan-300">
              {listProgressPercent < 100 ? "Processing list..." : "Complete"}
            </span>
            <span className="text-[10px] font-mono text-cyan-300">
              {listProgressPercent}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-black/30 dark:bg-white/10 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                listProgressPercent < 100
                  ? "bg-gradient-to-r from-cyan-400 to-fuchsia-500 animate-pulse"
                  : "bg-cyan-400"
              )}
              style={{ width: `${listProgressPercent}%` }}
            />
          </div>
        </div>
      )}

      {children && <div className="px-3 py-2 text-xs overflow-hidden bg-white dark:bg-transparent text-[#1E293B] dark:text-card-foreground">{children}</div>}
    </div>

      {handles.map((h) => (
        <div key={h.id}>
          <Handle
            id={h.id}
            type={h.type}
            position={h.position}
            className="!w-6 !h-6 !bg-transparent !border-0 touch-manipulation"
            style={h.top ? { top: h.top } : undefined}
          />
          {h.label && h.top && (
            <span
              className={cn(
                "absolute text-[9px] font-medium pointer-events-none select-none leading-none px-1 py-0.5 rounded",
                "text-muted-foreground bg-background/80 dark:bg-muted/60",
                h.type === "target" ? "left-3" : "right-3",
              )}
              style={{ top: h.top, transform: "translateY(-50%)" }}
            >
              {h.label}
            </span>
          )}
        </div>
      ))}
    </>
  )
}

export const BaseNode = memo(BaseNodeComponent)
