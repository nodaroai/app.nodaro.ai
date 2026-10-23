"use client"

import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { SCHEDULE_RULE_KINDS, isCronExpression, type ScheduleRule, type ScheduleRuleKind } from "@nodaro/shared/workflow"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import type { MessageKey } from "@/lib/i18n/en"
import { everyLimitsFor, ruleWithKind } from "@/lib/schedule-node-rules"
import { describeScheduleRule, hourLabel, weekdayShort } from "@/lib/schedule-words"

const KIND_LABEL: Readonly<Record<ScheduleRuleKind, MessageKey>> = {
  minutes: "sched.kindMinutes",
  hours: "sched.kindHours",
  days: "sched.kindDays",
  weeks: "sched.kindWeeks",
  months: "sched.kindMonths",
  cron: "sched.kindCron",
}

const EVERY_LABEL: Readonly<Record<Exclude<ScheduleRuleKind, "cron">, MessageKey>> = {
  minutes: "sched.minutesBetween",
  hours: "sched.hoursBetween",
  days: "sched.daysBetween",
  weeks: "sched.weeksBetween",
  months: "sched.monthsBetween",
}

/** Monday-first, as the design shows the chips; values stay 0 = Sunday. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const HOURS = Array.from({ length: 24 }, (_, h) => h)

function clampInt(raw: string, lo: number, hi: number): number | null {
  if (raw.trim() === "") return null
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return null
  return Math.min(hi, Math.max(lo, n))
}

/**
 * A bounded whole-number field that lets the person finish typing: an exact
 * in-range value is committed as it is typed (the preview follows along),
 * anything else waits for blur / Enter and is then clamped into range — so
 * "35" in a 1–31 field is not rewritten to "31" under the cursor.
 * Shared with the panel's Retry on failure section.
 */
export function NumberField({
  id,
  label,
  value,
  lo,
  hi,
  hint,
  onCommit,
}: {
  readonly id: string
  readonly label: string
  readonly value: number
  readonly lo: number
  readonly hi: number
  readonly hint: string
  readonly onCommit: (n: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = () => {
    const n = clampInt(draft, lo, hi)
    if (n === null) {
      setDraft(String(value))
      return
    }
    setDraft(String(n))
    if (n !== value) onCommit(n)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs" htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={lo}
        max={hi}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          const n = parseInt(raw, 10)
          if (!Number.isNaN(n) && String(n) === raw.trim() && n >= lo && n <= hi && n !== value) onCommit(n)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
        }}
        className="h-9"
      />
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  )
}

/** One rule card: its kind, the fields that kind reads, range hints, and the remove button. */
export function ScheduleRuleEditor({
  rule,
  index,
  canRemove,
  locale,
  onChange,
  onRemove,
}: {
  readonly rule: ScheduleRule
  readonly index: number
  readonly canRemove: boolean
  readonly locale: string
  readonly onChange: (next: ScheduleRule) => void
  readonly onRemove: () => void
}) {
  const t = useT()
  const [everyLo, everyHi] = everyLimitsFor(rule.kind)
  const set = (patch: Partial<ScheduleRule>) => onChange({ ...rule, ...patch })
  const showsHour = rule.kind === "days" || rule.kind === "weeks" || rule.kind === "months"
  const showsMinute = rule.kind !== "minutes" && rule.kind !== "cron"
  const cronValid = rule.kind !== "cron" || isCronExpression(rule.cron)
  const weekdays = rule.weekdays ?? []

  return (
    <div className="rounded-xl border border-border p-3.5 flex flex-col gap-3.5 bg-card" data-testid={`schedule-rule-${index + 1}`}>
      <div className="flex items-center gap-2.5">
        <span className="size-[22px] rounded-md bg-muted text-[11px] font-bold text-muted-foreground flex items-center justify-center">{index + 1}</span>
        <p className="flex-1 text-xs font-semibold text-foreground truncate">{describeScheduleRule(rule, t, locale)}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive disabled:opacity-40"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={t("sched.removeRule")}
          title={canRemove ? t("sched.removeRule") : t("sched.lastRuleKept")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">{t("sched.interval")}</Label>
        <Select value={rule.kind} onValueChange={(kind) => onChange(ruleWithKind(rule, kind as ScheduleRuleKind))}>
          <SelectTrigger className="h-9" aria-label={t("sched.interval")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEDULE_RULE_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>{t(KIND_LABEL[kind])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rule.kind !== "cron" && (
        <NumberField
          id={`rule-${rule.id}-every`}
          label={t(EVERY_LABEL[rule.kind])}
          value={rule.every ?? everyLo}
          lo={everyLo}
          hi={everyHi}
          hint={t("sched.rangeHint", { lo: everyLo, hi: everyHi })}
          onCommit={(n) => set({ every: n })}
        />
      )}

      {rule.kind === "weeks" && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t("sched.triggerOnWeekdays")}</Label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("sched.triggerOnWeekdays")}>
            {WEEKDAY_ORDER.map((day) => {
              const on = weekdays.includes(day)
              const last = on && weekdays.length === 1
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  disabled={last}
                  title={last ? t("sched.lastRuleKept") : undefined}
                  onClick={() => set({ weekdays: on ? weekdays.filter((d) => d !== day) : [...weekdays, day].sort((a, b) => a - b) })}
                  className={cn(
                    "px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                    on
                      ? "border-[#ff0073] bg-cta text-white"
                      : "border-border bg-background text-muted-foreground hover:border-[#ff0073]/50",
                    last && "cursor-default",
                  )}
                >
                  {weekdayShort(day, locale)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {rule.kind === "months" && (
        <NumberField
          id={`rule-${rule.id}-dom`}
          label={t("sched.dayOfMonth")}
          value={rule.dayOfMonth ?? 1}
          lo={1}
          hi={31}
          hint={t("sched.dayOfMonthHint")}
          onCommit={(n) => set({ dayOfMonth: n })}
        />
      )}

      {showsHour && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t("sched.triggerAtHour")}</Label>
          <Select value={String(rule.hour ?? 0)} onValueChange={(h) => set({ hour: parseInt(h, 10) })}>
            <SelectTrigger className="h-9" aria-label={t("sched.triggerAtHour")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[260px]">
              {HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>{hourLabel(h, locale)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {showsMinute && (
        <NumberField
          id={`rule-${rule.id}-minute`}
          label={t("sched.triggerAtMinute")}
          value={rule.minute ?? 0}
          lo={0}
          hi={59}
          hint={t("sched.rangeHint", { lo: 0, hi: 59 })}
          onCommit={(n) => set({ minute: n })}
        />
      )}

      {rule.kind === "cron" && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs" htmlFor={`rule-${rule.id}-cron`}>{t("sched.cronExpression")}</Label>
          <Input
            id={`rule-${rule.id}-cron`}
            value={rule.cron ?? ""}
            onChange={(e) => set({ cron: e.target.value })}
            placeholder="0 9 * * 1-5"
            className={cn("h-9 font-mono text-sm tracking-wider", !cronValid && "border-destructive")}
            dir="ltr"
            aria-invalid={!cronValid}
          />
          <p className={cn("text-[11px]", cronValid ? "text-muted-foreground" : "text-destructive")}>{t("cfgext.trigCronFormat")}</p>
        </div>
      )}
    </div>
  )
}
