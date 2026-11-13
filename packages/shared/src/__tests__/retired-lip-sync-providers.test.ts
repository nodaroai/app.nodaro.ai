import { describe, it, expect } from "vitest"
import {
  LIP_SYNC_PROVIDERS,
  REPLICATE_LIP_SYNC_PROVIDERS,
  VIDEO_INPUT_LIP_SYNC_PROVIDERS,
  FLEXIBLE_INPUT_LIP_SYNC_PROVIDERS,
  RETIRED_LIP_SYNC_PROVIDERS,
  retiredLipSyncProviderName,
  retiredLipSyncProviderMessage,
} from "../entries/models.js"
import { MODEL_CATALOG } from "../entries/model-catalog.js"

/** Wav2Lip, VideoReTalking and SadTalker are retired from Lip Sync (decided 2026-11-12). */
describe("the Lip Sync models retired from Lip Sync", () => {
  const RETIRED = ["wav2lip", "video-retalking", "sadtalker"]

  it("are exactly the three, each with the name it is shown by", () => {
    expect(RETIRED_LIP_SYNC_PROVIDERS).toEqual({ wav2lip: "Wav2Lip", "video-retalking": "VideoReTalking", sadtalker: "SadTalker" })
  })

  it("are offered nowhere: not a Lip Sync option, not a Replicate lip-sync option, not a catalog model", () => {
    for (const id of RETIRED) {
      expect(LIP_SYNC_PROVIDERS as readonly string[], id).not.toContain(id)
      expect(REPLICATE_LIP_SYNC_PROVIDERS.has(id as never), id).toBe(false)
      expect(MODEL_CATALOG[id], id).toBeUndefined()
    }
  })

  it("keep their input kind, so a saved node on one keeps the inputs its connections attach to", () => {
    expect(VIDEO_INPUT_LIP_SYNC_PROVIDERS.has("video-retalking" as never)).toBe(true)
    expect(FLEXIBLE_INPUT_LIP_SYNC_PROVIDERS.has("wav2lip" as never)).toBe(true)
  })

  it("answer one sentence each, and nothing else does (own keys only)", () => {
    expect(retiredLipSyncProviderMessage("wav2lip")).toBe("Wav2Lip is no longer available for Lip Sync. Pick another Lip Sync model.")
    expect(retiredLipSyncProviderMessage("video-retalking")).toBe("VideoReTalking is no longer available for Lip Sync. Pick another Lip Sync model.")
    expect(retiredLipSyncProviderMessage("sadtalker")).toBe("SadTalker is no longer available for Lip Sync. Pick another Lip Sync model.")
    for (const value of [undefined, null, 42, "", "latentsync", "kling-avatar", "constructor", "toString", "__proto__"]) {
      expect(retiredLipSyncProviderName(value), String(value)).toBeUndefined()
      expect(retiredLipSyncProviderMessage(value), String(value)).toBeUndefined()
    }
  })
})
