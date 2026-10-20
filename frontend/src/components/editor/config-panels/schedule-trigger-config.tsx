"use client"

import { useMemo } from "react"
import { Plus } from "lucide-react"
import {
  nodeFeedsAnything,
  normalizeScheduleRetry,
  normalizeScheduleRules,
  type FeedNode,
  type ScheduleRule,
} from "@nodaro/shared/workflow"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n"
import type { MessageKey } from "@/lib/i18n/en"
import { useLocaleStore } from "@/lib/locale-store"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  SCHEDULE_PRESET_IDS,
  defaultRuleForKind,
  effectiveScheduleTimezone,
  isScheduleActive,
  isScheduleTimezoneReadable,
  newScheduleRuleId,
  presetMatching,
  presetRules,
  rawScheduleRules,
  scheduleRulesPatch,
  type SchedulePresetId,
} from "@/lib/schedule-node-rules"
import { describeScheduleRule } from "@/lib/schedule-words"
import type { ScheduleTriggerData } from "@/types/nodes"
import type { ConfigProps } from "./types"
import { ScheduleWhenItRuns } from "./schedule-when-it-runs"
import { ScheduleRuleEditor } from "./schedule-rule-editor"
import { ScheduleRetrySection } from "./schedule-retry-section"
import { TimezoneSelect } from "./timezone-select"

const PRESET_LABEL: Readonly<Record<SchedulePresetId, MessageKey>> = {
  "every-5-min": "sched.presetEvery5Min",
  hourly: "sched.presetHourly",
  "daily-9am": "sched.presetDaily9",
  "weekdays-9am": "sched.presetWeekdays9",
}

function SectionTitle({ children }: { readonly children: string }) {
  return (
    <div className="flex items-center gap-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
      <div className="flex-1 h-px bg-border/70" />
    </div>
  )
}

/**
 * The Schedule Trigger's settings: the switch (a schedule runs only while it
 * is on), quick presets, what the rules mean before saving ("When it runs"),
 * the rules themselves, the timezone and the run cap. The node's label and
 * the Run-from-here button are the panel chrome's, shared by every node.
 *
 * Two readings of the rules: the editor edits them AS TYPED (`rawScheduleRules`
 * — a half-typed cron stays in its field), while the presets, the preview and
 * the "cannot run" lines read what the SERVER will run (normalised). A node
 * written before the rules model shows its converted rules; the first edit
 * writes `rules` and clears the old fields (`scheduleRulesPatch`) — nothing is
 * rewritten just by opening the panel, the server converts on save either way.
 */
export function ScheduleTriggerConfig({ data, onUpdate }: ConfigProps<ScheduleTriggerData>) {
  const t = useT()
  const locale = useLocaleStore((s) => s.locale)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  // The SAME "does this node feed anything" the server's run scope uses
  // (`@nodaro/shared` trigger-feeds): live edges, Group membership, field
  // mappings — so this line and the server never disagree on branch vs whole.
  const isWired = useWorkflowStore((s) =>
    selectedNodeId ? nodeFeedsAnything(s.nodes as ReadonlyArray<FeedNode>, s.edges, selectedNodeId) : false,
  )

  const rulesKey = JSON.stringify([data.rules, data.interval, data.cron, data.cronExpression])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key IS the dependency
  const rules = useMemo(() => rawScheduleRules(data), [rulesKey])
  const runnableRules = useMemo(() => normalizeScheduleRules(rules), [rules])
  const timezone = effectiveScheduleTimezone(data)
  const timezoneReadable = isScheduleTimezoneReadable(data)
  const active = isScheduleActive(data)
  const preset = presetMatching(runnableRules)
  // Retry on failure: shown as the server will run it (clamped); the section
  // writes the whole policy, so a partial object never reaches the row.
  const retry = useMemo(() => normalizeScheduleRetry(data.retry), [data.retry])

  const writeRules = (next: ReadonlyArray<ScheduleRule>) => onUpdate(scheduleRulesPatch(next))
  const replaceRule = (index: number, next: ScheduleRule) => writeRules(rules.map((r, i) => (i === index ? next : r)))
  const removeRule = (index: number) => {
    if (rules.length <= 1) return
    writeRules(rules.filter((_, i) => i !== index))
  }
  const addRule = () => writeRules([...rules, defaultRuleForKind("days", newScheduleRuleId(rules))])

  const cannotRun = !timezoneReadable
    ? t("sched.cannotRunTimezone", { tz: timezone })
    : runnableRules.length === 0
      ? t("sched.cannotRunRules")
      : null

  return (
    <div className="flex flex-col gap-5">
      <div
        className={cn(
          "rounded-xl border p-3.5 flex items-start gap-3",
          active ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-muted/20",
        )}
        data-testid="schedule-switch-card"
      >
        <Switch
          checked={active}
          onCheckedChange={(next) => onUpdate({ active: next })}
          aria-label={active ? t("sched.switchOnTitle") : t("sched.switchOffTitle")}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{active ? t("sched.switchOnTitle") : t("sched.switchOffTitle")}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{isWired ? t("sched.switchHint") : t("sched.switchHintUnwired")}</p>
          <p className="text-[11px] text-muted-foreground/80 mt-1.5">{isWired ? t("sched.scopeBranch") : t("sched.scopeWhole")}</p>
          {cannotRun && (
            <p className="text-[11px] text-destructive mt-1.5" data-testid="schedule-cannot-run">{cannotRun}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionTitle>{t("sched.presets")}</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {SCHEDULE_PRESET_IDS.map((id) => {
            const on = preset === id
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => writeRules(presetRules(id))}
                className={cn(
                  "px-2.5 py-1 rounded-full border text-[11.5px] font-semibold transition-colors",
                  on
                    ? "border-[#ff0073] bg-[#ff0073]/10 text-[#ff0073]"
                    : "border-border bg-background text-muted-foreground hover:border-[#ff0073]/50 hover:text-foreground",
                )}
              >
                {t(PRESET_LABEL[id])}
              </button>
            )
          })}
        </div>
      </div>

      <ScheduleWhenItRuns rules={runnableRules} timezone={timezone} timezoneReadable={timezoneReadable} locale={locale} />

      <div className="flex flex-col gap-3">
        <SectionTitle>{t("sched.triggerRules")}</SectionTitle>
        {rules.map((rule, index) => (
          <ScheduleRuleEditor
            key={rule.id}
            rule={rule}
            index={index}
            canRemove={rules.length > 1}
            locale={locale}
            onChange={(next) => replaceRule(index, next)}
            onRemove={() => removeRule(index)}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          className="w-full h-10 border-dashed text-muted-foreground hover:text-[#ff0073] hover:border-[#ff0073]/60 hover:bg-[#ff0073]/5"
          onClick={addRule}
        >
          <Plus className="h-4 w-4 me-1.5" />
          {t("sched.addRule")}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <SectionTitle>{t("sched.execution")}</SectionTitle>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t("cfgext.trigTimezone")}</Label>
          <TimezoneSelect value={timezone} onChange={(zone) => onUpdate({ timezone: zone })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs" htmlFor="schedule-max-executions">{t("cfgext.trigMaxExecutions")}</Label>
          <Input
            id="schedule-max-executions"
            type="number"
            inputMode="numeric"
            min={1}
            value={data.maxExecutions ?? ""}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === "") {
                onUpdate({ maxExecutions: undefined })
                return
              }
              const n = parseInt(raw, 10)
              if (!Number.isNaN(n) && n > 0) onUpdate({ maxExecutions: n })
            }}
            placeholder={t("cfgext.trigUnlimited")}
            className="h-9"
          />
          <p className="text-[11px] text-muted-foreground">{t("cfgext.trigLeaveEmptyUnlimited")}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionTitle>{t("sched.retrySection")}</SectionTitle>
        <ScheduleRetrySection retry={retry} onChange={(next) => onUpdate({ retry: next })} />
      </div>

      <p className="text-center text-[11px] text-muted-foreground" data-testid="schedule-summary">
        {rules.map((rule) => describeScheduleRule(rule, t, locale)).join("  ·  ")}
      </p>
    </div>
  )
}
