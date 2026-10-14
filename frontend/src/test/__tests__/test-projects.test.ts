// @vitest-environment node
// @test-watches frontend/**/*.{test,spec}.* frontend/vitest.config.ts frontend/src/test/no-isolate-files.json
/**
 * The isolated / shared-worker split (src/test/test-projects.ts) must never
 * lose a test file or run one twice, and the manifest may only name real test
 * files. The split is checked through Vitest's own file glob — the walk every
 * run and the affected-test engine (`globTestSpecifications`) use — against an
 * independent walk of the tree, so an entry whose glob silently matches
 * nothing, or matches more than itself, fails here. Vitest is
 * started in a child process: Vite probes the browser globals at import, which this
 * node-environment file's DOM tripwire refuses.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  asLiteralGlob,
  groupSharedByEnvironment,
  ISOLATED_PROJECT,
  NO_ISOLATE_MANIFEST,
  readNoIsolateFiles,
  SHARED_WORKER_HAZARD,
  SHARED_WORKER_PROJECT,
  shuffleRequested,
  shuffleWithSeed,
  testProjects,
} from "../test-projects"

const FRONTEND = path.resolve(__dirname, "../../..")
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

/**
 * The directories the root config's `exclude` skips, read from what Vitest
 * resolved (its defaults plus ours). Each pattern must name one directory,
 * either at any depth (a leading double star) or at the top, so the walk below
 * skips exactly what Vitest skips; any other shape fails until it is taught here.
 */
function skippedDirectories(exclude: readonly string[]) {
  const anywhere = new Set<string>()
  const atTop = new Set<string>()
  for (const pattern of exclude) {
    const match = /^(\*\*\/)?([^*?[\]{}()!/]+)\/\*\*$/.exec(pattern)
    if (!match) throw new Error(`exclude pattern "${pattern}" is not a directory pattern: teach walkTestFiles about it`)
    ;(match[1] ? anywhere : atTop).add(match[2])
  }
  return { anywhere, atTop }
}

/** Every test file under frontend/, by plain directory walk: Vitest's default include, minus the resolved excludes. */
function walkTestFiles(exclude: readonly string[], dir = FRONTEND, out: string[] = []): string[] {
  const { anywhere, atTop } = skippedDirectories(exclude)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const skipped = anywhere.has(entry.name) || (dir === FRONTEND && atTop.has(entry.name))
      if (!skipped) walkTestFiles(exclude, path.join(dir, entry.name), out)
    } else if (TEST_FILE.test(entry.name)) {
      out.push(path.relative(FRONTEND, path.join(dir, entry.name)).split(path.sep).join("/"))
    }
  }
  return out
}

const manifest = readNoIsolateFiles(FRONTEND)

interface ResolvedProjects {
  exclude: string[]
  projects: { name: string; isolate: boolean }[]
  specs: { project: string; file: string }[]
}

/** The projects and test files Vitest itself resolves from vitest.config.ts. */
function resolveProjects(): ResolvedProjects {
  const script = `
    import { createVitest } from "vitest/node"
    const root = process.argv[1]
    const vitest = await createVitest("test", { watch: false, run: true, root, reporters: [] }, {}, {})
    try {
      const specs = await vitest.globTestSpecifications()
      console.log("RESOLVED " + JSON.stringify({
        exclude: vitest.config.exclude,
        projects: vitest.projects.map((p) => ({ name: p.name, isolate: p.config.isolate })),
        specs: specs.map((s) => ({ project: s.project.name, file: s.moduleId })),
      }))
    } finally {
      await vitest.close()
    }`
  // Not this worker's VITEST_* variables: the child is a fresh Vitest, not a worker.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")))
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script, FRONTEND], { cwd: FRONTEND, env, encoding: "utf8" })
  const line = out.split("\n").find((l) => l.startsWith("RESOLVED "))
  if (!line) throw new Error(`Vitest printed no project list:\n${out}`)
  const resolved = JSON.parse(line.slice("RESOLVED ".length)) as ResolvedProjects
  const rel = (file: string) => path.relative(FRONTEND, file).split(path.sep).join("/")
  return { ...resolved, specs: resolved.specs.map((spec) => ({ ...spec, file: rel(spec.file) })) }
}

describe(NO_ISOLATE_MANIFEST, () => {
  it("lists existing test files, sorted, each once", () => {
    for (const file of manifest) {
      expect(file, "a test file relative to frontend/").toMatch(TEST_FILE)
      expect(existsSync(path.join(FRONTEND, file)), `${file} does not exist`).toBe(true)
    }
    expect(manifest).toEqual([...new Set(manifest)].sort())
  })

  it("lists no file that mocks modules, stubs globals or env, fakes timers or the clock, or resets modules", () => {
    const hazardous = manifest.filter((file) => SHARED_WORKER_HAZARD.test(readFileSync(path.join(FRONTEND, file), "utf8")))
    // Each one leaks into the files after it in a shared worker: take it out of the manifest.
    expect(hazardous).toEqual([])
  })
})

describe("testProjects", () => {
  it("defines no projects for an empty manifest (everything isolated, as before)", () => {
    expect(testProjects([], ["**/node_modules/**"])).toBeUndefined()
  })

  it("recognises the shared-worker hazards", () => {
    for (const call of ['vi.mock("x")', "vi.doMock('x')", "vi.resetModules()", 'vi.stubGlobal("fetch", f)', 'vi.stubEnv("A", "1")', "vi.useFakeTimers()", "vi.setSystemTime(new Date(0))", 'vi.unmock("x")', 'vi.doUnmock("x")', "vi\n  .mock(\"x\")"]) {
      expect(SHARED_WORKER_HAZARD.test(call), call).toBe(true)
    }
    for (const call of ["vi.fn()", "vi.spyOn(a, \"b\")", "vi.useRealTimers()", "vi.unstubAllGlobals()", "vi.hoisted(() => 1)"]) {
      expect(SHARED_WORKER_HAZARD.test(call), call).toBe(false)
    }
  })

  it("escapes glob syntax so an entry matches only its own path", () => {
    expect(asLiteralGlob("src/app/(auth)/__tests__/a.test.tsx")).toBe("src/app/\\(auth\\)/__tests__/a.test.tsx")
    expect(asLiteralGlob("src/[id]/a+b.test.ts")).toBe("src/\\[id\\]/a\\+b.test.ts")
  })
})

describe("groupSharedByEnvironment", () => {
  const spec = (name: string, isolate: boolean) => ({ name, project: { config: { isolate } } })

  it("keeps the isolated files' order first, then the shared node-environment files, then the other shared files", () => {
    const sorted = [spec("j1", false), spec("i1", true), spec("n1", false), spec("i2", true), spec("j2", false), spec("n2", false)]
    const order = groupSharedByEnvironment(sorted, (s) => s.name.startsWith("n")).map((s) => s.name)
    expect(order).toEqual(["i1", "i2", "n1", "n2", "j1", "j2"])
  })

  it("leaves an all-isolated order untouched", () => {
    const sorted = [spec("b", true), spec("a", true)]
    expect(groupSharedByEnvironment(sorted, () => true)).toEqual(sorted)
  })
})

describe("shuffleRequested", () => {
  it("is on for --sequence.shuffle and --sequence.shuffle.files, off for =false and other flags", () => {
    expect(shuffleRequested(["vitest", "run", "--sequence.shuffle"])).toBe(true)
    expect(shuffleRequested(["--sequence.shuffle.files"])).toBe(true)
    expect(shuffleRequested(["--sequence.shuffle=true"])).toBe(true)
    expect(shuffleRequested(["--sequence.shuffle=false"])).toBe(false)
    expect(shuffleRequested(["--sequence.shuffle.tests"])).toBe(false)
    expect(shuffleRequested(["--sequence.seed=3", "run"])).toBe(false)
  })

  it("reads a value given as the next argument", () => {
    expect(shuffleRequested(["--sequence.shuffle", "true"])).toBe(true)
    expect(shuffleRequested(["--sequence.shuffle.files", "true", "src/a.test.ts"])).toBe(true)
    expect(shuffleRequested(["--sequence.shuffle", "false"])).toBe(false)
    expect(shuffleRequested(["--sequence.shuffle", "src/a.test.ts"])).toBe(true)
  })
})

describe("shuffleWithSeed", () => {
  it("is a permutation, the same for the same seed", () => {
    const items = Array.from({ length: 50 }, (_, i) => i)
    const once = shuffleWithSeed(items, 42)
    expect([...once].sort((a, b) => a - b)).toEqual(items)
    expect(shuffleWithSeed(items, 42)).toEqual(once)
    expect(shuffleWithSeed(items, 43)).not.toEqual(once)
  })
})

describe("the projects Vitest resolves", () => {
  it("run every frontend test file exactly once, the manifest's in the shared worker", { timeout: 120_000 }, () => {
    const { exclude, projects, specs } = resolveProjects()
    const files = specs.map((spec) => spec.file)
    expect(files.length, "a file is in both projects").toBe(new Set(files).size)
    expect([...files].sort()).toEqual(walkTestFiles(exclude).sort())

    const inProject = (name: string) => specs.filter((spec) => spec.project === name).map((spec) => spec.file)
    if (manifest.length === 0) {
      expect(projects.map((project) => project.isolate)).toEqual([true])
      return
    }
    expect(projects.map((project) => [project.name, project.isolate]).sort()).toEqual([
      [ISOLATED_PROJECT, true],
      [SHARED_WORKER_PROJECT, false],
    ])
    expect(inProject(SHARED_WORKER_PROJECT).sort()).toEqual(manifest)
    expect(inProject(ISOLATED_PROJECT).length).toBe(files.length - manifest.length)
  })
})
