// @vitest-environment node
/**
 * Every editor surface that shows an execution's `error_message` reads it
 * through `executionErrorText`: a refusal the server records as a STABLE CODE
 * (`preview_review_required`, `preview_render_nested`) is shown as its copy in
 * the reader's language, never as the bare code (decided 2026-10-04).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")

describe("execution error text — the editor's display sites", () => {
  it("the editor's Executions tab maps the error before showing it", () => {
    const src = read("components/editor/executions-tab.tsx")
    expect(src).toContain("executionErrorText(exec.errorMessage)")
    expect(src).not.toMatch(/\{\s*exec\.errorMessage\s*\}/)
  })

  it("every server-run failure toast maps its description", () => {
    // One helper says a failed run (with its Continue from failed action): it maps the error…
    const helper = read("components/editor/workflow-editor/run-ended-toast.ts")
    expect(helper).toMatch(/toast\.error\(tx\("run\.backendFailed"\),\s*\{\s*description:\s*executionErrorText\(errorMessage\)/)
    // …and every place a run's failure reaches the editor goes through it, never a toast of its own.
    const src = read("components/editor/workflow-editor/run-handlers.ts")
    expect(src).not.toContain('tx("run.backendFailed")')
    expect([...src.matchAll(/toastBackendRunFailed\(executionId,/g)].length).toBeGreaterThanOrEqual(4)
  })

  it("the app runner maps a run's error both when it lands live and when a run is reopened", () => {
    const src = read("hooks/use-app-runner-store.ts")
    expect(src).toContain("errorMessage: executionErrorText(run.execution.errorMessage)")
    expect(src).toContain('errorMessage: executionErrorText(status.error_message) ?? "Execution failed"')
    expect(src).not.toMatch(/errorMessage:\s*status\.error_message\b/)
  })

  it("the Copilot's failed-run card maps the message", () => {
    const src = read("ee/components/copilot/copilot-run-section.tsx")
    expect(src).toMatch(/message=\{executionErrorText\(execution\?\.errorMessage\)\}/)
  })
})
