"use client"

/**
 * Reusable per-condition editor row shared by the filter-list config panel
 * and the router's conditional mode. Takes a single FilterListCondition plus
 * the parent's list of detected upstream field paths, and renders the full
 * editing UX: field dropdown, operator select, smart date picker for date-ish
 * fields + comparison ops, static/variable value toggle with variable token
 * dropdown.
 */

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2 } from "lucide-react"
import type { FilterListCondition, FilterListOperator } from "@/types/nodes"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILTER_OPERATOR_LABELS: Record<FilterListOperator, string> = {
  ">": "greater than",
  "<": "less than",
  ">=": "greater or equal",
  "<=": "less or equal",
  "=": "equals",
  "!=": "not equals",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  ends_with: "ends with",
  regex: "matches regex",
  exists: "exists",
  not_exists: "does not exist",
}

const FILTER_NO_VALUE_OPERATORS: ReadonlySet<FilterListOperator> = new Set(["exists", "not_exists"])

const FILTER_COMPARISON_OPERATORS: ReadonlySet<FilterListOperator> = new Set([">", "<", ">=", "<="])

const FILTER_VARIABLE_TOKENS: ReadonlyArray<{ token: string; label: string }> = [
  { token: "{{now}}", label: "Current ISO time ({{now}})" },
  { token: "{{trigger.last_triggered_at}}", label: "Last trigger fire ({{trigger.last_triggered_at}})" },
]

const DATE_FIELD_EXACT = new Set(["timestamp", "created_at", "updated_at", "published_at", "date"])
const DATE_FIELD_SUFFIX_RE = /(_at|_date|At|Date)$/

const FIELD_WHOLE = "__whole__"
const FIELD_CUSTOM = "__custom__"

export function isDateTimeField(name: string): boolean {
  if (!name) return false
  if (DATE_FIELD_EXACT.has(name.toLowerCase())) return true
  return DATE_FIELD_SUFFIX_RE.test(name)
}

export type DateValueMode = "since-last-run" | "last-hours" | "last-days" | "last-weeks" | "custom"

export function parseDateValueMode(value: string): { mode: DateValueMode; n: number } {
  if (value === "{{trigger.last_triggered_at}}") return { mode: "since-last-run", n: 0 }
  const hours = /^\{\{\s*last_N_hours:(\d+)\s*\}\}$/.exec(value)
  if (hours) return { mode: "last-hours", n: parseInt(hours[1], 10) }
  const days = /^\{\{\s*last_N_days:(\d+)\s*\}\}$/.exec(value)
  if (days) return { mode: "last-days", n: parseInt(days[1], 10) }
  const weeks = /^\{\{\s*last_N_weeks:(\d+)\s*\}\}$/.exec(value)
  if (weeks) return { mode: "last-weeks", n: parseInt(weeks[1], 10) }
  return { mode: "custom", n: 0 }
}

const DATE_MODE_DEFAULT_N: Record<Exclude<DateValueMode, "since-last-run" | "custom">, number> = {
  "last-hours": 3,
  "last-days": 1,
  "last-weeks": 1,
}

export function buildDateValueToken(mode: DateValueMode, n: number): string {
  switch (mode) {
    case "since-last-run":
      return "{{trigger.last_triggered_at}}"
    case "last-hours":
      return `{{last_N_hours:${n}}}`
    case "last-days":
      return `{{last_N_days:${n}}}`
    case "last-weeks":
      return `{{last_N_weeks:${n}}}`
    case "custom":
      return ""
  }
}

const DATE_MODE_LABEL: Record<DateValueMode, string> = {
  "since-last-run": "Since last run",
  "last-hours": "Last N hours",
  "last-days": "Last N days",
  "last-weeks": "Last N weeks",
  custom: "Custom…",
}

function DateTimeValuePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (nextValue: string, nextValueType: "static" | "variable") => void
}) {
  const parsed = parseDateValueMode(value)
  const showNInput = parsed.mode === "last-hours" || parsed.mode === "last-days" || parsed.mode === "last-weeks"
  const isSinceLastRun = parsed.mode === "since-last-run"

  return (
    <div className="flex flex-col gap-1 flex-1 min-w-0">
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <Select
          value={parsed.mode}
          onValueChange={(raw) => {
            const nextMode = raw as DateValueMode
            if (nextMode === "custom") {
              onChange("", "static")
              return
            }
            if (nextMode === "since-last-run") {
              onChange(buildDateValueToken(nextMode, 0), "variable")
              return
            }
            const n = parsed.n > 0 ? parsed.n : DATE_MODE_DEFAULT_N[nextMode]
            onChange(buildDateValueToken(nextMode, n), "variable")
          }}
        >
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0" aria-label="Date value mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DATE_MODE_LABEL) as DateValueMode[]).map((mode) => (
              <SelectItem key={mode} value={mode} className="text-xs">
                {DATE_MODE_LABEL[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showNInput && (
          <Input
            type="number"
            min={1}
            value={parsed.n || 1}
            onChange={(e) => {
              const n = Math.max(1, parseInt(e.target.value, 10) || 1)
              onChange(buildDateValueToken(parsed.mode, n), "variable")
            }}
            className="text-xs h-7 w-16 shrink-0"
            aria-label="Number of units"
          />
        )}
      </div>
      {isSinceLastRun && (
        <p className="text-[10px] text-amber-500/90" role="note">
          Resolves only on triggered/scheduled runs. A manual Run treats this as empty.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AndOrToggle — shared AND/OR pill switch
// ---------------------------------------------------------------------------

export function AndOrToggle({
  value,
  onChange,
}: {
  readonly value: "AND" | "OR"
  readonly onChange: (next: "AND" | "OR") => void
}) {
  return (
    <div className="flex rounded-md border border-border overflow-hidden">
      {(["AND", "OR"] as const).map((logicMode) => (
        <button
          key={logicMode}
          type="button"
          onClick={() => onChange(logicMode)}
          className={
            "px-2.5 py-1 text-[10px] font-medium transition-colors " +
            (value === logicMode
              ? "bg-foreground text-background"
              : "bg-background text-muted-foreground hover:text-foreground")
          }
        >
          {logicMode}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConditionRowEditor
// ---------------------------------------------------------------------------

export interface ConditionRowEditorProps {
  readonly condition: FilterListCondition
  readonly fieldOptions: readonly string[]
  readonly onUpdate: (patch: Partial<FilterListCondition>) => void
  readonly onRemove: () => void
}

export function ConditionRowEditor({ condition, fieldOptions, onUpdate, onRemove }: ConditionRowEditorProps) {
  const isNoValue = FILTER_NO_VALUE_OPERATORS.has(condition.operator)
  const isVariable = condition.valueType === "variable"
  const condMode = condition.mode ?? "dropdown"
  const fieldValue = condition.field ?? ""
  const selectValue = fieldValue === ""
    ? FIELD_WHOLE
    : (fieldOptions.includes(fieldValue) ? fieldValue : "")

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/20 p-2">
      <div className="flex items-center gap-1.5">
        {condMode === "dropdown" ? (
          <Select
            value={selectValue}
            onValueChange={(v) => {
              if (v === FIELD_CUSTOM) {
                onUpdate({ mode: "custom" })
              } else if (v === FIELD_WHOLE) {
                onUpdate({ field: "" })
              } else {
                onUpdate({ field: v })
              }
            }}
          >
            <SelectTrigger aria-label="Field" className="h-7 text-xs min-w-0 flex-1">
              <SelectValue placeholder="Select a field..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FIELD_WHOLE} className="text-muted-foreground">(whole item)</SelectItem>
              {fieldOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
              <SelectItem value={FIELD_CUSTOM} className="text-muted-foreground">Custom path…</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={fieldValue}
            onChange={(e) => onUpdate({ field: e.target.value })}
            placeholder="field (blank = whole item)"
            className="text-xs h-7 min-w-0 flex-1"
          />
        )}
        <Select
          value={condition.operator}
          onValueChange={(v) =>
            onUpdate({
              operator: v as FilterListOperator,
              value: FILTER_NO_VALUE_OPERATORS.has(v as FilterListOperator) ? "" : condition.value,
            })
          }
        >
          <SelectTrigger className="h-7 text-xs w-[140px] shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(FILTER_OPERATOR_LABELS) as [FilterListOperator, string][]).map(([op, label]) => (
              <SelectItem key={op} value={op} className="text-xs">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
          title="Remove condition"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {condMode === "custom" && (
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground hover:underline text-left self-start"
          onClick={() => onUpdate({ mode: "dropdown" })}
        >
          ← Back to field list
        </button>
      )}
      {!isNoValue && (() => {
        const useDatePicker =
          isDateTimeField(fieldValue) && FILTER_COMPARISON_OPERATORS.has(condition.operator)
        if (useDatePicker) {
          return (
            <DateTimeValuePicker
              value={condition.value ?? ""}
              onChange={(nextValue, nextValueType) =>
                onUpdate({ value: nextValue, valueType: nextValueType })
              }
            />
          )
        }
        return (
          <div className="flex items-center gap-1.5">
            {isVariable ? (
              <Select
                value={condition.value || ""}
                onValueChange={(v) => onUpdate({ value: v })}
              >
                <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                  <SelectValue placeholder="Select variable..." />
                </SelectTrigger>
                <SelectContent>
                  {FILTER_VARIABLE_TOKENS.map((v) => (
                    <SelectItem key={v.token} value={v.token} className="text-xs">
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={condition.value ?? ""}
                onChange={(e) => onUpdate({ value: e.target.value })}
                placeholder="value"
                className="text-xs h-7 min-w-0 flex-1"
              />
            )}
            <button
              type="button"
              onClick={() =>
                onUpdate({
                  valueType: isVariable ? "static" : "variable",
                  value: "",
                })
              }
              className={
                "shrink-0 text-[10px] px-2 py-1 rounded-md border transition-colors " +
                (isVariable
                  ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-400"
                  : "border-border text-muted-foreground hover:text-foreground")
              }
              title="Toggle static/variable value"
            >
              {isVariable ? "var" : "str"}
            </button>
          </div>
        )
      })()}
    </div>
  )
}
