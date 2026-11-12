// tools/units/app-field-rules.mjs
// The rules of a manifest's `appFields` (tools/units/README.md, "A unit's app
// fields"): the node's settings a published app may let its user set, each with
// the card it renders as and every value it takes. manifest.mjs calls it.
// Built-ins only, like the rest of the validator.
//
// A field is one of the node's own settings: it starts at its default
// (`defaultData`), it is never a wire's landing field or a result, and every
// value it lists is one the default could be. Its label (and a select option's)
// is a key of the unit's own strings.json, so it reads in every interface
// language. Whether each value is one the unit's data type takes is held at
// typecheck (the definitions aggregate, `UnitAppFieldsFit` of
// frontend/src/nodes/kit.ts), so types.ts is required beside it.
import { APP_FIELD_KINDS } from "./vocabulary.mjs"

/** Where the run override merge's own field lists live (@nodaro/shared). */
export const OVERRIDE_FIELD_LISTS_FILE = "packages/shared/src/preview-gate.ts"

/** Node fields that are never a setting an app may set: the node's own label, and its field-mapping wires. */
const NOT_A_SETTING = {
  label: "the node's label — not a setting its run reads",
  fieldMappings: "the node's field-mapping wires — not a setting a run may set",
}

/**
 * The field names an app field may not take, each with why: the node's label and field mappings, and the
 * fields the override merge deletes — `RUN_OVERRIDE_CLEARED_FIELDS` (a run's override clears these cached
 * results) and `RUN_ONLY_NODE_FIELDS` (set by one run's own override, dropped from saved data), read from
 * their source in @nodaro/shared as text, as the validator reads every product list (built-ins only).
 * frontend/src/__tests__/units-app-field-reserved.test.ts holds the repo's read to the runtime constants, and
 * a source that no longer declares either list throws, so the rule cannot go quietly empty.
 */
export function reservedAppFieldsFrom(source) {
  const out = new Map(Object.entries(NOT_A_SETTING))
  // A tree without @nodaro/shared's source (a fixture tree): the fixed names alone. The repo always has it,
  // and units-app-field-reserved.test.ts fails if the repo's read loses either list.
  if (!source) return out
  const read = (name, why) => {
    const m = source.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`))
    if (!m) throw new Error(`tools/units/app-field-rules.mjs: ${OVERRIDE_FIELD_LISTS_FILE} declares no "export const ${name} = [...] as const" — update reservedAppFieldsFrom`)
    for (const f of m[1].matchAll(/"([^"]+)"/g)) if (!out.has(f[1])) out.set(f[1], why)
  }
  read("RUN_OVERRIDE_CLEARED_FIELDS", "a run's override clears it (RUN_OVERRIDE_CLEARED_FIELDS) — a cached result, not a setting")
  read("RUN_ONLY_NODE_FIELDS", "a field one run's own override sets and saved data drops (RUN_ONLY_NODE_FIELDS)")
  return out
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0
const KEYS = {
  select: ["field", "kind", "labelKey", "options"],
  integer: ["field", "kind", "labelKey", "min", "max", "step"],
}

/**
 * Every problem with a unit's `appFields` (none when it declares none). `reserved` (field → why) is
 * `reservedAppFieldsFrom` over the repo's source (repoContext); a context without it (a fixture tree with no
 * @nodaro/shared source) still refuses the label and the field mappings.
 */
export function appFieldProblems(unit, m, reserved = new Map(Object.entries(NOT_A_SETTING))) {
  if (m.appFields === undefined) return []
  const errors = []
  const fields = m.appFields
  if (!Array.isArray(fields) || fields.length === 0) {
    return ["appFields must list the settings a published app may expose (omit it when there are none)"]
  }
  if (unit.typesSource === null) {
    errors.push(`appFields needs ${unit.dirs.frontend}/types.ts: each field's values are held to its data type there (UnitAppFieldsFit, at typecheck)`)
  }
  const data = isObject(m.defaultData) ? m.defaultData : {}
  const keys = new Set(Object.keys(isObject(unit.strings?.keys) ? unit.strings.keys : {}))
  const inputFields = new Set((Array.isArray(m.handles?.inputs) ? m.handles.inputs : []).map((h) => h?.field).filter(isNonEmptyString))
  const outputFields = new Set((Array.isArray(m.handles?.outputs) ? m.handles.outputs : []).map((h) => h?.from).filter(isNonEmptyString))
  const seen = new Set()
  const label = (key, at) => {
    if (!isNonEmptyString(key)) errors.push(`${at} must be a message key of the unit's strings.json keys`)
    else if (!keys.has(key)) errors.push(`${at}: "${key}" is not a key of the unit's strings.json keys (a label reads in every interface language — add it there, in all five dicts)`)
  }
  fields.forEach((f, i) => {
    const at = `appFields[${i}]`
    if (!isObject(f)) return errors.push(`${at} must be an object`)
    if (!APP_FIELD_KINDS.includes(f.kind)) return errors.push(`${at}.kind: "${f.kind}" is not an app-field kind (${APP_FIELD_KINDS.join(", ")})`)
    for (const k of Object.keys(f)) if (!KEYS[f.kind].includes(k)) errors.push(`${at}.${k}: unknown for kind "${f.kind}" (${KEYS[f.kind].join(", ")})`)
    label(f.labelKey, `${at}.labelKey`)
    if (!isNonEmptyString(f.field)) return errors.push(`${at}.field must name the node-data field the setting writes`)
    const where = `${at} ("${f.field}")`
    if (reserved.has(f.field)) errors.push(`${where}: "${f.field}" cannot be an app field: ${reserved.get(f.field)}`)
    if (seen.has(f.field)) errors.push(`${where}: the field is exposed twice — one app field per setting`)
    seen.add(f.field)
    if (inputFields.has(f.field)) errors.push(`${where}: "${f.field}" is an input's field — a wire lands there; an app field is a setting`)
    if (outputFields.has(f.field)) errors.push(`${where}: "${f.field}" is an output's field — a run writes it; an app field is a setting`)
    const hasDefault = Object.hasOwn(data, f.field)
    if (!hasDefault) errors.push(`${where}: defaultData has no "${f.field}" — an app field starts at the node's default`)
    const d = data[f.field]
    if (f.kind === "select") {
      if (!Array.isArray(f.options) || f.options.length === 0) return errors.push(`${where}.options must list the values a run may take ({ value, labelKey? })`)
      const values = []
      f.options.forEach((o, j) => {
        const oat = `${where}.options[${j}]`
        if (!isObject(o)) return errors.push(`${oat} must be { value, labelKey? }`)
        for (const k of Object.keys(o)) if (k !== "value" && k !== "labelKey") errors.push(`${oat}.${k}: unknown (value, labelKey)`)
        if (!isNonEmptyString(o.value)) return errors.push(`${oat}.value must be a non-empty string (a select card writes the option's string)`)
        if (values.includes(o.value)) errors.push(`${oat}: "${o.value}" is listed twice`)
        values.push(o.value)
        if (o.labelKey !== undefined) label(o.labelKey, `${oat}.labelKey`)
      })
      if (hasDefault && !values.includes(d)) errors.push(`${where}: its default ${JSON.stringify(d)} (defaultData) is not one of its options (${values.join(", ")})`)
    } else {
      const ints = ["min", "max", "step"].filter((k) => !Number.isSafeInteger(f[k]))
      if (ints.length) return errors.push(`${where}: ${ints.join(", ")} must be ${ints.length > 1 ? "whole numbers" : "a whole number"}`)
      if (f.step < 1) errors.push(`${where}.step must be at least 1`)
      else if (f.min >= f.max) errors.push(`${where}: min ${f.min} must be below max ${f.max}`)
      else if ((f.max - f.min) % f.step !== 0) errors.push(`${where}: max ${f.max} is not reached from min ${f.min} in steps of ${f.step}`)
      else if (hasDefault && !(Number.isSafeInteger(d) && d >= f.min && d <= f.max && (d - f.min) % f.step === 0)) {
        errors.push(`${where}: its default ${JSON.stringify(d)} (defaultData) is not a whole number from ${f.min} to ${f.max}${f.step > 1 ? ` in steps of ${f.step}` : ""}`)
      }
    }
  })
  return errors
}
