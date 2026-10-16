// @vitest-environment node
// @test-watches tools/units/registry-composers.json
// @test-units-by-name it names no registry: NODE_OPTIONS appears only inside a fixture source string
import { describe, expect, it } from "vitest"
import ts from "typescript"
import { buildGraph, createResolver, valueSpecifiers } from "../../../tools/structure/scanner.mjs"
import {
  checkBoundaries,
  checkCycles,
  checkHubs,
  checkImportBudget,
  cycleComponents,
  measureClosures,
  prepare,
  tightenedBaselines,
} from "../../../tools/structure/ratchets.mjs"

/**
 * Unit tests for the structure ratchets' scanner and checks
 * (tools/structure/). Every fixture is an in-memory source map, so nothing
 * here reads the repo; structure-ratchets.test.ts runs the real scan.
 */

const FE_ALIASES = [{ pattern: "@/*", target: "frontend/src/*" }]

function graphOf(files: Record<string, string>, name = "frontend") {
  return prepare({ name, ...buildGraph(ts, new Map(Object.entries(files)), FE_ALIASES) })
}

const specs = (text: string, path = "frontend/src/lib/x.ts") => valueSpecifiers(ts, path, text)

describe("valueSpecifiers — what a file loads at run time", () => {
  it("skips type-only imports and exports", () => {
    expect(specs(`
      import type { A } from "./a"
      import { type B, type C } from "./b"
      export type { D } from "./d"
      export { type E } from "./e"
      export type * from "./f"
      const x: A | B | C = null as never
      export default x
    `)).toEqual([])
  })

  it("skips an import used only in type positions — TypeScript elides it", () => {
    expect(specs(`
      import { Thing } from "./thing"
      import * as ns from "./ns"
      let a: Thing
      let b: typeof ns.value
      let c: import("./query").T
    `)).toEqual([])
  })

  it("keeps an import used as a value, in JSX, or as a class base", () => {
    expect(specs(`
      import { f } from "./f"
      import Comp from "./comp"
      import { Base, Iface } from "./base"
      import { inTypeOnly } from "./typed"
      f()
      const el = <Comp />
      class K extends Base implements Iface {}
      let t: inTypeOnly
    `, "frontend/src/lib/x.tsx")).toEqual(["./f", "./comp", "./base"])
  })

  it("keeps every import of a JavaScript file — only TypeScript elides", () => {
    expect(specs(`import { unused } from "./a"\n`, "frontend/src/lib/x.js")).toEqual(["./a"])
    expect(specs(`import { unused } from "./a"\n`, "frontend/src/lib/x.ts")).toEqual([])
  })

  it("counts side-effect imports, re-exports, literal dynamic import(), require() and vi.importActual()", () => {
    expect(specs(`
      import "./side"
      export * from "./star"
      export { v } from "./named"
      const lazy = () => import("./lazy")
      const tpl = () => import(\`./template\`)
      const r = require("./req")
      const real = vi.importActual("./actual")
    `)).toEqual(["./side", "./star", "./named", "./lazy", "./template", "./req", "./actual"])
  })

  it("ignores computed import(), vi.mock() and a mocked factory's specifier", () => {
    expect(specs(`
      const name = "./x"
      const lazy = () => import(name)
      const lazy2 = () => import(\`./dir/\${name}\`)
      vi.mock("./mocked", () => ({}))
    `)).toEqual([])
  })
})

describe("createResolver", () => {
  const files = new Set([
    "frontend/src/lib/a.ts",
    "frontend/src/lib/view.tsx",
    "frontend/src/lib/dir/index.ts",
    "frontend/src/components/button.tsx",
  ])
  const resolve = createResolver(files, FE_ALIASES)

  it("maps .js to .ts / .tsx, tries extensions and directory index files", () => {
    expect(resolve("frontend/src/lib/b.ts", "./a.js")).toBe("frontend/src/lib/a.ts")
    expect(resolve("frontend/src/lib/b.ts", "./view.js")).toBe("frontend/src/lib/view.tsx")
    expect(resolve("frontend/src/lib/b.ts", "./a")).toBe("frontend/src/lib/a.ts")
    expect(resolve("frontend/src/lib/b.ts", "./dir")).toBe("frontend/src/lib/dir/index.ts")
    expect(resolve("frontend/src/lib/dir/c.ts", ".")).toBe("frontend/src/lib/dir/index.ts")
    expect(resolve("frontend/src/lib/b.ts", "./a.js?v=1")).toBe("frontend/src/lib/a.ts")
  })

  it("resolves the @/ alias", () => {
    expect(resolve("frontend/src/lib/b.ts", "@/components/button")).toBe("frontend/src/components/button.tsx")
  })

  it("leaves packages and files outside the scanned tree unresolved", () => {
    expect(resolve("frontend/src/lib/b.ts", "react")).toBeNull()
    expect(resolve("frontend/src/lib/b.ts", "@nodaro/shared/nodes")).toBeNull()
    expect(resolve("frontend/src/lib/b.ts", "../../../packages/shared/src/index.js")).toBeNull()
  })
})

describe("C1 cycles", () => {
  const cyc = {
    "frontend/src/lib/a.ts": `import { b } from "./b.js"; export const a = () => b()`,
    "frontend/src/lib/b.ts": `import { c } from "./c.js"; export const b = () => c()`,
    "frontend/src/lib/c.ts": `import { a } from "./a.js"; export const c = () => a()`,
    // a 2-cycle is below the threshold
    "frontend/src/lib/p.ts": `import { q } from "./q"; export const p = () => q()`,
    "frontend/src/lib/q.ts": `import { p } from "./p"; export const q = () => p()`,
  }

  it("finds strongly connected components of 3+ files", () => {
    expect(cycleComponents(graphOf(cyc))).toEqual([["frontend/src/lib/a.ts", "frontend/src/lib/b.ts", "frontend/src/lib/c.ts"]])
  })

  it("a type-only edge closes no cycle", () => {
    const g = graphOf({ ...cyc, "frontend/src/lib/c.ts": `import type { A } from "./a"; export const c = (x?: A) => x` })
    expect(cycleComponents(g)).toEqual([])
  })

  it("a dynamic import() closes a cycle", () => {
    const g = graphOf({ ...cyc, "frontend/src/lib/c.ts": `export const c = () => import("./a")` })
    expect(cycleComponents(g)).toHaveLength(1)
  })

  it("passes on the recorded cycle, fails a new one and a grown one, and notes a shrunk one", () => {
    const g = graphOf(cyc)
    const baseline = { largest: 3, components: [["frontend/src/lib/a.ts", "frontend/src/lib/b.ts", "frontend/src/lib/c.ts"]] }
    expect(checkCycles("frontend", g, baseline).failures).toEqual([])

    const fresh = checkCycles("frontend", g, { largest: 0, components: [] })
    expect(fresh.failures.join("\n")).toMatch(/NEW import cycle/)
    expect(fresh.failures.join("\n")).toMatch(/frontend\/src\/lib\/a\.ts\n\s+-> frontend\/src\/lib\/b\.ts/)

    const grown = graphOf({
      ...cyc,
      "frontend/src/lib/c.ts": `import { a } from "./a"; import { d } from "./d"; export const c = () => a() + d()`,
      "frontend/src/lib/d.ts": `import { a } from "./a"; export const d = () => a()`,
      "frontend/src/lib/a.ts": `import { b } from "./b"; import { c } from "./c"; export const a = () => b() + c()`,
    })
    const r = checkCycles("frontend", grown, baseline)
    expect(r.failures.join("\n")).toMatch(/GREW or MERGED.*frontend\/src\/lib\/d\.ts/)
    expect(r.failures.join("\n")).toMatch(/largest import cycle grew: 4 files \(baseline 3\)/)

    const shrunk = checkCycles("frontend", graphOf({ "frontend/src/lib/a.ts": "export const a = 1" }), baseline)
    expect(shrunk.failures).toEqual([])
    expect(shrunk.notes.join("\n")).toMatch(/tighten the baseline/)
  })
})

describe("C2 import budget, C3 boundaries, C4 hubs", () => {
  const files = {
    "frontend/src/lib/hub.ts": `export const hub = 1`,
    "frontend/src/lib/mid.ts": `import { hub } from "./hub"; export const mid = hub`,
    "frontend/src/lib/leaf.ts": `export const leaf = 1`,
    "frontend/src/lib/ui-user.ts": `import { Button } from "@/components/button"; export const u = Button`,
    "frontend/src/components/button.tsx": `import { hub } from "@/lib/hub"; export const Button = hub`,
    "frontend/src/lib/__tests__/helper.ts": `import { leaf } from "../leaf"; export const h = leaf`,
    "frontend/src/lib/__tests__/a.test.ts": `import { mid } from "../mid"; import { h } from "./helper"; it("x", () => mid + h)`,
    "frontend/src/lib/__tests__/b.test.ts": `import { leaf } from "../leaf"; it("y", () => leaf)`,
    "frontend/src/lib/__tests__/c.test.ts": `import { u } from "../ui-user"; it("z", () => u)`,
    "frontend/src/lib/__tests__/d.test.ts": `import { leaf } from "../leaf"; it("w", () => leaf)`,
  }
  const g = graphOf(files)
  const m = measureClosures(g)

  it("counts each test's product closure (helpers traversed, not counted)", () => {
    expect(m.size.get("frontend/src/lib/__tests__/a.test.ts")).toBe(3) // mid, hub, leaf (via the helper)
    expect(m.size.get("frontend/src/lib/__tests__/c.test.ts")).toBe(3) // ui-user, button, hub
    expect(m.fanIn.get("frontend/src/lib/hub.ts")).toBe(2)
  })

  it("C2 reports (never fails) an unlisted test over the default and a listed test that grew; notes one that shrank", () => {
    const over = checkImportBudget("frontend", g, m, { default: 2, tests: {} })
    expect(over.failures).toEqual([])
    expect(over.findings.join("\n")).toMatch(/a\.test\.ts loads 3 product files \(budget 2\)/)
    expect(over.report).toMatch(/^\[import-budget\/frontend\] report only — 2 tests over the 2-file budget \(baseline lists 0\): 2 new over budget, 0 grew/)
    const grew = checkImportBudget("frontend", g, m, { default: 2, tests: { frontend: { "frontend/src/lib/__tests__/a.test.ts": 2, "frontend/src/lib/__tests__/c.test.ts": 3 } } })
    expect(grew.failures).toEqual([])
    expect(grew.findings).toHaveLength(1)
    expect(grew.findings[0]).toMatch(/a\.test\.ts grew to 3 product files \(recorded 2\)/)
    expect(grew.report).toMatch(/0 new over budget, 1 grew, 0 shrank/)
    const shrank = checkImportBudget("frontend", g, m, { default: 2, tests: { frontend: { "frontend/src/lib/__tests__/a.test.ts": 9, "frontend/src/lib/__tests__/c.test.ts": 3 } } })
    expect(shrank.failures).toEqual([])
    expect(shrank.findings).toEqual([])
    expect(shrank.report).toMatch(/0 grew, 1 shrank/)
    expect(shrank.notes.join("\n")).toMatch(/a\.test\.ts shrank \(3 < recorded 9\)/)
  })

  it("C3: fails a lib → components edge not in the baseline, notes a fixed one", () => {
    const fresh = checkBoundaries("frontend", g, {})
    expect(fresh.failures).toHaveLength(1)
    expect(fresh.failures[0]).toMatch(/frontend\/src\/lib\/ui-user\.ts -> frontend\/src\/components\/button\.tsx/)
    const known = { "frontend-lib-not-ui": ["frontend/src/lib/ui-user.ts -> frontend/src/components/button.tsx", "frontend/src/lib/gone.ts -> frontend/src/app/page.tsx"] }
    const r = checkBoundaries("frontend", g, known)
    expect(r.failures).toEqual([])
    expect(r.notes.join("\n")).toMatch(/1 recorded violation\(s\) are fixed/)
    expect(checkBoundaries("backend", g, {}).failures).toEqual([])
  })

  it("C3 node-units (G5): a unit may not import another unit, an aggregate or an engine module", () => {
    const units = graphOf({
      "frontend/src/nodes/a-node/exec.ts": `import { b } from "../b-node/exec"; import { UNIT_DEFINITIONS } from "../_generated/definitions"; import { run } from "@/components/editor/workflow-editor/execute-node"; import { h } from "@/lib/h"; import { own } from "./types"; export const e = [b, UNIT_DEFINITIONS, run, h, own]`,
      "frontend/src/nodes/a-node/types.ts": "export const own = 1",
      "frontend/src/nodes/b-node/exec.ts": "export const b = 1",
      "frontend/src/nodes/_generated/definitions.ts": `import { b } from "../b-node/exec"; export const UNIT_DEFINITIONS = [b]`,
      "frontend/src/components/editor/workflow-editor/execute-node.ts": "export const run = 1",
      "frontend/src/lib/h.ts": "export const h = 1",
      "frontend/src/nodes/c-node/exec.ts": `import { NODE_OPTIONS } from "@/lib/node-options"; export const c = NODE_OPTIONS`,
      "frontend/src/lib/node-options.tsx": "export const NODE_OPTIONS = []",
    })
    const r = checkBoundaries("frontend", units, {})
    expect(r.failures.filter((f) => f.startsWith("[boundaries/node-units]")).map((f) => f.split(" — ")[0])).toEqual([
      "[boundaries/node-units] frontend/src/nodes/a-node/exec.ts -> frontend/src/components/editor/workflow-editor/execute-node.ts",
      "[boundaries/node-units] frontend/src/nodes/a-node/exec.ts -> frontend/src/nodes/_generated/definitions.ts",
      "[boundaries/node-units] frontend/src/nodes/a-node/exec.ts -> frontend/src/nodes/b-node/exec.ts",
      "[boundaries/node-units] frontend/src/nodes/c-node/exec.ts -> frontend/src/lib/node-options.tsx",
    ])
    // A recorded edge of the OTHER project never reads as "fixed" here.
    const known = { "node-units": ["backend/src/nodes/x/route.ts -> backend/src/nodes/y/route.ts"] }
    expect(checkBoundaries("frontend", graphOf({ "frontend/src/lib/h.ts": "export const h = 1" }), known).notes).toEqual([])
  })

  it("C4 reports (never fails) a file entering the hub set with its fan-in, notes one that left", () => {
    // 4 tests → threshold 1; every reached product file is a hub here.
    const fresh = checkHubs("frontend", g, m, { frontend: ["frontend/src/lib/hub.ts", "frontend/src/lib/mid.ts", "frontend/src/lib/ui-user.ts", "frontend/src/components/button.tsx", "frontend/src/lib/old.ts"] })
    expect(fresh.failures).toEqual([])
    expect(fresh.findings).toHaveLength(1)
    expect(fresh.findings[0]).toMatch(/frontend\/src\/lib\/leaf\.ts is now loaded by 3 of 4 tests \(75 %/)
    expect(fresh.report).toBe("[hubs/frontend] report only — 5 hubs (fan-in ≥ 1 of 4 tests; register lists 5): 1 entered, 1 left. Entered: frontend/src/lib/leaf.ts (75 %).")
    expect(fresh.notes.join("\n")).toMatch(/dropped below 25 % fan-in \(frontend\/src\/lib\/old\.ts\)/)
  })

  it("--tighten only ever removes entries or lowers numbers", () => {
    const current = {
      cycles: { frontend: { largest: 0, components: [] } },
      importBudget: { frontend: { "frontend/src/lib/__tests__/a.test.ts": 3, "frontend/src/lib/__tests__/new.test.ts": 999 } },
      boundaries: { "frontend-lib-not-ui": ["x -> y", "new -> edge"] },
      hubs: { frontend: ["frontend/src/lib/hub.ts", "frontend/src/lib/new-hub.ts"] },
    }
    const baselines = {
      cycles: { frontend: { largest: 3, components: [["a", "b", "c"]] } },
      importBudget: { default: 2, tests: { frontend: { "frontend/src/lib/__tests__/a.test.ts": 9 } } },
      boundaries: { "frontend-lib-not-ui": ["x -> y", "fixed -> edge"] },
      hubs: { frontend: ["frontend/src/lib/hub.ts", "frontend/src/lib/old.ts"] },
    }
    expect(tightenedBaselines(current, baselines)).toEqual({
      cycles: { frontend: { largest: 0, components: [] } },
      importBudget: { default: 2, tests: { frontend: { "frontend/src/lib/__tests__/a.test.ts": 3 } } },
      boundaries: { "frontend-lib-not-ui": ["x -> y"] },
      hubs: { frontend: ["frontend/src/lib/hub.ts"] },
    })
  })
})
