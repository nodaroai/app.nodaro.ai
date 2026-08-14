import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

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
      // "loop" retired as a creatable type — it is now only a load-migrated
      // alias of "list" (see list-loop-migration.ts) and is intentionally
      // absent from NODE_DEFINITIONS.
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
      // Task 7.1: generate-video collapses i2v + t2v in the popup/sidebar UI,
      // but i2v + t2v remain in NODE_DEFINITIONS (the canonical registry checked
      // here) until Task 13.2 deletes them. Backward-compat for unmigrated rows.
      "image-to-video",
      "video-to-video",
      "text-to-video",
      "generate-video",
      "text-to-speech",
      "qa-check",
      "generate-music",
      "text-to-audio",
      "llm-chat",
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
      "extract-field",
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

  it("AI category has a substantial number of nodes", () => {
    // Originally asserted "AI has the most nodes", but the parameter category
    // has overtaken AI as the cinematography picker family has grown (now 45+
    // with transition + character-fx). The spirit of the test is "make sure
    // no one accidentally strips AI nodes" — a lower-bound check captures
    // that without false-positiving when parameter pickers are added.
    const aiCount = byCategory["ai"] ?? 0
    expect(aiCount).toBeGreaterThanOrEqual(40)
  })

  it("credit costs are 0 for all input/parameter nodes", () => {
    // Some input/parameter nodes are paid because they trigger an API call
    // rather than emitting a local value:
    //   web-scrape — Apify network call
    //   suno-voice — Suno voice-create call (paid once in the modal flow)
    //   telegram-channel-feed — fetches + parses a public channel's posts
    // The invariant this test guards is "users don't accidentally pay for
    // uploading or writing text", which these exceptions preserve.
    const paidInputExceptions = new Set(["web-scrape", "suno-voice", "telegram-channel-feed"])
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

// ---------------------------------------------------------------------------
// add-node-popup ↔ node-toolbar parity (the two separate NODE_OPTIONS lists).
//
// The popup and the sidebar used to maintain SEPARATE NODE_OPTIONS arrays and
// this section compared them for drift. They now share one list from
// @/lib/node-options (#635), so the assertions below prove the single source
// rather than reconciling two.
// ---------------------------------------------------------------------------

describe("add-node-popup ↔ node-toolbar parity", () => {
  // The two surfaces used to keep private NODE_OPTIONS copies and this suite
  // compared them for drift (#635). They now import one list from
  // @/lib/node-options, so the interesting assertion is no longer "the two
  // agree" — it is "there is only one list left to agree with".
  const SRC = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

  const SURFACES = ["../add-node-popup.tsx", "../node-toolbar.tsx"] as const

  it("declares the catalogue exactly once, in the shared module", () => {
    expect(SRC("../../../lib/node-options.tsx")).toMatch(/export const NODE_OPTIONS/)
    for (const surface of SURFACES) {
      expect(
        SRC(surface),
        surface + " re-declares NODE_OPTIONS — import @/lib/node-options instead",
      ).not.toMatch(/^(export )?const NODE_OPTIONS/m)
    }
  })

  it("has both surfaces import it from that module", () => {
    for (const surface of SURFACES) {
      expect(SRC(surface), surface).toMatch(
        /import \{[^}]*getNodeOptions[^}]*\} from "@\/lib\/node-options"/,
      )
    }
  })

  it("resolves to one and the same array at runtime", async () => {
    const shared = await import("@/lib/node-options")
    const popupModule = await import("../add-node-popup")
    const toolbarModule = await import("../node-toolbar")
    // Reference identity, not deep equality: two equal-but-separate arrays are
    // exactly the bug this replaces.
    expect(popupModule.NODE_OPTIONS).toBe(shared.NODE_OPTIONS)
    expect(popupModule.getNodeOptions).toBe(shared.getNodeOptions)
    expect(toolbarModule.getNodeOptions).toBe(shared.getNodeOptions)
  })
})
