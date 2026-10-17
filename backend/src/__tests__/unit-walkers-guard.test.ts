// @test-watches backend/src/**/*.test.ts
/**
 * A test that walks the route or worker trees sees the node units too.
 *
 * A node unit keeps its route and worker in its own folder
 * (backend/src/nodes/<type>/, tools/units/README.md), so a census that lists
 * backend/src/routes, ee/routes or workers/handlers alone is blind to every
 * unit: it passes, checking nothing about them, and the next unit escapes it.
 * Such a test must also read the units — through lib/unit-source-files.ts
 * (unitRouteFiles / unitWorkerFiles / unitSourceFiles), route-inventory's
 * allRouteFiles, or by walking the units folder itself.
 *
 * "Walks the trees" is read from the source: a directory listing
 * (readdirSync) plus a path that ENDS at one of those directories — the last
 * argument of a join()/resolve(), an entry of a list of directories, or, for a
 * test that sits in one of them, its own parent directory.
 */
import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REPO = join(__dirname, "..", "..", "..")
const SELF = "backend/src/__tests__/unit-walkers-guard.test.ts"

// Spelled in parts so this file never matches its own rules.
const TREE = ["rou" + "tes", "hand" + "lers"].join("|")
const SEGMENT = String.raw`["'\x60](?:[\w./-]*\/)?(?:${TREE})["'\x60]`
const ENDS_A_PATH = new RegExp(SEGMENT + String.raw`\s*\)`)
const IN_A_LIST = new RegExp(String.raw`\[[^\]\n]*` + SEGMENT + String.raw`[^\]\n]*\]`)
const OWN_PARENT = new RegExp(String.raw`(?:join|resolve)\(\s*[\w.()]+\s*,\s*["']\.\.["']\s*\)`)
const LISTS_A_DIR = new RegExp("readdir" + String.raw`Sync\(`)
const SITS_IN_A_TREE = new RegExp(String.raw`^backend/src/(?:ee/)?(?:routes|workers/handlers)/__tests__/`)
const READS_UNITS = new RegExp(["unitRouteFiles", "unitWorkerFiles", "unitSourceFiles", "allRouteFiles"].join("|") + String.raw`|["'\x60]nodes["'\x60]`)

const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/** Why `file` (repo-relative) walks the route/worker trees without the units, or null. */
function blindWalk(file: string, source: string): string | null {
  const src = code(source)
  if (!LISTS_A_DIR.test(src)) return null
  const walks = ENDS_A_PATH.test(src) || IN_A_LIST.test(src) || (SITS_IN_A_TREE.test(file) && OWN_PARENT.test(src))
  if (!walks || READS_UNITS.test(src)) return null
  return `${file}: walks the route/worker trees but never the node units — add unitRouteFiles()/unitWorkerFiles() (lib/unit-source-files.ts)`
}

describe("tests that walk the route or worker trees read the node units too", () => {
  it("every backend test", () => {
    const tests = execFileSync("git", ["ls-files", "backend/src"], { cwd: REPO, encoding: "utf8" })
      .split("\n").filter((f) => f.endsWith(".test.ts") && f !== SELF)
    expect(tests.length).toBeGreaterThan(1000)
    const blind = tests.flatMap((f) => blindWalk(f, readFileSync(join(REPO, f), "utf8")) ?? [])
    expect(blind).toEqual([])
  })

  it("the rule: a walk of a tree, a list of trees and a test's own tree are caught; a unit-aware walk or a single named file is not", () => {
    const R = "rou" + "tes"
    const H = "hand" + "lers"
    const rd = "readdir" + "Sync"
    const f = "backend/src/lib/__tests__/x.test.ts"
    expect(blindWalk(f, `${rd}(join(SRC, "${R}"))`)).not.toBeNull()
    expect(blindWalk(f, `const ROOTS = ["${R}", "ee/${R}"]\n${rd}(d)`)).not.toBeNull()
    expect(blindWalk(f, `${rd}(join(SRC, "workers", "${H}"))`)).not.toBeNull()
    expect(blindWalk(`backend/src/${R}/__tests__/x.test.ts`, `const D = resolve(dirname(fileURLToPath(import.meta.url)), "..")\n${rd}(D)`)).not.toBeNull()
    expect(blindWalk(f, `${rd}(join(SRC, "${R}"))\nunitRouteFiles(REPO)`)).toBeNull()
    expect(blindWalk(f, `const D = ["workers", "${R}", "nodes"]\n${rd}(d)`)).toBeNull()
    expect(blindWalk(f, `readFileSync(join(SRC, "${R}", "x.ts"))\n${rd}(MIGRATIONS)`)).toBeNull()
    expect(blindWalk(f, `// ${rd}(join(SRC, "${R}"))`)).toBeNull()
  })
})
