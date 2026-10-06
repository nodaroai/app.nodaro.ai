/**
 * Site totality for the preview stop rule (decided 2026-10-04).
 *
 * Every place that builds the set of nodes a run executes — a filter by
 * `isExecutableNode` — either takes the set through the rule
 * (`previewRunnable`, directly or through `estimateRunCredits`) or is listed
 * here as exempt, with why. A new set builder fails this census until it is
 * classified, so no surface can quote, flip or count a node the run will not
 * execute. And every `executeNode` caller funnels through `executeNodeCore`,
 * whose backstop refuses a gated node.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC_ROOT = join(__dirname, "..", "..", "..", "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(path))
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

const FILES = sourceFiles(SRC_ROOT).map((path) => ({ rel: relative(SRC_ROOT, path), text: readFileSync(path, "utf8") }))

/** A set builder: a filter by `isExecutableNode` (called or passed). */
const BUILDS_SET = /isExecutableNode\(|\(isExecutableNode\)/
/** Takes its set through the stop rule. */
const GATED = /previewRunnable\(|estimateRunCredits\(/

/** Files that build an executable set and take it through the rule. */
const GATED_SITES = new Set([
  "components/editor/workflow-editor/run-handlers.ts", // Run / from-here / selected: pending flip, reset, precheck, confirm
  "components/editor/workflow-editor/workflow-editor-main.tsx", // the editor badge; the Copilot card and run
  "hooks/use-live-run-estimate.ts", // the live estimate that gates presentation and mobile runs
  "components/presentation/views/chat-view-helpers.ts", // buildStepChips
])

/** Files that test executability for something other than a run's set. */
const EXEMPT_SITES: Readonly<Record<string, string>> = {
  "components/editor/workflow-editor/types.ts": "defines isExecutableNode",
  "components/editor/workflow-editor/run-from-here-set.ts":
    "liveExecutable / runFromHereExecutable: every consumer prices through estimateRunCredits or gates the set itself",
  "components/editor/workflow-editor/clear-run-results.ts": "classifies what Clear results clears, not what a run executes",
  "components/nodes/node-preview-gate-chip.tsx": "the chip: shown on a runnable node inside the rule's own closure",
  "components/editor/workflow-editor/sub-workflow-executor.ts":
    "a nested graph's progress count; a nested graph holding a Preview render is refused before it runs",
}

describe("preview stop rule — every executable-set builder is classified", () => {
  const builders = FILES.filter((f) => BUILDS_SET.test(f.text)).map((f) => f.rel)

  it("has no unclassified builder", () => {
    const unknown = builders.filter((rel) => !GATED_SITES.has(rel) && !(rel in EXEMPT_SITES))
    expect(unknown, "classify each new set builder: gate it with previewRunnable, or exempt it with why").toEqual([])
  })

  it.each([...GATED_SITES])("%s takes its set through the rule", (rel) => {
    const file = FILES.find((f) => f.rel === rel)
    expect(file, `${rel} is gone — drop it from the census`).toBeDefined()
    expect(file!.text).toMatch(GATED)
  })

  it("the shared estimate itself is gated", () => {
    const file = FILES.find((f) => f.rel === "components/editor/workflow-editor/estimate-run-credits.ts")!
    expect(file.text).toContain("previewRunnable(")
  })

  it("lists no stale entry", () => {
    for (const rel of [...GATED_SITES, ...Object.keys(EXEMPT_SITES)]) expect(builders).toContain(rel)
  })
})

describe("preview stop rule — every derived set builder is classified (Render final, A6.1)", () => {
  // Render final and Update preview build their set from `liveExecutable`, not a
  // fresh `isExecutableNode` filter, so the census above cannot see them: this
  // one reads the other door. Each consumer prices or flips its set through the
  // rule, on the graph the run executes.
  const USES_LIVE_SET = /\b(liveExecutable|runFromHereExecutable)\(/
  const DERIVED_GATED = new Set([
    "components/editor/workflow-editor/run-handlers.ts", // Run from here / selected
    "components/editor/workflow-editor/render-final-handler.ts", // Render final / Update preview: previewRunnable on the overridden graph
    "hooks/use-render-final.ts", // the bar's prices: estimateRunCredits (via useRunSetCredits) on the overridden graph
    "hooks/use-run-from-here-credits.ts", // the button's quote: estimateRunCredits
  ])
  const DERIVED_EXEMPT: Readonly<Record<string, string>> = {
    "components/editor/workflow-editor/run-from-here-set.ts": "defines liveExecutable / runFromHereExecutable",
  }

  it("has no unclassified consumer", () => {
    const users = FILES.filter((f) => USES_LIVE_SET.test(f.text)).map((f) => f.rel)
    expect(users.filter((rel) => !DERIVED_GATED.has(rel) && !(rel in DERIVED_EXEMPT))).toEqual([])
    for (const rel of [...DERIVED_GATED, ...Object.keys(DERIVED_EXEMPT)]) expect(users, `${rel} is stale`).toContain(rel)
  })

  it("Render final takes its set through the rule, built from the overridden graph", () => {
    const src = FILES.find((f) => f.rel === "components/editor/workflow-editor/render-final-handler.ts")!.text
    expect(src).toMatch(/previewRunnable\(/)
    // The graph is overridden BEFORE anything is priced or checked from it.
    expect(src.indexOf("withRunOverrides(")).toBeGreaterThan(-1)
    expect(src.indexOf("withRunOverrides(")).toBeLessThan(src.indexOf("confirmRunOrAbort("))
    // It confirms on the overridden graph, never the canvas's.
    expect(src).toMatch(/confirmRunOrAbort\(ctx, exec, overridden,/)
  })

  it("the bar's price is the overridden graph's estimate, never the canvas's", () => {
    const src = FILES.find((f) => f.rel === "hooks/use-render-final.ts")!.text
    expect(src).toContain("withRunOverrides(")
    expect(src).toMatch(/useRunSetCredits\(asFinal\.executable, asFinal\.graph/)
  })
})

describe("Render final's guards (A6.1)", () => {
  it("the render's own ▶ refusal sits in the single-node block, above the skip-confirm shortcut", () => {
    const src = FILES.find((f) => f.rel === "components/editor/workflow-editor/run-handlers.ts")!.text
    const gate = src.slice(src.indexOf("export async function confirmRunOrAbort("))
    const refusal = gate.indexOf("renderOwnRunRefusal(")
    expect(refusal).toBeGreaterThan(-1)
    expect(refusal).toBeLessThan(gate.indexOf("if (skip ||"))
    expect(gate.indexOf("replanEditLosses(")).toBeLessThan(gate.indexOf("if (skip ||"))
  })

  it("Run from here and Run selected are held to the same refusal, above the skip-confirm shortcut", () => {
    const src = FILES.find((f) => f.rel === "components/editor/workflow-editor/run-handlers.ts")!.text
    const gate = src.slice(src.indexOf("export async function confirmRunOrAbort("))
    expect(gate).toMatch(/trigger === "from-here" \|\| trigger === "selected"/)
    expect(gate).toMatch(/renderOwnRunRefusal\(n\.id, allNodes, edges, ids\)/)
    expect(gate.indexOf('trigger === "from-here" ||')).toBeLessThan(gate.indexOf("if (skip ||"))
  })

  it("Render final saves before it runs, and a refused save stops it", () => {
    const src = FILES.find((f) => f.rel === "components/editor/workflow-editor/render-final-handler.ts")!.text
    const save = src.indexOf("await save(projectId)")
    expect(save).toBeGreaterThan(-1)
    expect(src.indexOf("saveFailed(saved)")).toBeGreaterThan(save)
    expect(src.indexOf("saveFailed(saved)")).toBeLessThan(src.indexOf("runWorkflow(workflowId"))
  })
})

describe("preview stop rule — every executeNode caller meets the backstop", () => {
  const EXECUTE_NODE = "components/editor/workflow-editor/execute-node.ts"
  const callers = FILES.filter((f) => f.rel !== EXECUTE_NODE && /\bexecuteNode\(/.test(f.text)).map((f) => f.rel)

  it("executeNode has one entry, executeNodeCore, and the core refuses a gated node first", () => {
    const src = FILES.find((f) => f.rel === EXECUTE_NODE)!.text
    const core = src.slice(src.indexOf("function executeNodeCore("))
    const refusal = core.indexOf("previewSingleRunRefusal(")
    expect(refusal).toBeGreaterThan(-1)
    // Before anything resolves inputs or creates a job.
    expect(refusal).toBeLessThan(core.indexOf("resolveNodeInputs("))
  })

  it("the census of direct callers is known (each reaches the backstop through executeNode)", () => {
    expect(callers.sort()).toEqual([
      "components/editor/workflow-editor/ai-writer-handlers.ts",
      "components/editor/workflow-editor/auto-execute.ts",
      "components/editor/workflow-editor/list-execution.ts",
      "components/editor/workflow-editor/run-handlers.ts",
      "components/editor/workflow-editor/sub-workflow-executor.ts",
    ])
  })

  it("auto-execute skips a gated node silently, before it calls executeNode", () => {
    const src = FILES.find((f) => f.rel === "components/editor/workflow-editor/auto-execute.ts")!.text
    const fn = src.slice(src.indexOf("export function autoExecuteNode("))
    expect(fn.indexOf("editorPreviewGatedIds(")).toBeGreaterThan(-1)
    expect(fn.indexOf("editorPreviewGatedIds(")).toBeLessThan(fn.indexOf("executeNode("))
  })

  it("the run gate's preflights scan only what the run executes (the set less the closure)", () => {
    const src = FILES.find((f) => f.rel === "components/editor/workflow-editor/run-handlers.ts")!.text
    const start = src.indexOf("async function confirmRunOrAbort(")
    const gate = src.slice(start, src.indexOf("\n}\n", start))
    const gating = gate.match(/const (\w+) = previewRunnable\(executable, allNodes, edges\)/)
    expect(gating, "confirmRunOrAbort must gate the set its preflights scan").not.toBeNull()
    const runs = gating![1]
    const calls = [...gate.matchAll(/\b(wordTimingsPreflight|nestedRunPreflight)\((\w+)/g)]
    expect(calls.map((m) => m[1]).sort()).toEqual(["nestedRunPreflight", "wordTimingsPreflight"])
    for (const m of calls) expect(m[2], `${m[1]} scans the ungated set`).toBe(runs)
    for (const m of calls) expect(gate.indexOf(m[0])).toBeGreaterThan(gate.indexOf(gating![0]))
  })

  it("the run gate refuses a single ▶ above the skip-confirm shortcut", () => {
    const src = FILES.find((f) => f.rel === "components/editor/workflow-editor/run-handlers.ts")!.text
    const gate = src.slice(src.indexOf("async function confirmRunOrAbort("))
    const refusal = gate.indexOf("previewSingleRunRefusal(")
    expect(refusal).toBeGreaterThan(-1)
    expect(refusal).toBeLessThan(gate.indexOf("if (skip ||"))
  })
})

describe("preview stop rule — read only through the flag-gated editor module (decided 2026-10-05)", () => {
  // PREVIEW_STOP_RULE_ENABLED off must leave the editor as it was before the
  // rule: a call of the shared rule anywhere else would ignore the flag.
  const CALL = /\b(previewStops|previewGatedNodeIds|holdsPreviewRender)\(/
  const MODULE = "components/editor/workflow-editor/preview-gate.ts"

  it("preview-gate.ts is the one caller", () => {
    expect(FILES.filter((f) => CALL.test(f.text)).map((f) => f.rel)).toEqual([MODULE])
  })

  it("it asks the flag /config.js hands the editor", () => {
    expect(FILES.find((f) => f.rel === MODULE)!.text).toContain("runtimePreviewStopRule()")
  })
})
