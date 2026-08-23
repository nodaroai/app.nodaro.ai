/**
 * What the copilot is doing right now, one thin row per tool call.
 *
 * These rows are the transparency promise: the panel never says "working…"
 * while something opaque happens. Once the turn is over they collapse into a
 * single receipt — the detail stays one click away without leaving a wall of
 * finished steps above every answer.
 */
import { Check, ChevronDown } from "lucide-react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import type { CopilotActivity } from "@/ee/lib/copilot/types"

const DOT: Record<CopilotActivity["status"], string> = {
  started: "bg-primary",
  finished: "bg-[#475569]",
  failed: "bg-[var(--copilot-fail)]",
}

const LABEL: Record<CopilotActivity["status"], string> = {
  started: "text-foreground",
  finished: "text-[var(--copilot-muted)]",
  failed: "text-[var(--copilot-fail)]",
}

interface CopilotActivityRowsProps {
  activities: readonly CopilotActivity[]
  collapsed: boolean
  onExpand: () => void
}

export function CopilotActivityRows({ activities, collapsed, onExpand }: CopilotActivityRowsProps) {
  if (activities.length === 0) return null

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onExpand}
        className="flex items-center gap-2 py-1.5 px-0.5 w-full border-t border-b border-border text-left"
      >
        <Check className="w-3 h-3 text-[var(--copilot-dim)]" strokeWidth={2.4} />
        <span className="text-xs text-[var(--copilot-muted)]">{S.stepsCollapsed(activities.length)}</span>
        <ChevronDown className="w-[11px] h-[11px] text-[var(--copilot-dim)] ml-auto" strokeWidth={2.4} />
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-px py-1 border-t border-b border-border">
      {activities.map((activity) => (
        <div key={activity.id} className="flex items-center gap-2.5 py-1.5 px-0.5">
          <span className="w-3.5 h-3.5 flex-none flex items-center justify-center">
            <span
              className={`w-1.5 h-1.5 rounded-full ${DOT[activity.status]} ${activity.status === "started" ? "animate-pulse" : ""}`}
            />
          </span>
          <span className={`text-xs ${LABEL[activity.status]}`}>{activity.label}</span>
          {activity.note && (
            <span className="ml-auto text-[11px] text-[var(--copilot-dim)] tabular-nums truncate max-w-[45%]">
              {activity.note}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
