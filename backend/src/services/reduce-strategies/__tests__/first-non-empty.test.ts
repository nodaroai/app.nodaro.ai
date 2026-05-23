import { describe, expect, it } from "vitest"
import { execute } from "../first-non-empty"

const ctx = { userId: "u1", jobId: "j1", logger: console as any }

describe("first-non-empty strategy", () => {
  it("returns the first non-empty item with its selectedIndex", async () => {
    const out = await execute(["", "", "third", "fourth"], {}, ctx)
    expect(out.result).toBe("third")
    expect(out.meta.selectedIndex).toBe(2)
  })

  it("returns the only non-empty item", async () => {
    const out = await execute(["only"], {}, ctx)
    expect(out.result).toBe("only")
    expect(out.meta.selectedIndex).toBe(0)
  })

  it("throws EmptyInputError when all are empty", async () => {
    const { EmptyInputError } = await import("../types")
    await expect(execute(["", "", ""], {}, ctx)).rejects.toBeInstanceOf(EmptyInputError)
  })
})
