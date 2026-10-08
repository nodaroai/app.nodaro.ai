import { describe, expect, it } from "vitest"
import { describeErrorChain } from "../llm-errors.js"

describe("describeErrorChain", () => {
  it("reads every cause, outermost first, as class name and message", () => {
    const err = new Error("outer", { cause: Object.assign(new TypeError("middle"), { cause: "root text" }) })
    expect(describeErrorChain(err)).toBe("Error: outer | caused by TypeError: middle | caused by root text")
  })

  it("carries name and message only — never the request an SDK error holds", () => {
    const err = Object.assign(new Error("400 rejected"), {
      status: 400,
      request: { headers: { authorization: "Bearer not-for-logs" }, body: "{\"prompt\":\"private\"}" },
    })
    expect(describeErrorChain(err)).toBe("Error: 400 rejected")
  })

  it("is bounded in depth and per link", () => {
    let err = new Error("deepest")
    for (let i = 0; i < 20; i++) err = new Error(`level ${i}`, { cause: err })
    expect(describeErrorChain(err).split(" | caused by ")).toHaveLength(6)
    expect(describeErrorChain(new Error("y".repeat(5000)))).toHaveLength(601)
  })

  it("reads a thrown value that is not an Error", () => {
    expect(describeErrorChain({ message: "plain object" })).toBe("plain object")
    expect(describeErrorChain("text")).toBe("text")
  })
})
