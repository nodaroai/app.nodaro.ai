#!/usr/bin/env node
// tools/test-select/shadow-report.mjs
// The evidence for flipping TEST_SELECT_ENFORCE=true: across the shadow-mode
// CI runs of PRs into dev since a date, every selector miss (a failing test
// file the selection would have skipped) and the median share of each suite
// the selector would have run. A local, owner-run tool — not run in CI.
//   node tools/test-select/shadow-report.mjs --since 2026-10-13 [--repo owner/name]
// Needs an authenticated `gh` (GH_TOKEN works too).
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const PROJECTS = ["frontend", "backend"]

function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// runs: [{ url, expected?, projects: { frontend?: { shadow, selection, error?, selectionError? }, backend?: … } }]
// shadow = shadow-<project>.json, selection = selection-<project>.json (its
// `total` is the suite size); error = the artifact could not be read;
// selectionError = only the selection could not be read (the share is lost,
// the shadow result stands); expected = the projects whose test job ran.
// Everything that could hide a miss blocks `clean` — the bar for enforcing:
// a miss, an unattributed failure (failed with no failing file, or with an
// unhandled error), a crashed selector, a project whose job ran but left no
// shadow data, a check that errored. `clean` also needs one checked run.
export function aggregateShadow(runs) {
  const misses = []
  const unattributed = []
  const crashed = []
  const missing = []
  const errors = []
  const selectionErrors = []
  const shares = { frontend: [], backend: [] }
  for (const run of runs) {
    for (const project of run.expected ?? []) {
      if (!run.projects?.[project]) missing.push({ project, url: run.url, ...(run.baseUnknown && { baseUnknown: true }) })
    }
    for (const project of PROJECTS) {
      const entry = run.projects?.[project]
      if (!entry) continue
      if (entry.error || !entry.shadow) {
        errors.push({ project, url: run.url, error: entry.error ?? `shadow-${project}.json missing from the artifact` })
        continue
      }
      const { shadow, selection } = entry
      if (entry.selectionError) selectionErrors.push({ project, url: run.url, error: entry.selectionError })
      if (shadow.crashed) {
        crashed.push({ project, url: run.url, error: shadow.error ?? "selector crashed" })
        continue
      }
      if (shadow.unattributed) unattributed.push({ project, url: run.url })
      if (shadow.error) {
        errors.push({ project, url: run.url, error: shadow.error })
        continue
      }
      for (const file of shadow.misses ?? []) misses.push({ project, file, url: run.url })
      const total = selection?.total
      if (shadow.wouldRun === "full") shares[project].push(1)
      else if (shadow.wouldRun === "none") shares[project].push(0)
      else if (shadow.wouldRun === "affected" && Number.isFinite(total) && total > 0) shares[project].push(shadow.selected / total)
    }
  }
  const clean = runs.length > 0 && ![misses, unattributed, crashed, missing, errors].some((l) => l.length)
  return {
    runsChecked: runs.length, misses, unattributed, crashed, missing, errors, selectionErrors, clean,
    medianShare: { frontend: median(shares.frontend), backend: median(shares.backend) },
  }
}

// Which branch a pull_request run's PR targets: "dev", "other" or "unknown".
// GitHub fills a run's pull_requests only while the PR is OPEN (run
// 38439712814 of PR #2168, merged into dev, lists none), so a merged PR is
// found through the commit's pulls (`pulls`: that list, null when the lookup
// failed): the PR whose head is this run's head sha, else any PR into dev.
export function resolveBase({ listedBases, headSha, pulls }) {
  if (listedBases.length) return listedBases.includes("dev") ? "dev" : "other"
  if (!pulls) return "unknown"
  const own = pulls.filter((pr) => pr.head?.sha === headSha)
  if (own.length) return own.some((pr) => pr.base?.ref === "dev") ? "dev" : "other"
  return pulls.some((pr) => pr.base?.ref === "dev") ? "dev" : "unknown"
}

// Whether a run must be checked for shadow data. Only a run PROVABLY not into
// dev may be skipped; an unknown base fails closed. A run where no test job
// finished (both skipped by the Diff Gate, or cancelled) has nothing to miss.
export function shadowExpected({ base, hasArtifacts, expected }) {
  if (hasArtifacts) return true
  return base !== "other" && expected.length > 0
}

function gh(...args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 << 20 }).trim()
}

// Missing → null; present but unreadable → throws, so the caller reports it.
function readJson(file) {
  let text
  try { text = readFileSync(file, "utf8") } catch { return null }
  try { return JSON.parse(text) } catch (err) { throw new Error(`${path.basename(file)}: ${String(err.message).split("\n")[0]}`) }
}

const JOBS = { frontend: "Frontend Tests", backend: "Backend Tests" }

// Shadow mode is PRs into dev, so --since must not reach back before shadow
// mode reached dev: an older PR run into dev would be reported as missing data.
function collectRuns({ repo, since }) {
  const lines = gh("api", "--paginate",
    `repos/${repo}/actions/workflows/ci.yml/runs?event=pull_request&created=>=${since}&per_page=100`,
    "--jq", '.workflow_runs[] | [.id, .html_url, .head_sha, ([.pull_requests[].base.ref] | join(","))] | @tsv')
  const pullsBySha = new Map() // one lookup per head sha
  const pullsFor = (sha) => {
    if (!pullsBySha.has(sha)) {
      let pulls = null
      try {
        pulls = JSON.parse(gh("api", `repos/${repo}/commits/${sha}/pulls?per_page=100`))
      } catch { /* unknown → fails closed */ }
      pullsBySha.set(sha, Array.isArray(pulls) ? pulls : null)
    }
    return pullsBySha.get(sha)
  }
  const dir = mkdtempSync(path.join(tmpdir(), "shadow-report-"))
  const runs = []
  const listed = lines.split("\n").filter(Boolean)
  for (const line of listed) {
    const [id, url, headSha, bases = ""] = line.split("\t")
    const names = gh("api", `repos/${repo}/actions/runs/${id}/artifacts?per_page=100`, "--jq", ".artifacts[] | select(.expired | not) | .name")
      .split("\n").filter((n) => /^shadow-(frontend|backend)$/.test(n))
    // A test job that finished (success or failure) in a shadow run must have
    // left shadow data; skipped (the Diff Gate) and cancelled (superseded)
    // jobs are not expected to.
    const conclusions = Object.fromEntries(gh("api", `repos/${repo}/actions/runs/${id}/jobs?per_page=100`, "--jq", ".jobs[] | [.name, (.conclusion // \"\")] | @tsv")
      .split("\n").filter(Boolean).map((l) => l.split("\t")))
    const expected = Object.entries(JOBS).filter(([, job]) => ["success", "failure"].includes(conclusions[job])).map(([p]) => p)
    // The base matters only for a run without shadow artifacts.
    const base = names.length ? "dev"
      : resolveBase({ listedBases: bases.split(",").filter(Boolean), headSha, pulls: expected.length ? pullsFor(headSha) : [] })
    if (!shadowExpected({ base, hasArtifacts: names.length > 0, expected })) continue
    const projects = {}
    for (const name of names) {
      const project = name.slice("shadow-".length)
      const out = path.join(dir, id, name)
      const why = (err) => String(err.message).split("\n")[0]
      try {
        gh("run", "download", id, "--repo", repo, "--name", name, "--dir", out)
        projects[project] = { shadow: readJson(path.join(out, `shadow-${project}.json`)) }
      } catch (err) {
        // an artifact that cannot be read is an error in the report, never skipped
        projects[project] = { error: `${name}: ${why(err)}` }
        continue
      }
      // read apart: a bad selection costs the share, never the shadow result
      try {
        projects[project].selection = readJson(path.join(out, `selection-${project}.json`))
      } catch (err) {
        projects[project].selection = null
        projects[project].selectionError = why(err)
      }
    }
    runs.push({ url, expected, projects, ...(base === "unknown" && { baseUnknown: true }) })
  }
  return { listed: listed.length, runs }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: o } = parseArgs({ options: { since: { type: "string" }, repo: { type: "string" } } })
  if (!o.since || Number.isNaN(Date.parse(o.since))) {
    process.stderr.write("usage: shadow-report.mjs --since <ISO date> [--repo owner/name]\n")
    process.exit(2)
  }
  const repo = o.repo ?? gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner")
  const { listed, runs } = collectRuns({ repo, since: o.since })
  const report = aggregateShadow(runs)
  const pct = (x) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`)
  const out = [
    // both counts, so "no shadow runs" cannot pass for a broken listing
    `PR runs listed since ${o.since}: ${listed}, shadow runs checked: ${report.runsChecked}`,
    `Selector misses: ${report.misses.length}`,
    ...report.misses.map((m) => `  - ${m.project}: ${m.file}  ${m.url}`),
    `Unattributed failures (failed with no failing test file — possible misses): ${report.unattributed.length}`,
    ...report.unattributed.map((u) => `  - ${u.project}: ${u.url}`),
    `Selector crashes (the job fell back to a full run): ${report.crashed.length}`,
    ...report.crashed.map((c) => `  - ${c.project}: ${c.error}  ${c.url}`),
    `Missing shadow data (the test job ran, no shadow artifact): ${report.missing.length}`,
    ...report.missing.map((m) => `  - ${m.project}: ${m.url}${m.baseUnknown ? "  (PR base unknown — counted as missing)" : ""}`),
    `Checks that could not run or be read: ${report.errors.length}`,
    ...report.errors.map((e) => `  - ${e.project}: ${e.error}  ${e.url}`),
    `Selections that could not be read (share unknown, result kept): ${report.selectionErrors.length}`,
    ...report.selectionErrors.map((e) => `  - ${e.project}: ${e.error}  ${e.url}`),
    `Median share the selector would have run — frontend: ${pct(report.medianShare.frontend)}, backend: ${pct(report.medianShare.backend)}`,
    report.clean ? "Clean: no miss, unattributed failure, selector crash, missing shadow data or unreadable check." : "Not clean.",
  ]
  process.stdout.write(`${out.join("\n")}\n`)
}
