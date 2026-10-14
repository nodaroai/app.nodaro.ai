/**
 * What a Schedule Trigger node's data means — read by the node card, the
 * settings panel and the editor's top-bar switch, so the three never
 * disagree. The rule model itself (kinds, matching, previews) is
 * `@nodaro/shared` schedule-rules; this file is only the node-data side of it.
 */

import {
  SCHEDULE_EVERY_LIMITS,
  SCHEDULE_RULE_KINDS,
  isValidTimezone,
  legacyScheduleToRules,
  normalizeScheduleRule,
  normalizeScheduleRules,
  type ScheduleRule,
  type ScheduleRuleKind,
} from "@nodaro/shared/workflow"

type NodeDataLike = { readonly [key: string]: unknown }

export const DEFAULT_SCHEDULE_RULE: ScheduleRule = { id: "rule-1", kind: "days", every: 1, hour: 9, minute: 0 }

/**
 * The rules a node carries AS TYPED — what the rule editor edits. Entries of
 * an unknown kind are dropped; everything else is kept exactly as written
 * (a half-typed cron included), so an edit in progress never unmounts the
 * field it is being typed into. For a node written before the rules model
 * (`interval` "5m" / a preset cron / a custom `cron`), the conversion.
 * Read-only: the panel writes `rules` on its first edit and the server
 * converts on save, so nothing rewrites a node just for being opened.
 */
export function rawScheduleRules(data: NodeDataLike): ScheduleRule[] {
  if (!Array.isArray(data.rules)) return legacyScheduleToRules(data)
  return data.rules.flatMap((entry, i) => {
    if (!entry || typeof entry !== "object") return []
    const r = entry as Record<string, unknown>
    if (typeof r.kind !== "string" || !(SCHEDULE_RULE_KINDS as readonly string[]).includes(r.kind)) return []
    const id = typeof r.id === "string" && r.id.trim() ? r.id : `rule-${i + 1}`
    return [{ ...r, id, kind: r.kind as ScheduleRuleKind } as ScheduleRule]
  })
}

/**
 * The rules the SERVER will run — `rawScheduleRules` through the same
 * normaliser the projection uses. What the card, the preview and the preset
 * chips read.
 */
export function effectiveScheduleRules(data: NodeDataLike): ScheduleRule[] {
  return normalizeScheduleRules(rawScheduleRules(data))
}

/** The server can read this timezone (an unreadable one parks the schedule: it never runs). */
export function isScheduleTimezoneReadable(data: NodeDataLike): boolean {
  return isValidTimezone(effectiveScheduleTimezone(data))
}

/** Will the server run this schedule once it is on? At least one usable rule, and a timezone it can read. */
export function isScheduleRunnable(data: NodeDataLike): boolean {
  return effectiveScheduleRules(data).length > 0 && isScheduleTimezoneReadable(data)
}

/** A node still on the pre-rules fields (shown converted; migrated on the first edit). */
export function isLegacyScheduleNode(data: NodeDataLike): boolean {
  return !Array.isArray(data.rules) && ["interval", "cron", "cronExpression"].some((k) => typeof data[k] === "string" && (data[k] as string).trim() !== "")
}

/** The timezone the rules are read in — UTC when the node names none (what the server reads too). */
export function effectiveScheduleTimezone(data: NodeDataLike): string {
  return typeof data.timezone === "string" && data.timezone.trim() ? data.timezone.trim() : "UTC"
}

/** The switch: only the boolean `true` arms a schedule. */
export function isScheduleActive(data: NodeDataLike): boolean {
  return data.active === true
}

/**
 * The patch that puts a node on the rules model: the rules written, the
 * pre-rules fields cleared so nothing downstream can read them again.
 */
export function scheduleRulesPatch(rules: ReadonlyArray<ScheduleRule>): Record<string, unknown> {
  return { rules: [...rules], interval: undefined, cron: undefined, cronExpression: undefined }
}

export function newScheduleRuleId(existing: ReadonlyArray<ScheduleRule>): string {
  const taken = new Set(existing.map((r) => r.id))
  let n = existing.length + 1
  while (taken.has(`rule-${n}`)) n += 1
  return `rule-${n}`
}

/** The `every` range a kind accepts; a cron rule has none. */
export function everyLimitsFor(kind: ScheduleRuleKind): readonly [number, number] {
  return kind === "cron" ? [1, 1] : SCHEDULE_EVERY_LIMITS[kind]
}

/** A sensible fresh rule of the kind — what "Add trigger rule" and a kind switch start from. */
export function defaultRuleForKind(kind: ScheduleRuleKind, id: string): ScheduleRule {
  switch (kind) {
    case "minutes": return { id, kind, every: 20 }
    case "hours": return { id, kind, every: 1, minute: 0 }
    case "days": return { id, kind, every: 1, hour: 9, minute: 0 }
    case "weeks": return { id, kind, every: 1, hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5] }
    case "months": return { id, kind, every: 1, hour: 9, minute: 0, dayOfMonth: 1 }
    case "cron": return { id, kind, cron: "0 9 * * *" }
  }
}

/**
 * The same rule said in another kind: the time of day, the weekdays and the
 * day of month carry over where the new kind reads them; `every` restarts at
 * the kind's default (twenty minutes is not twenty months).
 */
export function ruleWithKind(rule: ScheduleRule, kind: ScheduleRuleKind): ScheduleRule {
  if (rule.kind === kind) return rule
  const fresh = defaultRuleForKind(kind, rule.id)
  const carried: ScheduleRule = {
    ...fresh,
    ...(rule.hour !== undefined ? { hour: rule.hour } : {}),
    ...(rule.minute !== undefined ? { minute: rule.minute } : {}),
    ...(rule.weekdays && rule.weekdays.length > 0 ? { weekdays: rule.weekdays } : {}),
    ...(rule.dayOfMonth !== undefined ? { dayOfMonth: rule.dayOfMonth } : {}),
    ...(rule.cron ? { cron: rule.cron } : {}),
  }
  return normalizeScheduleRule(carried, rule.id) ?? fresh
}

// ---------------------------------------------------------------------------
// Presets — the panel's quick chips. Editor-only: not part of the wire contract.
// ---------------------------------------------------------------------------

export const SCHEDULE_PRESET_IDS = ["every-5-min", "hourly", "daily-9am", "weekdays-9am"] as const
export type SchedulePresetId = (typeof SCHEDULE_PRESET_IDS)[number]

export const SCHEDULE_PRESET_RULES: Readonly<Record<SchedulePresetId, Omit<ScheduleRule, "id">>> = {
  "every-5-min": { kind: "minutes", every: 5 },
  hourly: { kind: "hours", every: 1, minute: 0 },
  "daily-9am": { kind: "days", every: 1, hour: 9, minute: 0 },
  "weekdays-9am": { kind: "weeks", every: 1, hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5] },
}

/** The schedule a preset writes: one rule. */
export function presetRules(id: SchedulePresetId): ScheduleRule[] {
  return [{ id: "rule-1", ...SCHEDULE_PRESET_RULES[id] }]
}

/** Field by field, after normalisation — not by serialised key order, which is another package's business. */
function sameRuleShape(a: Omit<ScheduleRule, "id">, b: Omit<ScheduleRule, "id">): boolean {
  const norm = (r: Omit<ScheduleRule, "id">) => normalizeScheduleRule({ id: "x", ...r }, "x")
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  return (
    na.kind === nb.kind &&
    na.every === nb.every &&
    na.hour === nb.hour &&
    na.minute === nb.minute &&
    na.dayOfMonth === nb.dayOfMonth &&
    na.cron === nb.cron &&
    (na.weekdays ?? []).join(",") === (nb.weekdays ?? []).join(",")
  )
}

/** The preset the schedule currently IS (exactly one rule, equal to it), or null. */
export function presetMatching(rules: ReadonlyArray<ScheduleRule>): SchedulePresetId | null {
  if (rules.length !== 1) return null
  const { id: _id, ...shape } = rules[0]
  for (const preset of SCHEDULE_PRESET_IDS) {
    if (sameRuleShape(shape, SCHEDULE_PRESET_RULES[preset])) return preset
  }
  return null
}
