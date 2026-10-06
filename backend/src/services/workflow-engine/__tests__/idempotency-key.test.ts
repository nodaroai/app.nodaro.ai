import { describe, expect, it } from "vitest"
import { idempotencyScopeSegment, syncHttpIdempotencyKey } from "../idempotency-key.js"

const EXEC = "11111111-2222-4333-8444-555555555555"

describe("syncHttpIdempotencyKey", () => {
  it("names the execution, the node and the fan-out iteration — and nothing else for a top-level node", () => {
    expect(syncHttpIdempotencyKey(EXEC, "save")).toBe(`wf-${EXEC}-save`)
    expect(syncHttpIdempotencyKey(EXEC, "save", 2)).toBe(`wf-${EXEC}-save-2`)
    expect(syncHttpIdempotencyKey(EXEC, "save", 0)).toBe(`wf-${EXEC}-save-0`)
  })

  it("inside a sub-workflow, every iteration that entered it gets its own key — iterations 2..N are writes, not replays", () => {
    const keys = [0, 1, 2].map((i) => syncHttpIdempotencyKey(EXEC, "inner-save", undefined, [idempotencyScopeSegment("sub", i)]))
    expect(new Set(keys).size).toBe(3)
    expect(keys[1]).toBe(`wf-${EXEC}-sub-1-inner-save`)
  })

  it("two sub-workflow nodes running the same child workflow never share a key; a nested path keeps every level", () => {
    const a = syncHttpIdempotencyKey(EXEC, "inner-save", undefined, ["sub-a"])
    const b = syncHttpIdempotencyKey(EXEC, "inner-save", undefined, ["sub-b"])
    expect(a).not.toBe(b)
    expect(syncHttpIdempotencyKey(EXEC, "inner-save", 1, ["outer-0", "mid"])).toBe(`wf-${EXEC}-outer-0-mid-inner-save-1`)
  })

  it("a re-pick of the same iteration gets the same key (deterministic)", () => {
    expect(syncHttpIdempotencyKey(EXEC, "save", 3, ["sub-1"])).toBe(syncHttpIdempotencyKey(EXEC, "save", 3, ["sub-1"]))
  })

  it("a long or non-ASCII path is hashed — a header the route accepts, still deterministic and still distinct per iteration", () => {
    const longId = "n".repeat(220)
    const hashed = syncHttpIdempotencyKey(EXEC, longId, 1)
    expect(hashed.length).toBeLessThanOrEqual(200)
    expect(hashed.startsWith(`wf-${EXEC}-`)).toBe(true)
    expect(hashed).toBe(syncHttpIdempotencyKey(EXEC, longId, 1))
    expect(hashed).not.toBe(syncHttpIdempotencyKey(EXEC, longId, 2))
    const hebrew = syncHttpIdempotencyKey(EXEC, "שמירה-לאוסף")
    expect(/^[\x21-\x7e]+$/.test(hebrew)).toBe(true)
    expect(hebrew).not.toBe(syncHttpIdempotencyKey(EXEC, "שמירה-אחרת"))
  })
})
