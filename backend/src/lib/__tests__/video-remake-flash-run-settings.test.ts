import { describe, expect, it } from "vitest"
import { isPrismRun } from "../cast-swap-prism-reference-audio.js"
import { isPulseRun } from "../cast-swap-pulse-reference-audio.js"
import { sharedModelOf } from "../share-links/shared-job.js"

/**
 * A Flash choice's run is its engine's run in every setting the platform applies to a request (the audio hooks read
 * the engine of the run, `castSwapEngineOfRun`), and a shared link names it by the choice.
 */
describe("a Flash run takes its engine's settings", () => {
  it("Prism Flash is a Prism run, Pulse Flash a Pulse run", () => {
    expect(isPrismRun("nodaro-prism-flash")).toBe(true)
    expect(isPulseRun("nodaro-prism-flash")).toBe(false)
    expect(isPulseRun("nodaro-pulse-flash")).toBe(true)
    expect(isPrismRun("nodaro-pulse-flash")).toBe(false)
  })

  it("a shared link names the choice", () => {
    expect(sharedModelOf({ type: "cast-swap", engine: "nodaro-pulse-flash" })).toEqual({ id: "nodaro-pulse-flash", name: "Pulse Flash" })
    expect(sharedModelOf({ type: "cast-swap", engine: "nodaro-pulse" })).toEqual({ id: "nodaro-pulse", name: "Nodaro Pulse" })
  })
})
