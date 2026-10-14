import { describe, it, expect } from "vitest"
import { duckedGraph } from "../mix-audio.js"
import { resolveDuck } from "../../../lib/mix-audio-duck.js"

const vols = (n: number) => Array.from({ length: n }, (_, i) => `[${i}:a]volume=1[a${i}]`)

describe("duckedGraph endAt", () => {
  it("default (longest) is byte-identical to the graph before endAt existed", () => {
    const g = duckedGraph(2, vols(2), resolveDuck({ under: 0 }))
    expect(g.endsWith("[k0][d1]amix=inputs=2:duration=longest:normalize=0,alimiter=level=disabled:limit=0.95[aout]")).toBe(true)
    expect(duckedGraph(2, vols(2), resolveDuck({ under: 0 }), "longest")).toBe(g)
  })

  it("voice: the key track mixes first and the mix ends with it", () => {
    const g = duckedGraph(2, vols(2), resolveDuck({ under: 1 }), "voice")
    expect(g.endsWith("[k1][d0]amix=inputs=2:duration=first:normalize=0,alimiter=level=disabled:limit=0.95[aout]")).toBe(true)
  })

  it("voice with three tracks keeps the others in their order after the key", () => {
    const g = duckedGraph(3, vols(3), resolveDuck({ under: 2 }), "voice")
    expect(g).toContain("[k2][d0][d1]amix=inputs=3:duration=first")
  })
})
