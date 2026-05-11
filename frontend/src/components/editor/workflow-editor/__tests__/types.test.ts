import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/api", () => ({
  StorageExceededError: class StorageExceededError extends Error {
    usedBytes: number
    quotaBytes: number
    remainingBytes: number
    tier: string
    constructor(
      msg: string,
      used: number,
      quota: number,
      remaining: number,
      tier: string,
    ) {
      super(msg)
      this.name = "StorageExceededError"
      this.usedBytes = used
      this.quotaBytes = quota
      this.remainingBytes = remaining
      this.tier = tier
    }
  },
}))

import {
  isExecutableNode,
  NODE_CREDIT_COSTS,
  EXECUTABLE_TYPES,
  MAX_CONSECUTIVE_POLL_FAILURES,
} from "../types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(type: string | undefined): any {
  return {
    id: "test-node",
    type,
    data: { label: type ?? "unknown" },
    position: { x: 0, y: 0 },
  }
}

// ---------------------------------------------------------------------------
// isExecutableNode
// ---------------------------------------------------------------------------

describe("isExecutableNode", () => {
  it("returns true for a known executable type (generate-image)", () => {
    expect(isExecutableNode(makeNode("generate-image"))).toBe(true)
  })

  it("returns true for another executable type (combine-videos)", () => {
    expect(isExecutableNode(makeNode("combine-videos"))).toBe(true)
  })

  it("returns true for scene type", () => {
    expect(isExecutableNode(makeNode("scene"))).toBe(true)
  })

  it("returns false for a non-executable type (text-prompt)", () => {
    expect(isExecutableNode(makeNode("text-prompt"))).toBe(false)
  })

  it("returns false for another non-executable type (upload-image)", () => {
    expect(isExecutableNode(makeNode("upload-image"))).toBe(false)
  })

  it("returns false for an unknown type", () => {
    expect(isExecutableNode(makeNode("totally-made-up"))).toBe(false)
  })

  it("returns false when type is undefined", () => {
    expect(isExecutableNode(makeNode(undefined))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// NODE_CREDIT_COSTS
// ---------------------------------------------------------------------------

describe("NODE_CREDIT_COSTS", () => {
  it("has generate-image at 2 credits", () => {
    expect(NODE_CREDIT_COSTS["generate-image"]).toBe(2)
  })

  it("has generate-script at 10 credits", () => {
    expect(NODE_CREDIT_COSTS["generate-script"]).toBe(10)
  })

  it("has trim-video at 1 credit", () => {
    expect(NODE_CREDIT_COSTS["trim-video"]).toBe(1)
  })

  it("has 3d-title at 15 credits", () => {
    expect(NODE_CREDIT_COSTS["3d-title"]).toBe(15)
  })

  it("has motion-graphics at 10 credits", () => {
    expect(NODE_CREDIT_COSTS["motion-graphics"]).toBe(10)
  })

  it("has composite at 0 credits", () => {
    expect(NODE_CREDIT_COSTS["composite"]).toBe(0)
  })

  it("has image-to-video at 25 credits", () => {
    expect(NODE_CREDIT_COSTS["image-to-video"]).toBe(25)
  })

  it("has lip-sync at 13 credits", () => {
    expect(NODE_CREDIT_COSTS["lip-sync"]).toBe(13)
  })

  it("has render-video at 15 credits", () => {
    expect(NODE_CREDIT_COSTS["render-video"]).toBe(15)
  })

  it("returns undefined for a non-existent node type", () => {
    expect(NODE_CREDIT_COSTS["non-existent"]).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// EXECUTABLE_TYPES
// ---------------------------------------------------------------------------

describe("EXECUTABLE_TYPES", () => {
  it("contains generate-image", () => {
    expect(EXECUTABLE_TYPES.has("generate-image")).toBe(true)
  })

  it("contains combine-videos", () => {
    expect(EXECUTABLE_TYPES.has("combine-videos")).toBe(true)
  })

  it("contains ai-writer", () => {
    expect(EXECUTABLE_TYPES.has("ai-writer")).toBe(true)
  })

  it("contains scene", () => {
    expect(EXECUTABLE_TYPES.has("scene")).toBe(true)
  })

  it("contains character", () => {
    expect(EXECUTABLE_TYPES.has("character")).toBe(true)
  })

  it("contains trim-video", () => {
    expect(EXECUTABLE_TYPES.has("trim-video")).toBe(true)
  })

  it("contains render-video", () => {
    expect(EXECUTABLE_TYPES.has("render-video")).toBe(true)
  })

  it("does NOT contain text-prompt", () => {
    expect(EXECUTABLE_TYPES.has("text-prompt")).toBe(false)
  })

  it("does NOT contain upload-image", () => {
    expect(EXECUTABLE_TYPES.has("upload-image")).toBe(false)
  })

  it("does NOT contain upload-video", () => {
    expect(EXECUTABLE_TYPES.has("upload-video")).toBe(false)
  })

  it("does NOT contain upload-audio", () => {
    expect(EXECUTABLE_TYPES.has("upload-audio")).toBe(false)
  })

  it("does NOT contain list", () => {
    expect(EXECUTABLE_TYPES.has("list")).toBe(false)
  })

  it("does NOT contain loop", () => {
    expect(EXECUTABLE_TYPES.has("loop")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// New nodes: EXECUTABLE_TYPES membership
// ---------------------------------------------------------------------------

describe("EXECUTABLE_TYPES — new nodes", () => {
  it("contains suno-mashup", () => {
    expect(EXECUTABLE_TYPES.has("suno-mashup")).toBe(true)
  })

  it("contains suno-replace-section", () => {
    expect(EXECUTABLE_TYPES.has("suno-replace-section")).toBe(true)
  })

  it("contains suno-style-boost", () => {
    expect(EXECUTABLE_TYPES.has("suno-style-boost")).toBe(true)
  })

  it("contains suno-add-instrumental", () => {
    expect(EXECUTABLE_TYPES.has("suno-add-instrumental")).toBe(true)
  })

  it("contains suno-add-vocals", () => {
    expect(EXECUTABLE_TYPES.has("suno-add-vocals")).toBe(true)
  })

  it("contains suno-convert-wav", () => {
    expect(EXECUTABLE_TYPES.has("suno-convert-wav")).toBe(true)
  })

  it("contains suno-upload-extend", () => {
    expect(EXECUTABLE_TYPES.has("suno-upload-extend")).toBe(true)
  })

  it("contains speech-to-video", () => {
    expect(EXECUTABLE_TYPES.has("speech-to-video")).toBe(true)
  })

  it("contains edit-image", () => {
    expect(EXECUTABLE_TYPES.has("edit-image")).toBe(true)
  })

  it("contains image-to-image", () => {
    expect(EXECUTABLE_TYPES.has("image-to-image")).toBe(true)
  })

  it("contains generate-mask", () => {
    expect(EXECUTABLE_TYPES.has("generate-mask")).toBe(true)
  })

})

// ---------------------------------------------------------------------------
// New nodes: NODE_CREDIT_COSTS values
// ---------------------------------------------------------------------------

describe("NODE_CREDIT_COSTS — new nodes", () => {
  it("has suno-mashup at 4 credits", () => {
    expect(NODE_CREDIT_COSTS["suno-mashup"]).toBe(4)
  })

  it("has suno-replace-section at 2 credits", () => {
    expect(NODE_CREDIT_COSTS["suno-replace-section"]).toBe(2)
  })

  it("has suno-style-boost at 1 credit", () => {
    expect(NODE_CREDIT_COSTS["suno-style-boost"]).toBe(1)
  })

  it("has suno-add-instrumental at 4 credits", () => {
    expect(NODE_CREDIT_COSTS["suno-add-instrumental"]).toBe(4)
  })

  it("has suno-add-vocals at 4 credits", () => {
    expect(NODE_CREDIT_COSTS["suno-add-vocals"]).toBe(4)
  })

  it("has suno-convert-wav at 1 credit", () => {
    expect(NODE_CREDIT_COSTS["suno-convert-wav"]).toBe(1)
  })

  it("has suno-upload-extend at 4 credits", () => {
    expect(NODE_CREDIT_COSTS["suno-upload-extend"]).toBe(4)
  })

  it("has speech-to-video at 4 credits", () => {
    expect(NODE_CREDIT_COSTS["speech-to-video"]).toBe(4)
  })

})

// ---------------------------------------------------------------------------
// MAX_CONSECUTIVE_POLL_FAILURES
// ---------------------------------------------------------------------------

describe("MAX_CONSECUTIVE_POLL_FAILURES", () => {
  it("equals 20", () => {
    expect(MAX_CONSECUTIVE_POLL_FAILURES).toBe(20)
  })
})
