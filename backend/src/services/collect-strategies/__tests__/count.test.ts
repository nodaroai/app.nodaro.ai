import { describe, expect, it } from "vitest"
import { execute } from "../count"

const ctx = { userId: "u1", jobId: "j1", logger: console as any }

describe("count strategy", () => {
  it("returns the number of survivors (not the number of attempts)", async () => {
    const out = await execute(["a", "", "b", "", "c"], {}, ctx)
    expect(out.result).toBe(3)
    expect(out.meta.summary).toMatch(/3.*5/)
  })

  it("returns 0 when all items are empty", async () => {
    const out = await execute(["", "", ""], {}, ctx)
    expect(out.result).toBe(0)
  })

  it("returns 0 for empty input", async () => {
    const out = await execute([], {}, ctx)
    expect(out.result).toBe(0)
  })
})
