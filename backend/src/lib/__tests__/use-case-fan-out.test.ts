import { describe, it, expect } from "vitest"
import {
  USE_CASE_LIST_DRIVEN,
  USE_CASE_NODE_TYPES,
  USE_CASE_REVIEW_LIST_DRIVEN,
  USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE,
  usecaseFanOutRefusalOf,
  usecaseFanOutRefused,
  usecaseListDrivenMessage,
  usecaseListsItsResult,
} from "@nodaro/render-rules"

/** The refusal's words for Trailer (decided 2026-10-18). */
const TRAILER_LIST_DRIVEN = "Trailer takes one recording. Use a separate workflow run for each recording."
import { usecaseFanOutRefusal } from "../../services/workflow-engine/use-case-request.js"

describe("a review-on use-case node is refused where an engine would fan it out over a list", () => {
  it("every use-case node with review on is refused; review off (a single-result node), or any other node, is not", () => {
    for (const type of USE_CASE_NODE_TYPES) {
      expect(usecaseFanOutRefused({ type, data: { reviewBeforeRender: true } })).toBe(true)
      // A node whose own result is a list is refused whatever its review says (below).
      if (usecaseListsItsResult(type)) continue
      expect(usecaseFanOutRefused({ type, data: { reviewBeforeRender: false } })).toBe(false)
      expect(usecaseFanOutRefused({ type, data: {} })).toBe(false)
    }
    expect(usecaseFanOutRefused({ type: "apply-edl", data: { reviewBeforeRender: true } })).toBe(false)
    expect(usecaseFanOutRefused({ type: undefined, data: undefined })).toBe(false)
  })

  it("the server's refusal carries the stable code", () => {
    const err = usecaseFanOutRefusal({ id: "t1", type: "tighten-episode", data: { reviewBeforeRender: true } })
    expect(err?.errorCode).toBe(USE_CASE_REVIEW_LIST_DRIVEN)
    expect(err?.message).toBe(USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE)
    expect(usecaseFanOutRefusal({ id: "t1", type: "tighten-episode", data: {} })).toBeNull()
  })
})

describe("a use-case node whose own result is a list is never fanned out over a list (decided 2026-10-14)", () => {
  it("a Trailer with review OFF is refused with use_case_list_driven; a Tighten with review off is not", () => {
    expect(usecaseFanOutRefusalOf({ type: "episode-trailer", data: { reviewBeforeRender: false } })).toEqual({ code: USE_CASE_LIST_DRIVEN, message: TRAILER_LIST_DRIVEN })
    expect(usecaseFanOutRefusalOf({ type: "episode-trailer", data: {} })?.code).toBe(USE_CASE_LIST_DRIVEN)
    expect(usecaseFanOutRefusalOf({ type: "tighten-episode", data: { reviewBeforeRender: false } })).toBeNull()
    expect(usecaseFanOutRefused({ type: "episode-trailer", data: {} })).toBe(true)
  })
  it("with review on too, the list refusal is the one named (turning review off would not help)", () => {
    expect(usecaseFanOutRefusalOf({ type: "episode-trailer", data: { reviewBeforeRender: true } })?.code).toBe(USE_CASE_LIST_DRIVEN)
    expect(usecaseFanOutRefusalOf({ type: "tighten-episode", data: { reviewBeforeRender: true } })?.code).toBe(USE_CASE_REVIEW_LIST_DRIVEN)
  })
  it("the server's refusal carries the code and the English text", () => {
    const err = usecaseFanOutRefusal({ id: "tr", type: "episode-trailer", data: {} })
    expect(err?.errorCode).toBe(USE_CASE_LIST_DRIVEN)
    expect(err?.message).toBe(TRAILER_LIST_DRIVEN)
  })
  it("the copy names the node's own type, never another node", () => {
    expect(usecaseListDrivenMessage("Trailer")).toBe(TRAILER_LIST_DRIVEN)
    expect(TRAILER_LIST_DRIVEN).not.toMatch(/Tighten/)
  })
})
