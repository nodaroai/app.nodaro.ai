import {
  calculateProgress,
  CATEGORY_DURATION_DEFAULTS,
  buildProgressSegments,
  calculateCombinedProgress,
} from "../progress-curve.js"

import {
  calculateMonetizationMarkup,
  calculateMonetizedCost,
} from "../monetization.js"

import {
  REPEATABLE_NODE_TYPES,
  REPEAT_PLACEHOLDER,
  getEffectiveRepeatCount,
  expandItemsWithRepeat,
} from "../repeat-types.js"

// ---------------------------------------------------------------------------
// calculateProgress
// ---------------------------------------------------------------------------
describe("calculateProgress", () => {
  it("returns 0 when no time has elapsed", () => {
    expect(calculateProgress(0, 10_000)).toBe(0)
  })

  it("returns 99 when elapsed equals estimated", () => {
    expect(calculateProgress(10_000, 10_000)).toBe(99)
  })

  it("returns 74 at half elapsed with default exponent=2", () => {
    // 99 * (1 - (1 - 0.5)^2) = 99 * 0.75 = 74.25 → 74
    expect(calculateProgress(5_000, 10_000)).toBe(74)
  })

  it("returns 0 when estimatedMs is 0", () => {
    expect(calculateProgress(5_000, 0)).toBe(0)
  })

  it("returns 0 when estimatedMs is negative", () => {
    expect(calculateProgress(5_000, -1_000)).toBe(0)
  })

  it("clamps to 99 when elapsed exceeds estimated", () => {
    expect(calculateProgress(20_000, 10_000)).toBe(99)
  })

  it("uses custom exponent=1 for linear progress", () => {
    // 99 * (1 - (1 - 0.5)^1) = 99 * 0.5 = 49.5 → 50
    expect(calculateProgress(5_000, 10_000, 1)).toBe(50)
  })

  it("returns 0 for negative elapsed (clamped to 0)", () => {
    expect(calculateProgress(-1_000, 10_000)).toBe(0)
  })

  it("uses higher exponent for steeper curve", () => {
    // exponent=3 at t=0.5: 99 * (1 - (0.5)^3) = 99 * 0.875 = 86.625 → 87
    expect(calculateProgress(5_000, 10_000, 3)).toBe(87)
  })
})

// ---------------------------------------------------------------------------
// CATEGORY_DURATION_DEFAULTS
// ---------------------------------------------------------------------------
describe("CATEGORY_DURATION_DEFAULTS", () => {
  it("contains all expected category keys", () => {
    const expectedKeys = ["image", "video", "audio-tts", "music", "llm", "upscale", "inline"]
    for (const key of expectedKeys) {
      expect(CATEGORY_DURATION_DEFAULTS).toHaveProperty(key)
    }
  })

  it("has positive durations for all categories", () => {
    for (const [key, value] of Object.entries(CATEGORY_DURATION_DEFAULTS)) {
      expect(value).toBeGreaterThan(0)
    }
  })

  it("has inline as the shortest duration", () => {
    const inline = CATEGORY_DURATION_DEFAULTS["inline"]
    for (const [key, value] of Object.entries(CATEGORY_DURATION_DEFAULTS)) {
      if (key !== "inline") {
        expect(value).toBeGreaterThan(inline)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// buildProgressSegments
// ---------------------------------------------------------------------------
describe("buildProgressSegments", () => {
  it("returns empty array for empty input", () => {
    expect(buildProgressSegments([])).toEqual([])
  })

  it("returns a single segment spanning 0 to 99 for one node", () => {
    const segments = buildProgressSegments([{ nodeId: "a", estimatedMs: 10_000 }])
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({
      nodeId: "a",
      startPct: 0,
      endPct: 99,
      estimatedMs: 10_000,
    })
  })

  it("splits evenly for two equal-duration nodes", () => {
    const segments = buildProgressSegments([
      { nodeId: "a", estimatedMs: 5_000 },
      { nodeId: "b", estimatedMs: 5_000 },
    ])
    expect(segments).toHaveLength(2)
    expect(segments[0].startPct).toBe(0)
    expect(segments[0].endPct).toBeCloseTo(49.5, 5)
    expect(segments[1].startPct).toBeCloseTo(49.5, 5)
    expect(segments[1].endPct).toBe(99)
  })

  it("allocates proportionally for three nodes (10s, 20s, 10s)", () => {
    const segments = buildProgressSegments([
      { nodeId: "a", estimatedMs: 10_000 },
      { nodeId: "b", estimatedMs: 20_000 },
      { nodeId: "c", estimatedMs: 10_000 },
    ])
    expect(segments).toHaveLength(3)

    // Total 40s: a=25%, b=50%, c=25% of 99
    // a: 0 → 24.75, b: 24.75 → 74.25, c: 74.25 → 99
    expect(segments[0].startPct).toBe(0)
    expect(segments[0].endPct).toBeCloseTo(24.75, 5)
    expect(segments[1].startPct).toBeCloseTo(24.75, 5)
    expect(segments[1].endPct).toBeCloseTo(74.25, 5)
    expect(segments[2].startPct).toBeCloseTo(74.25, 5)
    expect(segments[2].endPct).toBe(99)
  })

  it("always has the last segment end at exactly 99", () => {
    const segments = buildProgressSegments([
      { nodeId: "a", estimatedMs: 3_000 },
      { nodeId: "b", estimatedMs: 7_000 },
      { nodeId: "c", estimatedMs: 1_000 },
    ])
    expect(segments[segments.length - 1].endPct).toBe(99)
  })

  it("returns empty when all estimated durations are zero", () => {
    expect(buildProgressSegments([
      { nodeId: "a", estimatedMs: 0 },
      { nodeId: "b", estimatedMs: 0 },
    ])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// calculateCombinedProgress
// ---------------------------------------------------------------------------
describe("calculateCombinedProgress", () => {
  const segments = buildProgressSegments([
    { nodeId: "a", estimatedMs: 10_000 },
    { nodeId: "b", estimatedMs: 10_000 },
  ])

  it("returns 0 when all nodes are pending", () => {
    const statuses = {
      a: { status: "pending" as const },
      b: { status: "pending" as const },
    }
    expect(calculateCombinedProgress(segments, statuses)).toBe(0)
  })

  it("returns 99 when all nodes are completed", () => {
    const statuses = {
      a: { status: "completed" as const },
      b: { status: "completed" as const },
    }
    expect(calculateCombinedProgress(segments, statuses)).toBe(99)
  })

  it("treats skipped as completed", () => {
    const statuses = {
      a: { status: "skipped" as const },
      b: { status: "skipped" as const },
    }
    expect(calculateCombinedProgress(segments, statuses)).toBe(99)
  })

  it("contributes 0 for a failed node", () => {
    const statuses = {
      a: { status: "failed" as const },
      b: { status: "completed" as const },
    }
    // Only b's slice (49.5) counts → round(49.5) = 50
    expect(calculateCombinedProgress(segments, statuses)).toBe(50)
  })

  it("calculates proportional progress for a running node", () => {
    const now = Date.now()
    const startedAt = new Date(now - 5_000).toISOString() // 5s ago, est 10s
    const statuses = {
      a: { status: "running" as const, startedAt },
      b: { status: "pending" as const },
    }
    // Node a is at ~74/99 of its 49.5-wide slice → ~37
    const progress = calculateCombinedProgress(segments, statuses, now)
    expect(progress).toBeGreaterThan(30)
    expect(progress).toBeLessThan(45)
  })

  it("handles first completed and second running", () => {
    const now = Date.now()
    const startedAt = new Date(now - 10_000).toISOString() // fully elapsed
    const statuses = {
      a: { status: "completed" as const },
      b: { status: "running" as const, startedAt },
    }
    // a completed → 49.5, b at 99/99 of 49.5 → 49.5 → total ~99
    const progress = calculateCombinedProgress(segments, statuses, now)
    expect(progress).toBe(99)
  })

  it("ignores nodes not in segments", () => {
    const statuses = {
      a: { status: "completed" as const },
      b: { status: "completed" as const },
      c: { status: "pending" as const }, // not in segments
    }
    expect(calculateCombinedProgress(segments, statuses)).toBe(99)
  })

  it("skips segments with no matching status entry", () => {
    const statuses = {
      a: { status: "completed" as const },
      // b missing
    }
    // Only a's slice counts → round(49.5) = 50
    expect(calculateCombinedProgress(segments, statuses)).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// calculateMonetizationMarkup
// ---------------------------------------------------------------------------
describe("calculateMonetizationMarkup", () => {
  it("returns flatFee + ceil(baseCost * percent / 100)", () => {
    // 5 + ceil(100 * 10 / 100) = 5 + 10 = 15
    expect(calculateMonetizationMarkup(100, 5, 10)).toBe(15)
  })

  it("returns 0 when both flatFee and percent are zero", () => {
    expect(calculateMonetizationMarkup(100, 0, 0)).toBe(0)
  })

  it("returns only flatFee when percent is zero", () => {
    expect(calculateMonetizationMarkup(100, 3, 0)).toBe(3)
  })

  it("returns only percent markup when flatFee is zero", () => {
    // ceil(10 * 25 / 100) = ceil(2.5) = 3
    expect(calculateMonetizationMarkup(10, 0, 25)).toBe(3)
  })

  it("rounds up fractional percent markup with ceil", () => {
    // ceil(7 * 10 / 100) = ceil(0.7) = 1
    expect(calculateMonetizationMarkup(7, 0, 10)).toBe(1)
  })

  it("handles large values correctly", () => {
    // 100 + ceil(10000 * 15 / 100) = 100 + 1500 = 1600
    expect(calculateMonetizationMarkup(10_000, 100, 15)).toBe(1600)
  })

  it("returns 0 for zero baseCost, zero flatFee, and zero percent", () => {
    expect(calculateMonetizationMarkup(0, 0, 0)).toBe(0)
  })

  it("returns flatFee + 0 for zero baseCost with percent", () => {
    // 5 + ceil(0 * 50 / 100) = 5 + 0 = 5
    expect(calculateMonetizationMarkup(0, 5, 50)).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// calculateMonetizedCost
// ---------------------------------------------------------------------------
describe("calculateMonetizedCost", () => {
  it("returns baseCost plus markup", () => {
    // 100 + 15 = 115
    expect(calculateMonetizedCost(100, 5, 10)).toBe(115)
  })

  it("returns baseCost unchanged when no markup", () => {
    expect(calculateMonetizedCost(50, 0, 0)).toBe(50)
  })

  it("includes flatFee in total", () => {
    // 100 + 3 + ceil(0) = 103
    expect(calculateMonetizedCost(100, 3, 0)).toBe(103)
  })

  it("includes percent in total", () => {
    // 10 + 0 + ceil(2.5) = 13
    expect(calculateMonetizedCost(10, 0, 25)).toBe(13)
  })

  it("is consistent with markup function", () => {
    const baseCost = 200
    const flatFee = 10
    const percent = 20
    const markup = calculateMonetizationMarkup(baseCost, flatFee, percent)
    expect(calculateMonetizedCost(baseCost, flatFee, percent)).toBe(baseCost + markup)
  })
})

// ---------------------------------------------------------------------------
// REPEATABLE_NODE_TYPES
// ---------------------------------------------------------------------------
describe("REPEATABLE_NODE_TYPES", () => {
  it("is a Set", () => {
    expect(REPEATABLE_NODE_TYPES).toBeInstanceOf(Set)
  })

  it("contains expected AI generation types", () => {
    const expected = [
      "generate-image", "edit-image", "image-to-video",
      "text-to-video", "text-to-speech", "generate-music",
      "ai-writer", "suno-generate",
    ]
    for (const t of expected) {
      expect(REPEATABLE_NODE_TYPES.has(t)).toBe(true)
    }
  })

  it("does not contain FFmpeg or utility types", () => {
    const excluded = [
      "combine-videos", "trim-video", "resize-video",
      "render-video", "social-publish", "combine-text",
    ]
    for (const t of excluded) {
      expect(REPEATABLE_NODE_TYPES.has(t)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// REPEAT_PLACEHOLDER
// ---------------------------------------------------------------------------
describe("REPEAT_PLACEHOLDER", () => {
  it('equals "__repeat__"', () => {
    expect(REPEAT_PLACEHOLDER).toBe("__repeat__")
  })
})

// ---------------------------------------------------------------------------
// getEffectiveRepeatCount
// ---------------------------------------------------------------------------
describe("getEffectiveRepeatCount", () => {
  it("returns 1 when repeatCount is not set", () => {
    expect(getEffectiveRepeatCount({})).toBe(1)
  })

  it("returns 1 when repeatCount is 0", () => {
    expect(getEffectiveRepeatCount({ repeatCount: 0 })).toBe(1)
  })

  it("returns 1 when repeatCount is 1", () => {
    expect(getEffectiveRepeatCount({ repeatCount: 1 })).toBe(1)
  })

  it("returns 5 when repeatCount is 5", () => {
    expect(getEffectiveRepeatCount({ repeatCount: 5 })).toBe(5)
  })

  it("clamps to 20 when repeatCount exceeds max", () => {
    expect(getEffectiveRepeatCount({ repeatCount: 25 })).toBe(20)
  })

  it("floors fractional repeatCount", () => {
    // floor(1.7) = 1, and 1 <= 1 so returns 1
    expect(getEffectiveRepeatCount({ repeatCount: 1.7 })).toBe(1)
  })

  it("floors fractional value above 1", () => {
    // floor(3.9) = 3
    expect(getEffectiveRepeatCount({ repeatCount: 3.9 })).toBe(3)
  })

  it("returns 1 for negative repeatCount", () => {
    expect(getEffectiveRepeatCount({ repeatCount: -5 })).toBe(1)
  })

  it("returns 1 when repeatCount is undefined explicitly", () => {
    expect(getEffectiveRepeatCount({ repeatCount: undefined })).toBe(1)
  })

  it("returns 20 for repeatCount exactly 20", () => {
    expect(getEffectiveRepeatCount({ repeatCount: 20 })).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// expandItemsWithRepeat
// ---------------------------------------------------------------------------
describe("expandItemsWithRepeat", () => {
  it("returns null for undefined list with repeatCount=1 on a repeatable type", () => {
    expect(expandItemsWithRepeat(undefined, "generate-image", { repeatCount: 1 })).toBeNull()
  })

  it("returns synthetic repeat items for undefined list with repeatCount > 1", () => {
    const result = expandItemsWithRepeat(undefined, "generate-image", { repeatCount: 3 })
    expect(result).toEqual([REPEAT_PLACEHOLDER, REPEAT_PLACEHOLDER, REPEAT_PLACEHOLDER])
  })

  it("returns list as-is for multi-item list with repeatCount=1", () => {
    const result = expandItemsWithRepeat(["a", "b"], "generate-image", { repeatCount: 1 })
    expect(result).toEqual(["a", "b"])
  })

  it("expands multi-item list by repeatCount on a repeatable type", () => {
    const result = expandItemsWithRepeat(["a", "b"], "generate-image", { repeatCount: 2 })
    expect(result).toEqual(["a", "a", "b", "b"])
  })

  it("expands each item the correct number of times", () => {
    const result = expandItemsWithRepeat(["x", "y", "z"], "text-to-video", { repeatCount: 3 })
    expect(result).toEqual(["x", "x", "x", "y", "y", "y", "z", "z", "z"])
  })

  it("ignores repeatCount for non-repeatable type, returns list for >1 items", () => {
    const result = expandItemsWithRepeat(["a", "b"], "combine-text", { repeatCount: 5 })
    // Non-repeatable → repeatCount forced to 1 → returns listItems as-is
    expect(result).toEqual(["a", "b"])
  })

  it("returns null for single-item list with repeatCount=1", () => {
    expect(expandItemsWithRepeat(["a"], "generate-image", { repeatCount: 1 })).toBeNull()
  })

  it("returns null for undefined list on a non-repeatable type", () => {
    expect(expandItemsWithRepeat(undefined, "combine-text", { repeatCount: 5 })).toBeNull()
  })

  it("returns null for undefined list when no repeatCount is set", () => {
    expect(expandItemsWithRepeat(undefined, "generate-image", {})).toBeNull()
  })

  it("returns null for empty list", () => {
    // empty array: length is 0, not > 1, falls through to repeatCount check
    // repeatCount is 1 (no data) → returns null
    expect(expandItemsWithRepeat([], "generate-image", {})).toBeNull()
  })

  it("returns repeat placeholders for single-item list with repeatCount > 1", () => {
    // single-item list: length is 1, not > 1, falls through to repeatCount check
    // repeatCount is 3 → returns 3 placeholders
    const result = expandItemsWithRepeat(["a"], "generate-image", { repeatCount: 3 })
    expect(result).toEqual([REPEAT_PLACEHOLDER, REPEAT_PLACEHOLDER, REPEAT_PLACEHOLDER])
  })

  it("clamps repeat count to 20 even with large value", () => {
    const result = expandItemsWithRepeat(undefined, "generate-image", { repeatCount: 100 })
    expect(result).toHaveLength(20)
    expect(result!.every(item => item === REPEAT_PLACEHOLDER)).toBe(true)
  })
})
