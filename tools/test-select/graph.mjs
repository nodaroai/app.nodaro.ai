// tools/test-select/graph.mjs
// The test → source graph, from Vitest itself: `specifications.getTestDependencies`
// is the walk `vitest --changed` uses (static imports plus literal dynamic
// imports, node_modules excluded, workspace packages resolved to their real
// path — packages/<name>/dist/…). It is not a documented API: if a Vitest
// upgrade moves it, this throws and the engine runs the full suite.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { summarizeTest } from "./test-node.mjs"

const BATCH = 32

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"))
const nodaroDeps = (pkg) => Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })
  .filter((name) => name.startsWith("@nodaro/"))

// Vitest's walk drops a dependency that does not exist on disk, and a
// workspace package resolves to its packages/<name>/dist/ build — so without
// the build every package edge vanishes silently and a packages/shared/src
// change selects nothing. Returns the missing dist entry files (repo-relative)
// of the workspace packages the project depends on, directly or through
// another workspace package. Only those: packages/cli is never built by
// build:packages nor shipped in the CI build artifact, and demanding its dist
// would turn every selection into a full run.
export function missingPackageBuilds(repoRoot, project) {
  const byName = new Map()
  const packagesDir = path.join(repoRoot, "packages")
  for (const dir of existsSync(packagesDir) ? readdirSync(packagesDir) : []) {
    const manifest = path.join(packagesDir, dir, "package.json")
    if (!existsSync(manifest)) continue
    const pkg = readJson(manifest)
    if (pkg.name) byName.set(pkg.name, { dir, pkg })
  }
  const needed = new Set()
  const queue = nodaroDeps(readJson(path.join(repoRoot, project, "package.json")))
  while (queue.length > 0) {
    const name = queue.shift()
    if (needed.has(name) || !byName.has(name)) continue
    needed.add(name)
    queue.push(...nodaroDeps(byName.get(name).pkg))
  }
  const missing = []
  for (const name of needed) {
    const { dir, pkg } = byName.get(name)
    for (const entry of new Set([pkg.main, pkg.module].filter(Boolean).map((e) => path.posix.normalize(e)))) {
      if (entry.startsWith("dist/") && !existsSync(path.join(packagesDir, dir, entry))) missing.push(`packages/${dir}/${entry}`)
    }
  }
  return missing.sort()
}

export async function buildTestGraph(repoRoot, project) {
  const missing = missingPackageBuilds(repoRoot, project)
  if (missing.length > 0) {
    const more = missing.length > 1 ? ` (and ${missing.length - 1} more)` : ""
    throw new Error(`${missing[0]}${more} is missing — run npm run build:packages (without it the graph loses every workspace-package edge)`)
  }
  const root = path.join(repoRoot, project)
  // Resolved from the repo-root node_modules (vitest is hoisted there). A bare
  // dynamic import, not createRequire: `vitest/node` is an ESM-only export.
  const { createVitest } = await import("vitest/node")
  const rel = (p) => path.relative(repoRoot, p).split(path.sep).join("/")
  const cwd = process.cwd()
  let vitest
  process.chdir(root)
  try {
    vitest = await createVitest("test", { watch: false, run: true, root }, {}, {})
    if (typeof vitest.specifications?.getTestDependencies !== "function") {
      throw new Error("vitest.specifications.getTestDependencies is unavailable — the Vitest API changed")
    }
    const specs = await vitest.globTestSpecifications()
    // One cache for the whole run — the tests' dependencies overlap heavily.
    const sources = new Map()
    const readSource = (abs) => {
      if (!sources.has(abs)) {
        // null, never "": an unreadable module (virtual, vanished) cannot be
        // shown not to read files, so summarizeTest treats it as a reader.
        let text = null
        try { text = readFileSync(abs, "utf8") } catch { /* stays null */ }
        sources.set(abs, text)
      }
      return sources.get(abs)
    }
    const tests = []
    for (let i = 0; i < specs.length; i += BATCH) {
      const batch = await Promise.all(specs.slice(i, i + BATCH).map(async (spec) => {
        const deps = await vitest.specifications.getTestDependencies(spec)
        return summarizeTest({
          file: rel(spec.moduleId),
          // The test file itself must be readable: an error here throws and
          // the engine runs the full suite (only a dependency may vanish).
          source: readFileSync(spec.moduleId, "utf8"),
          deps: [...deps].map((d) => ({ path: rel(d), source: readSource(d) })),
        })
      }))
      tests.push(...batch)
    }
    if (tests.length === 0) throw new Error(`Vitest found no test files under ${project}/`)
    return tests
  } finally {
    // A createVitest or close() that throws must still leave the caller's cwd.
    try {
      await vitest?.close()
    } finally {
      process.chdir(cwd)
    }
  }
}
