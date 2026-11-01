/**
 * The shot list's pure rules on the admin screens: a style at its defaults is
 * never written, what needs an engine that runs it, the "description +
 * original" scene offered only where an engine declares it (with the
 * original's clip limit), and the Steps view's line on the measured cuts.
 */
import { describe, expect, it } from "vitest"
import type { TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS } from "./harness"
import { normaliseShotList, shotListNeedsEngine } from "../shot-list"
import { offeredScenes, originalSceneTooLong } from "../prompt-style"
import { cutsLine } from "../../jobs/job-generation-details"

const declares = (env: string, scenes: string[]): TrendEngineEnvironment =>
  ({ ...ENVIRONMENTS[0]!, env, supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, fullDepthScenes: scenes } } }) as TrendEngineEnvironment

describe("the shot list setting", () => {
  it("leaves out each style at its defaults", () => {
    expect(normaliseShotList(undefined)).toBeUndefined()
    expect(normaliseShotList({ precise: { mode: "off" }, flex: { mode: "on" } })).toBeUndefined()
    expect(normaliseShotList({ precise: { mode: "on" }, flex: { mode: "on" } })).toEqual({ precise: { mode: "on" } })
  })
  it("needs an engine that runs it only away from the defaults", () => {
    expect(shotListNeedsEngine({ flex: { mode: "on" } })).toBe(false)
    expect(shotListNeedsEngine({ precise: { mode: "on" } })).toBe(true)
    expect(shotListNeedsEngine({ flex: { mode: "on", llm: { model: "m", inputs: ["clip"], maxChars: 1000 } } })).toBe(true)
  })
})

describe("the description + original scene", () => {
  it("is offered only where an environment's engine declares it, or once chosen", () => {
    const values = (envs: TrendEngineEnvironment[] | undefined, current = "description" as const) => offeredScenes(current, envs).map((s) => s.value)
    expect(values(undefined)).toEqual(["description", "original", "none"])
    expect(values([declares("staging", ["description", "original", "none"])])).toEqual(["description", "original", "none"])
    expect(values([declares("staging", ["description", "description-and-original"])])).toContain("description-and-original")
    expect(offeredScenes("description-and-original", undefined).map((s) => s.value)).toContain("description-and-original")
    expect(offeredScenes("description", undefined, ["description", "description-and-original"]).map((s) => s.value)).toEqual(["description"])
  })
  it("holds the original's clip limit", () => {
    const m = { mode: "always" as const, source: "full-depth" as const, scene: "description-and-original" as const }
    expect(originalSceneTooLong(m, 27.6)).toBe(true)
    expect(originalSceneTooLong(m, 27.5)).toBe(false)
    expect(originalSceneTooLong({ ...m, scene: "description" }, 29)).toBe(false)
  })
})

describe("the Steps view's cut times", () => {
  it("says the cuts, one shot, or none measured", () => {
    expect(cutsLine([1.2, 2.5])).toBe("Cuts measured (2): 1.2 s, 2.5 s.")
    expect(cutsLine([])).toBe("Cuts measured: none (one shot).")
    expect(cutsLine(undefined)).toMatch(/No cut times were measured/)
  })
})
