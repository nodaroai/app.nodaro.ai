// tools/test-select/pass-cache.mjs
// The pass cache (§5.6, decided 2026-10-14): a test file whose exact inputs
// already passed is not run again on a PR. Pure where it can be — the CLI
// (pass-cache-cli.mjs) does the I/O. Built-ins only, like the rest of the
// engine: the tools self-test job runs without npm install.
//
// A file's key covers everything its result can depend on that we can name:
// its own content, every module Vitest's graph says it loads (workspace
// package dist files included, hashed from disk), every repo file its own or
// its helpers' `@test-watches` globs match, every file a product module it
// loads declares with `@reads`, its snapshot file, and an environment key
// (the engine's global triggers — lockfile, configs, setup, ci.yml, this
// engine — plus every non-module test-data file, the Node version and an
// epoch). Anything we cannot name makes the file uncacheable: it always runs.
import { createHash } from "node:crypto"
import { matchesAny } from "./glob.mjs"
import { GLOBAL_TRIGGERS } from "./select.mjs"

// Bump to throw every recorded pass away (a fixed bug in the key, a runner
// image change the key cannot see).
export const PASS_CACHE_EPOCH = 1

const TEST_DATA_DIR = /\/(?:__tests__|__goldens__|__fixtures__|fixtures)\//
const JS_TS_MODULE = /\.[cm]?[jt]sx?$/

const sha = (text) => createHash("sha256").update(text).digest("hex")

// The files whose change can change any test's outcome: the engine's global
// triggers, and test data that no declaration names (its readers' spellings
// are not all known — the same backstop select.mjs applies).
// Also: manual mocks (select.mjs runs everything on a __mocks__ change too)
// and the disposable runner's image definition.
const ENVIRONMENT_EXTRA = ["**/__mocks__/**", "tools/ci-runner/runner.Dockerfile"]
export function environmentFiles(trackedFiles) {
  return trackedFiles.filter((f) => matchesAny(f, GLOBAL_TRIGGERS) || matchesAny(f, ENVIRONMENT_EXTRA)
    || (TEST_DATA_DIR.test(f) && !JS_TS_MODULE.test(f))).sort()
}

// The modules a project's setup file imports by relative path (static or
// literal dynamic): every test runs them, but Vitest's graph starts at the
// test file and never lists them. One level is enough today; their own
// imports are ordinary sources a test that observes them also imports.
export function setupImports(setupPath, source) {
  const dir = setupPath.slice(0, setupPath.lastIndexOf("/"))
  const out = new Set()
  for (const m of source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    const parts = `${dir}/${m[1]}`.split("/")
    const stack = []
    for (const part of parts) {
      if (part === "..") stack.pop()
      else if (part !== ".") stack.push(part)
    }
    out.add(stack.join("/").replace(/\.js$/, ".ts"))
  }
  return [...out].sort()
}

// A coarse time bucket bounds every drift the key cannot see — the clock that
// date-dependent tests read, a runner image rebuilt with other system
// libraries, a flaky pass — to one ISO week.
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7)).padStart(2, "0")}`
}

export function environmentKey({ files, hash, extra = [] }) {
  return sha([`epoch:${PASS_CACHE_EPOCH}`, ...extra, ...files.map((f) => `${f}:${hash(f)}`)].join("\n"))
}

// Why a test is never cached, or null when it may be. `@test-always` and the
// untagged scanners read files nobody declared; a product module that reads
// undeclared files likewise; a shared-worker file's result can depend on the
// files before it in the worker.
export function uncacheableReason(test, sharedWorker = new Set()) {
  if (test.always) return "@test-always"
  if (test.scanner) return "reads files it does not declare"
  if (test.undeclaredReader) return `loads ${test.undeclaredReader}, which reads files it does not declare`
  if (sharedWorker.has(test.file)) return "runs in the shared worker"
  return null
}

// trackedFiles: repo-relative paths (`git ls-files`); hash(path) → content hash
// or "missing". Returns the key, or null for an uncacheable test.
export function testKey(test, { hash, trackedFiles, environment, sharedWorker }) {
  if (uncacheableReason(test, sharedWorker)) return null
  // An input we cannot read cannot be shown unchanged.
  if (hash(test.file) === "missing" || test.deps.some((d) => hash(d) === "missing")) return null
  const globs = [...test.watches, ...(test.reads ?? [])]
  const declared = globs.length ? trackedFiles.filter((f) => matchesAny(f, globs)) : []
  const slash = test.file.lastIndexOf("/")
  const snapshot = `${test.file.slice(0, slash)}/__snapshots__/${test.file.slice(slash + 1)}.snap`
  const parts = [
    `env:${environment}`,
    `test:${test.file}:${hash(test.file)}`,
    `snapshot:${hash(snapshot)}`,
    ...[...new Set(test.deps)].sort().map((d) => `dep:${d}:${hash(d)}`),
    ...[...new Set(declared)].sort().map((f) => `read:${f}:${hash(f)}`),
  ]
  // 128 bits: collision-free at this scale, half the cache entry
  return sha(parts.join("\n")).slice(0, 32)
}

// Which shard runs a file: a stable hash of its path, so every shard agrees
// whatever pass cache each one restored — shard first, filter second, and no
// file can fall between shards.
export function shardOf(file, shards) {
  return (Number.parseInt(sha(file).slice(0, 8), 16) % shards) + 1
}

// candidates: repo-relative test files this run would run; keys: file → key
// (null = uncacheable); passed: Set of keys that passed before.
export function planShard({ candidates, shard, shards, keys, passed }) {
  const run = []
  const skipped = []
  for (const file of [...candidates].sort()) {
    if (shardOf(file, shards) !== shard) continue
    const key = keys.get(file)
    if (key && passed.has(key)) skipped.push(file)
    else run.push(file)
  }
  return { run, skipped }
}

// The keys this run proved: files that ran and passed. Nothing when the run
// cannot be trusted file by file (no report, or Vitest logged an unhandled
// error the JSON report does not attribute).
// A file counts only when every one of its tests ran and passed: a file whose
// tests were skipped (an `it.skipIf(!ffmpegAvailable)` on a runner without
// ffmpeg) reports "passed" with nothing proven. A failed run that names no
// failing file proves nothing either (a crash the report cannot attribute).
export function provenKeys({ report, keys, unhandled, toRepoPath, exitCode = 0 }) {
  if (!report || unhandled) return []
  const results = report.testResults ?? []
  if (exitCode !== 0 && !results.some((r) => r.status === "failed")) return []
  const out = []
  for (const r of results) {
    if (r.status !== "passed") continue
    const assertions = r.assertionResults ?? []
    if (assertions.length === 0 || assertions.some((a) => a.status !== "passed")) continue
    const key = keys.get(toRepoPath(r.name))
    if (key) out.push(key)
  }
  return out
}

// The recorded set: newest first, capped, so the cache entry stays small.
// ~20 versions of both suites' files; ~0.7 MB per Actions-cache entry.
export const MAX_RECORDED = 20_000
export function mergePassed(previous, proven) {
  const seen = new Set()
  const out = []
  for (const key of [...proven, ...previous]) {
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length === MAX_RECORDED) break
  }
  return out
}
