#!/usr/bin/env node
// tools/ci/job-inputs-check.mjs <job key> [--write]
// Holds a gated job's declared inputs (job-inputs.json) to what its Vitest
// suite really reaches: Vitest's own import graph of every test file the job
// runs and of its setup files (tools/test-select/graph.mjs — workspace
// packages resolve to packages/<dir>/dist/, so it needs `npm ci` and the
// built packages), plus every @reads / @test-watches glob on the way. A file
// outside the inputs is an error: a PR changing it would skip the job.
// `--write` adds what is missing to job-inputs.json instead (sorted); review
// the diff — a directory glob may read better than a list of its files.
//
// It runs as a step of each gated Vitest job, so it runs exactly when the
// declaration can have gone stale: on every PR that changed an input, and on
// every push. Locally: `node tools/ci/job-inputs-check.mjs remotion` after
// `npm run build:packages`.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildTestGraph } from "../test-select/graph.mjs"
import { INPUTS_FILE, isCovered, isGlobCovered, requiredInputs, vitestInvocation, workflowJobs } from "./job-inputs.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (p) => readFileSync(path.join(repoRoot, p), "utf8")
const readJson = (p) => JSON.parse(read(p))

// The workspace packages `packages/<dir>` depends on, transitively, by dir.
function workspaceDepsOf() {
  const manifests = new Map(readdirSync(path.join(repoRoot, "packages"))
    .filter((dir) => existsSync(path.join(repoRoot, "packages", dir, "package.json")))
    .map((dir) => [dir, readJson(`packages/${dir}/package.json`)]))
  const byName = new Map([...manifests].map(([dir, pkg]) => [pkg.name, dir]))
  return (dir) => {
    const seen = new Set()
    const queue = [dir]
    while (queue.length > 0) {
      const pkg = manifests.get(queue.shift())
      for (const name of Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies, ...pkg?.peerDependencies })) {
        const d = byName.get(name)
        if (d && d !== dir && !seen.has(d)) { seen.add(d); queue.push(d) }
      }
    }
    return [...seen].sort()
  }
}

export async function checkJob(key, { write = false } = {}) {
  const declaration = readJson(INPUTS_FILE)
  const job = declaration.jobs[key]
  if (!job) throw new Error(`${INPUTS_FILE} declares no job "${key}" (it has ${Object.keys(declaration.jobs).join(", ")})`)
  const body = workflowJobs(read(".github/workflows/ci.yml"))[job.job]
  if (!body) throw new Error(`ci.yml has no job ${job.job}`)
  const run = vitestInvocation(body, (dir, name) => readJson(`${dir}/package.json`).scripts?.[name] ?? null)
  if (!run) throw new Error(`${job.job} runs no Vitest suite — nothing for this check to hold`)
  const tests = await buildTestGraph(repoRoot, run.project, { config: run.config, files: run.files, setupFiles: true })

  const workspaceDeps = workspaceDepsOf()
  const problems = []
  const missing = new Set()
  for (const t of tests) {
    const what = t.setup ? `setup file ${t.file}` : t.file
    if (t.always) problems.push(`${what} declares @test-always (${t.always}) — it may read anything, so no input list can hold it`)
    if (t.undeclaredReader) problems.push(`${what} reaches ${t.undeclaredReader}, which reads files and declares no @reads`)
    for (const p of [t.file, ...t.deps]) {
      if (p.startsWith("../")) { problems.push(`${what} reaches ${p}, outside the repository`); continue }
      for (const need of requiredInputs(p, workspaceDeps)) {
        if (!(need === p ? isCovered(p, job.inputs) : isGlobCovered(need, job.inputs))) missing.add(need)
      }
    }
    for (const g of [...t.watches, ...t.reads]) if (!isGlobCovered(g, job.inputs)) missing.add(g)
  }
  if (write && missing.size > 0) {
    declaration.jobs[key] = { ...job, inputs: [...new Set([...job.inputs, ...missing])].sort() }
    writeFileSync(path.join(repoRoot, INPUTS_FILE), `${JSON.stringify(declaration, null, 2)}\n`)
  }
  return { job: job.job, tests: tests.filter((t) => !t.setup).length, problems, missing: write ? [] : [...missing].sort(), added: write ? [...missing].sort() : [] }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [key, ...flags] = process.argv.slice(2)
  if (!key) {
    console.error("usage: node tools/ci/job-inputs-check.mjs <job key> [--write]")
    process.exit(2)
  }
  const result = await checkJob(key, { write: flags.includes("--write") })
  for (const p of result.problems) console.log(`::error::${p}`)
  if (result.added.length > 0) console.log(`added to ${INPUTS_FILE} → ${key}:\n  ${result.added.join("\n  ")}`)
  if (result.missing.length > 0) {
    console.log(`::error::${result.job}'s tests reach ${result.missing.length} path(s) that ${INPUTS_FILE} does not declare as its inputs — a PR changing one would skip the job`)
    console.log(`  ${result.missing.join("\n  ")}`)
    console.log(`Declare them: node tools/ci/job-inputs-check.mjs ${key} --write (after npm run build:packages), then review the diff.`)
  }
  if (result.problems.length > 0 || result.missing.length > 0) process.exit(1)
  console.log(`${result.job}: the ${result.tests} test file(s) reach only declared inputs`)
}
