/** Each dialogue speaker moved onto an ElevenLabs model gets its own voice (decided 2026-11-13). */
import { describe, expect, it, afterEach } from "vitest"
import { distinctMovedVoices, elevenLabsDialogueVoicePool } from "../dialogue-voice-pool.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

describe("distinctMovedVoices", () => {
  it("one pool voice per moved speaker, the same for its every line, never one the script already uses", () => {
    const pool = ["Rachel", "Alice", "George"]
    expect(distinctMovedVoices(["Fola", "Puck", "Fola"], ["", "", ""], pool)).toEqual(["Rachel", "Alice", "Rachel"])
    expect(distinctMovedVoices(["Fola", "Rachel"], ["", "Rachel"], pool)).toEqual(["Alice", "Rachel"])
    // A pool run dry leaves the rest to the worker's default rather than reuse a voice.
    expect(distinctMovedVoices(["A", "B", "C", "D"], ["", "", "", ""], pool)).toEqual(["Rachel", "Alice", "George", ""])
    // A line with no voice at all stays empty.
    expect(distinctMovedVoices([undefined, "Fola"], ["", ""], pool)).toEqual(["", "Rachel"])
  })
})

describe("elevenLabsDialogueVoicePool", () => {
  it("the deployment's default first, then the premade voices in order, no repeat", () => {
    const pool = elevenLabsDialogueVoicePool()
    expect(pool[0]).toBe("Rachel")
    expect(new Set(pool).size).toBe(pool.length)
  })

  it("under a voice lock: only voices of an allowed gender, the lock's default first", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
    __resetSurfaceProfileCacheForTests()
    const pool = elevenLabsDialogueVoicePool()
    expect(pool.length).toBeGreaterThan(1)
    expect(pool).not.toContain("Rachel")
  })
})
