// tools/test-dedup/clusters.mjs
// Section (b) of the duplicate report: test files about the same subject that
// load (almost) the same module graph, so merging them would load that graph
// once instead of once per file. Pure; Node built-ins only.
//
// A cluster is a set of test files that share:
//   - the directory, and the stem (the file name up to its first `-` or `.`:
//     `payload-builder-mentions.test.ts` → `payload`);
//   - the `vi.mock` / `vi.doMock` specifier set (a merge must keep each file's mocks);
//   - at least MIN_DEPS dependencies each, and a pairwise dependency Jaccard
//     index of at least MIN_JACCARD (complete linkage: every pair, not a chain);
//   - none is a frontend shared-worker file (frontend/src/test/no-isolate-files.json):
//     those already share a worker, merging them saves nothing.
export const MIN_JACCARD = 0.9
export const MIN_DEPS = 50
export const MAX_LINES = 800

export const stemOf = (file) => file.slice(file.lastIndexOf("/") + 1).split(/[-.]/)[0]
export const mockSetOf = (source) => [...source.matchAll(/\bvi\s*\.\s*(?:mock|doMock)\s*\(\s*(["'`])([^"'`]+)\1/g)]
  .map((m) => m[2]).sort().join("|")

export function jaccard(a, b) {
  let shared = 0
  for (const x of a) if (b.has(x)) shared++
  const union = a.size + b.size - shared
  return union === 0 ? 1 : shared / union
}

// tests: the graph (buildTestGraph's shape: { file, deps }); read(path) →
// source; sharedWorker: Set of repo-relative files. → clusters, largest first.
export function mergeClusters(tests, { read, sharedWorker = new Set() }) {
  const buckets = new Map()
  for (const t of tests) {
    if (sharedWorker.has(t.file) || t.deps.length < MIN_DEPS) continue
    const source = read(t.file) ?? ""
    const key = `${t.file.slice(0, t.file.lastIndexOf("/"))}\0${stemOf(t.file)}\0${mockSetOf(source)}`
    const item = { file: t.file, deps: new Set(t.deps), lines: source.split("\n").length }
    ;(buckets.get(key) ?? buckets.set(key, []).get(key)).push(item)
  }
  const clusters = []
  for (const items of buckets.values()) {
    const left = [...items].sort((a, b) => a.file.localeCompare(b.file))
    while (left.length > 0) {
      const cluster = [left.shift()]
      for (let i = 0; i < left.length;) {
        if (cluster.every((c) => jaccard(c.deps, left[i].deps) >= MIN_JACCARD)) cluster.push(...left.splice(i, 1))
        else i++
      }
      if (cluster.length > 1) clusters.push(cluster)
    }
  }
  return clusters.map((c) => {
    const lines = c.reduce((n, x) => n + x.lines, 0)
    return {
      dir: c[0].file.slice(0, c[0].file.lastIndexOf("/")),
      stem: stemOf(c[0].file),
      files: c.map((x) => x.file),
      deps: c.map((x) => x.deps.size),
      lines,
      // Files left after merging under the line cap (never more than today).
      mergedFiles: Math.min(c.length, Math.max(1, Math.ceil(lines / MAX_LINES))),
    }
  }).sort((a, b) => b.files.length - a.files.length || a.dir.localeCompare(b.dir))
}

// Vitest's closing lines in a CI log: "Test Files  N passed (N)" and
// "Duration  … (transform Xs, setup Xs, import Xs, tests Xs, environment Xs)".
// A log may hold several runs (a shard also runs a package suite): the largest
// run in each log is taken as the project's suite. JSON reports carry no
// import time, so only logs are read.
export function parseDurations(log) {
  // ANSI colours, raw or as `gh run view --log` prints them (`^[[2m`).
  // eslint-disable-next-line no-control-regex
  const text = log.replace(/(?:\u001b|\^\[)\[[0-9;]*m/g, "")
  const runs = []
  let files = null
  for (const line of text.split("\n")) {
    const f = line.match(/Test Files\s+.*\((\d+)\)\s*$/)
    if (f) { files = Number(f[1]); continue }
    const d = line.match(/Duration\s+[\d.]+m?s\s+\((.*)\)\s*$/)
    if (!d || files === null) continue
    const run = { files }
    for (const part of d[1].split(",")) {
      const m = part.trim().match(/^(\w+) ([\d.]+)(ms|s)$/)
      if (m) run[m[1]] = Number(m[2]) / (m[3] === "ms" ? 1000 : 1)
    }
    runs.push(run)
    files = null
  }
  if (runs.length === 0) return null
  return runs.reduce((a, b) => (b.files > a.files ? b : a))
}

// The saving model. A file's load cost (import + environment) is taken as
// proportional to the modules it loads: perDep = Σ(import + environment) of
// the suite / Σ dependencies of its files. Merging a cluster into k files
// (k = ceil(lines / 800)) loads its graph k times instead of n:
//   saving ≈ (Σ deps_i − k · max deps_i) · perDep
// It is a model, not a measurement: the plan's local pilot measured about
// 0.6 × the model on payload-builder*. Measure before acting on it.
export function perDependency(durations, tests) {
  if (!durations) return null
  const deps = tests.reduce((n, t) => n + t.deps.length, 0)
  const load = durations.reduce((n, d) => n + (d.import ?? 0) + (d.environment ?? 0), 0)
  return deps > 0 ? load / deps : null
}

export function clusterSaving(cluster, perDep, mergedFiles = cluster.mergedFiles) {
  if (perDep === null || perDep === undefined) return null
  const sum = cluster.deps.reduce((a, b) => a + b, 0)
  return Math.max(0, (sum - mergedFiles * Math.max(...cluster.deps)) * perDep)
}
