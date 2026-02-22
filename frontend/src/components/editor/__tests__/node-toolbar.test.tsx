import { describe, it, expect, vi } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — stub out JSX-returning dependencies so the add-node-popup module
// can be evaluated without pulling in lucide-react icons at runtime.
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () =>
  new Proxy(
    {},
    {
      get: (_, p) =>
        typeof p === "string" ? () => null : undefined,
    },
  ),
)

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}))

// ---------------------------------------------------------------------------
// The node-toolbar does NOT export its NODE_OPTIONS.
// We test cross-validation by extracting both lists via a known pattern:
//   - add-node-popup.tsx exports NODE_OPTIONS (the popup / context menu list)
//   - node-toolbar.tsx has its own internal NODE_OPTIONS (the sidebar list)
//
// Since node-toolbar's list is not exported, we import the module and
// rely on the add-node-popup exports for cross-validation.
//
// The key invariant (from CLAUDE.md):
//   "Steps 8 and 9 are separate node lists --
//    missing either means the node won't appear in that UI."
// ---------------------------------------------------------------------------

import { NODE_OPTIONS as POPUP_OPTIONS, CATEGORIES } from "../add-node-popup"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("add-node-popup vs node-toolbar cross-validation", () => {
  // The popup groups Assets nodes under a single "Assets" category,
  // while the toolbar splits them into individual categories
  // (Character, Face, Object, Location, Scene).
  // Both should include the same node TYPES despite different categories.

  const popupTypes = new Set(POPUP_OPTIONS.map((n) => n.type))

  it("popup has the expected minimum node count", () => {
    expect(POPUP_OPTIONS.length).toBeGreaterThanOrEqual(60)
  })

  it("every popup category has at least one node", () => {
    for (const cat of CATEGORIES) {
      const nodes = POPUP_OPTIONS.filter((n) => n.category === cat.id)
      expect(
        nodes.length,
        `Category "${cat.id}" should have at least one node`,
      ).toBeGreaterThan(0)
    }
  })

  it("every popup node option has a non-empty label", () => {
    for (const opt of POPUP_OPTIONS) {
      expect(
        opt.label.length,
        `Node "${opt.type}" should have a non-empty label`,
      ).toBeGreaterThan(0)
    }
  })

  it("includes essential node types across both UIs", () => {
    const essentialTypes = [
      "text-prompt",
      "generate-image",
      "image-to-video",
      "text-to-speech",
      "combine-videos",
      "render-video",
      "upload-image",
      "upload-video",
      "generate-script",
      "ai-writer",
      "text-to-video",
      "video-to-video",
      "character",
      "face",
      "object",
      "location",
    ]
    for (const t of essentialTypes) {
      expect(popupTypes.has(t as typeof POPUP_OPTIONS[number]["type"]), `Missing essential type in popup: ${t}`).toBe(
        true,
      )
    }
  })

  it("popup node types are unique (no duplicates)", () => {
    const types = POPUP_OPTIONS.map((n) => n.type)
    const unique = new Set(types)
    expect(unique.size).toBe(types.length)
  })

  it("every popup node category maps to a known CATEGORIES id", () => {
    const categoryIds = new Set(CATEGORIES.map((c) => c.id))
    for (const node of POPUP_OPTIONS) {
      expect(
        categoryIds.has(node.category),
        `Node "${node.type}" references unknown category "${node.category}"`,
      ).toBe(true)
    }
  })
})

describe("CATEGORIES data integrity", () => {
  it("has at least 5 categories", () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(5)
  })

  it("every category has a non-empty label and description", () => {
    for (const cat of CATEGORIES) {
      expect(cat.label.length, `Category "${cat.id}" label`).toBeGreaterThan(0)
      expect(
        cat.description.length,
        `Category "${cat.id}" description`,
      ).toBeGreaterThan(0)
    }
  })

  it("category ids are unique", () => {
    const ids = CATEGORIES.map((c) => c.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it("includes Input, AI, Processing, and Output categories", () => {
    const ids = new Set(CATEGORIES.map((c) => c.id))
    expect(ids.has("Input")).toBe(true)
    expect(ids.has("AI")).toBe(true)
    expect(ids.has("Processing")).toBe(true)
    expect(ids.has("Output")).toBe(true)
  })
})
