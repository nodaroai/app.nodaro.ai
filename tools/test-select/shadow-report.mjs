#!/usr/bin/env node
// tools/test-select/shadow-report.mjs
// The evidence for flipping TEST_SELECT_ENFORCE=true: across the shadow-mode
// CI runs of PRs into dev since a date, every selector miss (a failing test
// file the selection would have skipped), the median share of each suite
// the selector would have run (over every run, and over the runs it narrowed
// only), and which cause sent the other runs full — each global trigger, a
// removal, test data… with example PRs. A local, owner-run tool — not run in CI.
//   node tools/test-select/shadow-report.mjs --since 2026-10-13 [--repo owner/name] [--run <id>]…
// --run limits the report to those runs (still listed from --since) — to re-check one run.
// Needs an authenticated `gh` (GH_TOKEN works too).
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { matchesAny } from "./glob.mjs"
import { GLOBAL_TRIGGERS, NOT_VERSION_ONLY, isGlobalTrigger } from "./select.mjs"

const PROJECTS = ["frontend", "backend"]

// Why a selection ran everything, from its `reason` (select.mjs, engine.mjs):
// the global-trigger glob the named file matches ON THIS BRANCH — or that it
// matches none any more (one cause per file), so these rules would not have
// run everything for it
// — or the other kind of full run. The selector names only the FIRST trigger
// it finds, so this is first-trigger attribution.
export function classifyFullReason(reason) {
  if (typeof reason !== "string") return { cause: "reason unknown (the selection could not be read)" }
  const trigger = /^(.+?) can affect every test(?: — (.+))?$/.exec(reason)
  if (trigger) {
    const file = trigger[1]
    const glob = GLOBAL_TRIGGERS.find((g) => matchesAny(file, [g]))
    // one row per such file: each is a narrowing of its own
    if (!glob || !isGlobalTrigger(file)) return { cause: `no global trigger since 2026-10-18: ${file}`, file }
    // A manifest the selector did not mark as checked was judged before the
    // workspace-range rule (or never checked): it may be a release bump that
    // these rules narrow, so it gets a row apart from a real manifest change.
    const manifest = /(?:^|\/)package(?:-lock)?\.json$/.test(file)
    if (manifest && trigger[2] !== NOT_VERSION_ONLY) return { cause: `global trigger ${glob} (not checked for a version-only change — may be a release bump)`, file }
    return { cause: `global trigger ${glob}`, file }
  }
  const named = (re, cause) => { const m = re.exec(reason); return m && { cause, file: m[1] } }
  return named(/^(.+) was removed or renamed/, "a removed or renamed file")
    ?? named(/^(.+) is a manual mock/, "a manual mock")
    ?? named(/^(.+) is test data read at run time/, "test data")
    ?? (/^the diff lists \d+ files/.test(reason) ? { cause: "a diff too large to list" } : null)
    ?? (/^selection engine could not decide/.test(reason) ? { cause: "the selection engine could not decide" } : null)
    ?? { cause: `other: ${reason}` }
}

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
// bases (optional, per run): { [project]: what the PR's base commit did on its
// own post-merge dev run — { sha, url, failed, flaky, unknown } or
// { sha?, url?, error } } (baseFailures). A miss whose file is in `failed`
// there (failed in dev's full run and again alone) is INHERITED: dev was
// already broken at the commit the PR was tested on, so it says nothing about
// the selector (run 38902459956: #2288 broke library-render-label on dev, #2290
// was tested on top of it and touched nothing the test loads). It is listed
// apart and does not block clean. Anything short of that proof — the base
// unknown, its run missing or unread, the file only flaky or unlabelled there —
// leaves the miss a miss, with a note.
export function aggregateShadow(runs, registryChecks = []) {
  const misses = []
  const inherited = []
  const unattributed = []
  const crashed = []
  const missing = []
  const errors = []
  const selectionErrors = []
  const shares = { frontend: [], backend: [] }
  // runs that did not go full (affected or none) — what the rules narrow to
  const narrowedShares = { frontend: [], backend: [] }
  const fullBy = new Map() // cause → { runs: Set(url), projects, examples }
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
      const base = run.bases?.[project]
      for (const file of shadow.misses ?? []) {
        if (base?.sha && base.failed?.includes(file)) inherited.push({ project, file, url: run.url, base: base.sha, baseUrl: base.url })
        else misses.push({ project, file, url: run.url, ...baseNote(base, file) })
      }
      // Only a run where the rule's selection differs from the main one says anything about the rule.
      if (Array.isArray(shadow.registryMisses) && shadow.registryDiffers) {
        registryChecked++
        for (const file of shadow.registryMisses) registryMisses.push({ project, file, url: run.url })
      }
      const total = selection?.total
      if (shadow.wouldRun === "full") {
        shares[project].push(1)
        const { cause, file } = classifyFullReason(selection?.reason)
        if (!fullBy.has(cause)) fullBy.set(cause, { cause, runs: new Set(), projects: { frontend: 0, backend: 0 }, examples: [] })
        const row = fullBy.get(cause)
        row.projects[project]++
        if (!row.runs.has(run.url)) {
          row.runs.add(run.url)
          // one example per PR (a PR's pushes each leave a run)
          if (run.pr == null || !row.examples.some((e) => e.pr === run.pr)) row.examples.push({ pr: run.pr ?? null, url: run.url, ...(file && { file }) })
        }
      } else if (shadow.wouldRun === "none") {
        shares[project].push(0)
        narrowedShares[project].push(0)
      } else if (shadow.wouldRun === "affected" && Number.isFinite(total) && total > 0) {
        shares[project].push(shadow.selected / total)
        narrowedShares[project].push(shadow.selected / total)
      }
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
  // One row per cause, each run once (whichever of its projects went full), most runs first.
  const fullRuns = new Set([...fullBy.values()].flatMap((r) => [...r.runs]))
  const fullByCause = [...fullBy.values()]
    .map(({ cause, runs: urls, projects, examples }) => ({ cause, runs: urls.size, prs: examples.filter((e) => e.pr != null).length, projects, examples }))
    .sort((a, b) => b.runs - a.runs || a.cause.localeCompare(b.cause))
  return {
    runsChecked: runs.length, misses, inherited, unattributed, crashed, missing, errors, selectionErrors, clean,
    registry: { checked: registryChecked, misses: registryMisses, clean: registryChecked > 0 && registryMisses.length === 0 },
    medianShare: { frontend: median(shares.frontend), backend: median(shares.backend) },
    narrowed: {
      medianShare: { frontend: median(narrowedShares.frontend), backend: median(narrowedShares.backend) },
      runs: { frontend: narrowedShares.frontend.length, backend: narrowedShares.backend.length },
    },
    full: { runs: fullRuns.size, byCause: fullByCause },
  }
}

// Why a miss stays a miss although its base was looked at (none: not looked at).
function baseNote(base, file) {
  if (!base) return {}
  const at = base.sha ? ` ${base.sha.slice(0, 9)}` : ""
  if (base.error) return { baseNote: `base${at} not checked: ${base.error}` }
  if (base.flaky?.includes(file)) return { baseNote: `failed on the base${at}'s dev run too, but passed alone there (labelled flaky): ${base.url}` }
  if (base.unknown?.includes(file)) return { baseNote: `failed on the base${at}'s dev run too; its re-run left no report: ${base.url}` }
  return {}
}

// The base a pull_request job was tested on: actions/checkout logs the merge
// commit it checked out as "HEAD is now at <short> Merge <head> into <base>".
// For runs whose selection JSON predates its `base` field (cli.mjs).
export function baseFromCheckoutLog(log) {
  return /HEAD is now at [0-9a-f]+ Merge [0-9a-f]{40} into ([0-9a-f]{40})\b/.exec(log ?? "")?.[1] ?? null
}

// What the base commit's own post-merge run on dev failed, for one project.
// devRuns: the CI push runs of that commit on dev, newest first ([{ url,
// status, conclusion, artifacts: [names] }]); readLists(artifactName) →
// { failed, flaky, unknown } read from one failed-<project>[-<shard>] artifact
// (throws when it cannot be read). Only a finished run proves anything: no
// run, an unfinished one, a run neither green nor red, a red run with no list
// for the project, or an unreadable list is an `error` — the miss stays.
export function baseFailures({ sha, project, devRuns, readLists }) {
  const done = devRuns.find((r) => r.status === "completed")
  if (!done) return { sha, error: devRuns.length ? "its dev run has not finished" : "no CI run of it on dev" }
  const empty = { sha, url: done.url, failed: [], flaky: [], unknown: [] }
  if (done.conclusion === "success") return empty
  if (done.conclusion !== "failure") return { sha, url: done.url, error: `its dev run ended ${done.conclusion || "without a conclusion"}` }
  const names = (done.artifacts ?? []).filter((n) => new RegExp(`^failed-${project}(-\\d+)?$`).test(n))
  if (!names.length) return { sha, url: done.url, error: `its dev run failed and left no failed-${project} list` }
  const out = { ...empty }
  for (const name of names) {
    let lists
    try { lists = readLists(name) } catch (err) { return { sha, url: done.url, error: `${name}: ${String(err?.message ?? err).split("\n")[0]}` } }
    for (const key of ["failed", "flaky", "unknown"]) out[key] = [...new Set([...out[key], ...(lists[key] ?? [])])].sort()
  }
  return out
}

// Which branch a pull_request run's PR targets: "dev", "other" or "unknown".
// GitHub fills a run's pull_requests only while the PR is OPEN (run
// 38439712814 of PR #2168, merged into dev, lists none), so a merged PR is
// found through the commit's pulls (`pulls`: that list, null when the lookup
// failed): the PR whose head is this run's head sha, else any PR into dev.
// A run whose head is this repository's dev branch is the dev → main release
// PR, never a PR into dev: once merged its run lists no PR, and dev's tip
// commit lists only the feature PR merged into dev, which the fallback would
// take (run 39051029824 of PR #2303 resolved to #2297's base and was reported
// as missing shadow data).
export function resolveBase({ listedBases, headSha, pulls, headBranch = null, sameRepo = false }) {
  if (listedBases.length) return listedBases.includes("dev") ? "dev" : "other"
  if (headBranch === "dev" && sameRepo) return "other"
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

// GitHub's own transient errors (a 5xx) are retried, a few times, with a
// pause: a report reads hundreds of runs over half an hour, and one 502 used to
// end it with nothing printed. Any other failure is the caller's to judge.
export function withRetry(call, { tries = 4, pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return call()
    } catch (err) {
      const transient = /HTTP 5\d\d/.test(`${err?.stderr ?? ""} ${err?.message ?? ""}`)
      if (!transient || attempt >= tries) throw err
      pause(2000 * attempt)
    }
  }
}

function gh(...args) {
  return withRetry(() => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 << 20 })).trim()
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
// testSteps: { [job name]: conclusion of its "Run tests" step }. A shard job
// that failed BEFORE that step (run 38786332886: the pinned-ffmpeg download
// failed, curl exit 22, on shards 2 and 3) ran no test, so it has nothing to
// miss and no shadow data to leave — only a step that was skipped counts so;
// one that ran, failed or was cancelled midway still owes its data.
export function expectedFromJobs(conclusions, testSteps = {}) {
  const finished = (c) => ["success", "failure"].includes(c)
  const expected = []
  const expectedShards = {}
  for (const [project, job] of Object.entries(JOBS)) {
    // A skipped matrix job keeps its unexpanded name, "Frontend Tests (${{ matrix.shard }}/4)".
    const shards = Object.entries(conclusions).filter(([name]) => name.startsWith(`${job} (`))
    expectedShards[project] = shards.filter(([name, c]) => finished(c) && testSteps[name] !== "skipped")
      .map(([name]) => Number(name.slice(job.length + 2).split("/")[0])).filter(Number.isInteger)
    const isExpected = shards.length ? expectedShards[project].length > 0 : finished(conclusions[job])
    if (isExpected) expected.push(project)
  }
  return { expected, expectedShards }
}

// A shard job that did not finish (cancelled — superseded by a newer push — or
// skipped) is not expected to leave shadow data, as expectedFromJobs says; its
// always() upload step still uploads the selection alone. Such an artifact is
// dropped, never read as an error: nothing ran there, so it hides no miss (runs
// 39070714645, 39053728041, 39059853548). A download or parse error, or a
// shard that FINISHED without shadow data, stays an error. Returns null when
// nothing is left — the project then has no entry, and is "missing" only when
// one of its shard jobs finished.
export function mergeShardEntries(allParts, expectedShards = []) {
  const unfinished = (p) => p.shard !== null && !expectedShards.includes(p.shard) && !p.error && !p.shadow
  const parts = allParts.filter((p) => !unfinished(p))
  if (!parts.length) return null
  const errors = []
  const have = new Set(parts.map((p) => p.shard))
  const lost = expectedShards.filter((n) => !have.has(n))
  if (lost.length) errors.push(`no shadow data from shard ${lost.join(", ")}`)
  for (const p of parts) {
    if (p.error) errors.push(p.error)
    else if (!p.shadow) errors.push(`shard ${p.shard ?? "?"}: shadow JSON missing from the artifact`)
  }
  const shadows = parts.map((p) => p.shadow).filter(Boolean)
  const selectionPart = allParts.find((p) => p.selection) ?? allParts.find((p) => p.selectionError)
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

// The base from the checkout log of one of the project's shard jobs that
// finished — for runs whose selection JSON has no `base` yet. Null when none
// can be read.
function baseFromJobLog(repo, jobs, project) {
  for (const [name, conclusion, jobId] of jobs) {
    if (!name.startsWith(JOBS[project]) || !["success", "failure"].includes(conclusion)) continue
    try {
      const sha = baseFromCheckoutLog(gh("api", `repos/${repo}/actions/jobs/${jobId}/logs`, "--allow-escape-sequences"))
      if (sha) return sha
    } catch { /* try the next shard */ }
  }
  return null
}

// Shadow mode is PRs into dev, so --since must not reach back before shadow
// mode reached dev: an older PR run into dev would be reported as missing data.
function collectRuns({ repo, since, only = [] }) {
  const lines = gh("api", "--paginate",
    `repos/${repo}/actions/workflows/ci.yml/runs?event=pull_request&created=>=${since}&per_page=100`,
    "--jq", '.workflow_runs[] | [.id, .html_url, .head_sha, .head_branch, (.head_repository.full_name == .repository.full_name), ([.pull_requests[].base.ref] | join(",")), ([.pull_requests[].number | tostring] | join(","))] | @tsv')
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
  const failuresBySha = new Map() // one lookup per base commit and project
  const devFailures = (sha, project) => {
    const key = `${sha}\t${project}`
    if (!failuresBySha.has(key)) {
      let result
      try {
        const devRuns = gh("api", `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=dev&per_page=10`,
          "--jq", ".workflow_runs[] | [.id, .html_url, .status, (.conclusion // \"\")] | @tsv")
          .split("\n").filter(Boolean).map((l) => {
            const [runId, runUrl, status, conclusion] = l.split("\t")
            return { id: runId, url: runUrl, status, conclusion }
          })
        const done = devRuns.find((r) => r.status === "completed")
        if (done?.conclusion === "failure") {
          done.artifacts = gh("api", `repos/${repo}/actions/runs/${done.id}/artifacts?per_page=100`, "--jq", ".artifacts[] | select(.expired | not) | .name").split("\n").filter(Boolean)
        }
        result = baseFailures({ sha, project, devRuns, readLists: (name) => {
          const out = path.join(dir, `base-${done.id}`, name)
          gh("run", "download", done.id, "--repo", repo, "--name", name, "--dir", out)
          const list = (suffix) => { try { return readFileSync(path.join(out, `failed-${project}.txt${suffix}`), "utf8").split("\n").map((l) => l.trim()).filter(Boolean) } catch { return [] } }
          return { failed: list(""), flaky: list(".flaky"), unknown: list(".unknown") }
        } })
      } catch (err) {
        result = { sha, error: String(err?.message ?? err).split("\n")[0] }
      }
      failuresBySha.set(key, result)
    }
    return failuresBySha.get(key)
  }
  const runs = []
  const registryChecks = []
  const listed = lines.split("\n").filter(Boolean).filter((l) => !only.length || only.includes(l.split("\t")[0]))
  for (const line of listed) {
    const [id, url, headSha, headBranch, sameRepo, bases = "", numbers = ""] = line.split("\t")
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
    const jobs = gh("api", `repos/${repo}/actions/runs/${id}/jobs?per_page=100`, "--jq",
      ".jobs[] | [.name, (.conclusion // \"\"), (.id | tostring), ([.steps[]? | select(.name == \"Run tests\") | (.conclusion // \"\")] | first // \"\")] | @tsv")
      .split("\n").filter(Boolean).map((l) => l.split("\t"))
    const conclusions = Object.fromEntries(jobs.map(([name, conclusion]) => [name, conclusion]))
    const testSteps = Object.fromEntries(jobs.filter(([, , , step]) => step).map(([name, , , step]) => [name, step]))
    const { expected, expectedShards } = expectedFromJobs(conclusions, testSteps)
    // The base matters only for a run without shadow artifacts.
    const base = names.length ? "dev"
      : resolveBase({ listedBases: bases.split(",").filter(Boolean), headSha, headBranch, sameRepo: sameRepo === "true", pulls: expected.length ? pullsFor(headSha) : [] })
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
      const entry = list.length ? mergeShardEntries(list, list.some((p) => p.shard !== null) ? expectedShards[project] : []) : null
      if (entry) projects[project] = entry
    }
    // every artifact came from an unfinished shard and no shard job finished: nothing to check
    if (!Object.keys(projects).length && !expected.length) continue
    // A miss is checked against the PR's base: did the same file fail on dev there?
    const testedOn = {}
    for (const [project, entry] of Object.entries(projects)) {
      if (!entry.shadow?.misses?.length) continue
      const sha = entry.selection?.base ?? baseFromJobLog(repo, jobs, project)
      testedOn[project] = sha ? devFailures(sha, project) : { error: "the commit the PR was tested on could not be found" }
    }
    // the PR, for the report's examples: listed while it is open, else through
    // the commit's pulls — the PR whose head is this sha, else one into dev
    // (an earlier push of a PR is no longer its head)
    const pulls = numbers ? null : pullsFor(headSha)
    const pr = Number(numbers.split(",").filter(Boolean)[0])
      || pulls?.find((p) => p.head?.sha === headSha)?.number || pulls?.find((p) => p.base?.ref === "dev")?.number || null
    runs.push({ url, expected, projects, ...(pr && { pr }), ...(Object.keys(testedOn).length && { bases: testedOn }), ...(base === "unknown" && { baseUnknown: true }) })
  }
  return { listed: listed.length, runs, registryChecks }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: o } = parseArgs({ options: { since: { type: "string" }, repo: { type: "string" }, run: { type: "string", multiple: true } } })
  if (!o.since || Number.isNaN(Date.parse(o.since))) {
    process.stderr.write("usage: shadow-report.mjs --since <ISO date> [--repo owner/name] [--run <id>]…\n")
    process.exit(2)
  }
  const repo = o.repo ?? gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner")
  const { listed, runs, registryChecks } = collectRuns({ repo, since: o.since, only: o.run ?? [] })
  const report = aggregateShadow(runs, registryChecks)
  const pct = (x) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`)
  const example = (e) => `${e.pr ? `#${e.pr}` : e.url}${e.file ? ` ${e.file}` : ""}`
  const out = [
    // both counts, so "no shadow runs" cannot pass for a broken listing
    `PR runs listed since ${o.since}: ${listed}, shadow runs checked: ${report.runsChecked}`,
    `Selector misses: ${report.misses.length}`,
    ...report.misses.map((m) => `  - ${m.project}: ${m.file}  ${m.url}${m.baseNote ? `  (${m.baseNote})` : ""}`),
    `Inherited from dev (failed again on the PR's base commit's own dev run — not a miss, not blocking Clean): ${report.inherited.length}`,
    ...report.inherited.map((m) => `  - ${m.project}: ${m.file}  ${m.url}  (base ${m.base.slice(0, 9)}: ${m.baseUrl})`),
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
    `Median share among narrowed runs only (did not go full) — frontend: ${pct(report.narrowed.medianShare.frontend)} of ${report.narrowed.runs.frontend} run(s), backend: ${pct(report.narrowed.medianShare.backend)} of ${report.narrowed.runs.backend} run(s)`,
    `Runs that went full: ${report.full.runs} of ${report.runsChecked} — by the first trigger the selector found (a run counts once per cause; frontend/backend count project runs):`,
    ...report.full.byCause.map((row) => `  - ${row.cause}: ${row.runs} run(s) of ${row.prs} PR(s) (frontend ${row.projects.frontend}, backend ${row.projects.backend}), e.g. ${row.examples.slice(0, 3).map(example).join("; ")}`),
    report.clean ? "Clean: no miss, unattributed failure, selector crash, missing shadow data or unreadable check." : "Not clean.",
    `Registry rule (TEST_SELECT_REGISTRY_RULE, its own shadow period — not part of Clean): ${report.registry.checked} project run(s) where its selection differed, ${report.registry.misses.length} miss(es)`,
    ...report.registry.misses.map((m) => `  - ${m.project}: ${m.file}  ${m.url}`),
  ]
  process.stdout.write(`${out.join("\n")}\n`)
}
