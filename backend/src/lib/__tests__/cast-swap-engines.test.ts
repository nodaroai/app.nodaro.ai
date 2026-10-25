import { afterEach, describe, expect, it } from "vitest"
import { castSwapEnginesOf, castSwapLengthKey, loadedEngineRuns, withWireLengthKey } from "../cast-swap-engines.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../private-plugins/supports-registry.js"

/**
 * What a (loaded or recorded) Cast Swap engine runs, read in the platform's
 * internal ids whatever vocabulary it declared: an older engine the internal
 * ids, plugin 0.394.0+ the public ids AND the internal ones as aliases
 * (`engineAliases: true`) — which must read as two engines, not four.
 */
describe("castSwapEnginesOf", () => {
  afterEach(() => _resetPluginSupportsForTests())

  it("reads an engine that predates the choice as Pro alone", () => {
    expect(castSwapEnginesOf(undefined)).toEqual(["seedance-2-5"])
    expect(castSwapEnginesOf({})).toEqual(["seedance-2-5"])
  })

  it("reads each vocabulary, and both at once, as the two internal engines", () => {
    expect(castSwapEnginesOf({ engines: ["seedance-2-5", "kling-4"] })).toEqual(["seedance-2-5", "kling-4"])
    expect(castSwapEnginesOf({ engines: ["motion-pro", "motion-lite"] })).toEqual(["seedance-2-5", "kling-4"])
    expect(castSwapEnginesOf({ engines: ["motion-pro", "motion-lite", "seedance-2-5", "kling-4"] })).toEqual(["seedance-2-5", "kling-4"])
    expect(castSwapEnginesOf({ engines: ["motion-pro"] })).toEqual(["seedance-2-5"])
  })

  it("drops a declared value that names no engine", () => {
    expect(castSwapEnginesOf({ engines: ["kling-5", "motion-lite"] })).toEqual(["kling-4"])
    expect(castSwapEnginesOf({ engines: [] })).toEqual([])
  })

  it("answers loadedEngineRuns from the loaded declaration, in either vocabulary", () => {
    expect(loadedEngineRuns("kling-4")).toBe(false)
    expect(loadedEngineRuns("seedance-2-5")).toBe(true)
    setPluginSupports({ castSwap: { engines: ["motion-pro", "motion-lite", "seedance-2-5", "kling-4"], engineAliases: true } as never })
    expect(loadedEngineRuns("kling-4")).toBe(true)
  })
})

describe("withWireLengthKey", () => {
  afterEach(() => _resetPluginSupportsForTests())

  it("sends klingLength to an older engine, and motionLength where the engine declares engineAliases", () => {
    expect(castSwapLengthKey()).toBe("klingLength")
    expect(withWireLengthKey({ a: 1, motionLength: "cut-start" })).toEqual({ a: 1, klingLength: "cut-start" })
    expect(withWireLengthKey({ a: 1, klingLength: "cut-start" })).toEqual({ a: 1, klingLength: "cut-start" })
    setPluginSupports({ castSwap: { engines: ["motion-pro", "motion-lite"], engineAliases: true } as never })
    expect(castSwapLengthKey()).toBe("motionLength")
    expect(withWireLengthKey({ a: 1, klingLength: "cut-end" })).toEqual({ a: 1, motionLength: "cut-end" })
  })

  it("leaves a body with no length fit as it is", () => {
    const body = { a: 1 }
    expect(withWireLengthKey(body)).toBe(body)
  })
})
