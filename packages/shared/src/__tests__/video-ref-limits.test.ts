import { describe, expect, it } from "vitest"
import {
  SEEDANCE_2_REF_LIMITS,
  VIDEO_REF_LIMITS_BY_PROVIDER,
} from "../model-constants.js"

describe("VIDEO_REF_LIMITS_BY_PROVIDER", () => {
  it("seedance-2 providers get the SEEDANCE_2_REF_LIMITS shape", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["seedance-2"]).toEqual({
      images: SEEDANCE_2_REF_LIMITS.images,
      videos: SEEDANCE_2_REF_LIMITS.videos,
      audio: SEEDANCE_2_REF_LIMITS.audio,
    })
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["seedance-2-fast"]).toEqual({
      images: SEEDANCE_2_REF_LIMITS.images,
      videos: SEEDANCE_2_REF_LIMITS.videos,
      audio: SEEDANCE_2_REF_LIMITS.audio,
    })
  })
  it("non-seedance providers either have just an images cap or are absent", () => {
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["wan-i2v"]?.images).toBeGreaterThanOrEqual(1)
    expect(VIDEO_REF_LIMITS_BY_PROVIDER["kling-turbo"]).toBeUndefined()
  })
})
