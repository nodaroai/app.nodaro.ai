import { describe, it, expect } from "vitest"
import {
  IMAGE_GEN_MODELS,
  IMAGE_I2I_MODELS,
  VIDEO_I2V_MODELS,
  VIDEO_T2V_MODELS,
  KLING3_DURATIONS,
  KIE_VIDEO_DURATIONS,
  KIE_T2V_DURATIONS,
  PROVIDERS_WITH_END_FRAME,
} from "../model-options"

describe("IMAGE_GEN_MODELS", () => {
  it("has at least 3 models", () => {
    expect(IMAGE_GEN_MODELS.length).toBeGreaterThanOrEqual(3)
  })

  it("every model has value, label, desc", () => {
    for (const m of IMAGE_GEN_MODELS) {
      expect(m.value).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.desc).toBeTruthy()
    }
  })

  it("has no duplicate values", () => {
    const values = IMAGE_GEN_MODELS.map((m) => m.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe("IMAGE_I2I_MODELS", () => {
  it("has at least 3 models", () => {
    expect(IMAGE_I2I_MODELS.length).toBeGreaterThanOrEqual(3)
  })

  it("every model has value, label, desc", () => {
    for (const m of IMAGE_I2I_MODELS) {
      expect(m.value).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.desc).toBeTruthy()
    }
  })

  it("has no duplicate values", () => {
    const values = IMAGE_I2I_MODELS.map((m) => m.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe("VIDEO_I2V_MODELS", () => {
  it("has at least 5 models", () => {
    expect(VIDEO_I2V_MODELS.length).toBeGreaterThanOrEqual(5)
  })

  it("every model has value, label, desc", () => {
    for (const m of VIDEO_I2V_MODELS) {
      expect(m.value).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.desc).toBeTruthy()
    }
  })

  it("has no duplicate values", () => {
    const values = VIDEO_I2V_MODELS.map((m) => m.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe("VIDEO_T2V_MODELS", () => {
  it("has at least 5 models", () => {
    expect(VIDEO_T2V_MODELS.length).toBeGreaterThanOrEqual(5)
  })

  it("every model has value, label, desc", () => {
    for (const m of VIDEO_T2V_MODELS) {
      expect(m.value).toBeTruthy()
      expect(m.label).toBeTruthy()
      expect(m.desc).toBeTruthy()
    }
  })

  it("has no duplicate values", () => {
    const values = VIDEO_T2V_MODELS.map((m) => m.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe("KLING3_DURATIONS", () => {
  it("contains integers from 3 to 15", () => {
    expect(KLING3_DURATIONS).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it("has 13 entries", () => {
    expect(KLING3_DURATIONS).toHaveLength(13)
  })
})

describe("KIE_VIDEO_DURATIONS", () => {
  it("minimax supports only 5s", () => {
    expect(KIE_VIDEO_DURATIONS["minimax"]).toEqual([5])
  })

  it("veo3 supports 4/6/8s", () => {
    expect(KIE_VIDEO_DURATIONS["veo3"]).toEqual([4, 6, 8])
  })

  it("kling supports 5 and 10s", () => {
    expect(KIE_VIDEO_DURATIONS["kling"]).toEqual([5, 10])
  })

  it("kling-3.0 uses KLING3_DURATIONS (3-15)", () => {
    expect(KIE_VIDEO_DURATIONS["kling-3.0"]).toEqual([...KLING3_DURATIONS])
  })

  it("every provider has at least one duration", () => {
    for (const [, durations] of Object.entries(KIE_VIDEO_DURATIONS)) {
      expect(durations.length).toBeGreaterThan(0)
    }
  })
})

describe("KIE_T2V_DURATIONS", () => {
  it("has entries for text-to-video providers", () => {
    expect(Object.keys(KIE_T2V_DURATIONS).length).toBeGreaterThan(0)
  })

  it("kling-3.0 uses KLING3_DURATIONS", () => {
    expect(KIE_T2V_DURATIONS["kling-3.0"]).toEqual([...KLING3_DURATIONS])
  })

  it("every provider has at least one duration", () => {
    for (const [, durations] of Object.entries(KIE_T2V_DURATIONS)) {
      expect(durations.length).toBeGreaterThan(0)
    }
  })
})

describe("PROVIDERS_WITH_END_FRAME", () => {
  it("is a non-empty array", () => {
    expect(PROVIDERS_WITH_END_FRAME.length).toBeGreaterThan(0)
  })

  it("includes minimax and kling-3.0", () => {
    expect(PROVIDERS_WITH_END_FRAME).toContain("minimax")
    expect(PROVIDERS_WITH_END_FRAME).toContain("kling-3.0")
  })

  it("has no duplicates", () => {
    expect(new Set(PROVIDERS_WITH_END_FRAME).size).toBe(PROVIDERS_WITH_END_FRAME.length)
  })
})
