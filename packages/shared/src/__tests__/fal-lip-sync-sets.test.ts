import { describe, it, expect } from "vitest"
import {
  LIP_SYNC_PROVIDERS,
  VIDEO_INPUT_LIP_SYNC_PROVIDERS,
  FAL_LIP_SYNC_PROVIDERS,
  REPLICATE_LIP_SYNC_PROVIDERS,
} from "../model-constants.js"

describe("sync-lipsync-v3 provider-set membership", () => {
  it("is listed in LIP_SYNC_PROVIDERS (widens the lip-sync route Zod enum)", () => {
    expect(LIP_SYNC_PROVIDERS).toContain("sync-lipsync-v3")
  })

  it("is in FAL_LIP_SYNC_PROVIDERS", () => {
    expect(FAL_LIP_SYNC_PROVIDERS.has("sync-lipsync-v3")).toBe(true)
  })

  it("is in VIDEO_INPUT_LIP_SYNC_PROVIDERS (video-driven dubbing)", () => {
    expect(VIDEO_INPUT_LIP_SYNC_PROVIDERS.has("sync-lipsync-v3")).toBe(true)
  })

  it("is NOT in REPLICATE_LIP_SYNC_PROVIDERS (it's a fal model, not Replicate)", () => {
    expect(REPLICATE_LIP_SYNC_PROVIDERS.has("sync-lipsync-v3" as never)).toBe(false)
  })

  it("FAL and REPLICATE lip-sync sets are disjoint", () => {
    for (const p of FAL_LIP_SYNC_PROVIDERS) {
      expect(REPLICATE_LIP_SYNC_PROVIDERS.has(p as never)).toBe(false)
    }
  })
})
