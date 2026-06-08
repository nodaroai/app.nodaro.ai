import { describe, it, expect } from "vitest"
import { NotFoundError } from "@nodaro/client"
import { isNotFound } from "../api-errors"

describe("isNotFound", () => {
  it("is true for the SDK NotFoundError (what getWorkflowExecution throws on HTTP 404)", () => {
    expect(isNotFound(new NotFoundError("Execution not found"))).toBe(true)
  })

  it("is true for any error carrying a numeric status of 404 (e.g. the SSE client's SseHttpError)", () => {
    expect(isNotFound({ status: 404 })).toBe(true)
    expect(isNotFound(Object.assign(new Error("SSE request failed (404)"), { status: 404 }))).toBe(true)
  })

  it("is false for other errors, non-404 statuses, and nullish values", () => {
    expect(isNotFound(new Error("network blip"))).toBe(false)
    expect(isNotFound({ status: 500 })).toBe(false)
    expect(isNotFound(undefined)).toBe(false)
    expect(isNotFound(null)).toBe(false)
  })
})
