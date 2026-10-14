#!/usr/bin/env node
// @reads-none reads only the vitest JSON report it writes to a temp dir
// Re-runs the shared-worker qualification: the files in
// src/test/no-isolate-files.json, without isolation, in shuffled orders — first
// with several workers (the mixes CI and developers see), then with one worker
// (every listed file shares one worker, so every pair meets in one direction).
// A file belongs in the manifest only if every run passes it; one failure and
// it stays isolated. Use it after adding files to the manifest:
//
//   npm run test:qualify-shared                       # 3 runs × 6 workers + 2 runs × 1 worker
//   npm run test:qualify-shared -- --runs 5 --single 3 --workers 4 --seed 100
//
// Each listed file is also checked by shared-worker-setup.ts (it fails a file
// that leaves a global, env var, locale, clock or DOM behind) and by the guard
// test (src/test/__tests__/test-projects.test.ts: no module mocks, timer or
// global stubs). Exit code 1 when any run fails; the failing files are listed.
/* global process, console */
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} needs a whole number`)
  return value
}

const runs = option("runs", 3)
const single = option("single", 2)
const workers = option("workers", 6)
const firstSeed = option("seed", Date.now() % 100_000)

const plan = [
  ...Array.from({ length: runs }, (_, i) => ({ workers, seed: firstSeed + i })),
  ...Array.from({ length: single }, (_, i) => ({ workers: 1, seed: firstSeed + runs + i })),
]

const out = mkdtempSync(path.join(tmpdir(), "qualify-no-isolate-"))
const failures = new Map()
try {
  for (const { workers: count, seed } of plan) {
    const json = path.join(out, `run-${seed}.json`)
    const started = Date.now()
    const result = spawnSync(
      "npx",
      ["vitest", "run", "--project", "shared-worker", "--sequence.shuffle", `--sequence.seed=${seed}`, "--reporter=dot", "--reporter=json", `--outputFile.json=${json}`],
      { cwd: FRONTEND, env: { ...process.env, VITEST_MAX_WORKERS: String(count) }, stdio: ["ignore", "ignore", "inherit"] },
    )
    let report
    try {
      report = JSON.parse(readFileSync(json, "utf8"))
    } catch {
      console.error(`seed ${seed}: Vitest wrote no report (exit ${result.status}) — treat the run as failed`)
      process.exitCode = 1
      continue
    }
    const failed = report.testResults.filter((file) => file.status !== "passed").map((file) => path.relative(FRONTEND, file.name))
    for (const file of failed) failures.set(file, [...(failures.get(file) ?? []), seed])
    const seconds = Math.round((Date.now() - started) / 1000)
    const files = report.testResults.length
    console.log(`seed ${seed}, ${count} worker(s): ${files - failed.length}/${files} files passed, ${seconds} s`)
  }
} finally {
  rmSync(out, { recursive: true, force: true })
}

if (failures.size > 0) {
  console.log(`\n${failures.size} file(s) failed without isolation — take them out of src/test/no-isolate-files.json:`)
  for (const [file, seeds] of failures) console.log(`  ${file}  (seed ${seeds.join(", ")})`)
  process.exitCode = 1
} else if (!process.exitCode) {
  console.log(`\nAll ${plan.length} runs passed.`)
}
