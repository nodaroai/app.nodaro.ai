#!/usr/bin/env node
// tools/units/gen.mjs — gen:units: the node-unit generator (decided 2026-10-16).
//   npm run gen:units              write every generated file
//   npm run gen:units -- --check   regenerate in memory and compare; exit 1 listing each stale file
// It validates every unit manifest (frontend/src/nodes/<type>/unit.json), then
// writes the per-unit projections, the aggregate of every LIVE seam
// (tools/units/seams.mjs), the spliced regions and the shared contract rows.
// Deterministic: units sorted by type, LF, no timestamps. It never reads
// gen:skills' outputs and gen:skills never reads its outputs, so the two
// checks run in either order or concurrently.
// @reads frontend/src/nodes/** backend/src/nodes/** backend/src/ee/nodes/** frontend/src/lib/i18n/*.ts docs/nodes/README.md packages/shared/src/generated/** packages/render-rules/src/unit-kept-lengths.generated.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { loadUnits, repoContext, validateUnits } from "./manifest.mjs"
import { AGGREGATES, DATA_FILES, GENERATED_DIRS, PROJECTIONS, SPLICES, UNIT_ROOTS } from "./seams.mjs"
import { aggregateSource, contractsSource, definitionSource, descriptorSource, docsRows, i18nLines, keptLengthsSource, labelsSource, spliceRegion } from "./templates.mjs"

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

/**
 * Every path gen:units may write, as globs. gen:skills' list
 * (backend/scripts/lib/gen-skills/outputs.ts) must never intersect it —
 * units-generator.test.ts asserts that, so neither generator can overwrite
 * the other's output.
 */
export const GEN_UNITS_OUTPUTS = [
  ...PROJECTIONS.map((p) => `${UNIT_ROOTS[p.tree]}/*/${p.file}`),
  ...GENERATED_DIRS.map((d) => `${d}/**`),
  ...SPLICES.flatMap((s) => s.files.map((f) => f.path)),
  ...DATA_FILES.map((d) => d.out),
]

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** The files under `dir` (repo-relative), recursively; none when it does not exist. */
function filesUnder(root, dir) {
  const abs = path.join(root, dir)
  if (!existsSync(abs)) return []
  return readdirSync(abs).flatMap((n) => (statSync(path.join(abs, n)).isDirectory() ? filesUnder(root, `${dir}/${n}`) : [`${dir}/${n}`]))
}

/**
 * Everything gen:units would write for the tree at `root`.
 * `ctx` (validation context, incl. the live seams) and `readPrice`
 * (repo path → staticCosts) are injectable for tests; by default the price
 * reader loads TypeScript only when some unit has a price.ee.ts.
 * Returns { errors, outputs: Map<path, content>, orphans: path[] }.
 */
export async function generate({ root = REPO_ROOT, ctx = repoContext(root), readPrice } = {}) {
  const units = loadUnits(root)
  const errors = validateUnits(units, ctx)
  if (errors.length) return { errors, outputs: new Map(), orphans: [] }
  const live = ctx.live
  const outputs = new Map()
  let reader = readPrice
  const priceOf = async (u) => {
    if (!u.files.backend.includes("price.ee.ts")) return null
    reader ??= (await import("./price-reader.mjs")).priceReader(root)
    const costs = reader(`${u.dirs.backend}/price.ee.ts`)
    return Object.hasOwn(costs, u.type) ? costs[u.type] : null
  }
  for (const u of units) {
    // Validation guarantees the definitions and registry seams are live for any unit.
    outputs.set(`${u.dirs.frontend}/definition.generated.ts`, definitionSource(u, await priceOf(u)))
    if (Object.keys(u.strings?.labels ?? {}).length) outputs.set(`${u.dirs.frontend}/labels.generated.ts`, labelsSource(u))
    outputs.set(`${u.dirs.backend}/descriptor.generated.ts`, descriptorSource(u))
  }
  const hasMember = (u, agg) => {
    if (agg.member === "definition.generated.ts" || agg.member === "descriptor.generated.ts") return true
    if (agg.member === "labels.generated.ts") return Object.keys(u.strings?.labels ?? {}).length > 0
    return u.files[agg.tree].includes(agg.member)
  }
  for (const agg of AGGREGATES.filter((a) => live.has(a.id))) outputs.set(agg.out, aggregateSource(agg, units.filter((u) => hasMember(u, agg))))
  for (const s of SPLICES.filter((x) => live.has(x.id))) {
    for (const f of s.files) {
      const abs = path.join(root, f.path)
      if (!existsSync(abs)) throw new Error(`the "${s.id}" seam is live but ${f.path} does not exist`)
      const lines = s.id === "i18n" ? i18nLines(units, f.locale) : docsRows(units)
      outputs.set(f.path, spliceRegion(readFileSync(abs, "utf8"), s.start, s.end, lines, f.path))
    }
  }
  const dataSource = { contracts: contractsSource, lengths: keptLengthsSource }
  for (const d of DATA_FILES.filter((x) => live.has(x.id))) outputs.set(d.out, dataSource[d.id](units))
  // Orphans: generated files no unit or live seam produces any more (a
  // removed unit's projection, a seam switched off). --check fails on them;
  // a write deletes them.
  const generatedHere = [
    ...units.flatMap((u) => [...PROJECTIONS.map((p) => `${u.dirs[p.tree]}/${p.file}`)]),
    ...GENERATED_DIRS.flatMap((d) => filesUnder(root, d)),
    ...DATA_FILES.map((d) => d.out),
  ].filter((p) => existsSync(path.join(root, p)))
  const strayProjections = Object.entries(UNIT_ROOTS).flatMap(([, dir]) => filesUnder(root, dir))
    .filter((p) => /\.generated\.ts$/.test(p) && !GENERATED_DIRS.some((d) => p.startsWith(`${d}/`)))
  const orphans = [...new Set([...generatedHere, ...strayProjections])].filter((p) => !outputs.has(p)).sort(byCodeUnit)
  return { errors: [], outputs, orphans }
}

/** The outputs that differ from the tree (or are missing), plus the orphans. */
export function staleFiles(root, result) {
  const stale = []
  for (const [p, content] of result.outputs) {
    const abs = path.join(root, p)
    if (!existsSync(abs) || readFileSync(abs, "utf8") !== content) stale.push(p)
  }
  return [...stale, ...result.orphans].sort(byCodeUnit)
}

export function writeOutputs(root, result) {
  for (const [p, content] of result.outputs) {
    const abs = path.join(root, p)
    if (existsSync(abs) && readFileSync(abs, "utf8") === content) continue
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  for (const p of result.orphans) rmSync(path.join(root, p))
}

export async function main(argv = process.argv.slice(2), root = REPO_ROOT, out = process.stdout, err = process.stderr) {
  const unknown = argv.filter((a) => a !== "--check")
  if (unknown.length) {
    err.write(`gen:units: unknown argument ${unknown[0]} (usage: npm run gen:units [-- --check])\n`)
    return 2
  }
  const check = argv.includes("--check")
  const result = await generate({ root })
  if (result.errors.length) {
    err.write(`gen:units: ${result.errors.length} unit manifest problem(s):\n${result.errors.map((e) => `  - ${e}`).join("\n")}\n`)
    return 1
  }
  if (check) {
    const stale = staleFiles(root, result)
    if (stale.length) {
      err.write(`gen:units: DRIFT — ${stale.length} generated file(s) are stale:\n${stale.map((p) => `  - ${p}`).join("\n")}\nrun npm run gen:units and commit the result\n`)
      return 1
    }
    out.write(`gen:units: no drift (${result.outputs.size} generated file(s))\n`)
    return 0
  }
  writeOutputs(root, result)
  out.write(`gen:units: wrote ${result.outputs.size} file(s), removed ${result.orphans.length} orphan(s)\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main()
}
