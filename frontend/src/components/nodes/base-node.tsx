"use client"

import type { ReactNode, MouseEvent } from "react"
import { Handle, Position } from "@xyflow/react"
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
  readonly category: "input" | "parameter" | "ai" | "processing" | "output" | "scene" | "character"
  readonly credits?: number
  readonly handles: ReadonlyArray<HandleConfig>
  readonly children?: ReactNode
  readonly selected?: boolean
}

const CATEGORY_STYLES: Record<string, string> = {
  input: "border-blue-500/50 bg-blue-500/5",
  ai: "border-purple-500/50 bg-purple-500/5",
  processing: "border-amber-500/50 bg-amber-500/5",
  output: "border-green-500/50 bg-green-500/5",
  scene: "border-violet-500/50 bg-violet-500/5",
}

const CATEGORY_HEADER: Record<string, string> = {
  input: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  ai: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  processing: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  output: "bg-green-500/10 text-green-700 dark:text-green-300",
  scene: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
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
}: BaseNodeProps) {
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const duplicateNode = useWorkflowStore((s) => s.duplicateNode)

  function handleDuplicate(e: MouseEvent) {
    e.stopPropagation()
    duplicateNode(id)
  }

  return (
    <div
      className={cn(
        "group relative rounded-lg border-2 shadow-sm min-w-[200px] bg-card text-card-foreground",
        CATEGORY_STYLES[category],
        selected && "ring-2 ring-primary",
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
        {icon}
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
  )
}
