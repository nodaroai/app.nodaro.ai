import { describe, expect, it } from "vitest"
import { execute } from "../merge-json"

const ctx = { userId: "u1", jobId: "j1", logger: console as any }

describe("merge-json strategy", () => {
  it("deep-merges multiple JSON objects", async () => {
    const out = await execute(
      [`{"a":1,"nested":{"x":1}}`, `{"b":2,"nested":{"y":2}}`],
      { strategy: "deep" },
      ctx,
    )
    expect(JSON.parse(out.result)).toEqual({ a: 1, b: 2, nested: { x: 1, y: 2 } })
  })

  it("shallow-merges (last write wins on collisions)", async () => {
    const out = await execute(
      [`{"a":1,"nested":{"x":1}}`, `{"a":2,"nested":{"y":2}}`],
      { strategy: "shallow" },
      ctx,
    )
    expect(JSON.parse(out.result)).toEqual({ a: 2, nested: { y: 2 } })
  })

  it("filters empty strings before merging", async () => {
    const out = await execute([`{"a":1}`, "", `{"b":2}`, ""], { strategy: "deep" }, ctx)
    expect(JSON.parse(out.result)).toEqual({ a: 1, b: 2 })
    expect(out.meta.summary).toMatch(/2 of 4/)
  })

  it("throws EmptyInputError when all items are empty", async () => {
    const { EmptyInputError } = await import("../types")
    await expect(execute(["", ""], { strategy: "deep" }, ctx)).rejects.toBeInstanceOf(EmptyInputError)
  })

  it("throws on malformed JSON with item index in error message", async () => {
    await expect(execute([`{"a":1}`, `not json`], { strategy: "deep" }, ctx))
      .rejects.toThrow(/invalid json at item 1/i)
  })
})
