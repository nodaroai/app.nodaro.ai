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
// registryChecks: [{ project, url, check }] — the registry-check-<project>.json
// files an AFFECTED run (the main selector enforcing) left in its selection
// artifacts; shadow runs carry theirs inside the shadow data.
export function aggregateShadow(runs, registryChecks = []) {
  const misses = []
  const unattributed = []
  const crashed = []
  const missing = []
  const errors = []
  const selectionErrors = []
  const shares = { frontend: [], backend: [] }
  // The registry rule's own shadow period (registry.mjs): its misses are
  // reported apart and never decide `clean` — that is the main selector's bar.
  const registryMisses = []
  let registryChecked = 0
  for (const run of runs) {
    for (const project of run.expected ?? []) {
      if (!run.projects?.[project]) missing.push({ project, url: run.url, ...(run.baseUnknown && { baseUnknown: true }) })
    }
    for (const project of PROJECTS) {
      const entry = run.projects?.[project]
      if (!entry) continue
      if (entry.error || !entry.shadow) {
        errors.push({ project, url: run.url, error: entry.error ?? `shadow-${project}.json missing from the artifact` })
        // a sharded entry keeps the other shards' data: their misses still count
        if (!entry.shadow) continue
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
      // Only a run where the rule's selection differs from the main one says anything about the rule.
      if (Array.isArray(shadow.registryMisses) && shadow.registryDiffers) {
        registryChecked++
        for (const file of shadow.registryMisses) registryMisses.push({ project, file, url: run.url })
      }
      const total = selection?.total
      if (shadow.wouldRun === "full") shares[project].push(1)
      else if (shadow.wouldRun === "none") shares[project].push(0)
      else if (shadow.wouldRun === "affected" && Number.isFinite(total) && total > 0) shares[project].push(shadow.selected / total)
    }
  }
  // One per run and project, like shadow mode (each shard leaves its own check).
  const byRun = new Map()
  for (const { project, url, check } of registryChecks) {
    if (!check?.registryDiffers || !Array.isArray(check.registryMisses)) continue
    const key = `${url}\t${project}`
    if (!byRun.has(key)) byRun.set(key, { project, url, files: new Set() })
    for (const file of check.registryMisses) byRun.get(key).files.add(file)
  }
  for (const { project, url, files } of byRun.values()) {
    registryChecked++
    for (const file of [...files].sort()) registryMisses.push({ project, file, url })
  }
  const clean = runs.length > 0 && ![misses, unattributed, crashed, missing, errors].some((l) => l.length)
  return {
    runsChecked: runs.length, misses, unattributed, crashed, missing, errors, selectionErrors, clean,
    registry: { checked: registryChecked, misses: registryMisses, clean: registryChecked > 0 && registryMisses.length === 0 },
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

// Each test job runs in shards (decided 2026-10-14), each leaving its own
// shadow-<project>-<shard> artifact; a run from before sharding left one
// shadow-<project>. parts: [{ shard (null when unsharded), shadow, selection,
// error?, selectionError? }]; expectedShards: the shard numbers whose job
// finished. One project's entry in the shape aggregateShadow reads: misses
// and failures are the union, a crash / unattributed failure / error in any
// shard is the project's, and a shard that finished without shadow data is
// an error — never a smaller suite.
// conclusions: { [job name]: conclusion }. A project's shadow data is expected
// when one of its shard jobs ("Frontend Tests (2/4)") finished — success or
// failure; skipped (the Diff Gate) and cancelled (superseded) are not. The
// fan-in job of the same plain name passes on a skipped suite, so it says
// nothing here; it counts only in a run from before sharding (no shard job).
export function expectedFromJobs(conclusions) {
  const finished = (c) => ["success", "failure"].includes(c)
  const expected = []
  const expectedShards = {}
  for (const [project, job] of Object.entries(JOBS)) {
    // A skipped matrix job keeps its unexpanded name, "Frontend Tests (${{ matrix.shard }}/4)".
    const shards = Object.entries(conclusions).filter(([name]) => name.startsWith(`${job} (`))
    expectedShards[project] = shards.filter(([, c]) => finished(c))
      .map(([name]) => Number(name.slice(job.length + 2).split("/")[0])).filter(Number.isInteger)
    const isExpected = shards.length ? expectedShards[project].length > 0 : finished(conclusions[job])
    if (isExpected) expected.push(project)
  }
  return { expected, expectedShards }
}

export function mergeShardEntries(parts, expectedShards = []) {
  const errors = []
  const have = new Set(parts.map((p) => p.shard))
  const lost = expectedShards.filter((n) => !have.has(n))
  if (lost.length) errors.push(`no shadow data from shard ${lost.join(", ")}`)
  for (const p of parts) {
    if (p.error) errors.push(p.error)
    else if (!p.shadow) errors.push(`shard ${p.shard ?? "?"}: shadow JSON missing from the artifact`)
  }
  const shadows = parts.map((p) => p.shadow).filter(Boolean)
  const selectionPart = parts.find((p) => p.selection) ?? parts.find((p) => p.selectionError)
  const out = { selection: selectionPart?.selection ?? null, ...(selectionPart?.selectionError && !selectionPart.selection && { selectionError: selectionPart.selectionError }) }
  const crashedShadow = shadows.find((x) => x.crashed)
  if (crashedShadow) return { ...out, shadow: crashedShadow }
  if (new Set(shadows.map((x) => x.wouldRun)).size > 1) errors.push("the shards disagree on what the selector would have run")
  const union = (key) => [...new Set(shadows.flatMap((x) => x[key] ?? []))].sort()
  const shadowError = shadows.find((x) => x.error)?.error
  return {
    ...out,
    shadow: {
      ...shadows[0],
      failed: union("failed"),
      misses: union("misses"),
      ...(shadows.some((x) => Array.isArray(x.registryMisses)) && { registryMisses: union("registryMisses"), registryDiffers: shadows.some((x) => x.registryDiffers) }),
      ...(shadows.some((x) => x.unattributed) && { unattributed: true }),
      ...(shadowError && { error: shadowError }),
    },
    // the other shards' misses stay listed; the project is still not clean
    ...(errors.length && { error: errors.join("; ") }),
  }
}

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
  const registryChecks = []
  const listed = lines.split("\n").filter(Boolean)
  for (const line of listed) {
    const [id, url, headSha, bases = ""] = line.split("\t")
    const artifacts = gh("api", `repos/${repo}/actions/runs/${id}/artifacts?per_page=100`, "--jq", ".artifacts[] | select(.expired | not) | .name").split("\n")
    const names = artifacts.filter((n) => /^shadow-(frontend|backend)(-\d+)?$/.test(n))
    // An affected run (the main selector enforcing) checks the registry rule
    // after it ran; the result rides in its selection artifact.
    for (const name of artifacts.filter((n) => /^selection-(frontend|backend)(-\d+)?$/.test(n))) {
      const project = name.match(/^selection-(frontend|backend)/)[1]
      const out = path.join(dir, id, name)
      try {
        gh("run", "download", id, "--repo", repo, "--name", name, "--dir", out)
        const check = readJson(path.join(out, `registry-check-${project}.json`))
        if (check) registryChecks.push({ project, url, check })
      } catch { /* the selection artifact itself is the main report's concern */ }
    }
    // A test job that finished (success or failure) in a shadow run must have
    // left shadow data; skipped (the Diff Gate) and cancelled (superseded)
    // jobs are not expected to.
    const conclusions = Object.fromEntries(gh("api", `repos/${repo}/actions/runs/${id}/jobs?per_page=100`, "--jq", ".jobs[] | [.name, (.conclusion // \"\")] | @tsv")
      .split("\n").filter(Boolean).map((l) => l.split("\t")))
    const { expected, expectedShards } = expectedFromJobs(conclusions)
    // The base matters only for a run without shadow artifacts.
    const base = names.length ? "dev"
      : resolveBase({ listedBases: bases.split(",").filter(Boolean), headSha, pulls: expected.length ? pullsFor(headSha) : [] })
    if (!shadowExpected({ base, hasArtifacts: names.length > 0, expected })) continue
    const parts = { frontend: [], backend: [] }
    for (const name of names) {
      const [, project, shardText] = name.match(/^shadow-(frontend|backend)(?:-(\d+))?$/)
      const part = { shard: shardText ? Number(shardText) : null }
      parts[project].push(part)
      const out = path.join(dir, id, name)
      const why = (err) => String(err.message).split("\n")[0]
      try {
        gh("run", "download", id, "--repo", repo, "--name", name, "--dir", out)
        part.shadow = readJson(path.join(out, `shadow-${project}.json`))
      } catch (err) {
        // an artifact that cannot be read is an error in the report, never skipped
        part.error = `${name}: ${why(err)}`
        continue
      }
      // read apart: a bad selection costs the share, never the shadow result
      try {
        part.selection = readJson(path.join(out, `selection-${project}.json`))
      } catch (err) {
        part.selection = null
        part.selectionError = why(err)
      }
    }
    const projects = {}
    for (const [project, list] of Object.entries(parts)) {
      if (list.length) projects[project] = mergeShardEntries(list, list.some((p) => p.shard !== null) ? expectedShards[project] : [])
    }
    runs.push({ url, expected, projects, ...(base === "unknown" && { baseUnknown: true }) })
  }
  return { listed: listed.length, runs, registryChecks }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: o } = parseArgs({ options: { since: { type: "string" }, repo: { type: "string" } } })
  if (!o.since || Number.isNaN(Date.parse(o.since))) {
    process.stderr.write("usage: shadow-report.mjs --since <ISO date> [--repo owner/name]\n")
    process.exit(2)
  }
  const repo = o.repo ?? gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner")
  const { listed, runs, registryChecks } = collectRuns({ repo, since: o.since })
  const report = aggregateShadow(runs, registryChecks)
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
    `Registry rule (TEST_SELECT_REGISTRY_RULE, its own shadow period — not part of Clean): ${report.registry.checked} project run(s) where its selection differed, ${report.registry.misses.length} miss(es)`,
    ...report.registry.misses.map((m) => `  - ${m.project}: ${m.file}  ${m.url}`),
  ]
  process.stdout.write(`${out.join("\n")}\n`)
}
