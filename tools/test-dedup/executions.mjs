// tools/test-dedup/executions.mjs
// Section (a) of the duplicate report: every place ci.yml runs Vitest, expanded
// to the test files it runs, and the files more than one job runs on the same
// event. Pure (the caller passes ci.yml's text and the tracked files); Node
// built-ins only — the tools self-tests run with no npm install.
import { posix } from "node:path"
import { TEST_FILE } from "../test-select/test-node.mjs"

// Top-level jobs, split the way tools/__tests__/ci-preparation-gates.test.mjs
// does: a two-space-indented key starts a job, the next one ends it.
export function splitJobs(yml) {
  const jobsAt = yml.search(/^jobs:\s*$/m)
  const body = jobsAt < 0 ? "" : yml.slice(jobsAt)
  return [...body.matchAll(/^ {2}([\w-]+):\n([\s\S]*?)(?=^ {2}[\w-]+:\n|(?![\s\S]))/gm)]
    .map(([, id, text]) => ({ id, name: (text.match(/^ {4}name: (.+)$/m)?.[1].trim() ?? id).replace(/\$\{\{[^}]*\}\}/g, "*"), if: text.match(/^ {4}if: (.+)$/m)?.[1] ?? null, text }))
}

// The events the workflow triggers on (`on:` keys).
export function workflowEvents(yml) {
  const on = yml.match(/^on:\s*\n([\s\S]*?)(?=^\S)/m)?.[1] ?? ""
  return [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1])
}

// A condition restricts the events when it pins `github.event_name` with no
// `||` around it; anything else is assumed to allow every event (over-reporting
// a duplicate is safe, missing one is not).
export function eventsAllowed(condition, events) {
  if (!condition || /\|\|/.test(condition)) return events
  const eq = [...condition.matchAll(/github\.event_name == '([a-z_]+)'/g)].map((m) => m[1])
  const ne = [...condition.matchAll(/github\.event_name != '([a-z_]+)'/g)].map((m) => m[1])
  return events.filter((e) => (eq.length === 0 || eq.includes(e)) && !ne.includes(e))
}

// Steps of one job: name, if, working-directory and the full `run:` text
// (one line, or a `|` block).
export function splitSteps(jobText) {
  const steps = []
  const lines = jobText.split("\n")
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const start = line.match(/^( {6})- (.*)$/)
    if (start) { current = { name: null, if: null, workingDirectory: null, run: null }; steps.push(current); lines[i] = `${start[1]}  ${start[2]}` }
    if (!current) continue
    const l = lines[i]
    const kv = l.match(/^ {8}(name|if|working-directory|run): ?(.*)$/)
    if (!kv) continue
    const [, key, value] = kv
    if (key === "run" && /^[|>][-+]?$/.test(value.trim())) {
      const block = []
      for (i++; i < lines.length && (lines[i].startsWith("          ") || lines[i].trim() === ""); i++) block.push(lines[i].slice(10))
      i--
      current.run = block.join("\n").trimEnd()
    } else if (key === "run") current.run = value
    else if (key === "if") current.if = value
    else if (key === "working-directory") current.workingDirectory = value.trim()
    else current.name = value.trim()
  }
  return steps
}

// The parity run's discovery: `grep -rl -e … <dir> --include='<glob>'` inside
// the function that hands its matches to `npx vitest run "${files[@]}"`,
// after a `cd <dir>`. Returns null when ci.yml has no such function.
export function parityDiscovery(runText) {
  const fn = runText.match(/(\w+)\(\)\s*\{([\s\S]*?)\n\s*\}/g)?.find((f) => /npx vitest run[^\n]*"\$\{files\[@\]\}"/.test(f))
  if (!fn) return null
  const cd = fn.match(/^\s*cd (\S+)\s*$/m)?.[1] ?? "."
  const grep = fn.match(/grep -rl ((?:-e (?:'[^']*'|"[^"]*") )+)(\S+) --include=(?:'([^']+)'|"([^"]+)"|(\S+))/)
  if (!grep) return null
  const patterns = [...grep[1].matchAll(/-e (?:'([^']*)'|"([^"]*)")/g)].map((m) => m[1] ?? m[2])
  return { function: fn.match(/^(\w+)\(\)/)[1], cwd: cd, dir: grep[2], include: grep[3] ?? grep[4] ?? grep[5], patterns }
}

// What `grep -rl -e p… <dir> --include=<glob>` run in <cwd> lists, emulated
// over repo-relative files. The patterns are fixed strings (no BRE operator in
// them — anything else returns null, and the caller must not trust it).
export function discoverByGrep(discovery, files) {
  if (discovery.patterns.some((p) => /[.[\]*^$\\]/.test(p))) return null
  const base = posix.join(discovery.cwd, discovery.dir) + "/"
  const include = new RegExp(`^${discovery.include.replace(/[.+^$()|[\]\\{}]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)
  return files.filter((f) => f.path.startsWith(base) && include.test(posix.basename(f.path))
    && discovery.patterns.some((p) => f.source.includes(p))).map((f) => f.path).sort()
}

// One Vitest invocation of a step, as a description of the files it runs:
//   { kind: "suite", project }           — run-suite.sh: the project's whole suite (or its selection)
//   { kind: "package", dir, files? }     — `npm run test --workspace=<pkg> [-- files]`, or `npm run test` in packages/<dir>
//   { kind: "files", cwd, files }        — `npx vitest run <files>`
//   { kind: "discover", discovery }      — the parity function
export function invocationsOf(step, packageDirs) {
  const run = step.run ?? ""
  const out = []
  const cwd = step.workingDirectory ?? "."
  if (/run-suite\.sh/.test(run)) out.push({ kind: "suite", project: cwd })
  for (const m of run.matchAll(/npm run test --workspace=(\S+)(?: -- ([^\n]+))?/g)) {
    const dir = packageDirs.get(m[1])
    if (dir) out.push({ kind: "package", dir, files: m[2] ? m[2].trim().split(/\s+/).filter((a) => TEST_FILE.test(a)) : null })
  }
  if (/^npm run test\s*$/m.test(run) && cwd.startsWith("packages/")) out.push({ kind: "package", dir: cwd, files: null })
  const discovery = parityDiscovery(run)
  if (discovery) out.push({ kind: "discover", discovery })
  for (const m of run.matchAll(/npx vitest run ([^\n]+)/g)) {
    const files = m[1].trim().split(/\s+/).filter((a) => TEST_FILE.test(a))
    if (files.length > 0) out.push({ kind: "files", cwd, files })
  }
  return out
}

// The repo-relative test files one invocation runs.
//   tracked: every tracked path; read(path) → source (for the discovery).
export function expand(inv, { tracked, read }) {
  const tests = (prefix, skip = /(?:^|\/)(?:node_modules|dist|playwright)\//) => tracked
    .filter((p) => p.startsWith(prefix) && TEST_FILE.test(p) && !skip.test(p.slice(prefix.length)))
  if (inv.kind === "suite") return tests(`${inv.project}/`)
  if (inv.kind === "package") return inv.files ? inv.files.map((f) => posix.join(inv.dir, f)) : tests(`${inv.dir}/`)
  if (inv.kind === "files") return inv.files.map((f) => posix.join(inv.cwd, f))
  const base = posix.join(inv.discovery.cwd, inv.discovery.dir) + "/"
  const candidates = tracked.filter((p) => p.startsWith(base)).map((p) => ({ path: p, source: read(p) ?? "" }))
  return discoverByGrep(inv.discovery, candidates) ?? []
}

// A file a dedicated job lists by name (`npx vitest run <file>`) whose suites
// switch on the environment (`describe.runIf(…)`, `skipIf(…)`) runs for real
// only in that job (the real-Redis suites): not a duplicate.
export const ENV_GATED = /\.(?:runIf|skipIf)\s*\(/

// Every test file run by more than one execution on the same event.
//   → [{ file, events, executions: ["<job name> / <step name>", …], envGated }]
export function duplicateExecutions(yml, { tracked, read, packageDirs }) {
  const events = workflowEvents(yml)
  const runs = new Map() // file → [{ label, events }]
  const executions = []
  for (const job of splitJobs(yml)) {
    const jobEvents = eventsAllowed(job.if, events)
    for (const step of splitSteps(job.text)) {
      for (const inv of invocationsOf(step, packageDirs)) {
        const label = `${job.name} / ${step.name ?? "(unnamed step)"}`
        const stepEvents = eventsAllowed(step.if, jobEvents)
        const files = expand(inv, { tracked, read })
        executions.push({ label, kind: inv.kind, events: stepEvents, files: files.length })
        for (const f of files) (runs.get(f) ?? runs.set(f, []).get(f)).push({ label, kind: inv.kind, events: stepEvents })
      }
    }
  }
  const duplicates = []
  for (const [file, list] of runs) {
    const shared = events.filter((e) => list.filter((r) => r.events.includes(e)).length > 1)
    if (shared.length === 0) continue
    duplicates.push({ file, events: shared, executions: [...new Set(list.map((r) => r.label))], envGated: list.some((r) => r.kind === "files") && ENV_GATED.test(read(file) ?? "") })
  }
  return { executions, duplicates: duplicates.sort((a, b) => a.file.localeCompare(b.file)) }
}
