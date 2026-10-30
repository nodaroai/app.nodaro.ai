// tools/__tests__/ci-job-inputs.test.mjs
// The CI job gate (tools/ci/, decided 2026-10-20): four jobs run on a PR only
// when one of their declared inputs changed. These tests hold the gate's
// decisions, its wiring in ci.yml, and the declaration to the tree — the
// scripts and SQL each job's steps run. What a job's Vitest suite reaches is
// held by tools/ci/job-inputs-check.mjs, a step of each such job; the last
// test here runs it too when this checkout has the install and the build.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { matchesAny } from "../test-select/glob.mjs"
import { gateJobs, isCovered, isGlobCovered, loadJobInputs, staticJobReach, vitestInvocation, workflowJobs } from "../ci/job-inputs.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
const trackedSet = new Set(tracked)
const read = (p) => (trackedSet.has(p) && existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), "utf8") : null)
const workflow = read(".github/workflows/ci.yml")
const jobs = workflowJobs(workflow)
const declared = loadJobInputs()
const KEYS = ["remotion", "characterize", "migrations", "ffmpeg_ledger"]
const scriptOf = (dir, name) => JSON.parse(read(`${dir}/package.json`)).scripts?.[name] ?? null

const pr = (files, baseRef = "dev") => gateJobs({ event: "pull_request", baseRef, files, jobs: declared })
const running = (d) => Object.keys(d.outputs).filter((k) => d.outputs[k]).sort()

// ── the declaration ─────────────────────────────────────────────────────

test("the four gated jobs are declared, each naming a ci.yml job", () => {
  assert.deepEqual(Object.keys(declared).sort(), [...KEYS].sort())
  for (const [key, job] of Object.entries(declared)) {
    assert.ok(jobs[job.job], `${key}: ci.yml has no job ${job.job}`)
    assert.ok(Array.isArray(job.inputs) && job.inputs.length > 0, key)
    assert.deepEqual(job.inputs, [...new Set(job.inputs)].sort(), `${key}: inputs sorted, no duplicates`)
  }
})

test("every input names something in the tree: a literal path is tracked, a glob matches a tracked file", () => {
  for (const [key, job] of Object.entries(declared)) {
    for (const input of job.inputs) {
      if (/[*?{]/.test(input)) assert.ok(tracked.some((f) => matchesAny(f, [input])), `${key}: ${input} matches no tracked file`)
      else assert.ok(trackedSet.has(input), `${key}: ${input} is not tracked — renamed or removed? Update tools/ci/job-inputs.json`)
    }
  }
})

// ── the gate's decisions ────────────────────────────────────────────────

// A tracked input of `key` that no other job declares.
const ownInput = (key) => tracked.find((f) => matchesAny(f, declared[key].inputs)
  && KEYS.every((k) => k === key || !matchesAny(f, declared[k].inputs)) && !isCovered(f, []))

test("a change only inside one job's inputs runs that job alone", () => {
  for (const key of KEYS) {
    const file = ownInput(key)
    assert.ok(file, `${key} has no input of its own`)
    const d = pr([file, "frontend/src/main.tsx"])
    assert.deepEqual(running(d), [key], `${file}`)
    assert.match(d.reasons[key], new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is one of its inputs$`))
  }
})

test("an unrelated change runs none of them", () => {
  for (const files of [["frontend/src/main.tsx"], ["docs/nodes/README.md", "backend/src/routes/health.ts"], []]) {
    const d = pr(files)
    assert.deepEqual(running(d), [], files.join(", "))
    for (const k of KEYS) assert.equal(d.reasons[k], "no input of this job changed")
  }
})

test("a shared input runs every job that reaches it", () => {
  assert.deepEqual(running(pr(["packages/shared/src/index.ts"])), ["characterize", "ffmpeg_ledger", "remotion"])
  assert.deepEqual(running(pr(["supabase/migrations/001_x.sql"])), ["migrations"])
})

test("a global trigger, or the gate itself, runs all of them", () => {
  for (const f of ["package-lock.json", "backend/package.json", ".github/workflows/ci.yml", ".github/actions/restore-ci-build/action.yml",
    "Dockerfile", "tools/install-pinned-ffmpeg.sh", "backend/vitest.characterize.config.ts", "tools/test-select/glob.mjs",
    "tools/ci/job-inputs.json", "tools/ci/job-gate.mjs"]) {
    const d = pr(["frontend/src/main.tsx", f])
    assert.deepEqual(running(d), [...KEYS].sort(), f)
    assert.equal(d.reasons.remotion, `${f} can affect every gated job`)
  }
})

test("a push, a PR into main, an unreadable or oversized diff: every job runs", () => {
  for (const event of ["push", "workflow_dispatch", undefined]) {
    assert.deepEqual(running(gateJobs({ event, baseRef: "", files: [], jobs: declared })), [...KEYS].sort(), String(event))
  }
  assert.deepEqual(running(pr(["frontend/src/main.tsx"], "main")), [...KEYS].sort())
  assert.deepEqual(running(pr(null)), [...KEYS].sort())
  assert.deepEqual(running(pr(Array.from({ length: 2900 }, (_, i) => `frontend/src/f${i}.ts`))), [...KEYS].sort())
  // a PR into any other branch (a stacked PR) is gated like one into dev
  assert.deepEqual(running(pr(["frontend/src/main.tsx"], "feat/x")), [])
})

// ── the gate as the Diff Gate runs it ───────────────────────────────────

// The Diff Gate checks out only these directories, with no npm install: the
// gate must load from them alone, and must stay correct when it cannot.
const SPARSE = workflow.match(/sparse-checkout: \|\n((?: {12}\S.*\n)+)/)?.[1].trim().split(/\s+/)

function runGate({ files, ghFails = false, env = {} }) {
  const dir = mkdtempSync(path.join(tmpdir(), "job-gate-"))
  try {
    for (const d of SPARSE) cpSync(path.join(root, d), path.join(dir, d), { recursive: true })
    const bin = path.join(dir, "bin")
    mkdirSync(bin)
    writeFileSync(path.join(bin, "gh"), ghFails
      ? "#!/bin/sh\necho 'HTTP 502' >&2\nexit 1\n"
      : `#!/bin/sh\nprintf '%s\\n' "$*" > "${path.join(dir, "gh-args")}"\ncat "${path.join(dir, "files.txt")}"\n`)
    chmodSync(path.join(bin, "gh"), 0o755)
    writeFileSync(path.join(dir, "files.txt"), files.join("\n"))
    const out = path.join(dir, "out")
    const r = spawnSync(process.execPath, ["tools/ci/job-gate.mjs"], { cwd: dir, encoding: "utf8", env: {
      PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: out, EVENT_NAME: "pull_request", BASE_REF: "dev", REPO: "o/r", PR_NUMBER: "7", ...env,
    } })
    assert.equal(r.status, 0, r.stderr)
    const outputs = Object.fromEntries(readFileSync(out, "utf8").trim().split("\n").map((l) => l.split("=")))
    const ghArgs = existsSync(path.join(dir, "gh-args")) ? readFileSync(path.join(dir, "gh-args"), "utf8") : ""
    return { outputs, ghArgs, stdout: r.stdout }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("the Diff Gate's sparse checkout holds everything the gate loads", () => {
  assert.deepEqual(SPARSE, ["tools/test-select", "tools/ci"])
  const r = runGate({ files: ["frontend/src/main.tsx", ownInput("migrations")] })
  assert.deepEqual(r.outputs, { remotion: "false", characterize: "false", migrations: "true", ffmpeg_ledger: "false" })
  // renames count under both names: a move out of a job's inputs runs it
  assert.match(r.ghArgs, /pulls\/7\/files --paginate --jq \.\[\] \| \.filename, \(\.previous_filename \/\/ empty\)/)
})

test("a gate that cannot read the diff runs every job; a push never asks", () => {
  const failed = runGate({ files: [], ghFails: true })
  assert.deepEqual(failed.outputs, { remotion: "true", characterize: "true", migrations: "true", ffmpeg_ledger: "true" })
  assert.match(failed.stdout, /could not list the PR's files/)
  const push = runGate({ files: ["frontend/src/main.tsx"], env: { EVENT_NAME: "push", BASE_REF: "" } })
  assert.deepEqual(push.outputs, { remotion: "true", characterize: "true", migrations: "true", ffmpeg_ledger: "true" })
  assert.equal(push.ghArgs, "")
})

// ── the wiring in ci.yml ────────────────────────────────────────────────

test("the Diff Gate emits one output per declared job, from a step that cannot fail it", () => {
  const gate = jobs.changes
  for (const key of KEYS) assert.match(gate, new RegExp(`^      ${key}: \\$\\{\\{ steps\\.jobs\\.outputs\\.${key} \\}\\}$`, "m"), key)
  const step = gate.match(/- name: Decide the gated jobs\n((?: {8}.*\n)+)/)?.[1]
  assert.ok(step, "the gate step moved")
  assert.match(step, /^ {8}id: jobs$/m)
  assert.match(step, /^ {8}continue-on-error: true$/m)
  assert.match(step, /^ {8}run: node tools\/ci\/job-gate\.mjs$/m)
  for (const v of ["GH_TOKEN", "EVENT_NAME", "REPO", "PR_NUMBER", "BASE_REF"]) assert.match(step, new RegExp(`^ {10}${v}: `, "m"), v)
  assert.ok(gate.indexOf("sparse-checkout") < gate.indexOf("Decide the gated jobs"), "the gate runs after the checkout")
})

// The job's `if:`, evaluated as GitHub would.
const conditionOf = (body) => body.match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1]
const evaluate = (condition, needs) => Function("needs", "cancelled", `return (${condition.replace(/needs\.([a-z-]+)/g, "needs['$1']")})`)(needs, () => false)

test("each gated job runs unless its output is exactly 'false' — a failed or silent gate runs it", () => {
  for (const [key, { job }] of Object.entries(declared)) {
    const body = jobs[job]
    const needs = body.match(/^    needs: \[(.+)\]$/m)?.[1].split(", ") ?? []
    assert.ok(needs.includes("changes"), `${job} needs the Diff Gate`)
    const condition = conditionOf(body)
    assert.ok(condition?.startsWith("!cancelled() && ("), `${job}: ${condition}`)
    assert.match(condition, new RegExp(`needs\\.changes\\.outputs\\.${key} != 'false'`), job)
    const prep = needs.includes("prepare-packages")
    const at = (changes, output, prepare = "success") => evaluate(condition, {
      changes: { result: changes, outputs: { [key]: output } }, "prepare-packages": { result: prepare },
    })
    assert.equal(at("success", "false"), false, `${job}: skips when the gate says false`)
    for (const output of ["true", "", undefined]) assert.equal(at("success", output), true, `${job}: runs on ${output}`)
    for (const result of ["failure", "skipped", "cancelled"]) assert.equal(at(result, undefined), true, `${job}: runs when the gate ${result}`)
    if (prep) for (const result of ["failure", "skipped"]) assert.equal(at("success", "false", result), true, `${job}: a failed preparation still runs (and fails) it`)
  }
})

test("a Diff Gate failure cannot fail a gated job by itself: its preparation check reads prepare-packages only", () => {
  for (const { job } of Object.values(declared)) {
    const step = jobs[job].match(/- name: Require successful preparation\n((?: {8}.*\n)+)/)?.[1]
    if (!step) continue
    assert.match(step, /PREPARE_RESULT: \$\{\{ needs\.prepare-packages\.result \}\}/, job)
    assert.doesNotMatch(step, /toJSON\(needs\)/, job)
  }
})

test("each Vitest job checks its declaration before its tests, and every test file it names is declared", () => {
  const vitestJobs = []
  for (const [key, { job }] of Object.entries(declared)) {
    const body = jobs[job]
    const run = vitestInvocation(body, scriptOf)
    if (!run) {
      assert.doesNotMatch(body, /job-inputs-check/, `${job} runs no Vitest suite`)
      continue
    }
    vitestJobs.push(key)
    const check = body.indexOf(`run: node tools/ci/job-inputs-check.mjs ${key}\n`)
    assert.ok(check > 0, `${job} must run the declaration check`)
    assert.ok(check > body.indexOf("kind: packages"), `${job}: after the packages are restored`)
    assert.ok(check < body.lastIndexOf(`working-directory: ${run.project}`), `${job}: before the tests`)
    for (const f of run.files ?? []) assert.ok(isCovered(`${run.project}/${f}`, declared[key].inputs), `${job} runs ${f}, an undeclared input`)
    if (run.config) assert.ok(isCovered(`${run.project}/${run.config}`, declared[key].inputs), `${run.config}`)
  }
  assert.deepEqual(vitestJobs.sort(), ["characterize", "ffmpeg_ledger", "remotion"])
  assert.deepEqual(vitestInvocation(jobs["remotion-tests"], scriptOf), { project: "packages/remotion", config: null, files: null })
  assert.deepEqual(vitestInvocation(jobs.characterize, scriptOf), { project: "backend", config: "vitest.characterize.config.ts", files: null })
  assert.equal(vitestInvocation(jobs["ffmpeg-ledger-redis"], scriptOf).files.length, 4)
})

test("what each job's steps run is declared: its scripts, their imports and reads, the actions it uses, the SQL it applies", () => {
  for (const [key, { job, inputs }] of Object.entries(declared)) {
    const reach = staticJobReach(jobs[job], { read, tracked })
    assert.deepEqual(reach.paths.filter((p) => !isCovered(p, inputs)), [], `${key}: declare these in tools/ci/job-inputs.json`)
    assert.deepEqual(reach.globs.filter((g) => !isGlobCovered(g, inputs)), [], `${key}: these @reads globs`)
  }
  // the migration job's reach, spelled out: the whole chain, every proof and
  // what it includes, every script
  const m = staticJobReach(jobs["migration-behavior"], { read, tracked })
  assert.ok(m.paths.includes("backend/scripts/run-migrations.mjs"))
  assert.ok(m.paths.some((p) => p.startsWith("supabase/tests/fixtures/")), "\\ir includes are followed")
  assert.ok(m.paths.filter((p) => /^supabase\/migrations\/\d{3}_/.test(p)).length > 400)
  assert.deepEqual(m.globs, ["supabase/migrations/**"])
})

test("the static walk: includes, imports, reads, actions — and a step naming a missing file fails", () => {
  const files = {
    "s/a.mjs": 'import { b } from "./lib/b.mjs"\n',
    "s/lib/b.mjs": '// @reads data/**\nimport { readFileSync } from "node:fs"\n',
    "s/c.mjs": 'import { readFileSync } from "node:fs"\nreadFileSync("x")\n',
    "supabase/tests/x.behavior.sql": "\\ir fixtures/f.sql\n\\i supabase/other.sql\n",
    "supabase/tests/fixtures/f.sql": "select 1;\n",
    "supabase/other.sql": "select 2;\n",
    ".github/actions/a/action.yml": "runs:\n  steps:\n    - run: bash s/d.sh\n",
    "s/d.sh": "echo\n",
  }
  const t = { read: (p) => files[p] ?? null, tracked: Object.keys(files) }
  const r = staticJobReach("      - run: node s/a.mjs\n      - uses: ./.github/actions/a\n      - run: |\n          files=(supabase/tests/*.behavior.sql)\n", t)
  assert.deepEqual(r.paths, [".github/actions/a/action.yml", "s/a.mjs", "s/d.sh", "s/lib/b.mjs",
    "supabase/other.sql", "supabase/tests/fixtures/f.sql", "supabase/tests/x.behavior.sql"])
  assert.deepEqual(r.globs, ["data/**"])
  assert.throws(() => staticJobReach("      - run: node s/c.mjs\n", t), /an @reads declaration in s\/c\.mjs/)
  assert.throws(() => staticJobReach("      - run: node s/gone.mjs\n", t), /s\/gone\.mjs \(named by the job\)/)
})

// ── the Vitest graph (when this checkout can build it) ──────────────────

const canGraph = existsSync(path.join(root, "node_modules/vitest/package.json")) && existsSync(path.join(root, "packages/shared/dist"))
test("each Vitest job's tests reach only its declared inputs (Vitest's graph)", { skip: canGraph ? false : "needs npm ci and npm run build:packages — each gated job runs this check itself" }, async () => {
  const { checkJob } = await import("../ci/job-inputs-check.mjs")
  for (const key of ["remotion", "characterize", "ffmpeg_ledger"]) {
    const r = await checkJob(key)
    assert.deepEqual(r.problems, [], key)
    assert.deepEqual(r.missing, [], `${key}: node tools/ci/job-inputs-check.mjs ${key} --write`)
    assert.ok(r.tests > 0, key)
  }
})

test("a red gated job on the post-merge dev run is attributed to its PR; a skipped one never is", () => {
  const job = jobs["attribute-dev-failure"]
  const needs = job.match(/^    needs: \[(.+)\]$/m)[1].split(", ")
  const condition = conditionOf(job)
  for (const { job: id } of Object.values(declared)) {
    assert.ok(needs.includes(id), `attribute-dev-failure needs ${id}`)
    const at = (result) => Function("needs", "always", "github", `return (${condition.replace(/needs\.([a-z-]+)/g, "needs['$1']")})`)(
      Object.fromEntries(needs.map((n) => [n, { result: n === id ? result : "success" }])), () => true,
      { event_name: "push", ref: "refs/heads/dev" })
    assert.equal(at("failure"), true, `${id} failed`)
    for (const result of ["skipped", "success", "cancelled"]) assert.equal(at(result), false, `${id} ${result}`)
  }
  assert.match(job, /NEEDS: \$\{\{ toJSON\(needs\) \}\}/)
  assert.match(job, /failedJobs: failedJobsFrom\(JSON\.parse\(process\.env\.NEEDS \|\| "\{\}"\)\)/)
})

test("a failed declaration check fails the job but never hides the tests' result", () => {
  for (const [key, { job }] of Object.entries(declared)) {
    const body = jobs[job]
    if (!vitestInvocation(body, scriptOf)) continue
    const steps = body.split(/\n(?=      - )/)
    const at = steps.findIndex((st) => st.includes(`run: node tools/ci/job-inputs-check.mjs ${key}\n`) || st.endsWith(`job-inputs-check.mjs ${key}`))
    assert.doesNotMatch(steps[at], /continue-on-error/, `${job}: the check still fails the job`)
    const testStep = steps[at + 1]
    assert.match(testStep, /^        if: \$\{\{ !cancelled\(\) && steps\.build-packages\.outcome == 'success' \}\}$/m, `${job}: its tests run after a failed check`)
    assert.match(body, /- name: Restore shared packages\n        id: build-packages\n/, job)
  }
})

test("a hung gate cannot hold the Diff Gate", () => {
  // A number — or, for a PR into main, which waits for the dev run on its
  // head (tools/test-select/ci-mode.mjs), a longer number; still bounded.
  assert.match(jobs.changes, /^    timeout-minutes: (?:\d+|\$\{\{ github\.base_ref == 'main' && \d+ \|\| \d+ \}\})$/m)
  assert.match(jobs.changes.match(/- name: Decide the gated jobs\n((?: {8}.*\n)+)/)[1], /^ {8}timeout-minutes: \d+$/m)
})

test("a PR into main's Diff Gate is not cut off by ubuntu-slim's 15-minute job limit", () => {
  // ubuntu-slim cancels any job at 15 minutes, ignoring timeout-minutes, so a
  // wait longer than that has to run on a runner without the limit.
  const runsOn = jobs.changes.match(/^    runs-on: (.+)$/m)[1]
  const wait = Number(jobs.changes.match(/^    timeout-minutes: \$\{\{ github\.base_ref == 'main' && (\d+) \|\|/m)?.[1] ?? 0)
  if (wait > 15) assert.equal(runsOn, "${{ github.base_ref == 'main' && 'ubuntu-latest' || 'ubuntu-slim' }}")
})
