import { describe, expect, it } from "vitest"
import { lipSyncModelSwitchPatch, lipSyncResolutionChoices, lipSyncResolutionRefusal, lipSyncResolutions } from "../lip-sync-resolution.js"
import { drivingAudioLipSyncResolution } from "../driving-audio-lip-sync.js"

/** The Lip Sync node's resolutions after LTX 2.5 Fast (decided 2026-11-23): 1440p is its alone. */
describe("Lip Sync resolutions", () => {
  it("1440p is offered by LTX 2.5 Fast only, and refused for every other model", () => {
    expect(lipSyncResolutionChoices("ltx-2.5-fast")).toEqual({ values: ["720p", "1080p", "1440p"], def: "720p" })
    for (const p of ["seedance-2", "kling-avatar", "infinitalk", "omnihuman-1-5", "latentsync", "omnihuman-2-0"]) {
      expect(lipSyncResolutionRefusal(p, "1440p"), p).toMatch(/Nothing was charged/)
      expect(lipSyncResolutionRefusal(p, "1080p"), p).toBeUndefined()
    }
    expect(lipSyncResolutionRefusal("ltx-2.5-fast", "1440p")).toBeUndefined()
    expect(lipSyncResolutions()).toEqual(["480p", "720p", "1080p", "1440p", "4k"])
  })

  it("a model switch snaps a resolution the new model does not list — never above what was picked", () => {
    expect(lipSyncModelSwitchPatch("seedance-2", { provider: "ltx-2.5-fast", resolution: "1440p" })).toEqual({ resolution: "720p" })
    expect(lipSyncModelSwitchPatch("kling-avatar", { provider: "ltx-2.5-fast", resolution: "1440p" })).toEqual({ resolution: "720p" })
    expect(lipSyncModelSwitchPatch("infinitalk", { provider: "ltx-2.5-fast", resolution: "1080p" })).toEqual({ resolution: "720p" })
    // A model with no resolution choice: cleared.
    expect(lipSyncModelSwitchPatch("latentsync", { provider: "ltx-2.5-fast", resolution: "1440p" })).toEqual({ resolution: undefined })
    // A listed value stays: a Seedance 2.5 node at 1080p is no longer snapped to 720p (decided 2026-11-23).
    expect(lipSyncModelSwitchPatch("seedance-2", { provider: "kling-avatar", resolution: "480p" })).toEqual({})
    expect(lipSyncModelSwitchPatch("seedance-2-5", { provider: "seedance-2-5", resolution: "1080p" })).toEqual({})
    expect(lipSyncModelSwitchPatch("seedance-2-5", { provider: "seedance-2", resolution: "1080p" })).toEqual({})
    expect(lipSyncModelSwitchPatch("seedance-2", { provider: "seedance-2", resolution: "4k" })).toEqual({})
  })

  it("onto LTX 2.5 Fast: an off-list resolution follows its run's rule (1080p, as Generate Video), and a seed set for another model is cleared", () => {
    for (const r of ["480p", "4k"]) {
      expect(lipSyncModelSwitchPatch("ltx-2.5-fast", { provider: "seedance-2", resolution: r })).toEqual({ resolution: drivingAudioLipSyncResolution("ltx-2.5-fast", r) })
      expect(drivingAudioLipSyncResolution("ltx-2.5-fast", r)).toBe("1080p")
    }
    expect(lipSyncModelSwitchPatch("ltx-2.5-fast", { provider: "latentsync", seed: 0, fastMode: true })).toEqual({ seed: undefined, fastMode: undefined })
    // The same model (the panel's fail-safe): its own seed stays.
    expect(lipSyncModelSwitchPatch("ltx-2.5-fast", { provider: "ltx-2.5-fast", seed: 5 })).toEqual({})
  })
})
