// @registry-lookup getExposableFields asks the fields of the one node type it is given (unitDefinitionOf, NODE_DEF_MAP)
import type { ExposableField } from "@nodaro/shared/types"
import { isNodeSetting } from "@nodaro/render-rules"
import { NODE_DEF_MAP } from "@/types/nodes"
import { tx, type MessageKey } from "@/lib/i18n"
import { unitDefinitionOf } from "@/lib/unit-definitions"
import type { UnitAppField } from "@/nodes/kit"
import {
  getQuickConfigs,
  isInQuickConfigRange,
  quickConfigRetainedOption,
  quickConfigOptionValue,
  readQuickConfigValue,
  resolveQuickConfigOptions,
  type NodeQuickConfigControl,
  type QuickConfigControl,
  type QuickConfigOption,
} from "@/components/nodes/node-quick-configs"

/**
 * The fields a publisher can expose on a published app's input form, per node type.
 *
 * A legacy node has two sources, one list:
 *  - the node's hand-declared `exposableFields` (NODE_DEFINITIONS) — sliders, toggles, text and the selects a
 *    node renders its own way;
 *  - one field per quick-strip control (`NODE_QUICK_CONFIGS`), unless the control opts out (`exposable: false`).
 *    The strip's levers are the ones a user reaches for on every run, and the strip already carries what an app
 *    card needs: a provider-aware option list, the coercion to the node's data type, the projection a choice
 *    writes and the snap for a stale value. A node that registers its strip is covered here by default.
 *
 * A hand-declared field wins a key collision (it keeps the card apps were published with).
 *
 * A node unit has one source: its manifest's `appFields` (unit.json, read through the units door
 * `unitDefinitionOf`; tools/units/README.md "A unit's app fields"). A unit has neither of the legacy sources —
 * its type is named nowhere central (G2) — and the server holds a run to the same declaration
 * (backend/src/lib/exposed-unit-field-check.ts).
 *
 * Every consumer — the publish picker, the presentation view and the app runner (through `findExposableField`)
 * — reads this, so the three cannot disagree about which fields a node has.
 */
export interface ResolvedExposableField extends ExposableField {
  /** The strip control a derived field comes from (as its node type's registry hands it out). Absent on a hand-declared field. */
  readonly quick?: NodeQuickConfigControl
  /** The manifest declaration a node unit's field comes from (unit.json `appFields`). Absent on a legacy node's field. */
  readonly unit?: UnitAppField
}

/**
 * The card each kind of unit app field renders as (unit.json `appFields[].kind`, tools/units/vocabulary.mjs
 * APP_FIELD_KINDS — units-vocabulary.test.ts holds the two lists equal): a select of its string values, and a
 * whole number as a slider over its min / max / step.
 */
export const UNIT_APP_FIELD_CARDS = { select: "select", integer: "slider" } as const satisfies Record<UnitAppField["kind"], ExposableField["type"]>

/**
 * A unit's app field as the cards read it. Its label (and a select option's) is the unit's own message key in
 * the interface language, read when asked, as a strip control's is; an option with no label key shows its value.
 * It starts at the node's default (the validator requires one, of the field's own values).
 */
function unitAppField(f: UnitAppField, defaultData: Readonly<Record<string, unknown>>): ResolvedExposableField {
  const base = {
    key: f.field,
    label: tx(f.labelKey as MessageKey),
    type: UNIT_APP_FIELD_CARDS[f.kind],
    ...(Object.hasOwn(defaultData, f.field) ? { defaultValue: defaultData[f.field] } : {}),
    unit: f,
  }
  if (f.kind === "select") {
    return { ...base, options: f.options.map((o) => ({ value: o.value, label: o.labelKey ? tx(o.labelKey as MessageKey) : o.value })) }
  }
  return { ...base, min: f.min, max: f.max, step: f.step }
}

/**
 * Whether a strip control becomes an app field of a `nodeType` node. Never one that opted out, nor one that
 * reads the graph (an app card has none; the guard also holds those to `exposable: false`). And only a control
 * whose field is one of the node's settings — the keys its data type declares, the ones a published app keeps
 * of the node (`isNodeSetting`, generated from nodes.ts): a strip lever writing anything else moves nothing the
 * node reads, and an app card for it would render and change nothing.
 */
function isDerivable(nodeType: string, control: QuickConfigControl): boolean {
  return control.exposable !== false && !control.needsGraph && isNodeSetting(control.field, nodeType)
}

/**
 * The control's option list when it does not depend on the node's data, else undefined. A static list
 * qualifies, and so does a function that reads no node field — one that only GREYS options from account
 * state (the free-credit video locks), whose values are the same for every node. A list that reads a field
 * (resolution per model) does not.
 */
export function dataIndependentOptions(control: QuickConfigControl): readonly QuickConfigOption[] | undefined {
  if (typeof control.options !== "function") return control.options
  let readsData = false
  const probe = new Proxy({} as Record<string, unknown>, {
    get() { readsData = true; return undefined },
    has() { readsData = true; return false },
  })
  const opts = control.options(probe)
  return readsData ? undefined : opts
}

/**
 * A derived field's `options`, or undefined. Only a STATIC list whose every option stands for a value of the
 * field itself is offered: those are what the publisher can restrict and the server can hold a run to. A
 * provider-aware list differs per model, so restricting it could leave a model with nothing to choose; an
 * option that leaves the field unset ("Source", "Auto") has no value to keep in an allowed list.
 */
function restrictableOptions(control: QuickConfigControl): ExposableField["options"] {
  if (control.read) return undefined
  const opts = dataIndependentOptions(control)
  if (!opts || opts.length === 0) return undefined
  for (const o of opts) {
    const v = quickConfigOptionValue(control, o.value)
    if (v === undefined || String(v) !== o.value) return undefined
  }
  return opts.map((o) => ({ value: o.value, label: o.label }))
}

function deriveField(control: NodeQuickConfigControl, defaultData: Record<string, unknown>): ResolvedExposableField {
  const ownDefault = Object.hasOwn(defaultData, control.field)
    ? defaultData[control.field]
    : control.defaultValue !== undefined
      ? quickConfigOptionValue(control, control.defaultValue)
      : undefined
  const options = restrictableOptions(control)
  return {
    key: control.field,
    label: control.ariaLabel,
    type: "select",
    ...(options ? { options } : {}),
    ...(ownDefault !== undefined ? { defaultValue: ownDefault } : {}),
    quick: control,
  }
}

/** A node type's app fields: a unit's declared `appFields`; a legacy node's hand-declared fields, then the strip's derivable controls. */
export function getExposableFields(nodeType: string | undefined): ReadonlyArray<ResolvedExposableField> {
  if (!nodeType) return []
  const unit = unitDefinitionOf(nodeType)
  if (unit) return (unit.appFields ?? []).map((f) => unitAppField(f, unit.defaultData))
  const def = NODE_DEF_MAP.get(nodeType as never)
  const declared: ReadonlyArray<ResolvedExposableField> = def?.exposableFields ?? []
  const taken = new Set(declared.map((f) => f.key))
  const defaultData = (def?.defaultData ?? {}) as Record<string, unknown>
  const derived: ResolvedExposableField[] = []
  for (const control of getQuickConfigs(nodeType)) {
    if (!isDerivable(nodeType, control) || taken.has(control.field)) continue
    taken.add(control.field)
    derived.push(deriveField(control, defaultData))
  }
  return derived.length === 0 ? declared : [...declared, ...derived]
}

/**
 * The value a restriction (`allowedValues`) stores for option `optionValue`: the node-data value it stands for
 * on a derived field (720, not "720"), so the server's check and the card compare like with like; the option
 * string itself on a hand-declared field.
 */
export function exposedOptionValue(field: ResolvedExposableField, optionValue: string): string | number | boolean {
  if (!field.quick) return optionValue
  const v = quickConfigOptionValue(field.quick, optionValue)
  return typeof v === "number" || typeof v === "boolean" || typeof v === "string" ? v : optionValue
}

/**
 * What a strip-derived field's current value READS as, for the node's data (a run's values on top): the label of
 * the option it stands for (Draft "Draft", not `true`), an in-range custom number with its unit, else undefined
 * (a hand-declared field, or a value no option names). English; localize with `useLocalizeOptionLabel`.
 */
export function quickFieldValueLabel(field: ResolvedExposableField, nodeData: Record<string, unknown>): string | undefined {
  const control = field.quick
  if (!control) return undefined
  const stored = readQuickConfigValue(control, nodeData)
  const value = stored !== "" ? stored : (control.defaultValue ?? "")
  if (value === "") return undefined
  const option = resolveQuickConfigOptions(control, nodeData).find((o) => o.value === value) ?? quickConfigRetainedOption(control, value)
  if (option) return option.label
  return isInQuickConfigRange(control, value) ? `${value}${control.customRange?.unit ?? ""}` : undefined
}
