import { describe, it, expect } from "vitest"
import { NODE_DEFINITIONS } from "../nodes"

describe("voice-changer-pro node definition", () => {
  it("is registered with audio+video inputs and outputs", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "voice-changer-pro")
    expect(def).toBeDefined()
    expect(def?.inputs).toEqual(["audio", "video"])
    expect(def?.outputs).toEqual(["audio", "video"])
    expect(def?.category).toBe("ai")
  })

  it("defaults to an empty ordered-voice list and preserveBackground on", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "voice-changer-pro")!
    const d = def.defaultData as { orderedVoices: unknown[]; preserveBackground: boolean; removeBackgroundNoise: boolean }
    expect(d.orderedVoices).toEqual([])
    expect(d.preserveBackground).toBe(true)
    expect(d.removeBackgroundNoise).toBe(false)
  })
})
