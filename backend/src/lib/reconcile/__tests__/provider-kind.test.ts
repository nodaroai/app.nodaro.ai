import { describe, it, expect } from "vitest"
import { STALE_THRESHOLD_MS, KIE_RECOVER_KINDS } from "../types.js"
import {
  providerKindForImageModel,
  providerKindForVideoModel,
  providerKindForVideoToVideoModel,
  providerKindForLipSyncModel,
  providerKindForSuno,
} from "../provider-kind.js"

describe("providerKindFor*", () => {
  it("routes kontext models to kie-kontext (separate /flux/kontext endpoint)", () => {
    expect(providerKindForImageModel("flux-kontext")).toBe("kie-kontext")
    expect(providerKindForImageModel("flux-kontext-max")).toBe("kie-kontext")
  })

  it("routes default image models to kie-standard", () => {
    expect(providerKindForImageModel("nano-banana")).toBe("kie-standard")
    expect(providerKindForImageModel("flux")).toBe("kie-standard")
  })

  it("routes VEO models to kie-veo", () => {
    expect(providerKindForVideoModel("veo3")).toBe("kie-veo")
    expect(providerKindForVideoModel("veo3.1")).toBe("kie-veo")
  })

  it("routes Kling 3.0 to kie-kling3, runway-kie to kie-runway", () => {
    expect(providerKindForVideoModel("kling-3.0")).toBe("kie-kling3")
    expect(providerKindForVideoModel("runway-kie")).toBe("kie-runway")
  })

  it("routes runway-aleph to kie-aleph (its own /aleph/record-info endpoint)", () => {
    // Reconcile blind-spot regression: Aleph used to fall through to
    // `kie-standard`, which polled the wrong endpoint and force-failed every
    // stuck Aleph row after 18 attempts.
    expect(providerKindForVideoToVideoModel("runway-aleph")).toBe("kie-aleph")
  })

  it("routes luma-modify to kie-luma", () => {
    expect(providerKindForVideoToVideoModel("luma-modify")).toBe("kie-luma")
  })

  it("falls back to kie-standard for unknown v2v models", () => {
    expect(providerKindForVideoToVideoModel("wan-v2v")).toBe("kie-standard")
  })

  it("routes lip-sync uniformly to kie-lip-sync", () => {
    expect(providerKindForLipSyncModel("kling-avatar")).toBe("kie-lip-sync")
    expect(providerKindForLipSyncModel("infinitalk")).toBe("kie-lip-sync")
  })

  it("a Kling 4.0 run at 4K or in HDR is kie-long-video, past its ~45-min poll; 720p / 1080p SDR stays kie-standard", () => {
    for (const model of ["kling-4", "kling-4-keyframes"]) {
      expect(providerKindForVideoModel(model, { resolution: "720p" })).toBe("kie-standard")
      expect(providerKindForVideoModel(model, { resolution: "1080p", dynamicRange: "sdr" })).toBe("kie-standard")
      expect(providerKindForVideoModel(model, {})).toBe("kie-standard")
      expect(providerKindForVideoModel(model, { resolution: "4k" })).toBe("kie-long-video")
      expect(providerKindForVideoModel(model, { resolution: "1080p", dynamicRange: "hdr" })).toBe("kie-long-video")
      expect(providerKindForVideoModel(model, { resolution: "4K", dynamicRange: "hdr" })).toBe("kie-long-video")
    }
    // Flash has no 4K or HDR: always the standard kind.
    expect(providerKindForVideoModel("kling-4-flash", { resolution: "4k", dynamicRange: "hdr" })).toBe("kie-standard")
    // Seedance 2.5 at 4K is a long render too (decided 2026-11-25); its other sizes are not.
    expect(providerKindForVideoModel("seedance-2-5", { resolution: "4k" })).toBe("kie-long-video")
    expect(providerKindForVideoModel("seedance-2-5", { resolution: "1080p" })).toBe("kie-standard")
    // The threshold is past the worker's poll (2 × 45 s per output second of a 30 s clip = 45 min).
    expect(STALE_THRESHOLD_MS["kie-long-video"]).toBe(75 * 60 * 1000)
    expect(STALE_THRESHOLD_MS["kie-standard"]).toBe(20 * 60 * 1000)
    expect(KIE_RECOVER_KINDS.has("kie-long-video")).toBe(true)
  })

  it("routes Suno music to kie-suno", () => {
    expect(providerKindForSuno()).toBe("kie-suno")
  })
})
