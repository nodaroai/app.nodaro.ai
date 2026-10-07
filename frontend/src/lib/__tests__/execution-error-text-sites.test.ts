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
    const src = read("components/editor/workflow-editor/run-handlers.ts")
    const toasts = [...src.matchAll(/toast\.error\(tx\("run\.backendFailed"\),\s*\{\s*description:\s*([^}]*?)\s*,?\s*\}/g)]
    expect(toasts.length).toBeGreaterThanOrEqual(4)
    for (const [, description] of toasts) expect(description).toMatch(/^executionErrorText\(/)
  })

  it("the Copilot's failed-run card maps the message", () => {
    const src = read("ee/components/copilot/copilot-run-section.tsx")
    expect(src).toMatch(/message=\{executionErrorText\(execution\?\.errorMessage\)\}/)
  })
})
