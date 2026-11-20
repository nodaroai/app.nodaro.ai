import { describe, expect, it } from "vitest"
import {
  FREE_VIDEO_LIMITS_DEFAULTS,
  freeVideoDurationLock,
  freeVideoLock,
  freeVideoModelLock,
  freeVideoResolutionLock,
  type FreeVideoLimits,
} from "../entries/free-video-limits.js"

/**
 * The published free-credit video limits rule, as an app on the SDK locks its
 * pickers with it: the server refuses with the same functions (backend
 * `ee/billing/free-video-limits.ts`, whose suite covers the rule in depth), so
 * what is pinned here is the entry's contract — the option an app shows.
 */

const ON: FreeVideoLimits = { enabled: true, maxSeconds: 4 }

describe("@nodaro/shared/free-video-limits", () => {
  it("the defaults are on, at 4 seconds", () => {
    expect(FREE_VIDEO_LIMITS_DEFAULTS).toEqual(ON)
  })

  it("an 8-second Seedance 2 Fast clip is locked by its length, a 4-second one at its lowest resolution runs", () => {
    expect(freeVideoDurationLock("seedance-2-fast", 8, ON)).toEqual({ kind: "duration", label: "Seedance 2 Fast", max: 4 })
    expect(freeVideoModelLock("seedance-2-fast", ON)).toBeNull()
    expect(freeVideoDurationLock("seedance-2-fast", 4, ON)).toBeNull()
    expect(freeVideoResolutionLock("seedance-2-fast", "480p", ON)).toBeNull()
    expect(freeVideoResolutionLock("seedance-2-fast", "720p", ON)).toEqual({ kind: "resolution", label: "Seedance 2 Fast", lowest: "480p" })
  })

  it("Kling 4.0 and Seedance 2.5 are locked as models; their Flash tiers are open", () => {
    expect(freeVideoModelLock("kling-4", ON)).toEqual({ kind: "model", label: "Kling 4.0" })
    expect(freeVideoModelLock("seedance-2-5", ON)).toEqual({ kind: "model", label: "Seedance 2.5" })
    expect(freeVideoModelLock("kling-4-flash", ON)).toBeNull()
    expect(freeVideoModelLock("seedance-2-5-flash", ON)).toBeNull()
  })

  it("the length limit follows the limits the server states", () => {
    expect(freeVideoDurationLock("seedance-2-fast", 8, { enabled: true, maxSeconds: 8 })).toBeNull()
  })

  it("limits that are off lock nothing", () => {
    const off: FreeVideoLimits = { enabled: false, maxSeconds: 4 }
    expect(freeVideoModelLock("kling-4", off)).toBeNull()
    expect(freeVideoLock({ provider: "seedance-2-5", duration: 15, resolution: "1080p" }, off)).toBeNull()
  })

  it("a whole request is judged model first, then length, then resolution", () => {
    expect(freeVideoLock({ provider: "kling-4", duration: 15, resolution: "1080p" }, ON)?.kind).toBe("model")
    expect(freeVideoLock({ provider: "seedance-2-fast", duration: 8, resolution: "720p" }, ON)?.kind).toBe("duration")
    expect(freeVideoLock({ provider: "seedance-2-fast", duration: 4, resolution: "720p" }, ON)?.kind).toBe("resolution")
    expect(freeVideoLock({ provider: "seedance-2-fast", duration: 4, resolution: "480p" }, ON)).toBeNull()
  })

  it("a resolution left out of a request on a model with several is locked: the model would render its own default", () => {
    expect(freeVideoResolutionLock("seedance-2-fast", undefined, ON)).toEqual({ kind: "resolution", label: "Seedance 2 Fast", lowest: "480p" })
  })

  it("an image or audio model is not this rule's business", () => {
    expect(freeVideoLock({ provider: "nano-banana", duration: 30, resolution: "4K" }, ON)).toBeNull()
  })
})
