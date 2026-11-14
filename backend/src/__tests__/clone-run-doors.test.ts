// @test-watches backend/src/routes/app-runner.ts backend/src/routes/app-run-resume.ts backend/src/routes/app-render-final.ts backend/src/routes/component-execute.ts backend/src/routes/presentation.ts backend/src/routes/workflow-execution.ts backend/src/routes/api-tokens.ts
/**
 * Every door that starts a run of someone else's graph asks the one-off clone check before anything is
 * held, and reads the runner's recordings only after its own cheaper checks (its daily limit, the
 * runner's credits), so a refused run downloads nothing (decided 2026-11-13; lib/clone-app-run.ts).
 * Every other run path refuses a clone nothing can fill (inside a component) before its execution row.
 * Read in each door's source, in order.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..")
const source = (rel: string) => readFileSync(join(SRC, rel), "utf8")

/** `first` appears in `text`, and before `then`. */
function inOrder(text: string, first: string, then: string, label: string): void {
  const a = text.indexOf(first)
  const b = text.indexOf(then)
  expect(a, `${label}: ${first} is asked`).toBeGreaterThan(-1)
  expect(b, `${label}: ${then} is there`).toBeGreaterThan(-1)
  expect(a, `${label}: ${first} before ${then}`).toBeLessThan(b)
}

describe("the one-off clone check at every door", () => {
  it("an app run: the check before the daily limit; the recordings after the credit checks, before any row", () => {
    const text = source("routes/app-runner.ts")
    inOrder(text, "await cloneRunCheck(", "const rateLimitPromise", "app run")
    inOrder(text, "checkAppRunEligibility(req.userId)", "await cloneRecordingsRefusal(", "app run")
    inOrder(text, "await cloneRecordingsRefusal(", "refuseDegradedAppRun(req, reply", "app run")
  })

  it("an app run's Retry: the check before its price; the recordings after the credit checks, before its row", () => {
    const text = source("routes/app-run-resume.ts")
    inOrder(text, "await cloneRunCheck(", "await resumePrice(", "Retry")
    inOrder(text, "price.sufficient === false", "await cloneRecordingsRefusal(", "Retry")
    inOrder(text, "await cloneRecordingsRefusal(", "await insertWithIdempotencyKey", "Retry")
  })

  it("an app run's Render final: the check before the credit checks; the recordings after them, before the final starts", () => {
    const text = source("routes/app-render-final.ts")
    inOrder(text, "await cloneRunCheck(", "checkAppRunEligibility(userId)", "Render final")
    inOrder(text, "checkAppRunEligibility(userId)", "await cloneRecordingsRefusal(", "Render final")
    inOrder(text, "await cloneRecordingsRefusal(", "await executeAppRenderFinal(", "Render final")
  })

  it("a component's run and a share link viewer's run: the whole check before anything is written", () => {
    inOrder(source("routes/component-execute.ts"), "await cloneRunRefusal(", "await executeAppRun(", "component")
    inOrder(source("routes/presentation.ts"), "await cloneRunRefusal(", 'trigger_type: "manual"', "share link")
  })

  it("an ordinary run (the editor, MCP run_workflow) and an API token's run: an unfillable clone before the execution row", () => {
    inOrder(source("routes/workflow-execution.ts"), "await unfillableCloneRefusal(", "await insertWithIdempotencyKey<", "workflow run")
    inOrder(source("routes/api-tokens.ts"), "await unfillableCloneRefusal(", '// Create execution', "API run")
  })
})
