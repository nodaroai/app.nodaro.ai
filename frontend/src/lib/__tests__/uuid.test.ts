import { describe, it, expect } from "vitest"
import { isValidUuid } from "../uuid"

describe("isValidUuid", () => {
  it("accepts canonical UUIDs (any version, any case)", () => {
    expect(isValidUuid("5542fce6-61e8-44b2-a6e2-f4184eafe734")).toBe(true)
    expect(isValidUuid("A40FBFA7-EAD9-41CF-AF27-5FD74B53E23E")).toBe(true)
  })

  it("rejects the synthetic local ids the reconcile poll must never treat as backend jobs", () => {
    // These are the exact ids from the production 404 storm.
    expect(isValidUuid("exec-node_4")).toBe(false)
    expect(isValidUuid("exec-node_13")).toBe(false)
    expect(isValidUuid("upload-url-1780778224300")).toBe(false)
  })

  it("rejects empty and malformed strings", () => {
    expect(isValidUuid("")).toBe(false)
    expect(isValidUuid("not-a-uuid")).toBe(false)
    expect(isValidUuid("5542fce6-61e8-44b2-a6e2")).toBe(false)
  })
})
