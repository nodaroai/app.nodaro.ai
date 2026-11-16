// A step that is handed a secret on a pull request runs the BASE branch's copy
// of any repo script it runs, never the PR's own: a PR must not be able to
// change code that runs with a secret. The base copy is checked out into an
// untracked subdirectory (`.gate-base`), and the PR's copy stands in only while
// the base branch has none yet (private-marker-check.yml set the pattern).
//
// Read from every workflow a `pull_request` event runs (ci.yml among them). A
// step is held to it when it can run on a pull request (neither its job's nor
// its own `if:` rules a pull request out) and a secret reaches it (its own
// text, or its job's env, names `secrets.`). Such a step may:
// - run a script only through a variable set to its `.gate-base/` copy;
// - never invoke a literal repo path, `./…`, or npm/npx/yarn/pnpm (they run the
//   PR's packages and scripts);
// - `uses:` only GitHub's own actions (`actions/…`): they run their own
//   released code, never the PR's.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const WORKFLOWS = join(REPO, ".github/workflows")

/** The text of a workflow's `on:` block. */
const triggersOf = (text) => /^on:\s*(?:\[[^\]]*\]|\n(?:[ \t]+.*\n|\s*\n)*)/m.exec(text)?.[0] ?? ""
/** Whether a pull_request event (never pull_request_target, which runs the base branch's workflow) runs this workflow. */
const runsOnPullRequest = (text) => /\bpull_request\b(?!_)/.test(triggersOf(text))

/** The jobs of a workflow: id → its text (two-space indented keys under `jobs:`). */
function jobsOf(text) {
  const body = text.slice(text.search(/^jobs:\s*$/m))
  const jobs = new Map()
  for (const block of body.split(/\n(?=  [A-Za-z0-9_-]+:\s*\n)/).slice(1)) {
    jobs.set(/^  ([A-Za-z0-9_-]+):/.exec(block)[1], block)
  }
  return jobs
}

/** A job's header (before `steps:`) and its steps (each `      - …` item). */
function stepsOf(job) {
  const at = job.search(/^    steps:\s*$/m)
  if (at < 0) return { header: job, steps: [] }
  return { header: job.slice(0, at), steps: job.slice(at).split(/\n(?=      - )/).slice(1) }
}

/** An `if:` that rules a pull request out. */
const excludesPullRequest = (cond) =>
  /github\.event_name\s*!=\s*'pull_request'/.test(cond) || /github\.event_name\s*==\s*'(?:push|schedule|workflow_dispatch|release)'/.test(cond)

/** A step's `run:` script, its comment lines dropped. */
function runOf(step) {
  const m = /^ {8}run:\s*(\|[-+]?\s*\n((?: {10}.*\n?|\s*\n)*)|(.*))$/m.exec(step)
  if (!m) return ""
  const script = m[2] !== undefined ? m[2].split("\n").map((l) => l.slice(10)).join("\n") : m[3]
  return script.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")
}

/** What a secret-bearing step does that a PR's own code could change. */
function prCodeIn(step) {
  const found = []
  const uses = /^ {6}- uses:\s*(\S+)|^ {8}uses:\s*(\S+)/m.exec(step)
  const action = uses?.[1] ?? uses?.[2]
  // GitHub's own actions run their own released code, never the PR's.
  if (action && !action.startsWith("actions/")) found.push(`uses ${action}`)
  const run = runOf(step)
  for (const m of run.matchAll(/(?:^|[\s;&|(`])(node|bash|sh|python3?|tsx|bun|deno)\s+((?:-\S+\s+)*)([^\s;&|)]+)/g)) {
    const target = m[3]
    const variable = /^"?\$\{?(\w+)\}?"?$/.exec(target)?.[1]
    if (variable) {
      if (!new RegExp(`(?:^|\\s)${variable}=\\.gate-base/`).test(run)) found.push(`${m[1]} $${variable} (not set to a .gate-base/ copy)`)
    } else if (!target.startsWith("-") && !target.startsWith("/") && !target.startsWith(".gate-base/")) {
      found.push(`${m[1]} ${target}`)
    }
  }
  for (const m of run.matchAll(/(?:^|[\s;&|(`])(\.\/\S+|npm|npx|yarn|pnpm)(?=\s|$)/g)) found.push(m[1])
  return found
}

/** Every step a pull request runs with a secret: `{ workflow, job, name, step }`. */
function secretStepsOnPullRequests() {
  const out = []
  for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const text = readFileSync(join(WORKFLOWS, file), "utf8")
    if (!runsOnPullRequest(text)) continue
    for (const [job, block] of jobsOf(text)) {
      const { header, steps } = stepsOf(block)
      if (excludesPullRequest(/^    if:\s*(.*)$/m.exec(header)?.[1] ?? "")) continue
      const jobSecrets = /secrets\./.test(header)
      // A step a pull request never runs: its own `if:` rules one out, or it waits on the output of a step that does.
      const skippedOnPr = new Set()
      const ifOf = (step) => /^ {8}if:\s*(.*)$/m.exec(step)?.[1] ?? ""
      for (const step of steps) {
        const cond = ifOf(step)
        const waitsOn = [...cond.matchAll(/steps\.([\w-]+)\.outputs/g)].map((m) => m[1])
        const id = /^ {8}id:\s*(\S+)/m.exec(step)?.[1]
        if (id && (excludesPullRequest(cond) || (waitsOn.length > 0 && waitsOn.every((w) => skippedOnPr.has(w))))) skippedOnPr.add(id)
      }
      for (const step of steps) {
        if (!jobSecrets && !/secrets\./.test(step)) continue
        const cond = ifOf(step)
        const waitsOn = [...cond.matchAll(/steps\.([\w-]+)\.outputs/g)].map((m) => m[1])
        if (excludesPullRequest(cond) || (waitsOn.length > 0 && waitsOn.some((w) => skippedOnPr.has(w)) && /==\s*'true'/.test(cond))) continue
        out.push({ workflow: file, job, name: /^ {6}- name:\s*(.*)$|^ {8}name:\s*(.*)$/m.exec(step)?.slice(1).find(Boolean) ?? "(unnamed)", step })
      }
    }
  }
  return out
}

test("the reader finds the secret steps a pull request runs (and none it never runs)", () => {
  const found = secretStepsOnPullRequests().map((s) => `${s.workflow} ${s.job}`)
  // ci.yml's symbol check and the shared header's install run on pull requests with a secret…
  assert.ok(found.includes("ci.yml check-ee-imports"), found.join("\n"))
  assert.ok(found.includes("shared-header-contract.yml contract"), found.join("\n"))
  assert.ok(found.includes("private-marker-check.yml gate"), found.join("\n"))
  // …the migration push runs only on a push to main, and community-e2e's keyed lane never on a pull request
  // (its gate step rules one out, and the keyed steps wait on that gate's output).
  assert.ok(!found.includes("ci.yml migrate"), found.join("\n"))
  assert.ok(!found.some((f) => f.startsWith("community-e2e.yml")), found.join("\n"))
})

test("a step a pull request runs with a secret runs the base branch's copy of its script, never the PR's", () => {
  const offenders = secretStepsOnPullRequests().flatMap((s) => prCodeIn(s.step).map((what) => `${s.workflow} ${s.job} "${s.name}": ${what}`))
  assert.deepEqual(offenders, [], "Check the script out from the base branch into .gate-base (see private-marker-check.yml) and run that copy.")
})

test("the rule catches what it is for", () => {
  const step = (run) => `      - name: x\n        env:\n          X: \${{ secrets.X }}\n        run: |\n${run.split("\n").map((l) => `          ${l}`).join("\n")}\n`
  assert.deepEqual(prCodeIn(step("node tools/check.mjs")), ["node tools/check.mjs"])
  assert.deepEqual(prCodeIn(step("sh frontend/x.sh \"$GITHUB_WORKSPACE\"")), ["sh frontend/x.sh"])
  assert.deepEqual(prCodeIn(step("gate=tools/check.mjs\nnode \"$gate\"")), ["node $gate (not set to a .gate-base/ copy)"])
  assert.deepEqual(prCodeIn(step("npm run check")), ["npm"])
  assert.deepEqual(prCodeIn(step("./scripts/x.sh")), ["./scripts/x.sh"])
  assert.deepEqual(prCodeIn("      - uses: some/action@v1\n        with:\n          token: ${{ secrets.X }}\n"), ["uses some/action@v1"])
  assert.deepEqual(prCodeIn("      - uses: actions/checkout@v5\n        with:\n          token: ${{ secrets.X }}\n"), [])
  assert.deepEqual(prCodeIn(step("gate=.gate-base/tools/check.mjs\nif [ ! -f \"$gate\" ]; then gate=tools/check.mjs; fi\nnode \"$gate\"")), [])
})

/** The secret steps this rule moved to base copies: run each as the workflow does, with stand-in scripts. */
const BASE_COPY_STEPS = [
  { workflow: "ci.yml", job: "check-ee-imports", script: "tools/check-private-leaks.mjs" },
  { workflow: "shared-header-contract.yml", job: "contract", script: "frontend/src/ee/shell/install-package.sh" },
]

test("each moved step runs the base copy (from its .gate-base checkout), and the PR's copy only while the base has none", () => {
  for (const { workflow, job, script } of BASE_COPY_STEPS) {
    const steps = secretStepsOnPullRequests().filter((s) => s.workflow === workflow && s.job === job)
    const runStep = steps.find((s) => runOf(s.step).includes(`.gate-base/${script}`))
    assert.ok(runStep, `${workflow} ${job}: no step runs .gate-base/${script}`)
    // The job checks the base branch's copy out, sparse, into .gate-base, before that step.
    const { steps: all } = stepsOf(jobsOf(readFileSync(join(WORKFLOWS, workflow), "utf8")).get(job))
    const checkout = all.findIndex((s) => /uses: actions\/checkout@/.test(s) && /path: \.gate-base/.test(s) && /ref: \$\{\{ github\.base_ref \|\| github\.ref_name \}\}/.test(s) && s.includes(script))
    assert.ok(checkout >= 0 && checkout < all.indexOf(runStep.step), `${workflow} ${job}: no base checkout of ${script} before the step`)

    const stub = (who) => (script.endsWith(".sh") ? `echo ran-${who}\n` : `console.log("ran-${who}")\n`)
    const dir = mkdtempSync(join(tmpdir(), "base-copy-step-"))
    try {
      for (const [path, who] of [[script, "pr"], [join(".gate-base", script), "base"]]) {
        mkdirSync(dirname(join(dir, path)), { recursive: true })
        writeFileSync(join(dir, path), script.endsWith(".sh") ? `PIN="1.2.3"\n${stub(who)}` : stub(who))
      }
      writeFileSync(join(dir, "step.sh"), runOf(runStep.step))
      const run = () => spawnSync("bash", ["-e", "step.sh"], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_WORKSPACE: dir } })
      const both = run()
      assert.equal(both.status, 0, `${workflow}: ${both.stderr}`)
      assert.match(both.stdout, /ran-base/)
      assert.doesNotMatch(both.stdout, /ran-pr/, `${workflow}: the PR's copy ran although the base has one`)
      rmSync(join(dir, ".gate-base"), { recursive: true, force: true })
      const bootstrap = run()
      assert.equal(bootstrap.status, 0)
      assert.match(bootstrap.stdout, /ran-pr/)
      assert.match(bootstrap.stdout, /has no copy of the .* yet/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
