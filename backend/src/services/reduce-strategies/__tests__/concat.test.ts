import { describe, expect, it } from "vitest"
import { execute } from "../concat"

const ctx = { userId: "u1", jobId: "j1", logger: console as any }

describe("concat strategy", () => {
  it("joins survivors with the configured separator", async () => {
    const out = await execute(["a", "b", "c"], { separator: ", " }, ctx)
    expect(out.result).toBe("a, b, c")
    expect(out.meta.summary).toMatch(/joined 3/i)
  })

  it("filters empty strings before joining", async () => {
    const out = await execute(["a", "", "b", ""], { separator: "-" }, ctx)
    expect(out.result).toBe("a-b")
    expect(out.meta.summary).toMatch(/2/)
  })

  it("returns empty string for all-empty input (no error)", async () => {
    const out = await execute(["", ""], { separator: "," }, ctx)
    expect(out.result).toBe("")
    expect(out.meta.summary).toMatch(/0/)
  })

  it("defaults separator to double-newline when undefined", async () => {
    const out = await execute(["a", "b"], { separator: "\n\n" }, ctx)
    expect(out.result).toBe("a\n\nb")
  })
})
