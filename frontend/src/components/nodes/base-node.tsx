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
  input: "border-blue-300 bg-blue-50 dark:border-blue-500/70 dark:bg-blue-950/70",
  parameter: "border-indigo-300 bg-indigo-50 dark:border-indigo-500/70 dark:bg-indigo-950/70",
  ai: "border-[#161616] bg-white dark:border-purple-500/70 dark:bg-purple-950/70",
  processing: "border-amber-300 bg-amber-50 dark:border-amber-500/70 dark:bg-amber-950/70",
  output: "border-green-300 bg-green-50 dark:border-green-500/70 dark:bg-green-950/70",
  scene: "border-[#161616] bg-white dark:border-violet-500/70 dark:bg-violet-950/70",
  character: "border-pink-300 bg-pink-50 dark:border-pink-500/70 dark:bg-pink-950/70",
  object: "border-emerald-300 bg-emerald-50 dark:border-emerald-500/70 dark:bg-emerald-950/70",
  location: "border-cyan-300 bg-cyan-50 dark:border-cyan-500/70 dark:bg-cyan-950/70",
  script: "border-[#161616] bg-white dark:border-purple-500/70 dark:bg-purple-950/70",
  i2v: "border-[#161616] bg-white dark:border-purple-500/70 dark:bg-purple-950/70",
}

const CATEGORY_HEADER: Record<string, string> = {
  input: "bg-blue-100 text-gray-700 dark:bg-blue-900/70 dark:text-gray-200",
  parameter: "bg-indigo-100 text-gray-700 dark:bg-indigo-900/70 dark:text-gray-200",
  ai: "bg-[#161616] text-white dark:bg-purple-900/70 dark:text-gray-200",
  processing: "bg-amber-100 text-gray-700 dark:bg-amber-900/70 dark:text-gray-200",
  output: "bg-green-100 text-gray-700 dark:bg-green-900/70 dark:text-gray-200",
  scene: "bg-[#161616] text-white dark:bg-violet-900/70 dark:text-gray-200",
  character: "bg-pink-100 text-gray-700 dark:bg-pink-900/70 dark:text-gray-200",
  object: "bg-emerald-100 text-gray-700 dark:bg-emerald-900/70 dark:text-gray-200",
  location: "bg-cyan-100 text-gray-700 dark:bg-cyan-900/70 dark:text-gray-200",
  script: "bg-[#161616] text-white dark:bg-purple-900/70 dark:text-gray-200",
  i2v: "bg-[#161616] text-white dark:bg-purple-900/70 dark:text-gray-200",
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
          "flex items-center gap-2 px-3 py-2 rounded-t-md text-sm font-medium",
          CATEGORY_HEADER[category],
        )}
      >
        {(category === "ai" || category === "scene" || category === "script" || category === "i2v") ? (
          <span className="w-6 h-6 rounded-md bg-[#ff0073] dark:bg-transparent flex items-center justify-center text-white dark:text-white [&>svg]:w-3.5 [&>svg]:h-3.5">
            {icon}
          </span>
        ) : (
          <span>{icon}</span>
        )}
        <span className="flex-1 truncate">{label}</span>
        {credits !== undefined && credits > 0 && (
          <span className="text-xs opacity-70">{credits}cr</span>
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
