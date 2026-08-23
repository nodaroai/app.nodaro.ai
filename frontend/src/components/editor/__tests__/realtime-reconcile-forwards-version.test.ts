/**
 * The Realtime reconcile in workflow-canvas.tsx MUST forward `version` to
 * `reconcileFromRemote`. `loadedVersion` is the CAS token of the next full
 * save; when the canvas dropped it, every external write (MCP, Copilot,
 * another device) left the token stale and the user's next save failed with
 * "updated on another device" until a reload. Structural guard: the wiring
 * is one destructure + one spread, and that is where the regression lives.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("workflow-canvas realtime reconcile", () => {
  it("forwards the broadcast's version into reconcileFromRemote", () => {
    const source = readFileSync(join(__dirname, "..", "workflow-canvas.tsx"), "utf8")
    const start = source.indexOf("onReconcile:")
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf("onAppendNodes", start)
    expect(end).toBeGreaterThan(start)
    const block = source.slice(start, end)
    expect(block).toMatch(/\bversion\b/)
    expect(block).toMatch(/reconcileFromRemote\(\{[\s\S]*version[\s\S]*\}\)/)
  })
})
