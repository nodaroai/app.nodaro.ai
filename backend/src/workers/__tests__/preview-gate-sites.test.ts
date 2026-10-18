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
import { USE_CASE_NODE_TYPES, usecaseDescriptor } from "@nodaro/render-rules"

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

  // The spec's nine, since Render final in the app runner a tenth — the
  // app's Render final (a continuation of an app run) — an eleventh, a
  // use-case node's hidden run (decided 2026-10-13), and a twelfth, an app
  // run's Retry that continues its failed execution (decided 2026-10-18).
  const PRODUCERS = [
    "lib/plugin-triggers.ts",
    "lib/schedule-cron.ts",
    "routes/api-tokens.ts",
    "routes/app-run-resume.ts",
    "routes/app-runner.ts",
    "routes/presentation.ts",
    "routes/telegram-webhook.ts",
    "routes/webhook-triggers.ts",
    "routes/workflow-execution.ts",
    "services/app-execution.ts",
    "services/app-render-final.ts",
    "services/use-case-execution.ts",
  ]

  it("there are twelve: the spec's nine, the app's Render final, a use-case node's hidden run, and an app run's Retry", () => {
    expect(producers.map((f) => f.rel).sort()).toEqual(PRODUCERS)
  })

  it.each(PRODUCERS)("%s sets it", (rel) => expect(FILES.find((f) => f.rel === rel)!.text).toMatch(/reviewerPresent[,:]/))

  // A reviewer is a person who can press Render final: the editor
  // (`reviewer: "editor"`) and the app runner (`reviewer: "app"`, decided
  // 2026-10-04 with Render final in the app runner). Every other lane is
  // nobody to review.
  const APP_RUNNER_LANES = ["routes/app-runner.ts", "routes/app-run-resume.ts", "services/app-execution.ts", "services/app-render-final.ts"]

  // A use-case node's hidden run carries the answer of the run that started
  // the node — its caller's, never one of its own (decided 2026-10-13).
  const INHERITING_LANES = ["services/use-case-execution.ts"]

  it("only the editor's /run and the app runner's lanes can say a reviewer is present", () => {
    for (const f of producers) {
      if (f.rel === "routes/workflow-execution.ts" || APP_RUNNER_LANES.includes(f.rel) || INHERITING_LANES.includes(f.rel)) continue
      expect(f.text, f.rel).toMatch(/reviewerPresent: false/)
    }
  })

  it("the app runner's routes answer it from the runner's mark alone (lib/app-reviewer.ts)", () => {
    for (const rel of ["routes/app-runner.ts", "routes/app-render-final.ts", "routes/app-run-resume.ts"]) {
      expect(FILES.find((f) => f.rel === rel)!.text, rel).toMatch(/const reviewerPresent = appReviewerPresent\(req, /)
    }
    const mark = FILES.find((f) => f.rel === "lib/app-reviewer.ts")!.text
    expect(mark).toContain('req.authKind === "jwt"')
    expect(mark).toContain("extractMcpClient(req.body)")
    expect(mark).toMatch(/if \(opts\.component \|\| opts\.headless\) return false/)
  })

  it("a use-case node's hidden run passes its caller's answer through, unchanged", () => {
    expect(FILES.find((f) => f.rel === "services/use-case-execution.ts")!.text).toMatch(/reviewerPresent: p\.reviewerPresent,/)
  })

  // The hidden run passes its caller's answer through, so the guard follows
  // the callers: each derives it in the one helper, never from the body or a
  // literal (decided 2026-10-13).
  describe("every caller of executeInlineGraph derives reviewerPresent in usecaseReviewerPresent", () => {
    const USE_CASE_CALLERS = ["routes/use-case-continue.ts", "routes/use-case-run.ts"]
    const callers = FILES.filter((f) => f.rel !== "services/use-case-execution.ts" && /\bexecuteInlineGraph\(/.test(f.text))

    it("the callers are the listed use-case routes", () => {
      expect(callers.map((f) => f.rel).sort()).toEqual(USE_CASE_CALLERS)
    })

    it.each(USE_CASE_CALLERS)("%s answers it only through the helper", (rel) => {
      const text = FILES.find((f) => f.rel === rel)!.text
      const answers = [...text.matchAll(/reviewerPresent:\s*([^\n,]+)/g)].map((m) => m[1]!)
      expect(answers.length).toBeGreaterThan(0)
      for (const a of answers) expect(a, rel).toMatch(/^usecaseReviewerPresent\(/)
      // The parent's answer is the body field itself, never a literal or another value.
      const calls = [...text.matchAll(/usecaseReviewerPresent\(([^)]*)\)/g)].map((m) => m[1]!)
      expect(calls.length).toBeGreaterThan(0)
      for (const c of calls) expect(c, rel).toMatch(/\{ internal, forwarded: body\.reviewerPresent \}$/)
    })

    it("the helper: a caller outside any run when review is on; inside a run, only that run's literal true", () => {
      const src = FILES.find((f) => f.rel === "lib/use-case/request.ts")!.text
      const fn = src.slice(src.indexOf("export function usecaseReviewerPresent("))
      expect(fn.slice(0, fn.indexOf("\n}\n"))).toMatch(
        /if \(settings\.reviewBeforeRender !== true\) return false\s+return lane\.internal \? lane\.forwarded === true : true/,
      )
    })
  })

  // On the internal lane the use-case routes count a reviewer only when one is
  // FORWARDED (usecaseReviewerPresent). Two callers forward it, each from its
  // own reviewer (decided 2026-10-14): the backend engine (a use-case node in
  // a run — that run's own answer), and the MCP verbs (the agent that asked
  // for the review is its reviewer: `review_before_render` on a run, always on
  // a continue — which the route reads only when the run it continues has
  // review on). Any other forwarder fails here.
  describe("who forwards a reviewer to the use-case routes on the internal lane", () => {
    const FORWARDERS: Record<string, readonly RegExp[]> = {
      "services/workflow-engine/use-case-request.ts": [/reviewerPresent: ctx\.reviewerPresent === true,/],
      "lib/mcp/tools/verbs-use-case.ts": [
        /\.\.\.\(args\.review_before_render === true \? \{ reviewerPresent: true \} : \{\}\),/,
        /reviewerPresent: true,\n\s*mcp_client: session\.clientName,/,
      ],
    }
    // A file that calls a use-case route names one: a route literal, or the
    // type's route through the registry. A schema field (`reviewerPresent: z…`)
    // is no forward.
    const routeLiterals = USE_CASE_NODE_TYPES.map((t) => usecaseDescriptor(t).route.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
    const namesAUseCaseRoute = new RegExp(`["'\`](?:${routeLiterals.join("|")})|usecaseContinuePath\\(|usecaseDescriptor\\(`)
    const callers = FILES.filter(
      (f) => namesAUseCaseRoute.test(f.text) && /\breviewerPresent(?::(?!\s*z\.)|\s)/.test(f.text) && !f.rel.startsWith("routes/"),
    )

    it("the forwarders are the engine and the MCP verbs", () => {
      expect(callers.map((f) => f.rel).sort()).toEqual(Object.keys(FORWARDERS).sort())
    })

    it.each(Object.keys(FORWARDERS))("%s forwards it only by its own derivation", (rel) => {
      const text = FILES.find((f) => f.rel === rel)!.text
      const sites = [...text.matchAll(/\breviewerPresent:/g)].length
      for (const pattern of FORWARDERS[rel]!) expect(text, rel).toMatch(pattern)
      expect(sites, rel).toBe(FORWARDERS[rel]!.length)
    })
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
