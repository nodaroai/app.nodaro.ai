// tools/units/scaffold.mjs — `npm run gen:units -- --new <type> …`: write a
// new node unit's folders from templates (decided 2026-10-16: new nodes are
// units). The would-be unit is validated IN MEMORY by the same validator as
// gen:units (manifest.mjs) before anything is written, so a refused scaffold
// leaves the tree untouched; once written, gen:units regenerates, so
// `gen:units --check` is clean straight away. Built-ins only.
// @reads frontend/src/nodes/** backend/src/nodes/** tools/units/legacy-nodes.json frontend/src/lib/node-families.ts frontend/src/lib/node-options.tsx frontend/src/lib/*macro*.ts backend/src/ee/billing/credits.ts backend/src/providers/video/__characterization__/operations.ts packages/render-rules/src/use-case-specs.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { dataInterfaceName, LANE_CAPABILITIES, loadUnits, repoContext, TYPE_ID, validateUnits } from "./manifest.mjs"
import { UNIT_ROOTS } from "./seams.mjs"
import { EXECUTION_KINDS } from "./vocabulary.mjs"
import { apiTs, characterizeTs, configTsx, execTs, nodeTsx, optionTsx, payloadTs, priceTs, routeTs, typesTs, unitJson, useCaseTs, workerTs } from "./scaffold-templates.mjs"

/** The harness that composes every unit's characterize.char.ts (tools/units/seams.mjs "characterizations"). */
const CHARACTERIZATION_OPERATIONS = "backend/src/providers/video/__characterization__/operations.ts"

export const USAGE = [
  "usage: npm run gen:units -- --new <type> --category <category> --kind <worker|sync|inline|source|use-case>",
  "         --after <type|first> --description \"<one sentence for /v1/nodes>\"",
  "         (--family <family id> --picker-after <type|first> | --no-picker)",
  "         [--label \"<Label>\"] [--price <credits>   (worker, sync and use-case: required)]",
  `         [--lane <${LANE_CAPABILITIES.map((c) => c.slice("lane:".length)).join("|")}>   (worker: required — the concurrency lane its job counts in)]`,
  "         [--builder <key>   (use-case: required — its graph builder's key in packages/render-rules/src/use-case-specs.ts)]",
  "         [--characterize <operation it follows|first>   (worker: its ffmpeg characterization, characterize.char.ts)]",
].join("\n")

const FLAGS_WITH_VALUE = new Set(["--new", "--category", "--kind", "--after", "--description", "--family", "--picker-after", "--label", "--price", "--characterize", "--builder", "--lane"])
const BOOLEAN_FLAGS = new Set(["--no-picker"])

/** `--flag value` / `--flag=value` into { new, category, … }; unknown or valueless flags are errors. */
export function parseScaffoldArgs(argv) {
  const opts = {}
  const errors = []
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    const eq = raw.indexOf("=")
    const flag = eq > 0 ? raw.slice(0, eq) : raw
    const key = flag.replace(/^--/, "")
    if (BOOLEAN_FLAGS.has(flag)) {
      if (eq > 0) errors.push(`${flag} takes no value`)
      opts[key] = true
    } else if (FLAGS_WITH_VALUE.has(flag)) {
      const value = eq > 0 ? raw.slice(eq + 1) : argv[++i]
      if (value === undefined || (eq < 0 && value.startsWith("--"))) errors.push(`${flag} needs a value`)
      else if (Object.hasOwn(opts, key)) errors.push(`${flag} is given twice`)
      else opts[key] = value
    } else errors.push(`unknown argument ${raw}`)
  }
  return { opts, errors }
}

const titleCase = (type) => type.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ")
const place = (v) => (v === "first" ? null : v)

/**
 * The scaffold's options, normalised, plus every problem that is about the
 * FLAGS (the manifest rules are the validator's: validateUnits runs after).
 */
export function scaffoldOptions(raw) {
  const errors = []
  const need = (k, why) => { if (raw[k] === undefined || raw[k] === "") errors.push(`--${k} is required (${why})`) }
  need("new", "the node type id, kebab-case — it is the folder name")
  need("category", "the node category")
  need("kind", `how it runs: ${EXECUTION_KINDS.join(", ")}`)
  need("after", "where it sits in NODE_DEFINITIONS and the skills catalog: a node type, or first — order is user-visible, so it is always stated")
  need("description", "one sentence for /v1/nodes and the MCP catalog")
  if (raw.kind !== undefined && !EXECUTION_KINDS.includes(raw.kind)) errors.push(`--kind "${raw.kind}" is not one of ${EXECUTION_KINDS.join(", ")}`)
  if (raw["no-picker"] && (raw.family !== undefined || raw["picker-after"] !== undefined)) errors.push("--no-picker excludes --family and --picker-after")
  if (!raw["no-picker"]) {
    need("family", "its add-node picker family (an id in frontend/src/lib/node-families.ts), or --no-picker")
    need("picker-after", "where it sits in its family: a type of that family, or first")
  }
  const runsARoute = raw.kind === "worker" || raw.kind === "sync"
  // A use-case node runs the factory route: a run reserves its per-run fee (the use-case-fee:<type> row).
  const chargesAFee = raw.kind === "use-case"
  let price = null
  if (runsARoute || chargesAFee) {
    const what = runsARoute ? "its route charges a price.ee.ts row" : `a run reserves its per-run fee, the price.ee.ts row "use-case-fee:${raw.new ?? "<type>"}"`
    if (raw.price === undefined) errors.push(`--price is required for --kind ${raw.kind}: ${what} (0 for a free node — stated, never defaulted)`)
    else if (!/^\d+$/.test(raw.price)) errors.push(`--price "${raw.price}" is not a whole number of credits (model_pricing.credit_cost is an integer)`)
    else price = Number(raw.price)
  } else if (raw.price !== undefined) errors.push(`--price is only for --kind worker, sync or use-case (--kind ${raw.kind} runs no route, so nothing charges)`)
  if (chargesAFee && (raw.builder === undefined || raw.builder === "")) errors.push("--builder is required for --kind use-case: its graph builder's key in packages/render-rules/src/use-case-specs.ts — write the builder first")
  else if (!chargesAFee && raw.builder !== undefined) errors.push(`--builder is only for --kind use-case (--kind ${raw.kind} runs no graph builder)`)
  // A worker's job counts in one concurrency lane (backend/src/lib/concurrency-lanes/registry.ts): stated, never defaulted.
  const lanes = LANE_CAPABILITIES.map((c) => c.slice("lane:".length))
  if (raw.kind === "worker") {
    if (raw.lane === undefined || raw.lane === "") errors.push(`--lane is required for --kind worker: the concurrency lane its job counts in (${lanes.join(", ")}) — provider for a call to an external AI provider, llm for an LLM text call, local for in-house compute (ffmpeg, sharp, Remotion)`)
    else if (!lanes.includes(raw.lane)) errors.push(`--lane "${raw.lane}" is not one of ${lanes.join(", ")}`)
  } else if (raw.lane !== undefined) errors.push(`--lane is only for --kind worker (--kind ${raw.kind} runs no worker job)`)
  if (raw.characterize !== undefined && raw.kind !== "worker") errors.push(`--characterize is only for --kind worker: the characterization harness renders an ffmpeg worker's output (--kind ${raw.kind} runs none)`)
  const type = raw.new ?? ""
  if (type && !TYPE_ID.test(type)) errors.push(`"${type}" is not a kebab-case type id`)
  const o = {
    type,
    category: raw.category,
    kind: raw.kind,
    label: raw.label ?? titleCase(type),
    description: raw.description,
    after: place(raw.after),
    family: raw["no-picker"] ? null : raw.family,
    pickerAfter: raw["no-picker"] ? null : place(raw["picker-after"]),
    price,
    // The operation its characterization runs after (null = first); undefined = none.
    characterizeAfter: raw.characterize === undefined ? undefined : place(raw.characterize),
    // worker: the concurrency lane its job counts in; set only for that kind.
    ...(raw.kind === "worker" ? { lane: raw.lane } : {}),
    // use-case: its graph builder's key (USE_CASE_SPECS); set only for that kind.
    ...(chargesAFee ? { builder: raw.builder } : {}),
  }
  return { o, errors }
}

/** Every file of the new unit: repo path → content (per execution.kind). */
export function scaffoldFiles(o) {
  const fe = `${UNIT_ROOTS.frontend}/${o.type}`
  const be = `${UNIT_ROOTS.backend}/${o.type}`
  const files = new Map([
    [`${fe}/unit.json`, unitJson(o)],
    [`${fe}/types.ts`, typesTs(o)],
    [`${fe}/node.tsx`, nodeTsx(o)],
    [`${fe}/config.tsx`, configTsx(o)],
  ])
  if (o.family) files.set(`${fe}/option.tsx`, optionTsx(o))
  // A use-case node runs through executeUseCase (no exec.ts) and the factory route (no route of its own).
  if (o.kind !== "source" && o.kind !== "use-case") files.set(`${fe}/exec.ts`, execTs(o))
  if (o.kind === "use-case") {
    files.set(`${be}/use-case.ts`, useCaseTs(o))
    files.set(`${be}/price.ee.ts`, priceTs(o))
  }
  if (o.kind === "worker" || o.kind === "sync") {
    files.set(`${fe}/api.ts`, apiTs(o))
    files.set(`${be}/route.ts`, routeTs(o))
    files.set(`${be}/price.ee.ts`, priceTs(o))
  }
  if (o.kind === "worker") {
    files.set(`${be}/payload.ts`, payloadTs(o))
    files.set(`${be}/worker.ts`, workerTs(o))
    if (o.characterizeAfter !== undefined) files.set(`${be}/characterize.char.ts`, characterizeTs(o))
  }
  return files
}

/** The Unit manifest.mjs would load from `files` (so the validator judges it before any write). */
export function unitFromFiles(o, files) {
  const fe = `${UNIT_ROOTS.frontend}/${o.type}`
  const be = `${UNIT_ROOTS.backend}/${o.type}`
  const under = (dir) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)).sort()
  return {
    type: o.type,
    dirs: { frontend: fe, backend: be },
    files: { frontend: under(fe), backend: under(be) },
    manifest: JSON.parse(files.get(`${fe}/unit.json`)),
    manifestError: null,
    strings: null,
    stringsError: null,
    typesSource: files.get(`${fe}/types.ts`),
  }
}

/**
 * Everything `--new` would write for `raw` (parsed flags) at `root`, or the
 * reasons it refuses. Never writes. `ctx` is injectable for fixture trees.
 */
export function planScaffold(raw, { root, ctx = repoContext(root) } = {}) {
  const { o, errors } = scaffoldOptions(raw)
  if (errors.length) return { errors, files: new Map(), o }
  const fe = `${UNIT_ROOTS.frontend}/${o.type}`
  const be = `${UNIT_ROOTS.backend}/${o.type}`
  const taken = [fe, be].filter((d) => existsSync(path.join(root, d)))
  if (taken.length) return { errors: [`${taken.join(" and ")} already exist${taken.length === 1 ? "s" : ""} — --new never overwrites`], files: new Map(), o }
  const files = scaffoldFiles(o)
  const existing = loadUnits(root)
  // The validator reads unit files through ctx (price.ee.ts's creditId): serve the would-be files from memory.
  const planned = {
    ...ctx,
    exists: (p) => files.has(p) || ctx.exists(p),
    ...(ctx.readText ? { readText: (p) => (files.has(p) ? files.get(p) : ctx.readText(p)) } : {}),
  }
  const problems = validateUnits([...existing, unitFromFiles(o, files)], planned)
  // The characterization harness places the op after the one it names, and
  // throws at load on a name that is no operation: refuse it here instead.
  const opsFile = path.join(root, CHARACTERIZATION_OPERATIONS)
  if (typeof o.characterizeAfter === "string" && existsSync(opsFile)) {
    const ops = new Set([
      ...[...readFileSync(opsFile, "utf8").matchAll(/^\s*name: "([^"]+)",/gm)].map((m) => m[1]),
      ...existing.filter((u) => u.files.backend.includes("characterize.char.ts")).map((u) => u.type),
    ])
    if (!ops.has(o.characterizeAfter)) problems.push(`--characterize: "${o.characterizeAfter}" is not a characterization operation (${CHARACTERIZATION_OPERATIONS}), nor a unit's — name the operation it follows, or first`)
  }
  return { errors: problems, files, o }
}

/** The deliberately central steps a unit still takes after its folders exist (root CLAUDE.md). */
export function nextSteps(o) {
  const useCase = o.kind === "use-case"
  const strings = `add frontend/src/nodes/${o.type}/strings.json — the node label "${o.label}" in he/ja/ko/pt-br ("labels"), and any UI string the unit alone uses in all five dicts ("keys")`
  const docs = `write its docs page docs/nodes/<folder>/${o.type}.md and swap unit.json docs.awaiting for docs.page (docs-node-registry-parity needs the page and its docs/nodes/README.md row, which gen:units writes from docs.page); until the page is on the docs site, list the type in AWAITING_DOCS_PAGE (frontend/src/lib/node-docs/__tests__/node-docs.test.ts), then refresh the snapshot (npm -w frontend run gen:node-docs -- --live) and drop that line`
  const creditId = useCase ? `use-case-fee:${o.type}` : o.type
  const seed = o.price === null ? [] : [`seed its price: a supabase/migrations/NNN_*.sql INSERT INTO model_pricing … ON CONFLICT DO NOTHING for "${creditId}" at the same ${o.price} credits as price.ee.ts`]
  const steps = useCase
    ? [
        `its builder is written (USE_CASE_SPECS.${o.builder} in packages/render-rules/src/use-case-specs.ts): the graph a run of this node expands into, and the spec fields its run needs — a video output: its spec's \`outputLength\` is its length rule (never a "length:*" capability; use-case-output-length.test.ts), and \`triesEvery\` / \`audioForced\` when they apply (tools/units/README.md)`,
        `fill backend/src/nodes/${o.type}/use-case.ts's body with the node's settings, and \`settingKeys\` in its spec; its handles in unit.json and the matching fields in types.ts (${dataInterfaceName(o.type)})`,
        `its MCP verb: the REGISTER_BY_BUILDER entry for "${o.builder}" in backend/src/lib/mcp/tools/verbs-use-case.ts (the node's own tool, found by its builder; typecheck fails until it is there), and that tool's entry in docs/mcp/tools.md (gen:skills:check)`,
        `its settings table: a SETTINGS_TABLES row for "${o.type}" in backend/src/lib/__tests__/use-case-graph-validity.test.ts (every graph its builder can emit is walked; typecheck fails until it is there)`,
        strings,
        `its card's empty-state text: node.tsx shows Tighten's "Connect an episode recording" (node.tightenConnectRecording) until it is replaced with the node's own string`,
        ...seed,
        docs,
        "a @nodaro/shared changeset (the use-case list and contract rows are published: packages/shared/src/generated/unit-contracts.ts)",
      ]
    : [
        `fill the folders: the node's work (the step that throws "is not written yet"), its handles in unit.json and the matching fields in types.ts (${dataInterfaceName(o.type)})`,
        strings,
        docs,
        ...seed,
      ]
  if (o.characterizeAfter !== undefined) steps.push(`write its characterization (backend/src/nodes/${o.type}/characterize.char.ts run: the node's real provider function on a fixture), then bless its golden inside the pinned-ffmpeg image (backend/scripts/characterize-in-image.sh; backend/CLAUDE.md "ffmpeg: pinned version + output characterization")`)
  else if (o.kind === "worker") steps.push("an ffmpeg worker should be characterized: re-scaffold with --characterize <operation it follows>, or add characterize.char.ts and the \"ffmpeg-media\" capability by hand (tools/units/README.md)")
  if (o.kind === "worker") {
    steps.push("its output length: a video output needs a length rule (capability \"length:exact-video\" when it keeps the input's exact length, \"length:pass-video\" when at most that, \"length:unknown\" with a unit.json lengthUnknownReason sentence when no rule can bound it before it has run, and added by hand to the shrink-only unbounded pin; video-output-length.test.ts)")
    steps.push("a @nodaro/shared changeset: contract.producer adds a row to packages/shared/src/generated/unit-contracts.ts")
  }
  steps.push("npm run build:packages (gen:skills captures the MCP tools from the built packages, which carry the tables gen:units wrote), npm run gen (gen:units, then gen:skills — INTERNAL_ORCHESTRATOR_SECRET inline), npm run build:packages again (render-rules carries the node's settings), then npm run typecheck")
  return steps
}

/** Runs `--new`; returns the exit code. `generateAndWrite(root)` regenerates (gen.mjs passes its own). */
export async function scaffoldMain(argv, { root, out, err, generateAndWrite, ctx }) {
  const { opts, errors: argErrors } = parseScaffoldArgs(argv)
  if (argErrors.length) {
    err.write(`gen:units --new: ${argErrors.join("; ")}\n${USAGE}\n`)
    return 2
  }
  const plan = planScaffold(opts, { root, ...(ctx ? { ctx } : {}) })
  if (plan.errors.length) {
    err.write(`gen:units --new: refused, nothing written:\n${plan.errors.map((e) => `  - ${e}`).join("\n")}\n${USAGE}\n`)
    return 1
  }
  const folders = [`${UNIT_ROOTS.frontend}/${plan.o.type}`, `${UNIT_ROOTS.backend}/${plan.o.type}`]
  let done = false
  try {
    for (const [p, content] of plan.files) {
      mkdirSync(path.dirname(path.join(root, p)), { recursive: true })
      writeFileSync(path.join(root, p), content)
    }
    const regen = await generateAndWrite(root)
    if (regen !== 0) return regen
    done = true
  } finally {
    if (!done) {
      // A failed (or thrown) regeneration leaves the tree as it was, so the next
      // run does not meet "never overwrites".
      for (const d of folders) rmSync(path.join(root, d), { recursive: true, force: true })
      const restored = await generateAndWrite(root).catch(() => 1)
      err.write(`gen:units --new: regenerating failed, so the "${plan.o.type}" folders were removed again${restored === 0 ? "" : " (and regenerating without them failed too)"}\n`)
    }
  }
  out.write(`gen:units --new: wrote ${plan.files.size} file(s) for "${plan.o.type}":\n${[...plan.files.keys()].map((p) => `  ${p}`).join("\n")}\nnext:\n${nextSteps(plan.o).map((s, i) => `  ${i + 1}. ${s}`).join("\n")}\n`)
  return 0
}
