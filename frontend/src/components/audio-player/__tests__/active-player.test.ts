import { describe, it, expect, vi, beforeEach } from "vitest"
import { setActivePlayer, releaseActivePlayer } from "../active-player"

// Reset the module-level "current" between tests.
beforeEach(() => {
  const dummy = { pause: () => {} }
  setActivePlayer(dummy)
  releaseActivePlayer(dummy)
})

describe("active-player coordination", () => {
  it("pauses the previously-playing player when a new one starts", () => {
    const a = { pause: vi.fn() }
    const b = { pause: vi.fn() }
    setActivePlayer(a)
    expect(a.pause).not.toHaveBeenCalled()
    setActivePlayer(b)
    expect(a.pause).toHaveBeenCalledTimes(1)
    expect(b.pause).not.toHaveBeenCalled()
  })

  it("does not pause itself when re-activated", () => {
    const a = { pause: vi.fn() }
    setActivePlayer(a)
    setActivePlayer(a)
    expect(a.pause).not.toHaveBeenCalled()
  })

  it("release clears the active player so it isn't paused on the next start", () => {
    const a = { pause: vi.fn() }
    const b = { pause: vi.fn() }
    setActivePlayer(a)
    releaseActivePlayer(a)
    setActivePlayer(b)
    expect(a.pause).not.toHaveBeenCalled()
  })
})
