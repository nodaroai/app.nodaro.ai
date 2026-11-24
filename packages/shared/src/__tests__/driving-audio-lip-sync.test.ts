import { describe, expect, it } from "vitest"
import { drivingAudioLipSyncResolution, isDrivingAudioLipSyncProvider } from "../driving-audio-lip-sync.js"
import { drivingAudioRun } from "../driving-audio.js"
import { LIP_SYNC_PROVIDERS } from "../model-constants.js"
import { lipSyncTakesLever } from "../lip-sync-levers.js"

/** LTX 2.5 Fast on Lip Sync (decided 2026-11-23): Generate Video's audio-to-video rule, the node's resolutions. */
describe("LTX 2.5 Fast on Lip Sync", () => {
  it("is the only Lip Sync model that runs audio-to-video", () => {
    expect((LIP_SYNC_PROVIDERS as readonly string[]).filter(isDrivingAudioLipSyncProvider)).toEqual(["ltx-2.5-fast"])
    expect(isDrivingAudioLipSyncProvider("ltx-2.5-pro")).toBe(false)
  })

  it("its resolution: the node's 720p by default, its own three tiers as asked, 1080p for any other", () => {
    expect(drivingAudioLipSyncResolution("ltx-2.5-fast")).toBe("720p")
    for (const r of ["720p", "1080p", "1440p"]) expect(drivingAudioLipSyncResolution("ltx-2.5-fast", r)).toBe(r)
    expect(drivingAudioLipSyncResolution("ltx-2.5-fast", "480p")).toBe("1080p")
    expect(drivingAudioLipSyncResolution("ltx-2.5-fast", "4k")).toBe("1080p")
  })

  it("is priced by Generate Video's rows: the same id at every whole second", () => {
    for (let s = 3; s <= 20; s++) {
      const run = drivingAudioRun({ provider: "ltx-2.5-fast", resolution: drivingAudioLipSyncResolution("ltx-2.5-fast"), audioSec: s - 0.5 })
      expect(run).toMatchObject({ ok: true, creditId: `ltx-2.5-fast:${s}s:720p` })
    }
  })

  it("takes a resolution and a seed, not fast mode", () => {
    expect(lipSyncTakesLever("ltx-2.5-fast", "resolution")).toBe(true)
    expect(lipSyncTakesLever("ltx-2.5-fast", "seed")).toBe(true)
    expect(lipSyncTakesLever("ltx-2.5-fast", "fastMode")).toBe(false)
  })
})
