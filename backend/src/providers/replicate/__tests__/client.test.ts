import { describe, it, expect, vi } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — required because client.ts creates a Replicate singleton at import
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: { REPLICATE_API_TOKEN: "test-token", NODE_ENV: "test" },
}))

vi.mock("replicate", () => ({
  default: class MockReplicate {
    constructor() {}
  },
}))

import { extractUrl, extractCost } from "../client.js"

// ---------------------------------------------------------------------------
// extractUrl
// ---------------------------------------------------------------------------

describe("extractUrl", () => {
  it("returns string input directly", () => {
    const url = "https://example.com/image.png"

    expect(extractUrl(url)).toBe(url)
  })

  it("calls .url() method when input is an object with a url function", () => {
    const obj = { url: () => "https://example.com/from-method" }

    expect(extractUrl(obj)).toBe("https://example.com/from-method")
  })

  it("returns .url property when it is a string", () => {
    const obj = { url: "https://example.com/from-property" }

    expect(extractUrl(obj)).toBe("https://example.com/from-property")
  })

  it("returns .href property when present", () => {
    const obj = { href: "https://example.com/from-href" }

    expect(extractUrl(obj)).toBe("https://example.com/from-href")
  })

  it("throws for objects that do not resolve to a URL", () => {
    const obj = { foo: "bar" }

    expect(() => extractUrl(obj)).toThrow("Unexpected Replicate output object")
  })
})

// ---------------------------------------------------------------------------
// extractCost
// ---------------------------------------------------------------------------

describe("extractCost", () => {
  it("computes cost from predict_time and returns null for missing or zero metrics", () => {
    // Valid predict_time
    expect(extractCost({ predict_time: 10 })).toBeCloseTo(0.00225)
    expect(extractCost({ predict_time: 1 })).toBeCloseTo(0.000225)

    // Undefined metrics
    expect(extractCost(undefined)).toBeNull()

    // Missing predict_time key
    expect(extractCost({})).toBeNull()

    // Zero predict_time
    expect(extractCost({ predict_time: 0 })).toBeNull()
  })

  it("uses the per-model GPU rate, not a hard-coded T4 rate", () => {
    // Regression: extractCost hard-coded the T4 rate ($0.000225/s) for EVERY
    // model, under-charging the metered true-up on L40S/A100/H100 by 4–7×.
    const t = 10
    // L40S models (latentsync/wav2lip/incredibly-fast-whisper) → $0.000975/s
    expect(extractCost({ predict_time: t }, "latentsync")).toBeCloseTo(t * 0.000975)
    expect(extractCost({ predict_time: t }, "wav2lip")).toBeCloseTo(t * 0.000975)
    expect(extractCost({ predict_time: t }, "incredibly-fast-whisper")).toBeCloseTo(t * 0.000975)
    // A100 models (sadtalker/video-retalking) → $0.0014/s
    expect(extractCost({ predict_time: t }, "sadtalker")).toBeCloseTo(t * 0.0014)
    expect(extractCost({ predict_time: t }, "video-retalking")).toBeCloseTo(t * 0.0014)
    // T4 models + unknown keys + no key → T4 fallback ($0.000225/s)
    expect(extractCost({ predict_time: t }, "whisper")).toBeCloseTo(t * 0.000225)
    expect(extractCost({ predict_time: t }, "some-unmapped-model")).toBeCloseTo(t * 0.000225)
    expect(extractCost({ predict_time: t })).toBeCloseTo(t * 0.000225)
  })
})
