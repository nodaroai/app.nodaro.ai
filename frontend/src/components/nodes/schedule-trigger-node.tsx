"use client"

import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Clock, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { TriggerPreviewWarning } from "./trigger-preview-warning"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useNowMinute } from "@/hooks/use-now-minute"
import { effectiveScheduleRules, effectiveScheduleTimezone, isScheduleActive, isScheduleRunnable } from "@/lib/schedule-node-rules"
import { scheduleNextRun, scheduleRunsPerDay } from "@/lib/schedule-preview"
import { describeNextRun, describeSchedule, ruleCountLabel, runsPerDayLabel } from "@/lib/schedule-words"
import type { ScheduleTriggerData } from "@/types/nodes"

const HANDLES = [
  { id: "payload", type: "source" as const, position: Position.Right, customStyle: { top: '24px', right: '-29px' }, external: true },
] as const

/**
 * The card says what the schedule does, not how it is spelled: the rules in
 * words, the next run (in the schedule's timezone), whether it is on, how many
 * runs a day, how many rules. Computed with the server's own arithmetic and
 * re-read once a minute (one shared tick for every card on the canvas).
 */
function ScheduleTriggerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ScheduleTriggerData
  const t = useT()
  const locale = useLocaleStore((s) => s.locale)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const now = useNowMinute()

  const rulesKey = JSON.stringify([nodeData.rules, nodeData.interval, nodeData.cron, nodeData.cronExpression])
  const timezone = effectiveScheduleTimezone(nodeData)
  const active = isScheduleActive(nodeData)
  // "Active" is only honest when the server will actually run it: a switched-on
  // schedule with no usable rule or an unreadable timezone is PARKED on the
  // server, and the card says so rather than showing a green light.
  const state: "active" | "blocked" | "paused" = active ? (isScheduleRunnable(nodeData) ? "active" : "blocked") : "paused"
  const view = useMemo(() => {
    const rules = effectiveScheduleRules(nodeData)
    return {
      headline: describeSchedule(rules, t, locale),
      nextRun: describeNextRun(scheduleNextRun(rules, timezone, now), now, timezone, locale, t),
      perDay: runsPerDayLabel(scheduleRunsPerDay(rules, timezone, now), t),
      ruleCount: ruleCountLabel(rules.length, t),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rules compared by content (rulesKey), not identity
  }, [rulesKey, timezone, now, locale, t])

  return (
    <div className="relative max-w-[260px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Clock className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Clock className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        minWidth={240}
        hideHeader
        handles={HANDLES}
      >
        <div className="px-3.5 pt-3 pb-2.5 flex flex-col gap-1.5">
          <p className="text-[15px] font-semibold leading-snug text-foreground text-pretty break-words" data-testid="schedule-headline">
            {view.headline}
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0 text-[#ff0073]" />
            <span className="truncate">{view.nextRun} · {timezone}</span>
          </p>
          <div className="mt-0.5 pt-2 border-t border-border/60 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span
              data-testid="schedule-state"
              data-state={state}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold",
                state === "active" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                state === "blocked" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                state === "paused" && "bg-muted text-muted-foreground",
              )}
            >
              <span className={cn("size-1.5 rounded-full", state === "active" ? "bg-emerald-500" : state === "blocked" ? "bg-amber-500" : "bg-muted-foreground/60")} />
              {state === "active" ? t("sched.active") : state === "blocked" ? t("sched.cannotRun") : t("sched.paused")}
            </span>
            <span>{view.perDay}</span>
            <span className="flex-1" />
            <span>{view.ruleCount}</span>
          </div>
        </div>
        <TriggerPreviewWarning nodeId={id} armed={active} />
      </BaseNode>
      {/* A trigger starts the run; it takes nothing from the canvas (registry: inputs []). */}
      <HandleWithPopover nodeId={id} nodeType="schedule-trigger" handleId="payload" type="source" position={Position.Right} label="Payload" color={HANDLE_COLORS.control} icon={<Type />} side="right" top="24px" />
    </div>
  )
}

export const ScheduleTriggerNode = memo(ScheduleTriggerNodeComponent)
