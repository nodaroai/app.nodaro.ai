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

/**
 * The lists of node fields an app field may never name, read as text where they are defined (the validator
 * runs on built-ins only): what the run override merge deletes (@nodaro/shared) and what the server itself
 * writes into a run's overrides (@nodaro/render-rules). Each list's entries say why.
 */
export const RESERVED_FIELD_LISTS = [
  { file: "packages/shared/src/preview-gate.ts", name: "RUN_OVERRIDE_CLEARED_FIELDS", why: "a run's override clears it (RUN_OVERRIDE_CLEARED_FIELDS) — a cached result, not a setting" },
  { file: "packages/shared/src/preview-gate.ts", name: "RUN_ONLY_NODE_FIELDS", why: "a field one run's own override sets and saved data drops (RUN_ONLY_NODE_FIELDS)" },
  { file: "packages/render-rules/src/render-final-set.ts", name: "SERVER_RUN_OVERRIDE_FIELDS", why: "the server writes it into a run's overrides itself (SERVER_RUN_OVERRIDE_FIELDS) — a caller never sets it" },
]
/** The files those lists live in. */
export const RESERVED_FIELD_FILES = [...new Set(RESERVED_FIELD_LISTS.map((l) => l.file))]

/** Node fields that are never a setting an app may set: the node's own label, and its field-mapping wires. */
const NOT_A_SETTING = {
  label: "the node's label — not a setting its run reads",
  fieldMappings: "the node's field-mapping wires — not a setting a run may set",
}

/**
 * The string literals of `export const <name> = [ … ]` (optionally typed, optionally `as const`) in `source`.
 * Strict: it throws — naming the list and the file — on a list it cannot find, and on any element it cannot
 * read as a plain string literal (`"x"` or `'x'`): a spread, a reference, a template, a nested value. A list
 * the validator cannot read whole must fail the build, never shrink in silence.
 */
export function readConstList(source, name, file) {
  const head = new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*\\[`).exec(source)
  if (!head) throw new Error(`tools/units/app-field-rules.mjs: ${file} declares no "export const ${name} = [...]" — update RESERVED_FIELD_LISTS`)
  // The body up to the matching "]", comments dropped, strings kept whole.
  let body = ""
  let quote = null
  let i = head.index + head[0].length
  for (; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      body += c
      if (c === "\\") { body += source[++i] ?? ""; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === "/" && source[i + 1] === "/") { i = source.indexOf("\n", i); if (i < 0) { i = source.length; break } body += "\n"; continue }
    if (c === "/" && source[i + 1] === "*") { const close = source.indexOf("*/", i + 2); if (close < 0) { i = source.length; break } i = close + 1; continue }
    if (c === "]") break
    if (c === '"' || c === "'" || c === "`") quote = c
    body += c
  }
  if (i >= source.length) throw new Error(`tools/units/app-field-rules.mjs: ${name} in ${file} has no closing "]" the reader can find`)
  const values = []
  for (const raw of body.split(",")) {
    const el = raw.trim()
    if (el === "") continue
    const m = /^(["'])([^"'\\\n]*)\1$/.exec(el)
    if (!m) throw new Error(`tools/units/app-field-rules.mjs: cannot read "${el}" in ${name} (${file}) — the list must hold plain string literals (a spread, a reference or a template is not read)`)
    values.push(m[2])
  }
  return values
}

/**
 * The field names an app field may not take, each with why: the node's label and field mappings, and every
 * entry of `RESERVED_FIELD_LISTS`, read through `readText(file)` (repo path → its text, or null when absent).
 * A list file that is absent throws: the repo always has them, and a validator that read nothing would let a
 * reserved name through. frontend/src/__tests__/units-app-field-reserved.test.ts holds the read to the
 * runtime constants. A context with no reserved map (a fixture tree's) still refuses the label and the field
 * mappings (`appFieldProblems`'s default).
 */
export function reservedAppFieldsFrom(readText) {
  const out = new Map(Object.entries(NOT_A_SETTING))
  for (const { file, name, why } of RESERVED_FIELD_LISTS) {
    const source = readText(file)
    if (source === null || source === undefined) throw new Error(`tools/units/app-field-rules.mjs: ${file} is missing — it holds ${name}, which an app field may not name`)
    for (const field of readConstList(source, name, file)) if (!out.has(field)) out.set(field, why)
  }
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
