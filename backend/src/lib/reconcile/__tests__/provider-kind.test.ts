import { describe, it, expect } from "vitest"
import {
  providerKindForImageModel,
  providerKindForVideoModel,
  providerKindForVideoToVideoModel,
  providerKindForLipSyncModel,
  providerKindForTtsModel,
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

  it("routes ElevenLabs v3 TTS to elevenlabs-sync (direct ElevenLabs API)", () => {
    expect(providerKindForTtsModel("elevenlabs-v3")).toBe("elevenlabs-sync")
  })

  it("routes Suno music to kie-suno", () => {
    expect(providerKindForSuno()).toBe("kie-suno")
  })
})
