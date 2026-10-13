/**
 * The photo influence set's guard (ugc-photo-sentinel-cases.ts), at the two places every surface
 * goes through: the funnel that hands a workflow to anyone but its author (`ugcPublishedGraph`),
 * and the loader that hands such a run each sub-workflow graph it executes, at every depth
 * (`loadNestedRunGraphs`, the run's own loader, stripping each graph by its part of the set).
 * (a) No `KILL` ships; (c) every `KEEP` does.
 *
 * And the guard cannot be walked around: only the funnel and that loader strip a graph as
 * published, and every file that calls the funnel or the run's photo check is a surface one of the
 * sentinel tests reads — a new one fails here until a sentinel test reads it too.
 */
import { describe, it, expect, vi, beforeAll } from "vitest"
import type { CaseGraph } from "./ugc-photo-sentinel-cases.js"

const db = vi.hoisted(() => ({ workflows: new Map<string, CaseGraph>(), components: new Map<string, { graph: CaseGraph; creatorId: string }>() }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (column: string, value: unknown) => {
        filters[column] = value
        return chain
      }
      for (const m of ["is", "order", "limit"]) chain[m] = () => chain
      chain.single = async () => {
        const row = filters.user_id === OWNER ? db.workflows.get(filters.id as string) : undefined
        return row ? { data: row, error: null } : { data: null, error: { code: "PGRST116" } }
      }
      // A component's snapshot, by its slug.
      chain.then = (resolve: (v: unknown) => unknown) => {
        const found = table === "published_apps" ? db.components.get(filters.slug as string) : undefined
        return resolve({ data: found ? [{ snapshot_nodes: found.graph.nodes, snapshot_edges: found.graph.edges, creator_id: found.creatorId }] : [], error: null })
      }
      return chain
    },
  },
}))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))

import ts from "typescript"
import { CONTROL_CASES, KEEP, KILL, SENTINEL_CASES, marked, type SentinelCase } from "./ugc-photo-sentinel-cases.js"
import { SCAN_TIMEOUT_MS, eachSourceFile, parseText, walk } from "./source-scan.js"
import { ugcPublishedGraph } from "../ugc-composed-graph.js"
import { loadNestedRunGraphs, subWorkflowLoadOptions } from "../../services/workflow-engine/sub-workflow-handler.js"
import type { SimpleNode } from "../../services/workflow-engine/types.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"

beforeAll(async () => {
  await import("../../services/workflow-engine/sub-workflow-handler.js")
}, 60_000)

async function read(c: SentinelCase) {
  db.workflows.clear()
  db.components.clear()
  for (const [id, graph] of Object.entries(c.workflows)) db.workflows.set(id, graph)
  for (const [slug, found] of Object.entries(c.components ?? {})) db.components.set(slug, found)
  const published = await ugcPublishedGraph(c.graph.nodes, c.graph.edges, OWNER)
  const nested = await loadNestedRunGraphs(
    published.nodes as unknown as SimpleNode[],
    OWNER,
    0,
    new Set(),
    [],
    subWorkflowLoadOptions({ runsAsPublished: true, ugcStripSet: published.sets }),
  )
  return { shipped: JSON.stringify(published.nodes), nested: nested.map((g) => JSON.stringify(g.nodes)) }
}

describe.each([...SENTINEL_CASES, ...CONTROL_CASES].map((c) => [c.name, c] as const))("%s", (_name, c) => {
  it("(a) nothing that can flow into a creator's photo ships, nor reaches a sub-workflow graph the run loads", async () => {
    const { shipped, nested } = await read(c)
    expect(shipped).not.toContain(KILL)
    for (const graph of nested) expect(graph).not.toContain(KILL)
  })

  it("(c) everything else ships as it is", async () => {
    const { shipped, nested } = await read(c)
    for (const keep of marked(c, KEEP)) expect(shipped, keep).toContain(keep)
    const inChildren = marked(c, KEEP, true).filter((keep) => !marked(c, KEEP).includes(keep))
    for (const keep of inChildren) expect(nested.join("\n"), keep).toContain(keep)
  })
})

describe("the cases hold what they guard", () => {
  it("every sentinel case plants the sentinel in the graph or a sub-workflow graph, and every case a control", () => {
    for (const c of SENTINEL_CASES) {
      expect(marked(c, KILL, true).length, c.name).toBeGreaterThan(0)
      expect(marked(c, KEEP).length, c.name).toBeGreaterThan(0)
    }
  })
})

/**
 * Does this source call `name(…)` (a call, never a mention) — under its own name, an alias it is
 * imported as (`import { name as other }`), a const it is handed to (`const other = name`), a
 * destructured alias, or through a namespace (`ns.name(…)`)? A re-export of it counts too.
 */
function callsIn(sf: ts.SourceFile, name: string): boolean {
  const names = new Set([name])
  let hit = false
  walk(sf, (n) => {
    if (ts.isImportSpecifier(n) && (n.propertyName ?? n.name).text === name) names.add(n.name.text)
    if (ts.isExportSpecifier(n) && (n.propertyName ?? n.name).text === name) hit = true
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.initializer) && names.has(n.initializer.text) && ts.isIdentifier(n.name)) names.add(n.name.text)
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name) && ((n.propertyName && ts.isIdentifier(n.propertyName) && n.propertyName.text === name) || (!n.propertyName && n.name.text === name))) names.add(n.name.text)
  })
  walk(sf, (n) => {
    if (!ts.isCallExpression(n)) return
    const callee = n.expression
    if ((ts.isIdentifier(callee) && names.has(callee.text)) || (ts.isPropertyAccessExpression(callee) && callee.name.text === name)) hit = true
  })
  return hit
}

/** `callsIn` over an inline source (the matcher's own self-test). */
function callersIn(source: string, name: string): boolean {
  return callsIn(parseText("inline.ts", source), name)
}

/** The files of backend/src that call `name(…)` (`callsIn`). */
function callers(name: string): string[] {
  const found = new Set<string>()
  eachSourceFile([name], (sf, rel) => {
    if (callsIn(sf, name)) found.add(rel)
  })
  return [...found].sort()
}

describe("the scan finds a call however the callee is named", () => {
  it.each([
    ["an aliased import", `import { stripUgcPublishState as stripAlone } from "@nodaro/render-rules"\nvoid stripAlone([], [])`],
    ["a const alias", `import { stripUgcPublishState } from "@nodaro/render-rules"\nconst strip = stripUgcPublishState\nstrip([], [])`],
    ["a namespace import", `import * as rules from "@nodaro/render-rules"\nrules.stripUgcPublishState([], [])`],
    ["a destructured alias", `import * as rules from "@nodaro/render-rules"\nconst { stripUgcPublishState: s } = rules\ns([], [])`],
    ["a re-export", `export { stripUgcPublishState as strip } from "@nodaro/render-rules"`],
  ])("%s", (_how, source) => {
    expect(callersIn(source, "stripUgcPublishState")).toBe(true)
  })

  it("a mention in a comment or a string is no call", () => {
    expect(callersIn(`// stripUgcPublishState(nodes)\nconst text = "stripUgcPublishState(x)"`, "stripUgcPublishState")).toBe(false)
  })
})

/**
 * Every surface the guard table reads, by the file that hands a workflow to anyone but its author
 * (it calls the funnel) or refuses a run (it calls the one check), with the test that guards it.
 */
const GUARDED_SURFACES: Readonly<Record<string, string>> = {
  "lib/workflow-route-access.ts": "ugc-photo-sentinel-read (an editable copy's source)",
  "routes/presentation.ts": "ugc-photo-sentinel-read (a share link's view), ugc-photo-sentinel-refusal (a viewer's run)",
  "routes/published-apps.ts": "ugc-photo-sentinel-publish (an app, a component, a next version)",
  "routes/workflow-templates.ts": "ugc-photo-sentinel-publish (a template, a re-publish)",
  "routes/workflows.ts": "ugc-photo-sentinel-read (a public read)",
  "workers/orchestrator-worker.ts": "ugc-photo-sentinel-run (a viewer's run, an app's run)",
}
const GUARDED_REFUSALS: Readonly<Record<string, string>> = {
  "routes/app-runner.ts": "ugc-photo-sentinel-refusal (an app's runner)",
  "routes/component-execute.ts": "ugc-photo-sentinel-refusal (a component's caller)",
  "routes/presentation.ts": "ugc-photo-sentinel-refusal (a share link's viewer)",
}

describe("the one funnel, and nothing around it", () => {
  it("only the funnel strips a graph as published, and a run's sub-workflow loader through it: no surface strips on its own", () => {
    expect(callers("stripUgcPublishState")).toEqual(["lib/ugc-composed-graph.ts"])
    expect(callers("ugcStripPart")).toEqual(["lib/ugc-composed-graph.ts", "services/workflow-engine/sub-workflow-handler.ts"])
  }, SCAN_TIMEOUT_MS)

  it("every file that hands a workflow to anyone but its author goes through the funnel, and the guard table reads each (a new one: add it to a sentinel test, then here)", () => {
    expect(callers("ugcPublishedGraph")).toEqual(Object.keys(GUARDED_SURFACES).sort())
  }, SCAN_TIMEOUT_MS)

  it("every run that refuses a missing photo asks the one check, and the guard table runs each", () => {
    expect(callers("ugcRunMissesPhoto")).toEqual(Object.keys(GUARDED_REFUSALS).sort())
    expect(callers("ugcAppRunMissesPhoto")).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it("every file that starts a run of a published app or component asks the one check first", () => {
    for (const file of callers("executeAppRun")) expect(Object.keys(GUARDED_REFUSALS), file).toContain(file)
  }, SCAN_TIMEOUT_MS)
})

/**
 * Does a file name the option `key` at all: as a property (written out, shorthand, quoted or
 * computed), a destructured name, a property read, or a string? Over-reads on purpose: a mention
 * anywhere in code counts, a comment does not.
 */
function namesKey(sf: ts.SourceFile, key: string): boolean {
  let hit = false
  walk(sf, (n) => {
    if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n) || ts.isPropertySignature(n)) && ts.isIdentifier(n.name) && n.name.text === key) hit = true
    if (ts.isBindingElement(n) && ((n.propertyName && ts.isIdentifier(n.propertyName) && n.propertyName.text === key) || (ts.isIdentifier(n.name) && n.name.text === key))) hit = true
    if (ts.isPropertyAccessExpression(n) && n.name.text === key) hit = true
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === key) hit = true
  })
  return hit
}

describe("a template's kept run: only the template publish route asks for one", () => {
  it.each([
    ["written out", `f(x, y, o, { keepRunResults: {} })`],
    ["shorthand", `const keepRunResults = {}\nf({ keepRunResults })`],
    ["quoted", `f({ "keepRunResults": {} })`],
    ["computed", `f({ ["keepRunResults"]: {} })`],
    ["set on a built object", `const o: Record<string, unknown> = {}\no["keepRunResults"] = {}\nf(o)`],
  ])("the scan sees the option %s", (_how, source) => {
    expect(namesKey(parseText("inline.ts", source), "keepRunResults")).toBe(true)
  })

  it("a mention in a comment is no use of it", () => {
    expect(namesKey(parseText("inline.ts", "// keepRunResults: {}"), "keepRunResults")).toBe(false)
  })

  it("no file but the funnel (which defines it) and the template publish route names keepRunResults: apps, components, share links, public reads and runs never keep a run", () => {
    const found = new Set<string>()
    eachSourceFile(["keepRunResults"], (sf, rel) => {
      if (namesKey(sf, "keepRunResults")) found.add(rel)
    })
    expect([...found].sort()).toEqual(["lib/ugc-composed-graph.ts", "routes/workflow-templates.ts"])
  }, SCAN_TIMEOUT_MS)
})

