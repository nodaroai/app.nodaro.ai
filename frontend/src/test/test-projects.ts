/**
 * The frontend suite's Vitest projects: `isolated` (every test file, one fresh
 * module graph per file — Vitest's default) and `shared-worker` (the files in
 * no-isolate-files.json, which run several to a worker with `isolate: false`).
 *
 * Why: without isolation a worker skips re-importing the module graph for each
 * file — measured ~3× faster on a frontend shard — but a quarter of the files
 * failed that way (module-level state one file leaves for the next). So it is
 * opt-in per file, and a file joins the manifest only after it passed, same
 * test counts, in non-isolated workers beside other files in several shuffled
 * orders without breaking the files after it (decided 2026-10-13).
 *
 * An empty manifest means no projects at all: everything isolated, as before.
 * Guard: src/test/__tests__/test-projects.test.ts (every test file in exactly
 * one project, the manifest names only real test files).
 */
// @test-watches frontend/src/test/no-isolate-files.json
import { readFileSync } from "node:fs"
import path from "node:path"

export const NO_ISOLATE_MANIFEST = "src/test/no-isolate-files.json"

/**
 * A shared worker resets neither the module registry nor the mocker between
 * files (Vitest 4 skips both when `isolate` is false; it only restores spies),
 * so a file that mocks or unmocks a module, stubs a global or env var, fakes
 * timers or the clock, or resets modules hands that to every file after it in
 * the worker — and a
 * mocked file needs fresh modules itself. Measured 2026-10-14: of 478 frontend
 * jsdom files that failed in one shuffled shared run, 404 call `vi.mock`, and
 * a file that passed one order failed all 23 of its tests in another. Such a
 * file never joins the manifest, however often it happened to pass.
 */
export const SHARED_WORKER_HAZARD = /\bvi\s*\.\s*(?:mock|doMock|unmock|doUnmock|resetModules|stubGlobal|stubEnv|useFakeTimers|setSystemTime)\s*\(/

export const ISOLATED_PROJECT = "isolated"
export const SHARED_WORKER_PROJECT = "shared-worker"

/** The manifest's entries: test files relative to frontend/, as written (not globs). */
export function readNoIsolateFiles(frontendRoot: string): string[] {
  const parsed: unknown = JSON.parse(readFileSync(path.join(frontendRoot, NO_ISOLATE_MANIFEST), "utf8"))
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new Error(`${NO_ISOLATE_MANIFEST} must be a JSON array of test file paths`)
  }
  return parsed
}

/**
 * A file path as a glob that matches only itself. Vitest's include/exclude are
 * picomatch globs: a path with `[…]`, `{…}`, `*`, `?` or an extglob like
 * `@(…)` in it would be read as a pattern — matching nothing (the file quietly
 * stays isolated) or, in `isolated`'s exclude, other files too.
 */
export function asLiteralGlob(file: string): string {
  return file.replace(/[\\()[\]{}*?!+@|]/g, "\\$&")
}

/**
 * The `test.projects` entries for these shared-worker files, or undefined when
 * there are none. Both extend the root config (setup files, aliases, dedupe,
 * inline deps, env); they differ in the file lists, `isolate`, and the shared
 * worker's extra setup file (shared-worker-setup.ts).
 */
export function testProjects(sharedWorkerFiles: readonly string[], baseExclude: readonly string[]) {
  if (sharedWorkerFiles.length === 0) return undefined
  const literal = sharedWorkerFiles.map(asLiteralGlob)
  return [
    { extends: true, test: { name: ISOLATED_PROJECT, exclude: [...baseExclude, ...literal] } },
    {
      extends: true,
      test: {
        name: SHARED_WORKER_PROJECT,
        isolate: false,
        include: literal,
        // Appended to the root's setup.ts (arrays merge under `extends`).
        setupFiles: ["./src/test/shared-worker-setup.ts"],
      },
    },
  ]
}

/** A test file whose first line opts it into the node environment. */
export const NODE_ENVIRONMENT_DOCBLOCK = /^\/\/ @vitest-environment node\b/

interface Ordered {
  project: { config: { isolate: boolean } }
}

/**
 * The run order with the shared-worker files grouped by environment: isolated
 * files first, in the order given (projects already sort by name, so they ran
 * first anyway), then the shared node files, then the shared jsdom files —
 * each group keeping the order given.
 *
 * Why: Vitest hands a shared worker the next queued file only when it runs in
 * the same environment (and project); otherwise the worker is stopped and a
 * fresh one started. The default order (slowest, then largest first)
 * interleaves node and jsdom files, so about half the shared files got a fresh
 * worker anyway. Measured 2026-10-14, the 639 shared files at 6 workers:
 * isolated 83 s, shared in the default order 44 s, grouped 13 s.
 */
export function groupSharedByEnvironment<T extends Ordered>(sorted: readonly T[], inNodeEnvironment: (spec: T) => boolean): T[] {
  const isolated = sorted.filter((spec) => spec.project.config.isolate !== false)
  const shared = sorted.filter((spec) => spec.project.config.isolate === false)
  const node = shared.filter(inNodeEnvironment)
  const nodeSet = new Set(node)
  return [...isolated, ...node, ...shared.filter((spec) => !nodeSet.has(spec))]
}

/**
 * True when the command line asks for a shuffled file order. A custom
 * sequencer would silently replace Vitest's random one, so the config leaves
 * the grouping out for `--sequence.shuffle` / `--sequence.shuffle.files`,
 * written `=value` or with the value as the next argument (`false` turns it
 * off). A shuffle set any other way (`--sequence.shuffle` reaching the config
 * as `true` through the API, say) is caught by the sequencer itself, which
 * reads the resolved config; only `sequence.shuffle: { files: true }` set
 * outside this command line is invisible to both (Vitest folds it away before
 * the sequencer runs). `--sequence.shuffle.tests` alone also shuffles the
 * files here: Vitest hands the sequencer a plain `shuffle: true` for it, the
 * same as for `--sequence.shuffle`.
 */
export function shuffleRequested(argv: readonly string[]): boolean {
  let on = false
  argv.forEach((arg, index) => {
    const match = /^--sequence\.shuffle(?:\.files)?(?:=(.*))?$/.exec(arg)
    if (!match) return
    const value = match[1] ?? (/^(?:true|false)$/.test(argv[index + 1] ?? "") ? argv[index + 1] : undefined)
    on = value !== "false"
  })
  return on
}

/**
 * A seeded Fisher–Yates shuffle (mulberry32), for the sequencer when the
 * resolved config asks for shuffled files: the same seed, the same order.
 */
export function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
