import { describe, it, expect } from "vitest"
import { buildAudioFxArgs } from "../audio-fx.js"

describe("buildAudioFxArgs", () => {
  it("reverb preset (room) synthesizes an inline IR and convolves via afir", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "room" })
    expect(args[0]).toBe("-filter_complex")
    const fc = args[1]
    expect(fc).toContain("anoisesrc")
    expect(fc).toContain("afir")
    expect(args).toContain("-map")
    expect(args).toContain("[out]")
  })

  it("mix maps to the afir wet gain (0–1)", () => {
    const fc = buildAudioFxArgs({ audioUrl: "x", preset: "hall", mix: 50 })[1]
    expect(fc).toContain("wet=0.500")
  })

  it("church (cathedral scenario) uses a long IR (3.0s decay)", () => {
    const fc = buildAudioFxArgs({ audioUrl: "x", preset: "church" })[1]
    expect(fc).toContain("d=3")
  })

  it("telephone band-limits via -af (no filter_complex)", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "telephone" })
    expect(args[0]).toBe("-af")
    expect(args[1]).toContain("highpass=f=300")
    expect(args[1]).toContain("lowpass=f=3400")
  })

  it("echo uses aecho with the supplied delay/decay", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "echo", delayMs: 300, decay: 0.5 })
    expect(args[0]).toBe("-af")
    expect(args[1]).toContain("aecho=0.8:0.88:300:0.5")
  })

  it("custom applies only the set knobs (EQ + delay)", () => {
    const args = buildAudioFxArgs({ audioUrl: "x", preset: "custom", eqLow: 3, eqHigh: -2, delayMs: 200 })
    const chain = args[1]
    expect(chain).toContain("bass=g=3")
    expect(chain).toContain("treble=g=-2")
    expect(chain).toContain("aecho")
  })

  it("custom with no knobs is a no-op (anull)", () => {
    expect(buildAudioFxArgs({ audioUrl: "x", preset: "custom" })[1]).toBe("anull")
  })
})
