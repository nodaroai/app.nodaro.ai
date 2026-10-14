import { describe, it, expect } from "vitest"
import { USE_CASE_NODE_TYPES, USE_CASE_REVIEW_LIST_DRIVEN, usecaseFanOutRefused } from "@nodaro/render-rules"
import { usecaseFanOutRefusal } from "../../services/workflow-engine/use-case-request.js"

describe("a review-on use-case node is refused where an engine would fan it out over a list", () => {
  it("every use-case node with review on is refused; review off, or any other node, is not", () => {
    for (const type of USE_CASE_NODE_TYPES) {
      expect(usecaseFanOutRefused({ type, data: { reviewBeforeRender: true } })).toBe(true)
      expect(usecaseFanOutRefused({ type, data: { reviewBeforeRender: false } })).toBe(false)
      expect(usecaseFanOutRefused({ type, data: {} })).toBe(false)
    }
    expect(usecaseFanOutRefused({ type: "apply-edl", data: { reviewBeforeRender: true } })).toBe(false)
    expect(usecaseFanOutRefused({ type: undefined, data: undefined })).toBe(false)
  })

  it("the server's refusal carries the stable code", () => {
    const err = usecaseFanOutRefusal({ id: "t1", type: "tighten-episode", data: { reviewBeforeRender: true } })
    expect(err?.errorCode).toBe(USE_CASE_REVIEW_LIST_DRIVEN)
    expect(usecaseFanOutRefusal({ id: "t1", type: "tighten-episode", data: {} })).toBeNull()
  })
})
