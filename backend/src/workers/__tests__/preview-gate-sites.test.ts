/**
 * Site totality for the preview stop rule on the server (decided 2026-10-04).
 *
 * - Every producer that enqueues a workflow execution answers whether a
 *   reviewer is present (the field is REQUIRED; this also catches a payload
 *   built past the type).
 * - Both of the orchestrator's executable-set builders leave the gated
 *   closure out, and the stop is computed before either.
 * - The nested graph a sub-workflow runs is refused when it holds a Preview
 *   render (the handler's backstop).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(path))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(path)
    }
  }
  return out
}
const FILES = sourceFiles(SRC).map((path) => ({ rel: relative(SRC, path), text: readFileSync(path, "utf8") }))

describe("every enqueue producer answers reviewerPresent", () => {
  const producers = FILES.filter((f) => /orchestrationQueue\.add\(\s*"workflow-execution"/.test(f.text))

  // The spec's nine, and since Render final in the app runner a tenth: the
  // app's Render final (a continuation of an app run).
  const PRODUCERS = [
    "lib/plugin-triggers.ts",
    "lib/schedule-cron.ts",
    "routes/api-tokens.ts",
    "routes/app-runner.ts",
    "routes/presentation.ts",
    "routes/telegram-webhook.ts",
    "routes/webhook-triggers.ts",
    "routes/workflow-execution.ts",
    "services/app-execution.ts",
    "services/app-render-final.ts",
  ]

  it("there are ten: the spec's nine, and the app's Render final", () => {
    expect(producers.map((f) => f.rel).sort()).toEqual(PRODUCERS)
  })

  it.each(PRODUCERS)("%s sets it", (rel) => expect(FILES.find((f) => f.rel === rel)!.text).toMatch(/reviewerPresent[,:]/))

  // A reviewer is a person who can press Render final: the editor
  // (`reviewer: "editor"`) and the app runner (`reviewer: "app"`, decided
  // 2026-10-04 with Render final in the app runner). Every other lane is
  // nobody to review.
  const APP_RUNNER_LANES = ["routes/app-runner.ts", "services/app-execution.ts", "services/app-render-final.ts"]

  it("only the editor's /run and the app runner's lanes can say a reviewer is present", () => {
    for (const f of producers) {
      if (f.rel === "routes/workflow-execution.ts" || APP_RUNNER_LANES.includes(f.rel)) continue
      expect(f.text, f.rel).toMatch(/reviewerPresent: false/)
    }
  })

  it("the app runner's routes answer it from the runner's mark alone (lib/app-reviewer.ts)", () => {
    for (const rel of ["routes/app-runner.ts", "routes/app-render-final.ts"]) {
      expect(FILES.find((f) => f.rel === rel)!.text, rel).toMatch(/const reviewerPresent = appReviewerPresent\(req, /)
    }
    const mark = FILES.find((f) => f.rel === "lib/app-reviewer.ts")!.text
    expect(mark).toContain('req.authKind === "jwt"')
    expect(mark).toContain("extractMcpClient(req.body)")
    expect(mark).toMatch(/if \(opts\.component \|\| opts\.headless\) return false/)
  })

  it("a component's inner run is never a reviewer", () => {
    expect(FILES.find((f) => f.rel === "services/app-execution.ts")!.text).toMatch(/reviewerPresent === true && !isComponentExecution/)
  })
})

describe("the orchestrator leaves the gated closure out of both executable sets", () => {
  const src = FILES.find((f) => f.rel === "workers/orchestrator-worker.ts")!.text
  const run = src.slice(src.indexOf("export async function processWorkflowExecution("))

  it("computes the stop before it builds levels", () => {
    expect(run.indexOf("runPreviewStops(")).toBeGreaterThan(-1)
    expect(run.indexOf("runPreviewStops(")).toBeLessThan(run.indexOf("buildExecutionLevels("))
  })

  it("both `executableNodes` filters exclude it", () => {
    const filters = run.split("const executableNodes =").slice(1).map((s) => s.slice(0, s.indexOf("})")))
    expect(filters).toHaveLength(2)
    for (const body of filters) expect(body).toContain("previewGated.has(")
  })
})

describe("a nested graph holding a Preview render is refused by its handler", () => {
  it("executeSubWorkflow asks before any inner node runs", () => {
    const src = FILES.find((f) => f.rel === "services/workflow-engine/sub-workflow-handler.ts")!.text
    const run = src.slice(src.indexOf("export async function executeSubWorkflow("))
    expect(run.indexOf("previewRendersIn(")).toBeGreaterThan(-1)
    expect(run.indexOf("previewRendersIn(")).toBeLessThan(run.indexOf("executeNode("))
  })
})

describe("the shared stop rule is read only through the flag-gated funnel (decided 2026-10-05)", () => {
  // PREVIEW_STOP_RULE_ENABLED off must leave every surface as dev was before
  // the rule: a call of the shared rule anywhere else would ignore the flag.
  const CALL = /\b(previewStops|previewGatedNodeIds|holdsPreviewRender)\(/

  it("lib/preview-stop-rule.ts is the one caller", () => {
    expect(FILES.filter((f) => CALL.test(f.text)).map((f) => f.rel)).toEqual(["lib/preview-stop-rule.ts"])
  })

  it("its flag-free reading is the app listing's alone (decided 2026-10-06)", () => {
    const callers = FILES.filter((f) => f.rel !== "lib/preview-stop-rule.ts" && /\bpreviewStopsForListing\(/.test(f.text)).map((f) => f.rel)
    expect(callers).toEqual(["ee/billing/credits.ts"])
  })

  it("the funnel asks the flag", () => {
    expect(FILES.find((f) => f.rel === "lib/preview-stop-rule.ts")!.text).toContain("previewStopRuleEnabled()")
  })

  it("the fire lanes' check asks the flag before it reads the graph", () => {
    const src = FILES.find((f) => f.rel === "lib/preview-fire-refusal.ts")!.text
    expect(src.indexOf("previewStopRuleEnabled()")).toBeGreaterThan(-1)
    expect(src.indexOf("previewStopRuleEnabled()")).toBeLessThan(src.indexOf('.from("workflows")'))
  })

  it("the orchestrator applies the rule only to a job that carries reviewerPresent", () => {
    const src = FILES.find((f) => f.rel === "workers/orchestrator-worker.ts")!.text
    expect(src).toMatch(/typeof job\.data\.reviewerPresent === "boolean"/)
  })
})
