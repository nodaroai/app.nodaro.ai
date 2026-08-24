"use client"

import { ChevronRight, Home } from "lucide-react"
import { useSubWorkflowStack } from "@/hooks/use-sub-workflow-stack"
import { useT } from "@/lib/i18n"

interface SubWorkflowBreadcrumbProps {
  /**
   * Callback for clicking the root crumb (the original parent workflow that
   * opened the first sub-workflow). Should clear the stack and navigate.
   */
  readonly onJumpToRoot: () => void
  /**
   * Callback for clicking an intermediate crumb. Should `popTo(workflowId)`
   * and navigate.
   */
  readonly onJumpTo: (workflowId: string) => void
}

export function SubWorkflowBreadcrumb({ onJumpToRoot, onJumpTo }: SubWorkflowBreadcrumbProps) {
  const t = useT()
  const rootFrame = useSubWorkflowStack((s) => s.rootFrame)
  const stack = useSubWorkflowStack((s) => s.stack)

  // Nothing to show when nesting is depth 0.
  if (stack.length === 0 || !rootFrame) return null

  return (
    <nav
      aria-label={t("crumb.subWorkflowNav")}
      className="flex items-center gap-1 text-sm text-foreground/80 px-3 py-1.5 bg-card/90 border-b border-border dark:text-white/80 dark:bg-[#1E1E1E]/90 dark:border-[#2D2D2D] backdrop-blur-sm"
    >
      <button
        type="button"
        className="flex items-center gap-1 text-white/70 hover:text-white transition-colors"
        onClick={onJumpToRoot}
        title={t("crumb.backToOriginal")}
      >
        <Home className="w-3.5 h-3.5" />
        <span className="max-w-[160px] truncate">{rootFrame.workflowName}</span>
      </button>
      {stack.map((frame, i) => (
        <span key={`${frame.workflowId}-${i}`} className="flex items-center gap-1">
          <ChevronRight className="w-3.5 h-3.5 text-white/40" />
          <button
            type="button"
            className={
              i === stack.length - 1
                ? "text-white font-medium max-w-[160px] truncate"
                : "text-white/70 hover:text-white transition-colors max-w-[160px] truncate"
            }
            onClick={() => onJumpTo(frame.workflowId)}
            aria-current={i === stack.length - 1 ? "page" : undefined}
            disabled={i === stack.length - 1}
          >
            {frame.workflowName}
          </button>
        </span>
      ))}
    </nav>
  )
}
