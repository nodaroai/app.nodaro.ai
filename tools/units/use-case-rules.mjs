// tools/units/use-case-rules.mjs — the manifest rules of execution.kind "use-case"
// and of the contract keys @nodaro/shared composes (decided 2026-10-18). Called
// by manifest.mjs (validateUnit, checkFiles, checkSeams, validateUnits);
// built-ins only.
import { CONTRACT_KEYS, JSON_PIP_KINDS, PICKER_TABS, PRESENTS, USE_CASE_INPUT_HANDLES } from "./vocabulary.mjs"

const MEDIA = ["audio", "video", "image"]
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
/** Where a use-case node's graph builders live: USE_CASE_SPECS, read as text (repoContext). */
export const USE_CASE_SPECS_FILE = "packages/render-rules/src/use-case-specs.ts"

/** The lanes routeUseCaseInput lands a use-case input in, one per USE_CASE_INPUT_HANDLES entry (`media` → useCaseMedia). */
const USE_CASE_LANES = USE_CASE_INPUT_HANDLES.map((h) => `useCase${h[0].toUpperCase()}${h.slice(1)}`).join(" / ")

/** The builder keys of packages/render-rules/src/use-case-specs.ts, read as text: `  <key>: defineUseCase` lines of USE_CASE_SPECS. */
export function useCaseBuildersFrom(source) {
  const start = source.indexOf("export const USE_CASE_SPECS")
  if (start < 0) return new Set()
  return new Set([...source.slice(start).matchAll(/^ {2}([a-z][A-Za-z0-9]*): defineUseCase\b/gm)].map((m) => m[1]))
}

/** Problems with a unit's use-case shape and its shared-contract keys. */
export function useCaseProblems(unit, m, ctx) {
  const out = []
  const kind = m.execution?.kind
  const inputs = Array.isArray(m.handles?.inputs) ? m.handles.inputs : []
  const outputs = Array.isArray(m.handles?.outputs) ? m.handles.outputs : []
  const c = isObj(m.contract) ? m.contract : {}
  if (kind === "use-case") {
    const b = m.execution.builder
    if (typeof b !== "string" || !b) out.push(`execution.builder is required for a use-case node (its graph builder's key in ${USE_CASE_SPECS_FILE})`)
    else if (ctx.useCaseBuilders && !ctx.useCaseBuilders.has(b)) out.push(`execution.builder "${b}" is not a use-case spec in ${USE_CASE_SPECS_FILE} — write its builder first`)
    for (const [i, h] of inputs.entries()) {
      if (!USE_CASE_INPUT_HANDLES.includes(h?.id)) out.push(`handles.inputs[${i}].id "${h?.id}": a use-case input is one of ${USE_CASE_INPUT_HANDLES.join(", ")} (routeUseCaseInput routes only these)`)
      if (h?.field !== undefined) out.push(`handles.inputs[${i}].field: a use-case input lands in ${USE_CASE_LANES}, never a data field — remove it`)
      if (Array.isArray(h?.accepts) && h.accepts.includes("look")) out.push(`handles.inputs[${i}].accepts: a use-case input takes media, never JSON (routeUseCaseInput routes it into ${USE_CASE_LANES})`)
      if (h?.many !== undefined) out.push(`handles.inputs[${i}].many: a use-case input already takes every wire (routeUseCaseInput) — remove it`)
    }
    for (const [i, h] of outputs.entries()) if (h?.from !== undefined) out.push(`handles.outputs[${i}].from: a use-case node's outputs are read by the use-case reader (use-case-io.ts / use-case-output.ts) — remove it`)
    for (const cap of Array.isArray(m.capabilities) ? m.capabilities : []) {
      if (String(cap).startsWith("length:")) out.push(`capability "${cap}" describes a worker; a use-case node's output length is its spec's outputLength (${USE_CASE_SPECS_FILE})`)
      else if (cap === "ffmpeg-media" || cap === "finalize:own-writer") out.push(`capability "${cap}" describes a worker; a use-case node runs none`)
    }
  } else {
    if (m.execution?.builder !== undefined) out.push("execution.builder is only for execution.kind \"use-case\"")
    if (c.reviewHold !== undefined) out.push("contract.reviewHold is only for execution.kind \"use-case\"")
  }
  for (const [i, h] of outputs.entries()) {
    if (h?.runtimeTyped === undefined) continue
    if (h.runtimeTyped !== true || !MEDIA.includes(h.kind)) out.push(`handles.outputs[${i}].runtimeTyped: only true, and only on an audio/video/image output`)
    else if (c.producer !== "dynamic") out.push(`handles.outputs[${i}].runtimeTyped needs contract.producer "dynamic" (its medium is decided at run time)`)
  }
  const looks = outputs.filter((h) => h?.kind === "look").map((h) => h.id)
  const pips = isObj(c.jsonPips) ? c.jsonPips : c.jsonPips === undefined ? {} : null
  if (pips === null) out.push("contract.jsonPips must be { <look output id>: \"transcript\" | \"edl\" | \"other\" }")
  else {
    for (const id of looks) if (!Object.hasOwn(pips, id)) out.push(`outputs "${id}" is JSON (kind "look") but contract.jsonPips does not say what it carries (${JSON_PIP_KINDS.join(", ")})`)
    for (const [id, v] of Object.entries(pips)) {
      if (!looks.includes(id)) out.push(`contract.jsonPips.${id}: not a "look" output`)
      if (!JSON_PIP_KINDS.includes(v)) out.push(`contract.jsonPips.${id}: "${v}" is not ${JSON_PIP_KINDS.join(" | ")}`)
    }
  }
  if (c.nonPromptInputs !== undefined && !(Array.isArray(c.nonPromptInputs) && c.nonPromptInputs.every((h) => inputs.some((x) => x?.id === h)))) out.push("contract.nonPromptInputs must list input handle ids")
  else if (Array.isArray(c.nonPromptInputs)) {
    const twice = [...new Set(c.nonPromptInputs.filter((h, i) => c.nonPromptInputs.indexOf(h) !== i))]
    if (twice.length > 0) out.push(`contract.nonPromptInputs lists ${twice.map((h) => `"${h}"`).join(", ")} more than once — name each input once`)
  }
  if (c.reviewHold !== undefined && c.reviewHold !== true) out.push("contract.reviewHold is true or absent")
  if (c.presents !== undefined && !PRESENTS.includes(c.presents)) out.push(`contract.presents: "${c.presents}" is not ${PRESENTS.join(" | ")}`)
  if (c.fanOutEach !== undefined) out.push(...fanOutEachProblems(c.fanOutEach, outputs))
  const tabs = m.picker?.alsoOnTabs
  if (tabs !== undefined && !(Array.isArray(tabs) && tabs.every((t) => PICKER_TABS.includes(t)))) out.push(`picker.alsoOnTabs: each a picker tab (${PICKER_TABS.join(", ")})`)
  return out
}

/**
 * `contract.fanOutEach` — the row of FAN_OUT_EACH_HANDLES (@nodaro/shared
 * producer-types.ts): the output pips an "each" edge reads one item at a time
 * when the node ran once per item, and the pip an edge naming none reads.
 */
function fanOutEachProblems(f, outputs) {
  if (!isObj(f)) return ["contract.fanOutEach must be { each: <output ids>, primary: <output id> }"]
  const out = []
  const ids = outputs.map((h) => h?.id)
  for (const k of Object.keys(f)) if (k !== "each" && k !== "primary") out.push(`contract.fanOutEach.${k}: fanOutEach is { each, primary } — nothing else`)
  if (!Array.isArray(f.each) || f.each.length === 0 || !f.each.every((h) => typeof h === "string")) out.push("contract.fanOutEach.each: one or more output ids (the pips an \"each\" edge reads item by item)")
  else {
    for (const h of f.each) {
      const pip = outputs.find((o) => o?.id === h)
      if (!pip) out.push(`contract.fanOutEach.each: "${h}" is not an output id`)
      else if (pip.kind === "look") out.push(`contract.fanOutEach.each: "${h}" — a JSON (kind "look") output never fans out`)
    }
    const twice = [...new Set(f.each.filter((h, i) => f.each.indexOf(h) !== i))]
    if (twice.length > 0) out.push(`contract.fanOutEach.each lists ${twice.map((h) => `"${h}"`).join(", ")} more than once`)
  }
  if (typeof f.primary !== "string" || !ids.includes(f.primary)) out.push(`contract.fanOutEach.primary: "${f.primary}" is not an output id`)
  return out
}

/**
 * The unit-file rules of the kind: a use-case node runs no editor executor
 * and no job (its route factory builds the hidden chain), and its price.ee.ts
 * names the fee row a run reserves. `has(tree, file)`; `ctx.readText` reads
 * a repo file (absent in contexts that do not read files).
 */
export function useCaseFileProblems(unit, kind, has, ctx) {
  const out = []
  if (kind !== "use-case") {
    if (has("backend", "use-case.ts")) out.push(`use-case.ts is only for execution.kind "use-case"`)
    return out
  }
  const why = {
    "exec.ts": "the editor runs it through executeUseCase",
    "api.ts": "the editor runs it through executeUseCase",
    "payload.ts": "its route factory builds a hidden inline chain, never a job",
    "worker.ts": "its route factory builds a hidden inline chain, never a job",
  }
  for (const [f, reason] of Object.entries(why)) {
    const tree = f === "exec.ts" || f === "api.ts" ? "frontend" : "backend"
    if (has(tree, f)) out.push(`${unit.dirs[tree]}/${f}: execution.kind "use-case" has none — ${reason}`)
  }
  if (has("backend", "price.ee.ts") && ctx.readText) {
    const src = ctx.readText(`${unit.dirs.backend}/price.ee.ts`) ?? ""
    if (!/\bcreditId\b/.test(src)) out.push("a use-case unit reserves its fee row: price.ee.ts exports creditId")
  }
  return out
}

/** The seams a unit's use-case kind and shared-contract keys need: [seam id, what needs it]. */
export function useCaseSeamNeeds(m) {
  const out = []
  if (m.execution?.kind === "use-case") out.push(["use-case-rows", "execution.kind \"use-case\" (its builder row)"], ["contracts", "execution.kind \"use-case\" (UNIT_USE_CASE_TYPES)"])
  const c = isObj(m.contract) ? m.contract : {}
  for (const k of CONTRACT_KEYS) if (k !== "producer" && c[k] !== undefined) out.push(["contracts", `contract.${k}`])
  return out
}

/** A graph builder named by two units: the builder knows one type. */
export function duplicateBuilderProblems(units) {
  const byBuilder = new Map()
  for (const u of units) {
    const b = u.manifest?.execution?.kind === "use-case" ? u.manifest.execution.builder : undefined
    if (typeof b !== "string" || !b) continue
    byBuilder.set(b, [...(byBuilder.get(b) ?? []), u.type])
  }
  return [...byBuilder].filter(([, types]) => types.length > 1).map(([b, types]) => `${types.join(", ")}: execution.builder "${b}" is named by more than one unit — one use-case spec builds one node type`)
}
