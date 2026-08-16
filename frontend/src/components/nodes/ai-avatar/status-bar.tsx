"use client"

// The card's foot: readiness (green dot when the executor would accept a run,
// amber while something is still missing) + which engine renders, at what
// resolution. After a FAILED run it turns red and carries the error — the
// setup above stays editable, and the retry is the strip's Run (every action
// on the node lives in the bottom strip, not in the card). Pure display —
// both strings come from readiness.ts.

import { cn } from "@/lib/utils"
import { META_MONO, PANEL_BG, PANEL_EDGE } from "./styles"
import type { AiAvatarReadiness } from "./readiness"

interface AiAvatarStatusBarProps {
  readonly readiness: AiAvatarReadiness
  readonly engineLabel: string
  /** The last run failed — show its message (if any) instead of readiness. */
  readonly failure?: { readonly message?: string }
}

export function AiAvatarStatusBar({ readiness, engineLabel, failure }: AiAvatarStatusBarProps) {
  if (failure) {
    const text = failure.message?.trim() ? `Failed · ${failure.message.trim()}` : "Failed · run again from the strip"
    return (
      <div
        className={cn("shrink-0 flex items-center gap-2 px-3 py-2 border-t", PANEL_EDGE, "bg-red-500/10")}
        data-testid="ai-avatar-status"
        data-failed=""
      >
        <span aria-hidden className="w-1.5 h-1.5 rounded-full shrink-0 bg-red-500" />
        <span className="text-[11px] text-red-500 dark:text-red-400 truncate" role="alert" title={failure.message?.trim() || undefined}>
          {text}
        </span>
        <span className="flex-1" />
        <span className={META_MONO}>{engineLabel}</span>
      </div>
    )
  }
  return (
    <div
      className={cn("shrink-0 flex items-center gap-2 px-3 py-2 border-t", PANEL_EDGE, PANEL_BG)}
      data-testid="ai-avatar-status"
      data-ready={readiness.ready ? "" : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          readiness.ready ? "bg-[#3fbf7f]" : "bg-[#c8a23f]",
        )}
      />
      <span className="text-[11px] text-muted-foreground truncate" role="status">
        {readiness.text}
      </span>
      <span className="flex-1" />
      <span className={META_MONO}>{engineLabel}</span>
    </div>
  )
}
