// @test-watches frontend/src/nodes/**
import { describe, it, expect } from "vitest"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { classifyPreviewValue } from "@/hooks/use-workflow-store"
import { detectPreviewItemType } from "@/components/editor/workflow-editor/execution-graph"

/**
 * The two preview classifiers — detectPreviewItemType (the run path) and the
 * store's classifyPreviewValue (a Preview wired to a source that already has
 * results) — decide a URL with no extension by the same node-type rule,
 * previewTypeOfNodeType (decided 2026-10-19). With a recognised extension the
 * store keeps trusting the extension, while the run path decides by node type
 * first: that disagreement is left deliberately.
 */
const NO_EXT = "https://cdn.example.com/a/out"
const WITH_EXT = {
  mp4: { url: "https://cdn.example.com/a/out.mp4", type: "video" },
  mp3: { url: "https://cdn.example.com/a/out.mp3", type: "audio" },
  png: { url: "https://cdn.example.com/a/out.png", type: "image" },
} as const
/** The types the store answers before reading the URL at all. */
const STORE_DATA_FIRST = new Set(["forced-alignment", "video-analysis", "video-audit"])

const NODE_TYPES = [...new Set(NODE_DEFINITIONS.map((d) => d.type))].sort()

describe("preview classifiers on a URL with no extension", () => {
  it.each([
    ["remove-audio", "video"],
    ["image-to-video", "video"],
    ["lip-sync", "video"],
    ["dubbing", "audio"],
    // In the shared AUDIO_PRODUCER_TYPES; the editor's audio set gained it, so
    // the run path now says audio too (it said text) — decided 2026-10-19.
    ["extract-audio", "audio"],
  ] as const)("%s → %s in both classifiers", (type, expected) => {
    expect(detectPreviewItemType(type, NO_EXT)).toBe(expected)
    expect(classifyPreviewValue(type, NO_EXT)).toBe(expected)
  })

  it("covers every node type", () => {
    expect(NODE_TYPES).toContain("remove-audio")
    expect(NODE_TYPES.length).toBeGreaterThan(100)
  })

  it.each(NODE_TYPES)("%s: both classifiers agree", (type) => {
    expect(classifyPreviewValue(type, NO_EXT)).toBe(detectPreviewItemType(type, NO_EXT))
  })
})

describe("the store on a URL with a recognised extension", () => {
  it.each(NODE_TYPES)("%s: the extension decides", (type) => {
    for (const { url, type: byExtension } of Object.values(WITH_EXT)) {
      expect(classifyPreviewValue(type, url)).toBe(STORE_DATA_FIRST.has(type) ? "data" : byExtension)
    }
  })
})
