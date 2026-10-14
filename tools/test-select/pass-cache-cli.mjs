#!/usr/bin/env node
// tools/test-select/pass-cache-cli.mjs — the pass cache's I/O (pass-cache.mjs).
//
// plan:   node pass-cache-cli.mjs plan --project frontend --shard 2/4 --passed passed.txt \
//           [--candidates list.txt] --run-out run.txt --keys-out keys.json [--summary "$GITHUB_STEP_SUMMARY"]
//   Writes this shard's files to run (project-relative; the files whose exact
//   inputs passed before are left out) and every candidate's key. Candidates
//   default to every test file of the project.
// record: node pass-cache-cli.mjs record --project frontend --keys keys.json --report vitest.json \
//           [--log vitest.log] --out proven.txt
//   Writes the keys of the files that ran and passed (nothing after an
//   unhandled error).
// merge:  node pass-cache-cli.mjs merge --previous passed.txt --out passed.txt proven-1.txt …
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import {
  environmentFiles, environmentKey, isoWeek, mergePassed, planShard, provenKeys, setupImports, testKey, uncacheableReason,
} from "./pass-cache.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const lines = (file) => (file && existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [])
const [command, ...rest] = process.argv.slice(2)
const { values: o, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
  project: { type: "string" }, shard: { type: "string" }, passed: { type: "string" }, candidates: { type: "string" },
  "run-out": { type: "string" }, "keys-out": { type: "string" }, summary: { type: "string" },
  keys: { type: "string" }, report: { type: "string" }, log: { type: "string" }, out: { type: "string" },
  previous: { type: "string" }, graph: { type: "string" }, rc: { type: "string" },
} })

if (command === "plan") {
  const [shard, shards] = (o.shard ?? "1/1").split("/").map(Number)
  if (!["frontend", "backend"].includes(o.project) || !(shard >= 1 && shard <= shards)) {
    process.stderr.write("plan needs --project frontend|backend and --shard i/n\n")
    process.exit(2)
  }
  // The graph the Select step already built (cli.mjs --graph-out), when it
  // built one: the walk costs a minute or more on a CI runner.
  let tests = null
  if (o.graph && existsSync(o.graph)) {
    try { tests = JSON.parse(readFileSync(o.graph, "utf8")) } catch { tests = null }
  }
  if (!Array.isArray(tests) || tests.length === 0) tests = await (await import("./graph.mjs")).buildTestGraph(repoRoot, o.project)
  const trackedFiles = execFileSync("git", ["-C", repoRoot, "ls-files"], { encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
  const memo = new Map()
  const hash = (rel) => {
    if (!memo.has(rel)) {
      let h = "missing"
      try { h = createHash("sha256").update(readFileSync(path.join(repoRoot, rel))).digest("hex") } catch { /* stays missing */ }
      memo.set(rel, h)
    }
    return memo.get(rel)
  }
  const manifest = path.join(repoRoot, o.project, "src/test/no-isolate-files.json")
  const sharedWorker = new Set(existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).map((f) => `${o.project}/${f}`) : [])
  const setup = `${o.project}/src/test/setup.ts`
  const setupDeps = existsSync(path.join(repoRoot, setup)) ? setupImports(setup, readFileSync(path.join(repoRoot, setup), "utf8")) : []
  const environment = environmentKey({
    files: [...new Set([...environmentFiles(trackedFiles), ...setupDeps])].sort(), hash,
    extra: [`node:${process.version}`, `project:${o.project}`, `week:${isoWeek()}`,
      `image:${process.env.ImageVersion ?? process.env.RUNNER_ENVIRONMENT ?? "local"}`],
  })
  const keys = new Map(tests.map((t) => [t.file, testKey(t, { hash, trackedFiles, environment, sharedWorker })]))
  const candidates = o.candidates ? lines(o.candidates).map((f) => `${o.project}/${f}`) : tests.map((t) => t.file)
  // A selection that names nothing here is a broken input, never "run nothing":
  // fail, so the shard runs without a plan.
  if (o.candidates && candidates.length === 0) {
    process.stderr.write(`plan: ${o.candidates} lists no test file\n`)
    process.exit(1)
  }
  const { run, skipped } = planShard({ candidates, shard, shards, keys, passed: new Set(lines(o.passed)) })
  const local = (f) => path.posix.relative(o.project, f)
  writeFileSync(o["run-out"], run.map((f) => `${local(f)}\n`).join(""))
  if (o["keys-out"]) writeFileSync(o["keys-out"], `${JSON.stringify(Object.fromEntries(keys))}\n`)
  const uncacheable = tests.filter((t) => uncacheableReason(t, sharedWorker)).length
  const line = `${o.project} shard ${shard}/${shards}: ${run.length} file(s) to run, ${skipped.length} skipped — passed before with identical inputs (${uncacheable} of ${tests.length} test files are never cached)`
  process.stdout.write(`${line}\n`)
  if (o.summary) {
    appendFileSync(o.summary, `#### Pass cache\n\n${line}.\n${skipped.length ? `\n<details><summary>Skipped</summary>\n\n${skipped.map((f) => `- \`${f}\``).join("\n")}\n</details>\n` : ""}\n`)
  }
} else if (command === "record") {
  const keys = new Map(Object.entries(JSON.parse(readFileSync(o.keys, "utf8"))))
  let report = null
  try { report = JSON.parse(readFileSync(o.report, "utf8")) } catch { /* no usable report: nothing proven */ }
  const log = o.log && existsSync(o.log) ? readFileSync(o.log, "utf8") : ""
  const unhandled = log.includes("Unhandled Error") || log.includes("Unhandled Rejection")
  // Without the run's exit code nothing is recorded.
  const rcText = o.rc && existsSync(o.rc) ? readFileSync(o.rc, "utf8").trim() : ""
  const exitCode = /^\d+$/.test(rcText) ? Number(rcText) : null
  const projectDir = path.join(repoRoot, o.project)
  const toRepoPath = (name) => path.relative(repoRoot, path.isAbsolute(name) ? name : path.join(projectDir, name)).split(path.sep).join("/")
  const proven = exitCode === null ? [] : provenKeys({ report, keys, unhandled, toRepoPath, exitCode })
  writeFileSync(o.out, proven.map((k) => `${k}\n`).join(""))
  process.stdout.write(`${o.project}: ${proven.length} file(s) recorded as passed\n`)
} else if (command === "merge") {
  const merged = mergePassed(lines(o.previous), positionals.flatMap(lines))
  writeFileSync(o.out, merged.map((k) => `${k}\n`).join(""))
  process.stdout.write(`pass cache: ${merged.length} key(s)\n`)
} else {
  process.stderr.write("usage: pass-cache-cli.mjs plan|record|merge …\n")
  process.exit(2)
}
