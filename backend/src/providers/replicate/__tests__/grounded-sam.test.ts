import { describe, it, expect, vi } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — grounded-sam.ts imports extractUrl from client.ts, which creates a
// Replicate singleton at import time that reads config.REPLICATE_API_TOKEN.
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: { REPLICATE_API_TOKEN: "test-token", NODE_ENV: "test" },
}))

vi.mock("replicate", () => ({
  default: class MockReplicate {
    constructor() {}
  },
}))

import {
  GROUNDED_SAM_MODEL,
  GROUNDED_SAM_VERSION,
  pickMaskFromOutput,
} from "../grounded-sam.js"

describe("grounded-sam pinning", () => {
  it("uses a pinned version (not a floating owner/name)", () => {
    expect(GROUNDED_SAM_VERSION).toMatch(/^[0-9a-f]{40,}$/)
    expect(GROUNDED_SAM_MODEL).toContain("/")
  })

  it("picks the mask URL from the model's output shape", () => {
    // Real shape (confirmed against the live model 2026-06-09): the model emits
    // FOUR images and the white-on-black subject mask is named `mask.<ext>`,
    // NOT the last element (the last element is the INVERTED mask). We must pick
    // `mask.jpg` and reject `inverted_mask.jpg`.
    const realOutput = [
      "https://replicate.delivery/x/annotated_picture_mask.jpg",
      "https://replicate.delivery/x/neg_annotated_picture_mask.jpg",
      "https://replicate.delivery/x/mask.jpg",
      "https://replicate.delivery/x/inverted_mask.jpg",
    ]
    expect(pickMaskFromOutput(realOutput)).toBe(
      "https://replicate.delivery/x/mask.jpg",
    )

    // The element literally named `mask.*` wins even when it is not last.
    expect(pickMaskFromOutput(["viz.png", "mask.png"])).toBe("mask.png")
    // A single URL passes through.
    expect(pickMaskFromOutput("mask.png")).toBe("mask.png")
    // Empty / missing output is a hard error.
    expect(() => pickMaskFromOutput([])).toThrow()
    expect(() => pickMaskFromOutput(null)).toThrow()
  })
})
