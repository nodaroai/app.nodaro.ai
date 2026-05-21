import { describe, expect, it } from "vitest"
import { execute } from "../vote"

const ctx = { userId: "u1", jobId: "j1", logger: console as any }

describe("vote strategy", () => {
  it("returns the most common survivor", async () => {
    const out = await execute(["a", "b", "a", "c", "a"], { caseSensitive: false }, ctx)
    expect(out.result).toBe("a")
    expect(out.meta.summary).toMatch(/a.*3.*5/)
  })

  it("filters empty strings before tallying", async () => {
    const out = await execute(["a", "", "b", "", "b"], { caseSensitive: false }, ctx)
    expect(out.result).toBe("b")
  })

  it("ties resolve to the first encountered survivor", async () => {
    const out = await execute(["a", "b"], { caseSensitive: false }, ctx)
    expect(out.result).toBe("a")
  })

  it("caseSensitive=true treats 'A' and 'a' as different", async () => {
    const out = await execute(["A", "a", "A"], { caseSensitive: true }, ctx)
    expect(out.result).toBe("A")
  })

  it("caseSensitive=false treats 'A' and 'a' as same", async () => {
    const out = await execute(["A", "a", "A"], { caseSensitive: false }, ctx)
    expect(out.result.toLowerCase()).toBe("a")
  })

  it("throws EmptyInputError when all are empty", async () => {
    const { EmptyInputError } = await import("../types")
    await expect(execute(["", ""], { caseSensitive: false }, ctx)).rejects.toBeInstanceOf(EmptyInputError)
  })
})
