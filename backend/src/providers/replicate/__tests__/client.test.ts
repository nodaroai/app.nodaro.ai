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
})
