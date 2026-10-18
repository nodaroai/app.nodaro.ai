// tools/units/manifest.mjs
// The ONE loader and validator of node units — gen:units (tools/units/gen.mjs)
// and gen:skills (backend/scripts/lib/gen-skills/parse-node-definitions.ts)
// both read units through it, so they can never disagree about what a unit
// is. Built-ins only: the tools self-test job runs it without npm install.
// @reads frontend/src/nodes/** backend/src/nodes/** tools/units/legacy-nodes.json tools/units/reserved-credit-ids.json frontend/src/lib/node-families.ts docs/nodes/README.md frontend/src/lib/node-options.tsx frontend/src/lib/*macro*.ts backend/src/ee/billing/credits.ts
//
// A unit is one node type, named by its type id. Its manifest,
// frontend/src/nodes/<type>/unit.json, is the source of truth; the backend
// folder backend/src/nodes/<type>/ holds what the server runs. See
// tools/units/README.md.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { CAPABILITIES } from "./capabilities.mjs"
import { AGGREGATES, EXECUTION_SEAMS, UNIT_FILES, UNIT_ROOTS, liveSeams } from "./seams.mjs"
import { ACCEPTS_KINDS, CATEGORIES, DICT_LOCALES, MEDIA_INPUT_KINDS, REGISTRY_CATEGORIES, EXECUTION_KINDS, HANDLE_KINDS, LABEL_LOCALES, NOT_A_UNIT, OUTPUT_TYPES, PRODUCER_KINDS, QUEUES } from "./vocabulary.mjs"

export const TYPE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const MESSAGE_KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+$/
const TOP_LEVEL_KEYS = ["$schema", "schemaVersion", "type", "label", "category", "position", "picker", "handles", "defaultData", "execution", "capabilities", "lengthUnknownReason", "registry", "contract", "docs"]
const CONTRACT_KEYS = ["producer"]
const MEDIA_KINDS = ["audio", "video", "image"]
// No price, credit id, doctrine or prompt text in a manifest: prices live in
// backend/src/nodes/<type>/price.ee.ts (Enterprise License), prompt content in
// @nodaro/prompts. A key that names a price is refused anywhere in the manifest.
const PRICE_KEY = /credit|price|cost/i
const PROMPT_KEY = /prompt|doctrine|instruction/i

export const pascalCase = (type) => type.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("")
/** The `<Pascal>Data` interface a unit's types.ts exports — the same name gen:skills looks for. */
export const dataInterfaceName = (type) => `${pascalCase(type)}Data`
/** A JS identifier for a unit's import binding in an aggregate. */
export const unitBinding = (type) => `unit_${type.replace(/-/g, "_")}`

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function dirNames(abs) {
  if (!existsSync(abs)) return []
  return readdirSync(abs).filter((n) => !n.startsWith("_") && statSync(path.join(abs, n)).isDirectory()).sort(byCodeUnit)
}
function fileNames(abs) {
  if (!existsSync(abs)) return []
  return readdirSync(abs).filter((n) => n !== "__tests__").sort(byCodeUnit)
}
function readJson(abs) {
  try {
    return { value: JSON.parse(readFileSync(abs, "utf8")) }
  } catch (err) {
    return { error: String(err?.message ?? err).split("\n")[0] }
  }
}

/**
 * @typedef {{ keys?: Record<string, Record<string, string>>, labels?: Record<string, Record<string, string>> }} UnitStrings
 * @typedef {{
 *   type: string,
 *   dirs: { frontend: string, backend: string },
 *   files: { frontend: string[], backend: string[] },
 *   manifest: any,
 *   manifestError: string | null,
 *   strings: UnitStrings | null,
 *   stringsError: string | null,
 *   typesSource: string | null,
 * }} Unit
 */

/**
 * Every unit folder under `root` (a repo root, or a fixture tree), sorted by
 * type. A folder with no manifest still comes back (with `manifestError`) so
 * the validator can name it. No folder at all is zero units, never an error.
 */
/** @returns {Unit[]} */
export function loadUnits(root) {
  const abs = (p) => path.join(root, p)
  const types = [...new Set([...dirNames(abs(UNIT_ROOTS.frontend)), ...dirNames(abs(UNIT_ROOTS.backend))])].sort(byCodeUnit)
  return types.map((type) => {
    const fe = `${UNIT_ROOTS.frontend}/${type}`
    const be = `${UNIT_ROOTS.backend}/${type}`
    const files = { frontend: fileNames(abs(fe)), backend: fileNames(abs(be)) }
    /** @type {Unit} */
    const unit = { type, dirs: { frontend: fe, backend: be }, files, manifest: null, manifestError: null, strings: null, stringsError: null, typesSource: null }
    if (files.frontend.includes("unit.json")) {
      const m = readJson(abs(`${fe}/unit.json`))
      unit.manifest = m.value ?? null
      unit.manifestError = m.error ?? null
    } else {
      unit.manifestError = `${fe}/unit.json is missing — every unit has a manifest`
    }
    if (files.frontend.includes("strings.json")) {
      const s = readJson(abs(`${fe}/strings.json`))
      unit.strings = s.value ?? null
      unit.stringsError = s.error ?? null
    }
    if (files.frontend.includes("types.ts")) unit.typesSource = readFileSync(abs(`${fe}/types.ts`), "utf8")
    return unit
  })
}

/** The family ids of the `NODE_FAMILIES` literal (LEGACY_NODE_FAMILIES) in frontend/src/lib/node-families.ts (textual; pinned to the runtime list by units-vocabulary.test.ts). */
export function familyIdsFrom(source) {
  // The hand-written literal (LEGACY_NODE_FAMILIES since NODE_FAMILIES composes the units in).
  const legacy = source.search(/^(?:export )?const LEGACY_NODE_FAMILIES\b/m)
  const start = legacy >= 0 ? legacy : source.indexOf("export const NODE_FAMILIES")
  if (start < 0) return []
  const rest = source.slice(start)
  const next = rest.indexOf("\nexport ", 1)
  const body = next < 0 ? rest : rest.slice(0, next)
  return [...body.matchAll(/(?:^[ \t]+|\{[ \t]*)id: "([^"]+)"/gm)].map((m) => m[1])
}

/** The node index whose rows gen:units writes (tools/units/seams.mjs docs-index). */
export const DOCS_INDEX = "docs/nodes/README.md"

/**
 * The docs pages (repo paths) the hand-written rows of the node index link to:
 * every `](./<path>.md)` link outside the `<!-- gen:units … -->` region.
 */
export function handWrittenIndexLinks(source) {
  const out = new Set()
  let inRegion = false
  for (const line of source.split(/\r?\n/)) {
    const t = line.trim()
    if (t === "<!-- gen:units start -->") inRegion = true
    else if (t === "<!-- gen:units end -->") inRegion = false
    else if (!inRegion) for (const m of line.matchAll(/\]\(\.\/([^)#\s]+\.md)\)/g)) out.add(path.posix.join("docs/nodes", m[1]))
  }
  return out
}

/**
 * Each hand-written family's member types (string literals of its `types`
 * array; an identifier such as REFRAME_ENTRY_TYPE is not a node type a unit
 * can follow), by family id — textual, like familyIdsFrom.
 */
export function familyTypesFrom(source) {
  const ids = [...source.matchAll(/(?:^[ \t]+|\{[ \t]*)id: "([^"]+)"/gm)]
  const legacy = source.search(/^(?:export )?const LEGACY_NODE_FAMILIES\b/m)
  const out = new Map()
  ids.filter((m) => legacy < 0 || m.index > legacy).forEach((m, i, all) => {
    const body = source.slice(m.index, i + 1 < all.length ? all[i + 1].index : undefined)
    const list = body.match(/types: \[([^\]]*)\]/)?.[1] ?? ""
    out.set(m[1], [...list.matchAll(/"([^"]+)"/g)].map((t) => t[1]))
  })
  return out
}

/**
 * Names a unit type may not take though no legacy node has them, each with
 * why: a composer keys a wider table by type and throws at module load on a
 * collision (assertDisjoint), and a plain object answers some names by itself.
 *   - Object.prototype names ("constructor") — every keyed table would "have" it;
 *   - the add-node options that are not node types (a canvas macro: "reframe");
 *   - the credit ids of STATIC_CREDIT_COSTS / CREDIT_COSTS ("ai-writer") — a
 *     unit's price.ee.ts row is keyed by its type, and credits.ts would throw.
 * Read from source text (the two credit literals of credits.ts, node-options.tsx
 * and the *MACRO_ID constants), so the validator stays built-ins only. Credit
 * ids credits.ts builds in code (spreads, loops) cannot be read as text: they
 * are listed in tools/units/reserved-credit-ids.json, and
 * backend/src/__tests__/units-reserved-ids.test.ts holds text ∪ that list to
 * the runtime tables, naming any id that is missing or listed for nothing.
 */
export function reservedIdsFrom({ credits = "", options = "", macros = [], codeBuiltCreditIds = [] } = {}) {
  const out = new Map()
  const add = (id, why) => { if (TYPE_ID.test(id) && !out.has(id)) out.set(id, why) }
  for (const n of Object.getOwnPropertyNames(Object.prototype)) add(n, "an Object.prototype name: every keyed registry would already answer it")
  for (const src of macros) {
    for (const m of src.matchAll(/^export const \w*MACRO_ID\s*=\s*"([^"]+)"/gm)) add(m[1], "a canvas macro's add-node entry (CANVAS_MACROS) — NODE_OPTIONS already holds it")
  }
  const optionsStart = options.search(/^const LEGACY_NODE_OPTIONS\b/m)
  if (optionsStart >= 0) for (const m of options.slice(optionsStart).matchAll(/^ {4}type: "([^"]+)",/gm)) add(m[1], "an add-node option (LEGACY_NODE_OPTIONS)")
  const credit = "a credit id in backend/src/ee/billing/credits.ts — the unit's price.ee.ts row would collide with it"
  // Only the top-level keys (two-space indent) of the two composed literals.
  for (const lit of credits.matchAll(/composeRecord(?:<[^\n]*?>)?\("(?:STATIC_CREDIT_COSTS|CREDIT_COSTS)", \{\n([\s\S]*?)\n\}, /g)) {
    for (const m of lit[1].matchAll(/^ {2}(?:"([a-z][a-z0-9-]*)"|([a-z][a-z0-9]*))\s*:/gm)) add(m[1] ?? m[2], credit)
  }
  for (const id of codeBuiltCreditIds) add(id, `${credit} (built in code: tools/units/reserved-credit-ids.json)`)
  return out
}

/** The validation context of the real repo. Tests build their own. */
export function repoContext(root) {
  const legacy = JSON.parse(readFileSync(path.join(root, "tools/units/legacy-nodes.json"), "utf8"))
  const text = (p) => (existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), "utf8") : "")
  const familiesSource = text("frontend/src/lib/node-families.ts")
  const libDir = path.join(root, "frontend/src/lib")
  const macroFiles = existsSync(libDir) ? readdirSync(libDir).filter((f) => /macros?\.ts$/.test(f)).map((f) => `frontend/src/lib/${f}`) : []
  return {
    legacyTypes: new Set(legacy.types),
    families: new Set(familyIdsFrom(familiesSource)),
    familyTypes: familyTypesFrom(familiesSource),
    reserved: reservedIdsFrom({
      credits: text("backend/src/ee/billing/credits.ts"),
      options: text("frontend/src/lib/node-options.tsx"),
      macros: macroFiles.map(text),
      codeBuiltCreditIds: JSON.parse(text("tools/units/reserved-credit-ids.json") || '{"ids":[]}').ids,
    }),
    live: liveSeams(),
    capabilities: CAPABILITIES,
    exists: (p) => existsSync(path.join(root, p)),
    readText: (p) => (existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), "utf8") : null),
  }
}

function forbiddenContent(value, where, out) {
  if (Array.isArray(value)) value.forEach((v, i) => forbiddenContent(v, `${where}[${i}]`, out))
  else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (PRICE_KEY.test(k)) out.push(`${where}.${k}: no price or credit field in a manifest — prices live in backend/src/nodes/<type>/price.ee.ts`)
      forbiddenContent(v, `${where}.${k}`, out)
    }
  }
}

function checkHandles(h, errors) {
  if (!isObject(h)) return errors.push("handles must be { inputs: [...], outputs: [...] }")
  const ids = []
  for (const side of ["inputs", "outputs"]) {
    if (!Array.isArray(h[side])) { errors.push(`handles.${side} must be an array`); continue }
    h[side].forEach((handle, i) => {
      const at = `handles.${side}[${i}]`
      if (!isObject(handle)) return errors.push(`${at} must be an object`)
      if (!isNonEmptyString(handle.id)) errors.push(`${at}.id must be a non-empty string`)
      else ids.push(handle.id)
      if (!isNonEmptyString(handle.label)) errors.push(`${at}.label must be a non-empty string`)
      if (side === "inputs") {
        if (!Array.isArray(handle.accepts) || handle.accepts.length === 0) errors.push(`${at}.accepts must list at least one handle kind`)
        else {
          for (const k of handle.accepts) {
            if (!HANDLE_KINDS.includes(k)) errors.push(`${at}.accepts: "${k}" is not a handle kind (${HANDLE_KINDS.join(", ")})`)
            else if (!ACCEPTS_KINDS.includes(k)) errors.push(`${at}.accepts: "${k}" has no editor connection rule for a unit input yet (${ACCEPTS_KINDS.join(", ")}) — add it to unitInputAccepts (frontend/src/lib/ffmpeg-handles.ts) and ACCEPTS_KINDS in this PR`)
          }
        }
        if (handle.field !== undefined && !isNonEmptyString(handle.field)) errors.push(`${at}.field must be a non-empty string`)
      } else {
        if (!HANDLE_KINDS.includes(handle.kind)) errors.push(`${at}.kind: "${handle.kind}" is not a handle kind (${HANDLE_KINDS.join(", ")})`)
        if (handle.from !== undefined && !isNonEmptyString(handle.from)) errors.push(`${at}.from must be a non-empty string`)
      }
    })
  }
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dup.length) errors.push(`handle ids must be unique: ${[...new Set(dup)].join(", ")}`)
}

function checkProducer(m, errors) {
  const contract = m.contract ?? {}
  if (!isObject(contract)) return errors.push("contract must be an object")
  for (const k of Object.keys(contract)) {
    if (!CONTRACT_KEYS.includes(k)) errors.push(`contract.${k}: the contract is a whitelist (${CONTRACT_KEYS.join(", ")}) — it is published in @nodaro/shared, never a price, prompt or doctrine`)
  }
  const producer = contract.producer
  if (producer !== undefined && !PRODUCER_KINDS.includes(producer)) errors.push(`contract.producer: "${producer}" is not a producer kind (${PRODUCER_KINDS.join(", ")})`)
  const outputs = Array.isArray(m.handles?.outputs) ? m.handles.outputs : []
  const media = [...new Set(outputs.map((o) => o?.kind).filter((k) => MEDIA_KINDS.includes(k)))].sort(byCodeUnit)
  if (producer === undefined && media.length > 0) {
    errors.push(`outputs a ${media.join("/")} handle but declares no contract.producer — without it no downstream node accepts its output`)
  } else if (producer === "dynamic" && media.length === 0) {
    errors.push("contract.producer is \"dynamic\" but no output carries audio, video or image")
  } else if (producer && producer !== "dynamic" && (media.length !== 1 || media[0] !== producer)) {
    errors.push(`contract.producer is "${producer}" but the media outputs are ${media.length ? media.join("/") : "none"} — use "dynamic" for a node with more than one media kind`)
  }
}

function requiredFiles(kind) {
  if (kind === "worker") return { frontend: ["exec.ts", "api.ts"], backend: ["payload.ts", "worker.ts"], route: true }
  if (kind === "sync") return { frontend: ["exec.ts", "api.ts"], backend: [], route: true }
  if (kind === "inline") return { frontend: ["exec.ts"], backend: [], route: false }
  return { frontend: [], backend: [], route: false }
}

function checkFiles(unit, m, errors) {
  for (const tree of ["frontend", "backend"]) {
    for (const f of unit.files[tree]) {
      if (!UNIT_FILES[tree].includes(f)) errors.push(`${unit.dirs[tree]}/${f}: not a unit file (allowed: ${UNIT_FILES[tree].join(", ")}, __tests__/)`)
    }
  }
  const kind = m.execution?.kind
  if (!EXECUTION_KINDS.includes(kind)) return
  const has = (tree, f) => unit.files[tree].includes(f)
  // Every node renders on the canvas: nodeTypes composes each unit's node.tsx.
  if (!has("frontend", "node.tsx")) errors.push(`every unit needs ${unit.dirs.frontend}/node.tsx (its canvas component)`)
  const need = requiredFiles(kind)
  for (const tree of ["frontend", "backend"]) for (const f of need[tree]) if (!has(tree, f)) errors.push(`execution.kind "${kind}" needs ${unit.dirs[tree]}/${f}`)
  const routes = ["route.ts", "route.ee.ts"].filter((f) => has("backend", f))
  if (routes.length > 1) errors.push("route.ts and route.ee.ts are exclusive — a Cloud-only unit has route.ee.ts only")
  if (need.route && routes.length === 0) errors.push(`execution.kind "${kind}" needs ${unit.dirs.backend}/route.ts (or route.ee.ts when Cloud-only)`)
  if (!need.route && routes.length > 0) errors.push(`execution.kind "${kind}" runs no route — remove ${routes.join(", ")} or change the kind`)
  for (const f of ["payload.ts", "worker.ts"]) if (kind !== "worker" && has("backend", f)) errors.push(`${f} is only for execution.kind "worker"`)
  if (kind === "source" && has("frontend", "exec.ts")) errors.push("execution.kind \"source\" runs nothing — remove exec.ts or change the kind")
  // The add-node picker renders the icon of option.tsx (node-options.tsx composes it).
  if (isObject(m.picker) && !has("frontend", "option.tsx")) errors.push(`a unit in the add-node picker needs ${unit.dirs.frontend}/option.tsx (its icon), or "picker": null`)
  // getModelCreditBaseCost hard-fails on an unknown id, so a route without a price breaks the node.
  if (routes.length > 0 && !has("backend", "price.ee.ts")) errors.push(`a unit with a route needs ${unit.dirs.backend}/price.ee.ts (a zero-cost one too)`)
  if (routes.length === 0 && has("backend", "price.ee.ts")) errors.push("price.ee.ts without a route prices nothing — remove it")
  // The characterization harness renders ffmpeg-backed operations through their real provider.
  if (has("backend", "characterize.char.ts") && (kind !== "worker" || !(Array.isArray(m.capabilities) && m.capabilities.includes("ffmpeg-media")))) {
    errors.push(`characterize.char.ts characterizes an ffmpeg worker: it needs execution.kind "worker" and the "ffmpeg-media" capability`)
  }
  if (unit.typesSource !== null && !new RegExp(`export\\s+(?:interface|type)\\s+${dataInterfaceName(unit.type)}\\b`).test(unit.typesSource)) {
    errors.push(`${unit.dirs.frontend}/types.ts must export ${dataInterfaceName(unit.type)} (the name gen:skills reads)`)
  }
}

function checkStrings(unit, errors) {
  if (unit.stringsError) return errors.push(`strings.json: ${unit.stringsError}`)
  const s = unit.strings
  if (s === null) return
  if (!isObject(s)) return errors.push("strings.json must be { keys?, labels? }")
  for (const k of Object.keys(s)) if (k !== "keys" && k !== "labels") errors.push(`strings.json: unknown section "${k}" (keys, labels)`)
  for (const [key, tr] of Object.entries(s.keys ?? {})) {
    if (!MESSAGE_KEY.test(key)) errors.push(`strings.json keys: "${key}" is not a message key (area.name)`)
    for (const l of DICT_LOCALES) if (!isNonEmptyString(tr?.[l])) errors.push(`strings.json keys."${key}" needs a non-empty "${l}"`)
    for (const l of Object.keys(tr ?? {})) if (!DICT_LOCALES.includes(l)) errors.push(`strings.json keys."${key}": "${l}" is not a dict locale (${DICT_LOCALES.join(", ")})`)
  }
  for (const [label, tr] of Object.entries(s.labels ?? {})) {
    for (const l of LABEL_LOCALES) if (!isNonEmptyString(tr?.[l])) errors.push(`strings.json labels."${label}" needs a non-empty "${l}"`)
    for (const l of Object.keys(tr ?? {})) if (!LABEL_LOCALES.includes(l)) errors.push(`strings.json labels."${label}": "${l}" is not a label locale (${LABEL_LOCALES.join(", ")})`)
  }
}

function checkSeams(unit, m, ctx, errors) {
  const missing = (seam, why) => {
    if (!ctx.live.has(seam)) errors.push(`${why} needs the "${seam}" seam, which is not live — build the seam in this PR (tools/units/seams.mjs; decided 2026-10-16: no exceptions list)`)
  }
  missing("definitions", "every unit")
  missing("registry", "every unit")
  const run = EXECUTION_SEAMS.find((x) => x.kind === m.execution?.kind)
  if (run) missing(run.id, `execution.kind "${run.kind}" (a server-run workflow cannot run it: ${run.gap})`)
  for (const a of AGGREGATES) {
    if (a.member.endsWith(".generated.ts")) continue
    if (unit.files[a.tree].includes(a.member)) missing(a.id, a.member)
  }
  if (Object.keys(unit.strings?.keys ?? {}).length) missing("i18n", "strings.json keys")
  if (Object.keys(unit.strings?.labels ?? {}).length) missing("labels", "strings.json labels")
  if (m.docs?.page) missing("docs-index", "docs.page")
  if (m.contract?.producer) missing("contracts", "contract.producer")
  for (const c of Array.isArray(m.capabilities) ? m.capabilities : []) {
    const cap = ctx.capabilities[c]
    if (cap) missing(cap.seam, `capability "${c}"`)
  }
}

// Always reserved, whatever context a test builds: a plain object already answers these.
const PROTOTYPE_NAMES = reservedIdsFrom()

/**
 * Every problem with one unit, as `<type>: <message>` lines. `knownTypes` =
 * legacy ∪ every unit; `unitFamilies` = each unit's picker.family (so
 * picker.after may name a unit of the same family).
 */
export function validateUnit(unit, ctx, knownTypes, unitFamilies = new Map()) {
  const errors = []
  const m = unit.manifest
  if (!m) return [`${unit.type}: ${unit.manifestError}`]
  if (!isObject(m)) return [`${unit.type}: unit.json must be an object`]
  if (typeof m.kind === "string" && NOT_A_UNIT[m.kind]) errors.push(`"kind": "${m.kind}" — ${NOT_A_UNIT[m.kind]}`)
  for (const k of Object.keys(m)) if (!TOP_LEVEL_KEYS.includes(k) && k !== "kind") errors.push(`unknown key "${k}" (allowed: ${TOP_LEVEL_KEYS.join(", ")})`)
  if (m.kind !== undefined && !NOT_A_UNIT[m.kind]) errors.push(`unknown key "kind"`)
  if (m.schemaVersion !== 1) errors.push("schemaVersion must be 1")
  if (m.type !== unit.type) errors.push(`type "${m.type}" must equal its folder name "${unit.type}"`)
  if (!TYPE_ID.test(unit.type)) errors.push(`"${unit.type}" is not a kebab-case type id`)
  if (ctx.legacyTypes.has(unit.type)) errors.push("is also a legacy node (tools/units/legacy-nodes.json) — a type lives in exactly one place")
  else {
    const reserved = ctx.reserved?.get(unit.type) ?? PROTOTYPE_NAMES.get(unit.type)
    if (reserved) errors.push(`"${unit.type}" is reserved: ${reserved} — choose another type id`)
  }
  if (!isNonEmptyString(m.label)) errors.push("label must be a non-empty string")
  if (!CATEGORIES.includes(m.category)) errors.push(`category "${m.category}" is not one of ${CATEGORIES.join(", ")}`)
  else if (!REGISTRY_CATEGORIES.includes(m.category)) errors.push(`category "${m.category}" has no /v1/nodes category yet (${REGISTRY_CATEGORIES.join(", ")}) — a unit in it adds that seam in its own PR`)
  const after = (v, where) => {
    if (v === null) return
    if (typeof v !== "string") return errors.push(`${where} must name a node type or be null (first)`)
    if (v === unit.type) errors.push(`${where} names the unit itself`)
    else if (!knownTypes.has(v)) errors.push(`${where}: "${v}" is not a node type`)
  }
  // Order is user-visible (the add-node popup, family types, the skills
  // catalog), so the author always states the place.
  if (!isObject(m.position) || !("after" in m.position)) errors.push("position.after is required (a node type, or null for first)")
  else after(m.position.after, "position.after")
  if (!("picker" in m)) errors.push("picker is required ({ family, after, … }, or null when the node is not in the add-node picker)")
  else if (m.picker !== null) {
    if (!isObject(m.picker)) errors.push("picker must be an object or null")
    else {
      if (!ctx.families.has(m.picker.family)) errors.push(`picker.family "${m.picker.family}" is not a family id in frontend/src/lib/node-families.ts`)
      if (!("after" in m.picker)) errors.push("picker.after is required (a node type, or null for first in its family)")
      else {
        after(m.picker.after, "picker.after")
        // The family header lists its types in this order: the place is IN the family.
        const members = ctx.familyTypes?.get(m.picker.family)
        const a = m.picker.after
        if (members && typeof a === "string" && a !== unit.type && knownTypes.has(a) && !members.includes(a) && unitFamilies.get(a) !== m.picker.family) {
          errors.push(`picker.after: "${a}" is not in family "${m.picker.family}" — a unit follows a type of its own family (${members.length ? members.join(", ") : "none yet"}), or null for first`)
        }
      }
      if (m.picker.keywords !== undefined && !(Array.isArray(m.picker.keywords) && m.picker.keywords.every(isNonEmptyString))) errors.push("picker.keywords must be a list of strings")
    }
  }
  checkHandles(m.handles, errors)
  if (!isObject(m.defaultData)) errors.push("defaultData must be an object")
  else {
    for (const [k, v] of Object.entries(m.defaultData)) {
      if (PROMPT_KEY.test(k) && typeof v === "string" && v !== "") errors.push(`defaultData.${k}: no prompt text in a manifest — prompt content belongs in @nodaro/prompts`)
    }
  }
  const ex = m.execution
  if (!isObject(ex) || !EXECUTION_KINDS.includes(ex.kind)) errors.push(`execution.kind must be one of ${EXECUTION_KINDS.join(", ")}`)
  else {
    if (ex.kind === "worker" && !QUEUES.includes(ex.queue)) errors.push(`execution.queue "${ex.queue}" is not a queue (${QUEUES.join(", ")})`)
    if (ex.kind !== "worker" && ex.queue !== undefined) errors.push("execution.queue is only for execution.kind \"worker\"")
    if (ex.requires !== undefined) {
      const r = ex.requires
      if (ex.kind !== "worker" && ex.kind !== "sync") errors.push("execution.requires is only for a node that runs on the server")
      if (!isObject(r) || !Array.isArray(r.anyOf) || r.anyOf.length === 0 || !r.anyOf.every(isNonEmptyString)) errors.push("execution.requires.anyOf must list the data fields any of which supplies the media")
      else if (!MEDIA_INPUT_KINDS.includes(r.kind) || !isNonEmptyString(r.noun)) errors.push(`execution.requires needs a media \`kind\` (${MEDIA_INPUT_KINDS.join(", ")}) and a \`noun\` ("a video")`)
    }
  }
  if (!Array.isArray(m.capabilities)) errors.push("capabilities must be an array (empty is fine)")
  else {
    for (const c of m.capabilities) if (!Object.hasOwn(ctx.capabilities, c)) errors.push(`capability "${c}" is not in tools/units/capabilities.mjs — a new capability needs a reviewed seam first`)
    if (m.capabilities.includes("length:pass-video") && m.capabilities.includes("length:exact-video")) errors.push("capabilities: \"length:exact-video\" already keeps the length — drop \"length:pass-video\"")
    if (m.capabilities.includes("length:unknown")) {
      for (const keeps of ["length:pass-video", "length:exact-video"]) if (m.capabilities.includes(keeps)) errors.push(`capabilities: "length:unknown" (no rule bounds its length) contradicts "${keeps}" (it keeps its video input's) — a node has one length rule`)
      if (m.contract?.producer !== "video") errors.push("capabilities: \"length:unknown\" is the length rule of a video output — it needs contract.producer \"video\"")
      if (m.lengthUnknownReason === undefined) errors.push("capabilities: \"length:unknown\" needs lengthUnknownReason — one sentence on why no rule bounds its length before it has run (UNBOUNDED_LENGTH_REASONS)")
    }
    if (m.lengthUnknownReason !== undefined && !m.capabilities.includes("length:unknown")) errors.push("lengthUnknownReason is only for a unit with the \"length:unknown\" capability")
  }
  if (m.lengthUnknownReason !== undefined && !isNonEmptyString(m.lengthUnknownReason)) {
    errors.push("lengthUnknownReason must be a non-empty sentence")
  }
  if (!isObject(m.registry) || !isNonEmptyString(m.registry.description) || !OUTPUT_TYPES.includes(m.registry.outputType)) {
    errors.push(`registry needs a description and an outputType (${OUTPUT_TYPES.join(", ")}) — /v1/nodes lists every node`)
  }
  if (isObject(m.registry)) {
    for (const k of Object.keys(m.registry)) if (!["description", "outputType", "after"].includes(k)) errors.push(`registry.${k}: unknown (description, outputType, after)`)
    // /v1/nodes keeps its own hand-curated order: a node whose place there
    // differs from position.after states it (a migrated node keeps its place).
    if ("after" in m.registry) after(m.registry.after, "registry.after")
  }
  checkProducer(m, errors)
  const docs = m.docs
  if (!isObject(docs) || (docs.page === undefined) === (docs.awaiting === undefined)) errors.push("docs needs exactly one of page (the docs/nodes/… page) or awaiting (why it has none yet)")
  else if (docs.page !== undefined) {
    if (typeof docs.page !== "string" || !/^docs\/nodes\/.+\.md$/.test(docs.page)) errors.push("docs.page must be a docs/nodes/<category>/<type>.md path")
    else if (!ctx.exists(docs.page)) errors.push(`docs.page ${docs.page} does not exist`)
  } else if (!isNonEmptyString(docs.awaiting)) errors.push("docs.awaiting must give the reason")
  if (isObject(docs)) {
    for (const k of Object.keys(docs)) if (!["page", "awaiting", "useCase", "index"].includes(k)) errors.push(`docs.${k}: unknown (page, awaiting, useCase, index)`)
    if (docs.useCase !== undefined && !isNonEmptyString(docs.useCase)) errors.push("docs.useCase must be a non-empty string (the node index's \"use it to\" column)")
    // A migrated node keeps its hand-written docs/nodes/README.md row where it
    // is (decided 2026-10-16: the public page does not change); gen:units then
    // writes no row for it. The row must exist, outside the generated region.
    if (docs.index !== undefined) {
      if (docs.index !== "hand-written") errors.push(`docs.index: "${docs.index}" — the only value is "hand-written" (omit it for a generated row)`)
      else if (typeof docs.page !== "string") errors.push("docs.index \"hand-written\" needs docs.page (the page its row links to)")
      else if (ctx.readText && !handWrittenIndexLinks(ctx.readText(DOCS_INDEX) ?? "").has(docs.page)) {
        errors.push(`docs.index is "hand-written" but ${DOCS_INDEX} has no hand-written row linking ${docs.page} (outside the gen:units region)`)
      }
    }
  }
  forbiddenContent(m, "unit", errors)
  checkFiles(unit, m, errors)
  checkStrings(unit, errors)
  checkSeams(unit, m, ctx, errors)
  return errors.map((e) => `${unit.type}: ${e}`)
}

/** Validates every unit; returns the problems (empty = valid). */
export function validateUnits(units, ctx) {
  const known = new Set([...ctx.legacyTypes, ...units.map((u) => u.type)])
  const unitFamilies = new Map(units.filter((u) => isObject(u.manifest?.picker)).map((u) => [u.type, u.manifest.picker.family]))
  const errors = units.flatMap((u) => validateUnit(u, ctx, known, unitFamilies))
  try {
    insertAtPositions([...ctx.legacyTypes], units.filter((u) => u.manifest?.position).map((u) => ({ type: u.type, after: u.manifest.position.after })))
  } catch (err) {
    errors.push(String(err.message))
  }
  return errors
}

/**
 * The full order: `base` (the legacy order) with each unit inserted right
 * after the type its `after` names (null = first). Units that name the same
 * place keep type order. Throws on an unknown place or a cycle among units.
 * gen:skills and every composer place units with this one function.
 */
export function insertAtPositions(base, units) {
  const known = new Set([...base, ...units.map((u) => u.type)])
  const byAnchor = new Map()
  for (const u of [...units].sort((a, b) => byCodeUnit(a.type, b.type))) {
    const anchor = u.after ?? null
    if (anchor !== null && !known.has(anchor)) throw new Error(`${u.type}: position.after "${anchor}" is not a node type`)
    if (!byAnchor.has(anchor)) byAnchor.set(anchor, [])
    byAnchor.get(anchor).push(u.type)
  }
  const out = []
  const placed = new Set()
  const place = (type) => {
    out.push(type)
    placed.add(type)
    for (const t of byAnchor.get(type) ?? []) place(t)
  }
  for (const t of byAnchor.get(null) ?? []) place(t)
  for (const t of base) place(t)
  const unplaced = units.map((u) => u.type).filter((t) => !placed.has(t))
  if (unplaced.length) throw new Error(`position.after forms a cycle among units: ${unplaced.join(", ")}`)
  return out
}
