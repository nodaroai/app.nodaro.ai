import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const workflow = readFileSync(new URL("../../.github/workflows/staging-migrate.yml", import.meta.url), "utf8")
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8")

/**
 * The staging migration job must never be able to reach production's database
 * and must be off until a staging project exists and someone switches it on.
 * Text checks on purpose: the risky part is what the workflow says.
 */

test("it runs only on dev, so a run from any other branch (main included) can never leave a red check", () => {
  const condition = workflow.slice(workflow.indexOf("    if: >-"), workflow.indexOf("    env:"))
  assert.match(condition, /github\.ref == 'refs\/heads\/dev'/)
})

test("it runs only for this repository, and a push only once it is switched on", () => {
  assert.match(workflow, /github\.repository == 'nodaroai\/app\.nodaro\.ai-internal'/)
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' \|\| vars\.STAGING_MIGRATE_ENABLED == 'true'/)
  assert.match(workflow, /branches: \[dev\]/)
  assert.ok(!/^\s*-\s*main\s*$/m.test(workflow), "never triggered by main")
})

test("with no staging project named, it stops before doing anything: each step runs only after the one before it worked, back to the gate", () => {
  assert.match(workflow, /if \[ -z "\$STAGING_PROJECT_ID" \]; then/)
  assert.match(workflow, /proceed=false/)
  const chain = [
    ["uses: actions/checkout", /if: steps\.gate\.outputs\.proceed == 'true'/],
    ["uses: supabase/setup-cli", /if: steps\.checkout\.outcome == 'success'/],
    ["name: Link the staging project", /if: steps\.cli\.outcome == 'success'/],
    ["name: Push migrations", /if: steps\.link\.outcome == 'success'/],
  ]
  for (const [marker, guard] of chain) {
    const step = steps().find((text) => text.includes(marker))
    assert.ok(step, marker)
    assert.match(step, guard, marker)
  }
})

test("it refuses production's project, whatever the setting says", () => {
  assert.match(workflow, /\[ "\$STAGING_PROJECT_ID" = "\$PRODUCTION_PROJECT_ID" \]/)
  assert.match(workflow, /PRODUCTION_PROJECT_ID: \$\{\{ secrets\.SUPABASE_PROJECT_ID \}\}/)
  // The push links only the staging secret, never production's.
  assert.match(workflow, /SUPABASE_PROJECT_ID: \$\{\{ secrets\.SUPABASE_STAGING_PROJECT_ID \}\}/)
  assert.doesNotMatch(workflow.slice(workflow.indexOf("- name: Link the staging project")), /secrets\.SUPABASE_PROJECT_ID/)
})

test("a manual run is a dry run unless it says otherwise", () => {
  assert.match(workflow, /supabase db push --include-all \$\{DRY_RUN:\+--dry-run\}/)
  assert.match(workflow, /inputs\.dry_run/)
  assert.match(workflow, /default: true/)
})

test("it uses the same pinned Supabase CLI as production's migrate job", () => {
  const pin = /supabase\/setup-cli@[0-9a-f]{40}[\s\S]{0,300}?version: ([\d.]+)/
  assert.equal(workflow.match(pin)?.[1], ci.match(pin)?.[1])
})

/** The gate step's shell script, as the runner gets it. */
function gateScript() {
  const step = workflow.slice(workflow.indexOf("- name: Stop unless a staging project is named"))
  const run = step.slice(step.indexOf("run: |") + "run: |".length, step.indexOf("\n      - uses:"))
  const lines = run.split("\n").filter((line) => line.trim() !== "")
  const indent = Math.min(...lines.map((line) => line.match(/^ */)[0].length))
  return lines.map((line) => line.slice(indent)).join("\n")
}

function runGate(env) {
  const dir = mkdtempSync(join(tmpdir(), "staging-gate-"))
  const output = join(dir, "output")
  writeFileSync(output, "")
  try {
    const result = spawnSync("sh", ["-c", gateScript()], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env }, encoding: "utf8" })
    return { status: result.status, output: readFileSync(output, "utf8"), stdout: result.stdout }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Every Supabase project the repository names is production's, past or present; the
// current one, which the repository does not name, is listed by hand.
const PRODUCTION_REFS = ["wtklnihbnotyrixkouyl", "kvitmiiswsbtxvjgvbkw"]

/** The Supabase project refs a git checkout names (`<ref>.supabase.co`); none is an empty list, never an error. */
export function supabaseRefsNamedIn(dir) {
  const found = spawnSync("git", ["grep", "-ohE", "[a-z0-9]{20}\\.supabase\\.(co|in)"], { cwd: dir, encoding: "utf8" })
  // git grep answers 1 when nothing matches: the rule holds with no ref named anywhere.
  if (found.status !== 0 && found.status !== 1) throw new Error(found.stderr)
  return [...new Set(found.stdout.split("\n").filter(Boolean).map((host) => host.slice(0, 20)))]
}

test("a checkout naming no Supabase project is an empty list, not an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "no-refs-"))
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir })
    writeFileSync(join(dir, "a.txt"), "nothing to see")
    execFileSync("git", ["add", "a.txt"], { cwd: dir })
    assert.deepEqual(supabaseRefsNamedIn(dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("it refuses every production project the repository knows, by name, whatever the secrets say", () => {
  const named = supabaseRefsNamedIn(new URL("../..", import.meta.url))
  const refs = [...new Set([...PRODUCTION_REFS, ...named])]
  for (const ref of refs) {
    const run = runGate({ STAGING_PROJECT_ID: ref, PRODUCTION_PROJECT_ID: "abcdefghijklmnopqrst" })
    // Refused without a failing step: the run may sit on a commit that is main's head.
    assert.equal(run.status, 0, `${ref}: the gate never fails the job`)
    assert.match(run.output, /proceed=false/, ref)
    assert.match(run.output, /refused=/, ref)
  }
})

test("the gate's answers: unset stops quietly, production's own secret is refused, a staging project proceeds", () => {
  assert.match(runGate({ STAGING_PROJECT_ID: "", PRODUCTION_PROJECT_ID: "abcdefghijklmnopqrst" }).output, /proceed=false/)
  for (const env of [{ STAGING_PROJECT_ID: "abcdefghijklmnopqrst", PRODUCTION_PROJECT_ID: "abcdefghijklmnopqrst" }, { STAGING_PROJECT_ID: "stagingprojectrefabc", PRODUCTION_PROJECT_ID: "" }]) {
    const run = runGate(env)
    assert.equal(run.status, 0)
    assert.match(run.output, /proceed=false/)
    assert.match(run.output, /refused=/)
  }
  const ok = runGate({ STAGING_PROJECT_ID: "stagingprojectrefabc", PRODUCTION_PROJECT_ID: "abcdefghijklmnopqrst" })
  assert.equal(ok.status, 0)
  assert.match(ok.output, /proceed=true/)
})

test("only dev's own code ever really applies: a push to dev, or a manual run on dev that asks for it", () => {
  assert.match(workflow, /DRY_RUN: \$\{\{ !\(github\.ref == 'refs\/heads\/dev' && \(github\.event_name == 'push' \|\| !inputs\.dry_run\)\) && 'yes' \|\| '' \}\}/)
})

test("staging takes migrations in dev's merge order: one numbered below the newest applied is applied too, not a red run; production's push is unchanged", () => {
  assert.match(workflow, /run: supabase db push --include-all \$\{DRY_RUN:\+--dry-run\}/)
  const migrate = ci.slice(ci.indexOf("  migrate:"), ci.indexOf("  changeset-guard:"))
  assert.match(migrate, /run: supabase db push\n/)
  assert.doesNotMatch(migrate, /--include-all/)
})

/** The job's steps, as their text. */
function steps() {
  const job = workflow.slice(workflow.indexOf("    steps:"))
  return job.split("\n      - ").slice(1).map((step) => `- ${step}`)
}

test("no step can turn the job's check red: a run may sit on a commit that is, or becomes, main's head", () => {
  for (const step of steps()) {
    const name = step.match(/name: (.*)/)?.[1] ?? step.match(/uses: (\S+)/)?.[1]
    assert.match(step, /continue-on-error: true/, `${name}: a failure here is reported, never a failing check`)
    assert.match(step, /timeout-minutes: \d+/, `${name}: a hung step ends inside the job`)
  }
  const report = steps().find((step) => step.includes("Report the outcome"))
  assert.ok(report, "a step reports the outcome")
  assert.match(report, /if: always\(\)/)
  assert.match(workflow, /permissions: \{ contents: read, issues: write \}/)
})

/** The report step's script, run with a stand-in `gh` that records its calls and fails, as a broken API would. */
function runReport(env) {
  const report = steps().find((step) => step.includes("Report the outcome"))
  const run = report.slice(report.indexOf("run: |") + "run: |".length)
  const lines = run.split("\n").filter((line) => line.trim() !== "")
  const indent = Math.min(...lines.map((line) => line.match(/^ */)[0].length))
  const script = lines.map((line) => line.slice(indent)).join("\n")
  const dir = mkdtempSync(join(tmpdir(), "staging-report-"))
  try {
    const bin = join(dir, "bin")
    execFileSync("mkdir", ["-p", bin])
    const calls = join(dir, "calls")
    writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${calls}"\nexit 1\n`)
    execFileSync("chmod", ["+x", join(bin, "gh")])
    const summary = join(dir, "summary")
    writeFileSync(summary, "")
    writeFileSync(calls, "")
    const result = spawnSync("bash", ["-e", "-c", script], {
      env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_STEP_SUMMARY: summary, GITHUB_REPOSITORY: "o/r", RUN_URL: "https://run", ...env },
      encoding: "utf8",
    })
    return { status: result.status, summary: readFileSync(summary, "utf8"), calls: readFileSync(calls, "utf8") }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("a failed push is reported in a labelled issue and the job summary, and the step itself never fails", () => {
  const run = runReport({ PROCEED: "true", CHECKOUT: "success", CLI: "success", LINK: "success", PUSH: "failure", REFUSED: "", DRY_RUN: "yes" })
  assert.equal(run.status, 0)
  assert.match(run.summary, /push/i)
  assert.match(run.summary, /fail/i)
  assert.match(run.calls, /staging-migrate-failure/)
  assert.match(run.calls, /issue (create|comment)/)
})

test("a refused gate is reported the same way; a clean run or no staging project opens nothing", () => {
  const refused = runReport({ PROCEED: "false", REFUSED: "SUPABASE_STAGING_PROJECT_ID names a production project", CHECKOUT: "", CLI: "", LINK: "", PUSH: "", DRY_RUN: "" })
  assert.equal(refused.status, 0)
  assert.match(refused.summary, /production project/)
  assert.match(refused.calls, /issue (create|comment)/)
  for (const env of [
    { PROCEED: "true", CHECKOUT: "success", CLI: "success", LINK: "success", PUSH: "success", REFUSED: "", DRY_RUN: "" },
    { PROCEED: "false", CHECKOUT: "", CLI: "", LINK: "", PUSH: "", REFUSED: "", DRY_RUN: "" },
  ]) {
    const run = runReport(env)
    assert.equal(run.status, 0)
    assert.doesNotMatch(run.calls, /issue create/)
  }
})

test("the job's own limit is well above the sum of its steps' limits, so the report step always runs before the job is cut off", () => {
  const job = workflow.slice(workflow.indexOf("  migrate-staging:"), workflow.indexOf("    steps:"))
  const jobLimit = Number(job.match(/^    timeout-minutes: (\d+)/m)?.[1])
  const stepLimits = steps().map((step) => Number(step.match(/timeout-minutes: (\d+)/)?.[1] ?? NaN))
  assert.ok(stepLimits.every((limit) => Number.isFinite(limit)), "every step has its own limit")
  const sum = stepLimits.reduce((total, limit) => total + limit, 0)
  assert.ok(jobLimit >= sum + 15, `job limit ${jobLimit} min against the steps' ${sum} min`)
})
