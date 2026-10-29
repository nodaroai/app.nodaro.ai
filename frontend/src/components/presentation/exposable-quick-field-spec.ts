import {
  allQuickConfigOptions,
  getQuickConfigs,
  quickConfigOptionValue,
  resolveQuickConfigOptions,
  type QuickConfigControl,
} from "@/components/nodes/node-quick-configs"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { dataIndependentOptions, getExposableFields } from "./exposable-fields"

/**
 * What the SERVER needs to know about an app field derived from a quick-strip control, computed from the same
 * controls the app card renders. The backend cannot import the frontend's strip registry, so this is rendered
 * into a generated table (`backend/src/lib/mcp/generated/exposable-quick-fields.ts`, held to this by
 * `__tests__/exposable-quick-fields-table.test.ts`) that `get_app_inputs` types the field by and the app run
 * route validates a submitted value against.
 */
export type ExposableQuickValue = string | number | boolean

export interface ExposableQuickFieldSpec {
  /** The node-data type of the field's value. */
  readonly valueType: "string" | "number" | "boolean"
  /** Every value the field can take, across every model the node offers (sorted). */
  readonly values: ReadonlyArray<ExposableQuickValue>
  /**
   * True when the list is the same whatever else the node is set to (a static strip list). Only then does the
   * server hold a run to it: a provider-aware list is unioned across models here, and what one model takes is
   * the route's and the payload normalizer's to decide.
   */
  readonly fixed: boolean
  /**
   * Values the field still TAKES but no longer offers (the strip's `retainedOptions` — a retired model a saved
   * node or caller still names): a run naming one is accepted, and nothing advertises it. Absent when none.
   */
  readonly retained?: ReadonlyArray<ExposableQuickValue>
  /** A numeric field that also takes any value in this range (the strip's "Custom…"). */
  readonly min?: number
  readonly max?: number
}

/** Upper bound on the data combinations explored per node, so a strip that grows a large lever cross-product fails loudly here. */
const MAX_CANDIDATES = 20_000
const MAX_ROUNDS = 8

const UNSET = "\u0000unset"
const keyOf = (v: unknown): string => (v === undefined ? UNSET : JSON.stringify(v))
const valueOfKey = (k: string): unknown => (k === UNSET ? undefined : JSON.parse(k))

function compareValues(a: ExposableQuickValue, b: ExposableQuickValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

/** Options of `control` for `data`, recording which data keys the option function read. */
function optionsReading(control: QuickConfigControl, data: Record<string, unknown>, reads: Set<string>) {
  const proxy = new Proxy(data, {
    get(target, prop) {
      if (typeof prop === "string") reads.add(prop)
      return Reflect.get(target, prop)
    },
    has(target, prop) {
      if (typeof prop === "string") reads.add(prop)
      return Reflect.has(target, prop)
    },
  })
  // The DECLARED options: the generated table must not depend on what this
  // deployment happens to offer at generation time.
  return allQuickConfigOptions(control, proxy)
}

/**
 * Every value each control of a node type can write, found by evaluating provider-aware option lists over every
 * combination of the values the fields they read can hold (a fixed point: a list can read a field another
 * provider-aware list writes, as AI Avatar's resolution reads its engine).
 */
function valuesByField(type: string): Map<string, Set<string>> {
  const all = getQuickConfigs(type)
  const values = new Map<string, Set<string>>()
  const add = (field: string, v: unknown) => {
    if (v === undefined) return
    let set = values.get(field)
    if (!set) values.set(field, (set = new Set()))
    set.add(keyOf(v))
  }
  const addOptions = (c: QuickConfigControl, opts: ReturnType<typeof resolveQuickConfigOptions>) => {
    for (const o of opts) if (!o.disabled) add(c.field, quickConfigOptionValue(c, o.value))
  }
  const dynamic = all.filter((c) => typeof c.options === "function")
  for (const c of all) if (typeof c.options !== "function") addOptions(c, c.options)

  const drivers = new Set<string>()
  for (const c of dynamic) optionsReading(c, {}, drivers)

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const before = JSON.stringify([[...drivers].sort(), [...values].map(([k, s]) => [k, s.size])])
    const keys = [...drivers].sort()
    let candidates: Record<string, unknown>[] = [{}]
    for (const k of keys) {
      const choices = [UNSET, ...(values.get(k) ?? [])]
      const next: Record<string, unknown>[] = []
      for (const c of candidates) for (const choice of choices) next.push(choice === UNSET ? c : { ...c, [k]: valueOfKey(choice) })
      candidates = next
      if (candidates.length > MAX_CANDIDATES) {
        throw new Error(`${type}: more than ${MAX_CANDIDATES} lever combinations to explore — bound the strip's option functions`)
      }
    }
    for (const c of dynamic) for (const data of candidates) addOptions(c, optionsReading(c, data, drivers))
    const after = JSON.stringify([[...drivers].sort(), [...values].map(([k, s]) => [k, s.size])])
    if (after === before) return values
  }
  throw new Error(`${type}: the strip's option lists did not settle in ${MAX_ROUNDS} rounds`)
}

function specOf(control: QuickConfigControl, raw: Set<string> | undefined): ExposableQuickFieldSpec | undefined {
  const list = [...(raw ?? [])].map(valueOfKey) as ExposableQuickValue[]
  const range = control.customRange
  if (list.length === 0 && !range) return undefined
  const valueType: ExposableQuickFieldSpec["valueType"] =
    range || (list.length > 0 && list.every((v) => typeof v === "number"))
      ? "number"
      : list.every((v) => typeof v === "boolean")
        ? "boolean"
        : "string"
  const offered = new Set(list.map(keyOf))
  const retained = (control.retainedOptions ?? [])
    .map((o) => quickConfigOptionValue(control, o.value) as ExposableQuickValue)
    .filter((v) => v !== undefined && !offered.has(keyOf(v)))
  return {
    valueType,
    values: [...list].sort(compareValues),
    fixed: dataIndependentOptions(control) !== undefined,
    ...(retained.length > 0 ? { retained: [...retained].sort(compareValues) } : {}),
    ...(range ? { min: range.min, max: range.max } : {}),
  }
}

/** Node type → derived field key → its spec, for every node type with a strip-derived app field. */
export function exposableQuickFieldSpecs(): Record<string, Record<string, ExposableQuickFieldSpec>> {
  const out: Record<string, Record<string, ExposableQuickFieldSpec>> = {}
  for (const type of NODE_DEFINITIONS.map((d) => d.type as string).sort()) {
    const derived = getExposableFields(type).filter((f) => f.quick)
    if (derived.length === 0) continue
    const values = valuesByField(type)
    const specs: Record<string, ExposableQuickFieldSpec> = {}
    for (const f of [...derived].sort((a, b) => (a.key < b.key ? -1 : 1))) {
      const spec = specOf(f.quick!, values.get(f.key))
      if (spec) specs[f.key] = spec
    }
    if (Object.keys(specs).length > 0) out[type] = specs
  }
  return out
}

/** The generated backend module's source. Deterministic: sorted keys and values, no labels (they are localized). */
export function renderExposableQuickFieldsModule(specs: Record<string, Record<string, ExposableQuickFieldSpec>>): string {
  const lines: string[] = [
    "// GENERATED from the frontend's quick-strip controls (NODE_QUICK_CONFIGS, through",
    "// frontend/src/components/presentation/exposable-quick-field-spec.ts) — do NOT hand-edit.",
    "// Held to them by frontend/src/components/presentation/__tests__/exposable-quick-fields-table.test.ts; regenerate with",
    "//   cd frontend && npx vitest run src/components/presentation/__tests__/exposable-quick-fields-table.test.ts -u",
    "// Values only (the node-data values a field takes), no labels and no prices.",
    "",
    "export interface ExposableQuickFieldSpec {",
    "  /** The node-data type of the field's value. */",
    '  readonly valueType: "string" | "number" | "boolean"',
    "  /** Every value the field can take, across every model the node offers. */",
    "  readonly values: ReadonlyArray<string | number | boolean>",
    "  /** The same list whatever else the node is set to: a run is held to it. A provider-aware list is not. */",
    "  readonly fixed: boolean",
    "  /** Values the field still takes but no longer offers (a retired model): a run naming one is accepted, nothing advertises it. */",
    "  readonly retained?: ReadonlyArray<string | number | boolean>",
    "  /** A numeric field that also takes any value in this range. */",
    "  readonly min?: number",
    "  readonly max?: number",
    "}",
    "",
    "/** Node type → app field derived from a quick-strip control → what it takes. */",
    "export const EXPOSABLE_QUICK_FIELDS: Readonly<Record<string, Readonly<Record<string, ExposableQuickFieldSpec>>>> = {",
  ]
  for (const [type, fields] of Object.entries(specs)) {
    lines.push(`  ${JSON.stringify(type)}: {`)
    for (const [key, s] of Object.entries(fields)) {
      const range = s.min !== undefined ? `, min: ${s.min}, max: ${s.max}` : ""
      const retained = s.retained ? `, retained: ${JSON.stringify(s.retained)}` : ""
      lines.push(`    ${JSON.stringify(key)}: { valueType: ${JSON.stringify(s.valueType)}, fixed: ${s.fixed}${range}, values: ${JSON.stringify(s.values)}${retained} },`)
    }
    lines.push("  },")
  }
  lines.push("}", "")
  return lines.join("\n")
}
