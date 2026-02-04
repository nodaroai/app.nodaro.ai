"use client"

import type { ReactNode, MouseEvent } from "react"
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
  readonly category: "input" | "parameter" | "ai" | "processing" | "output" | "scene" | "character" | "object" | "location" | "script" | "i2v"
  readonly credits?: number
  readonly handles: ReadonlyArray<HandleConfig>
  readonly children?: ReactNode
  readonly selected?: boolean
  readonly minWidth?: number
  readonly minHeight?: number
  readonly isRunning?: boolean
}

const CATEGORY_STYLES: Record<string, string> = {
  input: "border-[#E2E8F0] bg-[#F8FAFC] dark:border-[#38BDF8] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  parameter: "border-[#EEF2FF] bg-[#F9FAFF] dark:border-[#818CF8] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  ai: "border-[#404040] bg-[#F8FAFC] dark:border-[#ff0073] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  processing: "border-[#CBD5E1] bg-[#F1F5F9] dark:border-[#475569] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  output: "border-green-300 bg-green-50 dark:border-green-500 dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  scene: "border-[#404040] bg-[#F8FAFC] dark:border-[#ff0073] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  character: "border-pink-300 bg-pink-50 dark:border-[#F472B6] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  object: "border-emerald-300 bg-emerald-50 dark:border-[#34D399] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  location: "border-cyan-300 bg-cyan-50 dark:border-[#22D3EE] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  script: "border-[#404040] bg-[#F8FAFC] dark:border-[#ff0073] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
  i2v: "border-[#404040] bg-[#F8FAFC] dark:border-[#ff0073] dark:bg-[#1E1E1E]/90 dark:backdrop-blur-sm",
}

const CATEGORY_HEADER: Record<string, string> = {
  input: "bg-[#007AFF] text-white dark:bg-[#38BDF8] dark:text-white",
  parameter: "bg-[#6366F1] text-white dark:bg-[#818CF8] dark:text-white",
  ai: "bg-[#282828] text-white dark:bg-[#ff0073] dark:text-white dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
  processing: "bg-[#475569] text-white dark:bg-[#475569] dark:text-white",
  output: "bg-green-100 text-gray-700 dark:bg-green-600 dark:text-white",
  scene: "bg-[#282828] text-white dark:bg-[#ff0073] dark:text-white dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
  character: "bg-pink-100 text-gray-700 dark:bg-[#F472B6] dark:text-white",
  object: "bg-emerald-100 text-gray-700 dark:bg-[#34D399] dark:text-white",
  location: "bg-cyan-100 text-gray-700 dark:bg-[#22D3EE] dark:text-white",
  script: "bg-[#282828] text-white dark:bg-[#ff0073] dark:text-white dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
  i2v: "bg-[#282828] text-white dark:bg-[#ff0073] dark:text-white dark:shadow-[0_0_20px_rgba(255,0,115,0.3)]",
}

export function BaseNode({
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
}: BaseNodeProps) {
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const duplicateNode = useWorkflowStore((s) => s.duplicateNode)

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
          "group relative rounded-lg border-2 shadow-sm min-w-[200px] bg-card text-card-foreground h-full",
          CATEGORY_STYLES[category],
          selected && "ring-2 ring-primary",
          selected && category === "input" && "dark:shadow-[0_0_20px_rgba(56,189,248,0.4)]",
          selected && category === "parameter" && "dark:shadow-[0_0_20px_rgba(129,140,248,0.4)]",
          selected && (category === "ai" || category === "scene" || category === "script" || category === "i2v") && "dark:shadow-[0_0_25px_rgba(255,0,115,0.5)]",
          selected && category === "processing" && "dark:shadow-[0_0_20px_rgba(71,85,105,0.4)]",
          selected && category === "character" && "dark:shadow-[0_0_20px_rgba(244,114,182,0.4)]",
          selected && category === "location" && "dark:shadow-[0_0_20px_rgba(34,211,238,0.4)]",
          selected && category === "object" && "dark:shadow-[0_0_20px_rgba(52,211,153,0.4)]",
          selected && category === "output" && "dark:shadow-[0_0_20px_rgba(34,197,94,0.4)]",
          isRunning && "node-running",
        )}
        onClick={() => selectNode(id)}
      >
      <button
        className="absolute -top-3 -right-3 z-10 hidden group-hover:flex items-center justify-center w-6 h-6 rounded-full bg-card border shadow-sm hover:bg-accent"
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
          <span className="w-6 h-6 rounded-md bg-white dark:bg-white/20 flex items-center justify-center text-[#007AFF] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
            {icon}
          </span>
        ) : category === "parameter" ? (
          <span className="w-6 h-6 rounded-md bg-white dark:bg-white/20 flex items-center justify-center text-[#6366F1] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
            {icon}
          </span>
        ) : category === "processing" ? (
          <span className="w-6 h-6 rounded-md bg-white dark:bg-white/20 flex items-center justify-center text-[#475569] dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
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
          <span>{icon}</span>
        )}
        <span className="flex-1 truncate">{label}</span>
        {credits !== undefined && credits > 0 && (
          <span className="font-mono text-[10px] text-white/70 dark:text-[#ff0073]">{credits}cr</span>
        )}
      </div>

      {children && <div className="px-3 py-2 text-xs">{children}</div>}

      {handles.map((h) => (
        <div key={h.id}>
          <Handle
            id={h.id}
            type={h.type}
            position={h.position}
            className="!w-3 !h-3 !bg-primary !border-2 !border-background touch-manipulation [@media(pointer:coarse)]:!w-5 [@media(pointer:coarse)]:!h-5"
            style={h.top ? { top: h.top } : undefined}
          />
          {h.label && h.top && (
            <span
              className={cn(
                "absolute text-[9px] text-muted-foreground/70 pointer-events-none select-none leading-none",
                h.type === "target" ? "left-3" : "right-3",
              )}
              style={{ top: h.top, transform: "translateY(-50%)" }}
            >
              {h.label}
            </span>
          )}
        </div>
      ))}
    </div>
    </>
  )
}
