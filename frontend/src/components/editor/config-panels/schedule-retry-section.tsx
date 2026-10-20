"use client"

import { SCHEDULE_RETRY_DEFAULTS, SCHEDULE_RETRY_LIMITS, type ScheduleRetry } from "@nodaro/shared/workflow"

import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n"
import { NumberField } from "./schedule-rule-editor"

/**
 * The Schedule Trigger panel's "Retry on failure": the switch (off = no
 * policy on the node), the wait, the attempts and "Cheap lanes only". Every
 * edit hands back the WHOLE policy, or `undefined` to switch it off, so a
 * partial object never reaches the node.
 */
export function ScheduleRetrySection({
  retry,
  onChange,
}: {
  /** The policy as the server will run it (normalised), or null when off. */
  readonly retry: ScheduleRetry | null
  readonly onChange: (next: ScheduleRetry | undefined) => void
}) {
  const t = useT()
  return (
    <>
      <div
        className={cn(
          "rounded-xl border p-3.5 flex items-start gap-3",
          retry ? "border-[#ff0073]/40 bg-[#ff0073]/5" : "border-border bg-muted/20",
        )}
        data-testid="schedule-retry-card"
      >
        <Switch
          checked={retry !== null}
          onCheckedChange={(on) => onChange(on ? { ...SCHEDULE_RETRY_DEFAULTS } : undefined)}
          aria-label={t("sched.retryToggle")}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{t("sched.retryToggle")}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t("sched.retryHint")}</p>
        </div>
      </div>
      {retry && (
        <>
          <NumberField
            id="schedule-retry-after"
            label={t("sched.retryAfterMinutes")}
            value={retry.afterMinutes}
            lo={SCHEDULE_RETRY_LIMITS.afterMinutes[0]}
            hi={SCHEDULE_RETRY_LIMITS.afterMinutes[1]}
            hint={t("sched.rangeHint", { lo: SCHEDULE_RETRY_LIMITS.afterMinutes[0], hi: SCHEDULE_RETRY_LIMITS.afterMinutes[1] })}
            onCommit={(n) => onChange({ ...retry, afterMinutes: n })}
          />
          <NumberField
            id="schedule-retry-attempts"
            label={t("sched.retryMaxAttempts")}
            value={retry.maxAttempts}
            lo={SCHEDULE_RETRY_LIMITS.maxAttempts[0]}
            hi={SCHEDULE_RETRY_LIMITS.maxAttempts[1]}
            hint={t("sched.rangeHint", { lo: SCHEDULE_RETRY_LIMITS.maxAttempts[0], hi: SCHEDULE_RETRY_LIMITS.maxAttempts[1] })}
            onCommit={(n) => onChange({ ...retry, maxAttempts: n })}
          />
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="schedule-retry-cheap-lanes"
              checked={retry.cheapLanesOnly}
              onCheckedChange={(checked) => onChange({ ...retry, cheapLanesOnly: checked === true })}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-0.5">
              <label htmlFor="schedule-retry-cheap-lanes" className="text-xs font-medium cursor-pointer">
                {t("sched.retryCheapLanes")}
              </label>
              <p className="text-[11px] text-muted-foreground">{t("sched.retryCheapLanesHint")}</p>
            </div>
          </div>
        </>
      )}
    </>
  )
}
