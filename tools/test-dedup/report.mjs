#!/usr/bin/env node
// tools/test-dedup/report.mjs
// The test de-duplication report (read-only): where CI does the same test work
// twice. See tools/test-dedup/README.md.
//   node tools/test-dedup/report.mjs --project backend [--graph g.json] [--durations shard1.log …] [--out report.md]
//   --project frontend | backend | packages (every package with a test script) | packages/<dir>
// It reuses the selector's test graph (tools/test-select/graph.mjs) — never a
// second one — and loads Vitest (through graph.mjs) and `typescript` lazily,
// so its pure parts run under the tools self-tests with no npm install.
// @reads .github/workflows/ci.yml frontend/src/test/no-isolate-files.json packages/*/package.json {frontend,backend,packages}/**/*.{test,spec}.{ts,tsx,js,mjs}
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { copies, duplicateBodies, extractTests } from "./bodies.mjs"
import { MAX_LINES, MIN_DEPS, MIN_JACCARD, clusterSaving, mergeClusters, parseDurations, perDependency } from "./clusters.mjs"
import { CATEGORIES, classifyCrossTree } from "./cross-tree.mjs"
import { duplicateExecutions, expand, invocationsOf, splitJobs, splitSteps } from "./executions.mjs"

const fmt = (s) => (s === null ? "—" : `${s.toFixed(1)} s`)
const list = (xs, max = 8) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} … (+${xs.length - max})`)

// Every input is passed in, so the self-test renders from fixtures.
export function renderReport({ project, executions, clusters, perDep, bodies, crossTree }) {
  const out = [`# Test de-duplication report: ${project}`, ""]

  out.push("## (a) Duplicate CI executions", "",
    "Each Vitest invocation in `.github/workflows/ci.yml`, expanded to its files. A file listed below runs in more than one of them on the same event.", "",
    "| Execution | Kind | Events | Files |", "|---|---|---|---|",
    ...executions.executions.map((e) => `| ${e.label} | ${e.kind} | ${e.events.join(", ")} | ${e.files} |`), "")
  const real = executions.duplicates.filter((d) => !d.envGated)
  const gated = executions.duplicates.filter((d) => d.envGated)
  const byPair = new Map()
  for (const d of real) { const k = d.executions.join(" + "); (byPair.get(k) ?? byPair.set(k, []).get(k)).push(d.file) }
  out.push(`**${real.length} files run twice or more** (${gated.length} more switch on the environment with \`runIf\`/\`skipIf\` and run for real in one job only — not duplicates).`, "")
  for (const [pair, files] of byPair) out.push(`- ${pair}: ${files.length} files — ${list(files.map((f) => `\`${f}\``))}`)
  if (gated.length) out.push(`- environment-gated: ${list(gated.map((d) => `\`${d.file}\``))}`)
  out.push("")

  const files = clusters.reduce((n, c) => n + c.files.length, 0)
  const removable = clusters.reduce((n, c) => n + c.files.length - 1, 0)
  const capped = clusters.reduce((n, c) => n + c.files.length - c.mergedFiles, 0)
  const total = (merged) => (perDep === null ? null : clusters.reduce((n, c) => n + clusterSaving(c, perDep, merged(c)), 0))
  out.push("## (b) Merge clusters", "",
    `Same directory and stem (name up to the first \`-\` or \`.\`), the same \`vi.mock\` set, ≥ ${MIN_DEPS} dependencies each, pairwise dependency Jaccard ≥ ${MIN_JACCARD}, no frontend shared-worker file.`, "",
    `**${clusters.length} clusters, ${files} files** — ${removable} files fewer if each became one file, ${capped} fewer under the ${MAX_LINES}-line cap.`,
    perDep === null ? "No saving estimate (no `--durations` logs, or `--project packages`, whose suites share a shard log with Backend Tests)."
      : `Estimated saving per full run (model: load cost ∝ dependencies, ${(perDep * 1000).toFixed(2)} ms per dependency from the logs): ${fmt(total(() => 1))} collapsed to one file each, ${fmt(total((c) => c.mergedFiles))} under the cap. A model — measure before acting on it.`, "",
    "| Cluster | Files | Lines | Merged files | Est. saving |", "|---|---|---|---|---|",
    ...clusters.map((c) => `| \`${c.dir}/${c.stem}*\` | ${c.files.length} | ${c.lines} | ${c.mergedFiles} | ${fmt(clusterSaving(c, perDep))} |`), "")

  out.push("## (c) Copy-pasted test bodies", "")
  if (!bodies) out.push("Skipped: `typescript` could not be loaded.", "")
  else {
    out.push(`${bodies.total} tests, ${bodies.long} with a body of 80+ characters (comments and layout ignored).`, "",
      `**Same describe scope: ${copies(bodies.sameScope, (g) => g.titles.length)} copies in ${bodies.sameScope.length} groups** — the candidates.`, "",
      ...bodies.sameScope.map((g) => `- \`${g.file}\`${g.scope ? ` › ${g.scope}` : ""}: ${g.titles.map((t) => `"${t}"`).join(" = ")}`), "",
      `**Across files, same body, subjects and mock/setup context: ${copies(bodies.crossFile, (g) => g.files.length)} copies in ${bodies.crossFile.length} groups** — mostly deliberate per-locale or per-engine twins; judge each.`, "",
      ...bodies.crossFile.map((g) => `- "${g.title}": ${g.files.map((f) => `\`${f}\``).join(", ")}`), "")
  }

  out.push("## (d) Cross-tree parity tests", "")
  if (!crossTree) out.push("Only for `--project backend` (the parity run discovers backend tests).", "")
  else {
    const count = (c) => crossTree.filter((x) => x.category === c).length
    out.push(`The parity run in Type Check discovers **${crossTree.length} files** with its grep; each also runs in Backend Tests.`, "",
      "| Category | Files |", "|---|---|", ...CATEGORIES.map((c) => `| ${c} | ${count(c)} |`), "",
      ...CATEGORIES.flatMap((c) => {
        const xs = crossTree.filter((x) => x.category === c)
        return xs.length ? [`**${c}**`, "", ...xs.map((x) => `- \`${x.file}\`${x.importsFrontend ? " (imports frontend/)" : ""}`), ""] : []
      }))
    const stray = crossTree.filter((x) => !CATEGORIES.includes(x.category))
    if (stray.length) out.push(`Not in the graph: ${stray.map((x) => `\`${x.file}\``).join(", ")}`, "")
  }
  return out.join("\n")
}

// The Vitest projects one --project names: frontend, backend, every package
// with a test script ("packages"), or one of them ("packages/<dir>"). null
// when it names none.
export function projectsOf(project, manifests) {
  if (project === "frontend" || project === "backend") return [project]
  const testable = manifests.filter((m) => m.pkg?.scripts?.test).map((m) => m.dir).sort()
  if (project === "packages") return testable.length ? testable : null
  return testable.includes(project) ? [project] : null
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
  const { values: o } = parseArgs({ options: {
    project: { type: "string" }, graph: { type: "string" }, durations: { type: "string", multiple: true }, out: { type: "string" },
  } })
  const read = (p) => { try { return readFileSync(path.join(repoRoot, p), "utf8") } catch { return null } }
  const manifests = readdirSync(path.join(repoRoot, "packages"))
    .map((dir) => ({ dir: `packages/${dir}`, manifest: read(`packages/${dir}/package.json`) }))
    .filter((m) => m.manifest).map((m) => ({ dir: m.dir, pkg: JSON.parse(m.manifest) }))
  const packageDirs = new Map(manifests.map((m) => [m.pkg.name, m.dir]))
  const projects = projectsOf(o.project, manifests)
  if (!projects) {
    process.stderr.write("--project must be frontend, backend, packages or packages/<dir> (a package with a test script)\n")
    process.exit(2)
  }
  const tracked = execFileSync("git", ["-C", repoRoot, "ls-files"], { encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
  const buildTestGraph = async (p) => (await import("../test-select/graph.mjs")).buildTestGraph(repoRoot, p)
  const tests = o.graph ? JSON.parse(readFileSync(o.graph, "utf8"))
    : (await Promise.all(projects.map(buildTestGraph))).flat()
  const yml = read(".github/workflows/ci.yml")
  const executions = duplicateExecutions(yml, { tracked, read, packageDirs })

  const sharedWorkerList = read("frontend/src/test/no-isolate-files.json")
  const sharedWorker = new Set(sharedWorkerList ? JSON.parse(sharedWorkerList).map((f) => `frontend/${f}`) : [])
  const clusters = mergeClusters(tests, { read, sharedWorker })
  const durations = (o.durations ?? []).map((f) => parseDurations(readFileSync(f, "utf8"))).filter(Boolean)
  const perDep = o.project.startsWith("packages") ? null : perDependency(durations.length ? durations : null, tests)

  let bodies = null
  let ts = null
  try { ts = createRequire(path.join(repoRoot, "package.json"))("typescript") } catch { /* section (c) is skipped */ }
  if (ts) bodies = duplicateBodies(tests.flatMap((t) => extractTests(ts, t.file, read(t.file) ?? "")))

  let crossTree = null
  if (o.project === "backend") {
    const parity = splitJobs(yml).flatMap((j) => splitSteps(j.text)).flatMap((s) => invocationsOf(s, packageDirs)).find((i) => i.kind === "discover")
    if (!parity) throw new Error("ci.yml has no cross-tree parity discovery — the report cannot classify it")
    const discovered = expand(parity, { tracked, read })
    // The emulated grep must agree with the real one, or the report is wrong.
    if (existsSync(path.join(repoRoot, parity.discovery.cwd))) {
      const args = ["-rl", ...parity.discovery.patterns.flatMap((p) => ["-e", p]), parity.discovery.dir, `--include=${parity.discovery.include}`]
      // Tracked files on both sides: an untracked test in a dirty checkout is not CI's.
      const trackedSet = new Set(tracked)
      const real = execFileSync("grep", args, { cwd: path.join(repoRoot, parity.discovery.cwd), encoding: "utf8" })
        .split("\n").filter(Boolean).map((f) => path.posix.join(parity.discovery.cwd, f)).filter((f) => trackedSet.has(f)).sort()
      if (real.join("\n") !== discovered.join("\n")) throw new Error(`the emulated parity grep found ${discovered.length} files, the real grep ${real.length}`)
    }
    crossTree = classifyCrossTree(discovered, tests)
  }

  const report = renderReport({ project: o.project, executions, clusters, perDep, bodies, crossTree })
  if (o.out) writeFileSync(o.out, `${report}\n`)
  else process.stdout.write(`${report}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
