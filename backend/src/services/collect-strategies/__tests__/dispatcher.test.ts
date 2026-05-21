import { describe, expect, it } from "vitest"
import { dispatchStrategy } from "../index"

const ctx = { userId: "u1", jobId: "j1", logger: console as any }

describe("dispatchStrategy", () => {
  it("routes to the right strategy by id", async () => {
    const out = await dispatchStrategy("concat", ["a", "b"], { separator: "-" }, ctx)
    expect(out.result).toBe("a-b")
  })

  it("validates config against the strategy's configSchema", async () => {
    await expect(
      dispatchStrategy("concat", ["a"], { separator: 123 as any }, ctx),
    ).rejects.toThrow(/expected string/i)
  })

  it("throws on unknown strategyId", async () => {
    await expect(
      dispatchStrategy("nope" as never, ["a"], {}, ctx),
    ).rejects.toThrow(/unknown collect strategy/i)
  })
})
