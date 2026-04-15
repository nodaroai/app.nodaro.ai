import { describe, it, expect } from "vitest"

/**
 * Cross-validation test for node toolbar / add-node-popup data integrity.
 *
 * Both add-node-popup.tsx (context menu) and node-toolbar.tsx (sidebar) maintain
 * separate NODE_OPTIONS arrays. Per CLAUDE.md:
 *   "Steps 8 and 9 are separate node lists --
 *    missing either means the node won't appear in that UI."
 *
 * This test validates against NODE_DEFINITIONS from types/nodes.ts, which is
 * the canonical registry that both UI lists should cover. It does NOT import
 * from add-node-popup or node-toolbar directly (those modules require JSX
 * rendering context and heavy mocking).
 */

import { NODE_DEFINITIONS, type SceneNodeType } from "@/types/nodes"

// ---------------------------------------------------------------------------
// Tests: NODE_DEFINITIONS integrity (canonical registry)
// ---------------------------------------------------------------------------

describe("NODE_DEFINITIONS registry integrity", () => {
  it("has at least 60 entries", () => {
    expect(NODE_DEFINITIONS.length).toBeGreaterThanOrEqual(60)
  })

  it("every definition has type, label, category, and creditCost", () => {
    for (const def of NODE_DEFINITIONS) {
      expect(def.type, "type").toBeTruthy()
      expect(def.label, `label for ${def.type}`).toBeTruthy()
      expect(def.category, `category for ${def.type}`).toBeTruthy()
      expect(def.creditCost, `creditCost for ${def.type}`).toBeGreaterThanOrEqual(0)
    }
  })

  it("has no duplicate types", () => {
    const types = NODE_DEFINITIONS.map((d) => d.type)
    const unique = new Set(types)
    if (unique.size !== types.length) {
      const duplicates = types.filter((t, i) => types.indexOf(t) !== i)
      throw new Error(`Duplicate types in NODE_DEFINITIONS: ${duplicates.join(", ")}`)
    }
    expect(unique.size).toBe(types.length)
  })

  it("every type is kebab-case (lowercase + hyphens + digits)", () => {
    const validPattern = /^[a-z0-9][a-z0-9-]*$/
    for (const def of NODE_DEFINITIONS) {
      expect(def.type).toMatch(validPattern)
    }
  })

  it("every label is non-empty and reasonable length", () => {
    for (const def of NODE_DEFINITIONS) {
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.label.length).toBeLessThanOrEqual(30)
    }
  })

  it("every definition has inputs and outputs arrays", () => {
    for (const def of NODE_DEFINITIONS) {
      expect(Array.isArray(def.inputs), `${def.type} inputs`).toBe(true)
      expect(Array.isArray(def.outputs), `${def.type} outputs`).toBe(true)
    }
  })

  it("every definition has defaultData", () => {
    for (const def of NODE_DEFINITIONS) {
      expect(def.defaultData, `${def.type} defaultData`).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: essential node types present
// ---------------------------------------------------------------------------

describe("NODE_DEFINITIONS essential types", () => {
  const allTypes = new Set(NODE_DEFINITIONS.map((d) => d.type))

  it("includes all Input nodes", () => {
    const expected = [
      "text-prompt",
      "list",
      "loop",
      "upload-image",
      "upload-video",
      "upload-audio",
      "rss-feed",
      "youtube-video",
      "reference-audio",
    ]
    for (const t of expected) {
      expect(allTypes.has(t as SceneNodeType), `Missing Input type: ${t}`).toBe(true)
    }
  })

  it("includes all Parameter nodes", () => {
    const expected = [
      "tone",
      "style-guide",
      "provider",
      "scene-count",
      "duration",
      "aspect-ratio",
      "motion",
      "camera-motion",
    ]
    for (const t of expected) {
      expect(allTypes.has(t as SceneNodeType), `Missing Parameter type: ${t}`).toBe(true)
    }
  })

  it("includes all AI nodes", () => {
    const expected = [
      "generate-script",
      "generate-image",
      "modify-image",
      "upscale-image",
      "remove-background",
      "image-to-video",
      "video-to-video",
      "text-to-video",
      "text-to-speech",
      "qa-check",
      "generate-music",
      "text-to-audio",
      "ai-writer",
      "transcribe",
      "image-to-text",
      "audio-isolation",
      "lip-sync",
      "motion-transfer",
    ]
    for (const t of expected) {
      expect(allTypes.has(t as SceneNodeType), `Missing AI type: ${t}`).toBe(true)
    }
  })

  it("includes all Suno nodes", () => {
    const expected = [
      "suno-generate",
      "suno-cover",
      "suno-extend",
      "suno-lyrics",
      "suno-separate",
      "suno-music-video",
    ]
    for (const t of expected) {
      expect(allTypes.has(t as SceneNodeType), `Missing Suno type: ${t}`).toBe(true)
    }
  })

  it("includes all Processing nodes", () => {
    const expected = [
      "combine-videos",
      "merge-video-audio",
      "add-captions",
      "resize-video",
      "trim-audio",
      "mix-audio",
      "adjust-volume",
      "trim-video",
      "video-composer",
      "after-effects",
      "lottie-overlay",
      "3d-title",
      "motion-graphics",
      "composite",
      "render-video",
      "speed-ramp",
      "loop-video",
      "fade-video",
      "transcode-video",
      "manual-edit",
      "video-upscale",
      "combine-text",
      "split-text",
    ]
    for (const t of expected) {
      expect(allTypes.has(t as SceneNodeType), `Missing Processing type: ${t}`).toBe(true)
    }
  })

  it("includes all Asset/Entity nodes", () => {
    const expected = ["scene", "character", "face", "object", "location"]
    for (const t of expected) {
      expect(allTypes.has(t as SceneNodeType), `Missing Asset type: ${t}`).toBe(true)
    }
  })

  it("includes all Output nodes", () => {
    const expected = ["save-to-storage", "webhook-output"]
    for (const t of expected) {
      expect(allTypes.has(t as SceneNodeType), `Missing Output type: ${t}`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: category distribution
// ---------------------------------------------------------------------------

describe("NODE_DEFINITIONS category distribution", () => {
  const byCategory = NODE_DEFINITIONS.reduce(
    (acc, def) => {
      const cat = def.category
      acc[cat] = (acc[cat] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  it("has nodes in at least 5 categories", () => {
    expect(Object.keys(byCategory).length).toBeGreaterThanOrEqual(5)
  })

  it("AI category has the most nodes", () => {
    const aiCount = byCategory["ai"] ?? 0
    for (const [cat, count] of Object.entries(byCategory)) {
      if (cat !== "ai") {
        expect(aiCount).toBeGreaterThanOrEqual(count)
      }
    }
  })

  it("credit costs are 0 for all input/parameter nodes", () => {
    // web-scrape is input-category but paid — it's a network-bound data
    // source (Apify API), unlike uploads / text-prompts / triggers which
    // are pure local inputs. The invariant this test guards is "users
    // don't accidentally pay for uploading or writing text", which this
    // exception preserves.
    const paidInputExceptions = new Set(["web-scrape"])
    const zeroCostCategories = ["input", "parameter"]
    for (const def of NODE_DEFINITIONS) {
      if (zeroCostCategories.includes(def.category) && !paidInputExceptions.has(def.type)) {
        expect(
          def.creditCost,
          `${def.type} should have 0 credit cost`,
        ).toBe(0)
      }
    }
  })
})
