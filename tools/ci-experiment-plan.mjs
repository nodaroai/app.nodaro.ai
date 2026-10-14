#!/usr/bin/env node
// Capacity experiment (.github/workflows/ci-capacity-experiment.yml): the plan,
// the per-cell record and the summary table, kept here so they are testable.
//
//   node tools/ci-experiment-plan.mjs plan [config]   matrix + runner from tools/ci-experiment.json
//   node tools/ci-experiment-plan.mjs cell <out.json> one cell's measurements (env + vitest output)
//   node tools/ci-experiment-plan.mjs summary <dir>   markdown table over every cell JSON under <dir>
//
// `summary` also works offline: download the `capacity-cell-*` artifacts of
// several runs into one directory and it groups them by configuration.
// Built-ins only — this runs before `npm ci`.

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { availableParallelism, totalmem } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { stripVTControlCharacters } from "node:util"

export const CONFIG_PATH = "tools/ci-experiment.json"
export const PROJECTS = ["frontend", "backend"]
// maxCells is the cost cap: every cell is a separately billed runner, so a run
// larger than 32 cells has to say so explicitly. maxParallel bounds how many
// cells hold a runner at once (on the shared pool they compete with PR CI).
export const DEFAULTS = Object.freeze({
  runsOn: "ubuntu-latest", workers: "auto", shards: 1, projects: PROJECTS, repeat: 1, maxCells: 32, maxParallel: 4,
})
// GitHub refuses a matrix of more than 256 jobs; no maxCells may exceed it.
export const MATRIX_LIMIT = 256
const KEYS = Object.keys(DEFAULTS)

const isPositiveInt = v => Number.isInteger(v) && v >= 1

/** Parse and validate the experiment file. Throws an Error naming the field. */
export function parseConfig(text, source = CONFIG_PATH) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error(`${source} is not valid JSON: ${err.message}`)
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${source} must be a JSON object`)
  const unknown = Object.keys(raw).filter(k => !KEYS.includes(k))
  if (unknown.length) throw new Error(`${source}: unknown field(s) ${unknown.join(", ")} (allowed: ${KEYS.join(", ")})`)
  const config = { ...DEFAULTS, ...raw }

  const { runsOn, workers, shards, projects, repeat, maxCells, maxParallel } = config
  const label = v => typeof v === "string" && v.trim() !== ""
  if (!(label(runsOn) || (Array.isArray(runsOn) && runsOn.length > 0 && runsOn.every(label)))) {
    throw new Error(`${source}: runsOn must be a runner label or a non-empty array of labels`)
  }
  if (!(workers === "auto" || isPositiveInt(workers))) throw new Error(`${source}: workers must be "auto" or an integer >= 1`)
  if (!isPositiveInt(shards)) throw new Error(`${source}: shards must be an integer >= 1`)
  if (!isPositiveInt(repeat)) throw new Error(`${source}: repeat must be an integer >= 1`)
  if (!Array.isArray(projects) || projects.length === 0 || projects.some(p => !PROJECTS.includes(p))
    || new Set(projects).size !== projects.length) {
    throw new Error(`${source}: projects must be a non-empty list of distinct values from ${PROJECTS.join(", ")}`)
  }
  if (!(isPositiveInt(maxCells) && maxCells <= MATRIX_LIMIT)) throw new Error(`${source}: maxCells must be an integer from 1 to ${MATRIX_LIMIT}`)
  if (!isPositiveInt(maxParallel)) throw new Error(`${source}: maxParallel must be an integer >= 1`)
  const cells = projects.length * shards * repeat
  if (cells > maxCells) {
    throw new Error(`${source}: ${cells} cells (projects × shards × repeat) exceeds maxCells ${maxCells}`
      + ` — every cell is a billed runner; raise "maxCells" (at most ${MATRIX_LIMIT}) to allow it`)
  }
  return { runsOn, workers, shards, projects: [...projects], repeat, maxCells, maxParallel }
}

/** One matrix entry per project × shard × repeat. */
export function buildMatrix(config) {
  const include = []
  for (const project of config.projects) {
    for (let repeat = 1; repeat <= config.repeat; repeat++) {
      for (let shard = 1; shard <= config.shards; shard++) include.push({ project, shard, repeat })
    }
  }
  return { include }
}

/** The plan job's outputs, each a single line (GITHUB_OUTPUT). */
export function planOutputs(config) {
  return {
    runsOn: JSON.stringify(config.runsOn),
    runsOnLabel: runsOnLabel(config.runsOn),
    matrix: JSON.stringify(buildMatrix(config)),
    workers: String(config.workers),
    shards: String(config.shards),
    repeat: String(config.repeat),
    maxParallel: String(config.maxParallel),
    cells: String(config.projects.length * config.shards * config.repeat),
    expected: JSON.stringify(Object.fromEntries(config.projects.map(p => [p, config.shards * config.repeat]))),
  }
}

export const runsOnLabel = runsOn => (Array.isArray(runsOn) ? runsOn.join(",") : runsOn)

const toSeconds = (value, unit) => (unit === "ms" ? Number(value) / 1000 : Number(value))

/** Vitest's "Duration  12.34s (transform 1.20s, setup 345ms, import …, tests …, environment …)". */
export function parseVitestDuration(log) {
  const lines = stripVTControlCharacters(log).split("\n").filter(l => /^\s*Duration\s/.test(l))
  const line = lines.at(-1)
  if (!line) return null
  const head = line.match(/Duration\s+([\d.]+)(ms|s)\b/)
  if (!head) return null
  const phases = {}
  const inner = line.match(/\(([^)]*)\)/)
  for (const part of inner ? inner[1].split(",") : []) {
    const m = part.trim().match(/^([a-z]+)\s+([\d.]+)(ms|s)$/)
    if (m) phases[m[1]] = toSeconds(m[2], m[3])
  }
  return { vitestDurationSeconds: toSeconds(head[1], head[2]), phases }
}

/** bash `times` prints the shell's and then its children's "user sys", e.g. "1m2.500s 0m4.250s". */
export function parseTimes(text) {
  const lines = String(text ?? "").trim().split("\n").filter(Boolean)
  const children = lines.at(-1)?.trim().split(/\s+/)
  if (!children || children.length !== 2) return null
  const secs = t => {
    const m = t.match(/^(\d+)m([\d.]+)s$/)
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
  }
  const [user, sys] = children.map(secs)
  return Number.isFinite(user) && Number.isFinite(sys) ? { user, sys } : null
}

const readText = path => {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}
const num = v => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v))

/** Assemble one cell's record from the step's environment, vitest's log and its JSON report. */
export function buildCell(env, { log, report, cpuMax }) {
  const timing = parseVitestDuration(log ?? "")
  const cpu = parseTimes(env.CAPACITY_TIMES)
  const files = Array.isArray(report?.testResults) ? report.testResults : null
  const exitCode = num(env.CAPACITY_EXIT_CODE)
  const stage = env.CAPACITY_STAGE === "setup" ? "setup" : "tests"
  return {
    runId: env.GITHUB_RUN_ID ?? null,
    runAttempt: num(env.GITHUB_RUN_ATTEMPT),
    stage, // "setup" = checkout / ffmpeg / npm ci / package build failed; vitest never ran
    failedStep: stage === "setup" ? env.CAPACITY_FAILED_STEP || "setup" : null,
    project: env.CAPACITY_PROJECT,
    shard: num(env.CAPACITY_SHARD),
    shards: num(env.CAPACITY_SHARDS),
    repeat: num(env.CAPACITY_REPEAT),
    runsOn: env.CAPACITY_RUNS_ON,
    runner: env.RUNNER_NAME ?? null,
    runnerEnvironment: env.RUNNER_ENVIRONMENT ?? null,
    nproc: num(env.CAPACITY_NPROC),
    availableParallelism: availableParallelism(),
    cpuMax: cpuMax?.trim() || null,
    memMB: Math.round(totalmem() / 2 ** 20),
    workers: env.CAPACITY_WORKERS, // requested: "auto" or an integer
    effectiveMaxWorkers: env.CAPACITY_EFFECTIVE_WORKERS || "vitest default",
    wallSeconds: num(env.CAPACITY_WALL_MS) === null ? null : num(env.CAPACITY_WALL_MS) / 1000,
    setupSeconds: num(env.CAPACITY_SETUP_MS) === null ? null : num(env.CAPACITY_SETUP_MS) / 1000,
    cpuSeconds: cpu ? +(cpu.user + cpu.sys).toFixed(2) : null,
    peakMemMB: num(env.CAPACITY_PEAK_BYTES) === null ? null : Math.round(num(env.CAPACITY_PEAK_BYTES) / 2 ** 20),
    peakMemSource: env.CAPACITY_PEAK_SOURCE || null,
    vitestDuration: timing?.vitestDurationSeconds ?? null,
    phases: timing?.phases ?? {},
    exitCode,
    passed: num(report?.numPassedTests),
    failed: num(report?.numFailedTests),
    files: files ? files.length : null,
    ok: stage === "tests" && exitCode === 0 && num(report?.numFailedTests) === 0,
  }
}

export const median = values => {
  const v = values.filter(x => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = v.length >> 1
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}
const sum = values => values.reduce((a, b) => a + (b ?? 0), 0)
const fmt = (v, digits = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(digits))
const distinct = values => [...new Set(values.map(v => (v === null || v === undefined ? "–" : String(v))))].join(" / ")

/**
 * Group cells by configuration and compute, per group, over COMPLETE repeats only
 * (every shard present and ok — a timed-out shard uploads nothing and an early
 * crash is short, so a partial repeat would understate the critical path):
 *   - shard wall (median of those cells' vitest wall),
 *   - critical path = the slowest shard of each repeat (what a run waits for), median and range,
 *   - runner-seconds = the shards' vitest walls summed per repeat (median), and the same including setup,
 *   - CPU-seconds = user+sys of vitest and its workers summed per repeat (median).
 * A repeat is keyed by (runId, runAttempt, repeat), so cells downloaded from
 * several runs aggregate as separate repeats, and a re-run attempt never
 * completes a repeat with the first attempt's shards.
 * `expected` = { [project]: cell count } from the plan; a shortfall is reported as missing.
 */
export function summarize(cells, expected = {}) {
  const groups = new Map()
  for (const cell of cells) {
    const key = [cell.project, cell.runsOn, cell.workers, cell.shards].join("|")
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(cell)
  }
  const rows = [...groups.values()].map(group => {
    const byRepeat = new Map()
    for (const c of group) {
      const key = [c.runId ?? "", c.runAttempt ?? "", c.repeat].join("|")
      byRepeat.set(key, [...(byRepeat.get(key) ?? []), c])
    }
    const first = group[0]
    const repeats = [...byRepeat.values()].filter(r =>
      new Set(r.map(c => c.shard)).size === first.shards && r.every(c => c.ok && Number.isFinite(c.wallSeconds)))
    const complete = repeats.flat()
    const critical = repeats.map(r => Math.max(...r.map(c => c.wallSeconds)))
    const expectedRepeats = expected[first.project] && first.shards ? Math.floor(expected[first.project] / first.shards) : 0
    return {
      project: first.project,
      runsOn: first.runsOn,
      workers: first.workers,
      effectiveMaxWorkers: distinct(group.map(c => c.effectiveMaxWorkers)),
      shards: first.shards,
      completeRepeats: repeats.length,
      repeats: Math.max(byRepeat.size, expectedRepeats),
      cells: group.length,
      nproc: distinct(group.map(c => c.nproc)),
      cpuMax: distinct(group.map(c => c.cpuMax)),
      memMB: distinct(group.map(c => c.memMB)),
      shardWallMedian: median(complete.map(c => c.wallSeconds)),
      criticalPathMedian: median(critical),
      criticalPathMin: critical.length ? Math.min(...critical) : null,
      criticalPathMax: critical.length ? Math.max(...critical) : null,
      runnerSecondsTests: median(repeats.map(r => sum(r.map(c => c.wallSeconds)))),
      runnerSecondsWithSetup: median(repeats.map(r => sum(r.map(c => (c.wallSeconds ?? 0) + (c.setupSeconds ?? 0))))),
      cpuSeconds: median(repeats.map(r => sum(r.map(c => c.cpuSeconds)))),
      peakMemMB: Math.max(0, ...group.map(c => c.peakMemMB ?? 0)) || null, // every cell: an OOM is the point
      files: median(repeats.map(r => sum(r.map(c => c.files)))),
      failedCells: group.filter(c => !c.ok).length,
    }
  })
  const missing = Object.entries(expected)
    .map(([project, count]) => ({ project, missing: count - cells.filter(c => c.project === project).length }))
    .filter(m => m.missing > 0)
  return { rows, missing, failed: cells.filter(c => !c.ok) }
}

export function renderMarkdown(cells, expected = {}) {
  const { rows, missing, failed } = summarize(cells, expected)
  const out = ["## Capacity experiment", ""]
  if (!cells.length) out.push("**No cell results were found.**", "")
  if (rows.length) {
    out.push(
      "| Project | runs-on | workers (effective) | shards | complete repeats | nproc / cpu.max | shard wall (median s) | critical path s (median, min–max) | runner-s tests | runner-s incl. setup | CPU-s | peak mem MB | files | failed cells |",
      "|---|---|---|---:|---:|---|---:|---|---:|---:|---:|---:|---:|---:|",
    )
    for (const r of rows) {
      out.push(`| ${r.project} | \`${r.runsOn}\` | ${r.workers} (${r.effectiveMaxWorkers}) | ${r.shards} | ${r.completeRepeats}/${r.repeats} | ${r.nproc} / ${r.cpuMax} | ${fmt(r.shardWallMedian)} | ${fmt(r.criticalPathMedian)} (${fmt(r.criticalPathMin)}–${fmt(r.criticalPathMax)}) | ${fmt(r.runnerSecondsTests)} | ${fmt(r.runnerSecondsWithSetup)} | ${fmt(r.cpuSeconds)} | ${fmt(r.peakMemMB)} | ${fmt(r.files)} | ${r.failedCells ? `**${r.failedCells}**` : 0} |`)
    }
    out.push(
      "",
      "Timing columns use complete repeats only (every shard present and passing); peak memory and failures count every cell. Critical path = the slowest shard of a repeat (what a run waits for). Runner-s = shards' vitest wall summed per repeat (billable test time); incl. setup adds install + package build per shard. CPU-s = user+sys of vitest and its workers.",
      "",
    )
  }
  for (const m of missing) out.push(`**Missing:** ${m.missing} ${m.project} cell(s) produced no result (cancelled, timed out or never started).`)
  const where = c => `${c.project} shard ${c.shard}/${c.shards} repeat ${c.repeat}${c.runId ? ` (run ${c.runId}#${c.runAttempt ?? 1})` : ""} on ${c.runner ?? "?"}`
  for (const c of failed) {
    out.push(c.stage === "setup"
      ? `**Setup failed:** ${where(c)} — at ${c.failedStep ?? "setup"}; vitest never ran.`
      : `**Failed cell:** ${where(c)} — exit ${c.exitCode ?? "?"}, ${c.failed ?? "?"} failed test(s).`)
  }
  if (missing.length || failed.length) out.push("")
  if (cells.length) {
    out.push(
      "<details><summary>Per cell</summary>", "",
      "| Project | run | shard | repeat | runner | nproc | wall s | vitest s | import s | tests s | environment s | setup s | CPU-s | peak MB | files | ok |",
      "|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    )
    const sorted = [...cells].sort((a, b) => a.project.localeCompare(b.project) || String(a.runId ?? "").localeCompare(String(b.runId ?? ""))
      || (a.runAttempt ?? 0) - (b.runAttempt ?? 0) || a.repeat - b.repeat || a.shard - b.shard)
    for (const c of sorted) {
      out.push(`| ${c.project} | ${c.runId ? `${c.runId}#${c.runAttempt ?? 1}` : "–"} | ${c.shard}/${c.shards} | ${c.repeat} | ${c.runner ?? "–"} | ${c.nproc ?? "–"} | ${fmt(c.wallSeconds, 1)} | ${fmt(c.vitestDuration, 1)} | ${fmt(c.phases.import, 1)} | ${fmt(c.phases.tests, 1)} | ${fmt(c.phases.environment, 1)} | ${fmt(c.setupSeconds, 1)} | ${fmt(c.cpuSeconds, 1)} | ${fmt(c.peakMemMB)} | ${c.files ?? "–"} | ${c.ok ? "yes" : c.stage === "setup" ? "**setup failed**" : "**no**"} |`)
    }
    out.push("", "</details>", "")
  }
  return out.join("\n")
}

const findJson = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  if (statSync(path).isDirectory()) return findJson(path)
  return name.endsWith(".json") ? [path] : []
})

function main([command, arg]) {
  if (command === "plan") {
    const source = arg ?? CONFIG_PATH
    const outputs = planOutputs(parseConfig(readFileSync(source, "utf8"), source))
    const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join("\n") + "\n"
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines)
    process.stdout.write(lines)
    return
  }
  if (command === "cell") {
    if (!arg) throw new Error("usage: cell <out.json>")
    const reportText = readText(process.env.CAPACITY_REPORT ?? "")
    let report = null
    try {
      report = reportText ? JSON.parse(reportText) : null
    } catch {
      report = null
    }
    const cell = buildCell(process.env, {
      log: readText(process.env.CAPACITY_LOG ?? "") ?? "",
      report,
      cpuMax: readText("/sys/fs/cgroup/cpu.max"),
    })
    writeFileSync(arg, JSON.stringify(cell, null, 2) + "\n")
    process.stdout.write(JSON.stringify(cell, null, 2) + "\n")
    return
  }
  if (command === "summary") {
    if (!arg) throw new Error("usage: summary <dir>")
    const cells = existsSync(arg)
      ? findJson(arg).map(p => JSON.parse(readFileSync(p, "utf8"))).filter(c => c && typeof c.project === "string")
      : []
    const expected = process.env.CAPACITY_EXPECTED ? JSON.parse(process.env.CAPACITY_EXPECTED) : {}
    const markdown = renderMarkdown(cells, expected)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n")
    process.stdout.write(markdown + "\n")
    if (process.env.CAPACITY_SUMMARY_JSON) {
      writeFileSync(process.env.CAPACITY_SUMMARY_JSON, JSON.stringify({ ...summarize(cells, expected), cells }, null, 2) + "\n")
    }
    return
  }
  throw new Error("usage: ci-experiment-plan.mjs plan [config] | cell <out.json> | summary <dir>")
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`ci-experiment-plan: ${err.message}\n`)
    process.exit(1)
  }
}
