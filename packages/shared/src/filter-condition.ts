/** Pure condition evaluator shared by filter-list and router (conditional mode). */

import { evaluateJsonPath } from "./json-path.js"

export type FilterListOperator =
  | ">" | "<" | ">=" | "<="
  | "=" | "!="
  | "contains" | "not_contains"
  | "starts_with" | "ends_with" | "regex"
  | "exists" | "not_exists"

export interface FilterListCondition {
  id?: string
  field?: string
  operator: FilterListOperator
  value?: string
  valueType?: "static" | "variable"
  /** UI-only hint on the config panel — irrelevant to evaluation. */
  mode?: "dropdown" | "custom"
}

/** AND/OR condition bundle used by the router's conditional mode. When a
 *  group matches, every routeId is added to activeRoutes. Multiple groups
 *  union (deduped). */
export interface RouterConditionGroup {
  id?: string
  conditions?: FilterListCondition[]
  conditionLogic?: "AND" | "OR"
  routeIds?: string[]
}

export function tryParseJson(item: unknown): unknown {
  if (typeof item !== "string") return item
  const trimmed = item.trim()
  if (!trimmed) return item
  const first = trimmed[0]
  if (first !== "{" && first !== "[" && first !== "\"" && !/^-?\d/.test(trimmed) && trimmed !== "true" && trimmed !== "false" && trimmed !== "null") {
    return item
  }
  try { return JSON.parse(trimmed) } catch { return item }
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

/** Resolve a relative-window token like `last_N_hours:3` to an ISO timestamp
 *  N units before `Date.now()`. Returns undefined for malformed tokens. */
export function resolveRelativeWindowToken(key: string): string | undefined {
  const m = /^last_N_(hours|days|weeks):(-?\d+)$/.exec(key)
  if (!m) return undefined
  const n = parseInt(m[2], 10)
  if (!Number.isFinite(n)) return undefined
  const unitMs = m[1] === "hours" ? HOUR_MS : m[1] === "days" ? DAY_MS : WEEK_MS
  return new Date(Date.now() - n * unitMs).toISOString()
}

export function resolveConditionValue(
  raw: string,
  valueType: string | undefined,
  triggerData?: Record<string, unknown>,
): string {
  const hasTemplate = /\{\{/.test(raw)
  if (valueType !== "variable" && !hasTemplate) return raw
  return raw.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr) => {
    const key = String(expr).trim()
    if (key === "now") return new Date().toISOString()
    if (key === "trigger.last_triggered_at") {
      const v = triggerData?.last_triggered_at
      return v == null ? "" : String(v)
    }
    if (key.startsWith("trigger.")) {
      const path = key.slice("trigger.".length)
      const v = triggerData?.[path]
      return v == null ? "" : String(v)
    }
    const relative = resolveRelativeWindowToken(key)
    if (relative !== undefined) return relative
    return ""
  })
}

function asComparableNumber(v: unknown): number {
  if (typeof v === "number") return v
  if (typeof v === "boolean") return v ? 1 : 0
  if (typeof v === "string") {
    const trimmed = v.trim()
    if (trimmed === "") return NaN
    const n = Number(trimmed)
    if (!isNaN(n)) return n
    const d = Date.parse(trimmed)
    if (!isNaN(d)) return d
  }
  return NaN
}

// Numeric-first ordering compare used by >, <, >=, <=. Falls back to
// localeCompare when either side can't be parsed as a number.
function compareValues(a: unknown, b: unknown): number {
  const na = asComparableNumber(a)
  const nb = asComparableNumber(b)
  if (!isNaN(na) && !isNaN(nb)) return na - nb
  return String(a ?? "").localeCompare(String(b ?? ""))
}

// Numeric-first equality used by = and !=. So "432" == 432, and 432 == "432".
// Falls back to strict string equality (null/undefined coerced to "") so
// alpha values still work.
function valuesEqual(a: unknown, b: unknown): boolean {
  const na = asComparableNumber(a)
  const nb = asComparableNumber(b)
  if (!isNaN(na) && !isNaN(nb)) return na === nb
  return String(a ?? "") === String(b ?? "")
}

export function evaluateCondition(
  parsedItem: unknown,
  rawItem: string,
  condition: FilterListCondition,
  triggerData?: Record<string, unknown>,
): boolean {
  const path = (condition.field ?? "").trim()
  let fieldValue: unknown
  if (path === "") {
    fieldValue = parsedItem ?? rawItem
  } else {
    const matches = evaluateJsonPath(parsedItem ?? rawItem, path)
    fieldValue = matches.length > 0 ? matches[0] : undefined
  }

  const targetStr = resolveConditionValue(condition.value ?? "", condition.valueType, triggerData)

  switch (condition.operator) {
    case "exists":
      return fieldValue !== undefined && fieldValue !== null
    case "not_exists":
      return fieldValue === undefined || fieldValue === null
    case "contains":
      return String(fieldValue ?? "").includes(targetStr)
    case "not_contains":
      return !String(fieldValue ?? "").includes(targetStr)
    case "starts_with":
      return String(fieldValue ?? "").startsWith(targetStr)
    case "ends_with":
      return String(fieldValue ?? "").endsWith(targetStr)
    case "regex": {
      if (!targetStr) return false
      try {
        return new RegExp(targetStr).test(String(fieldValue ?? ""))
      } catch {
        return false
      }
    }
    case "=":
      return valuesEqual(fieldValue, targetStr)
    case "!=":
      return !valuesEqual(fieldValue, targetStr)
    case ">":
      return compareValues(fieldValue, targetStr) > 0
    case "<":
      return compareValues(fieldValue, targetStr) < 0
    case ">=":
      return compareValues(fieldValue, targetStr) >= 0
    case "<=":
      return compareValues(fieldValue, targetStr) <= 0
    default:
      return false
  }
}

/** Evaluate a single AND/OR-joined group against one item. Empty condition
 *  list evaluates to `true` — typical when the user has just added a group
 *  and hasn't configured any conditions yet. */
export function evaluateConditionGroup(
  parsedItem: unknown,
  rawItem: string,
  conditions: readonly FilterListCondition[],
  logic: "AND" | "OR",
  triggerData?: Record<string, unknown>,
): boolean {
  const effective = conditions.filter((c) => c && c.operator)
  if (effective.length === 0) return true
  const results = effective.map((c) => evaluateCondition(parsedItem, rawItem, c, triggerData))
  return logic === "OR" ? results.some(Boolean) : results.every(Boolean)
}
