// tools/ci/job-inputs.mjs
// Which CI jobs a pull request can affect (decided 2026-10-20). A few jobs
// test one corner of the tree on paid runners — Remotion Tests, FFmpeg Output
// Characterization, Migration Behavior, FFmpeg Ledger — and ran on every PR
// whatever it changed. Each one's inputs are declared ONCE, in job-inputs.json
// (job key → globs); the Diff Gate (job-gate.mjs) emits one output per key,
// and the job runs when the PR touched one of its inputs, a global trigger of
// the test-selection engine, or this gate itself.
//
// The declaration checks itself. A job with a Vitest suite runs
// job-inputs-check.mjs before its tests: every file its tests reach (Vitest's
// own graph, plus the setup files and every @reads / @test-watches glob on the
// way) must be an input. tools/__tests__/ci-job-inputs.test.mjs holds the rest
// to the tree: the scripts each job's steps run, the SQL the migration job
// applies, the ci.yml wiring. The argument it rests on: the reached files are
// all inputs, so a PR that changes none of them (and no global trigger, which
// covers the lockfile, the configs and ci.yml) cannot change what the tests
// reach — and a PR that does change one runs the job, and with it the check.
//
// Pure, and Node built-ins only: the Diff Gate runs this on a sparse checkout
// of tools/test-select and tools/ci with no npm install.
import { readFileSync } from "node:fs"
import { posix } from "node:path"
import { isScanner, parseReads } from "../test-select/annotations.mjs"
import { matchesAny } from "../test-select/glob.mjs"
import { MAX_VISIBLE_CHANGES, isGlobalTrigger } from "../test-select/global-triggers.mjs"

export const INPUTS_FILE = "tools/ci/job-inputs.json"
// The gate's own code and declarations: an input of every gated job, so a
// change to them runs all of them (and so proves itself).
export const GATE_FILES = ["tools/ci/**"]

export function loadJobInputs(read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8")) {
  return JSON.parse(read(INPUTS_FILE)).jobs
}

// Every output true, with one reason.
const all = (jobs, reason) => ({
  outputs: Object.fromEntries(Object.keys(jobs).map((k) => [k, true])),
  reasons: Object.fromEntries(Object.keys(jobs).map((k) => [k, reason])),
})

// `files`: the PR's changed paths, a renamed file under BOTH its names (a move
// out of a job's inputs changes the job as much as an edit does). null = the
// list could not be read. Anything but a PR into dev or a feature branch runs
// every job: a push to dev or main is the post-merge coverage, and a PR into
// main is a promotion, which runs what it ran before this gate.
export function gateJobs({ event, baseRef, files, jobs }) {
  if (event !== "pull_request") return all(jobs, `${event || "unknown event"}: every gated job runs after the merge`)
  if (baseRef === "main") return all(jobs, "PR into main: a promotion runs every gated job")
  if (!Array.isArray(files)) return all(jobs, "the changed files could not be read — running every gated job")
  if (files.length >= MAX_VISIBLE_CHANGES) return all(jobs, `the diff lists ${files.length} files — too many to see them all`)
  const trigger = files.find((f) => isGlobalTrigger(f) || matchesAny(f, GATE_FILES))
  if (trigger) return all(jobs, `${trigger} can affect every gated job`)
  const outputs = {}
  const reasons = {}
  for (const [key, job] of Object.entries(jobs)) {
    const hit = files.find((f) => matchesAny(f, job.inputs))
    outputs[key] = Boolean(hit)
    reasons[key] = hit ? `${hit} is one of its inputs` : "no input of this job changed"
  }
  return { outputs, reasons }
}

// Covered = a global trigger, the gate itself, or one of the job's inputs.
export const isCovered = (path, inputs) => isGlobalTrigger(path) || matchesAny(path, GATE_FILES) || matchesAny(path, inputs)
// A glob (an @reads or @test-watches one) is covered when an input glob
// contains it: matched as text, `**` in an input reaches every `*` in it.
export const isGlobCovered = (glob, inputs) => inputs.includes(glob) || isCovered(glob, inputs)

// A workspace package's build output stands for the whole package — any file
// of it can change the build, and dist/ is untracked, so a diff never names
// it. Bundling may inline its own workspace dependencies, so those count too.
const DIST = /^packages\/([^/]+)\/dist\//
export const distPackage = (path) => path.match(DIST)?.[1] ?? null
export const packageInput = (dir) => `packages/${dir}/**`

// What one reached path requires of the inputs. `workspaceDeps(dir)`: the
// package dirs `packages/<dir>` depends on, transitively.
export function requiredInputs(path, workspaceDeps) {
  const dir = distPackage(path)
  if (!dir) return [path]
  return [dir, ...workspaceDeps(dir)].map(packageInput)
}

// The jobs of a workflow, by id: `  id:\n` … up to the next one.
export function workflowJobs(text) {
  return Object.fromEntries([...text.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|$(?![\s\S]))/gm)]
    .map(([, name, body]) => [name, body]))
}

// The job's steps, each as its own text.
const stepsOf = (body) => body.split(/\n(?=      - )/).slice(1)

// The Vitest run a job's steps make: the one step with a working-directory
// that runs `npx vitest run …` or an npm script that does. `scriptOf(project,
// name)` reads package.json scripts. Returns { project, config, files } or
// null when the job runs no Vitest suite; more than one is an error.
export function vitestInvocation(body, scriptOf) {
  const runs = []
  for (const step of stepsOf(body)) {
    const dir = step.match(/^\s+working-directory: (\S+)$/m)?.[1]
    const command = step.match(/^\s+run: (.+)$/m)?.[1]?.trim()
    if (!dir || !command) continue
    const npm = command.match(/^npm run ([\w:-]+)$/)
    const line = npm ? scriptOf(dir, npm[1]) : command
    const vitest = line?.match(/(?:^|&&\s*|\s)(?:npx )?vitest run(?<args>(?: \S+)*)\s*$/)
    if (!vitest) continue
    const args = vitest.groups.args.trim().split(/\s+/).filter(Boolean)
    const config = args.includes("--config") ? args[args.indexOf("--config") + 1] : null
    const files = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "--config")
    runs.push({ project: dir, config, files: files.length > 0 ? files : null })
  }
  if (runs.length > 1) throw new Error(`the job runs ${runs.length} Vitest suites — declare one per job`)
  return runs[0] ?? null
}

// The repo files a job's steps run, statically: `node <script>` and `bash
// <script>` (and each script's relative imports and @reads), the local
// actions it uses (and what THEY run), and the SQL it applies — every file a
// shell glob of the job names, and each one's `\i` / `\ir` includes.
// `read(path)` returns a tracked file's text (null when absent); `tracked` is
// every tracked path. Returns { paths, globs } (sorted).
export function staticJobReach(body, { read, tracked }) {
  const paths = new Set()
  const globs = new Set()
  const missing = []
  const add = (p, via) => {
    if (paths.has(p)) return false
    if (read(p) === null) { missing.push(`${p} (named by ${via})`); return false }
    paths.add(p)
    return true
  }
  // A global trigger or the gate's own code runs every gated job already;
  // what it imports and reads is the engine's to declare, not the job's.
  const runsEverything = (p) => isGlobalTrigger(p) || matchesAny(p, GATE_FILES)
  const walkScript = (p, via) => {
    if (!add(p, via) || runsEverything(p)) return
    const source = read(p)
    for (const m of source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*(["'])(\.{1,2}\/[^"']+)\1/g)) walkScript(posix.normalize(posix.join(posix.dirname(p), m[2])), p)
    // A script that reads repo files says which (`@reads`), or that it reads
    // none (`@reads-none`) — the reads-guard rule, for the job's scripts.
    const { reads, readsNone } = parseReads(source)
    if (reads.length === 0 && !readsNone && isScanner(source)) missing.push(`an @reads declaration in ${p}, which reads files`)
    for (const g of reads) globs.add(g)
  }
  const walkSql = (p, via) => {
    if (!add(p, via)) return
    for (const m of read(p).matchAll(/^\s*\\(i|ir|include|include_relative)\s+(\S+)/gm)) {
      const relative = m[1] === "ir" || m[1] === "include_relative"
      walkSql(posix.normalize(relative ? posix.join(posix.dirname(p), m[2]) : m[2]), p)
    }
  }
  const walkBody = (text, via) => {
    for (const m of text.matchAll(/\b(?:node|bash)\s+((?:[\w.-]+\/)+[\w.-]+\.(?:mjs|cjs|js|sh))\b/g)) {
      if (m[1].endsWith(".sh")) add(m[1], via)
      else walkScript(m[1], via)
    }
    for (const m of text.matchAll(/uses: \.\/(\.github\/actions\/[\w.-]+)/g)) {
      const action = [`${m[1]}/action.yml`, `${m[1]}/action.yaml`].find((f) => read(f) !== null)
      if (!action) { missing.push(`${m[1]}/action.yml (used by ${via})`); continue }
      if (add(action, via)) walkBody(read(action), action)
    }
    for (const m of text.matchAll(/\b(supabase\/[\w./*?[\]-]+\.sql)\b/g)) {
      const glob = m[1].replace(/\[[^\]]*\]/g, "?")
      for (const f of tracked.filter((t) => matchesAny(t, [glob]))) walkSql(f, via)
    }
  }
  walkBody(body, "the job")
  if (missing.length > 0) throw new Error(`the job's steps need what is not there: ${missing.join("; ")}`)
  return { paths: [...paths].sort(), globs: [...globs].sort() }
}
