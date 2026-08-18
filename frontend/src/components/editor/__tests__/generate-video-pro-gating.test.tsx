import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { CLOUD_ONLY_NODE_TYPES, NODARO_EXCLUSIVE_NODE_TYPES } from "@/lib/cloud-only-nodes"

// Read at module load (before any `vi.resetModules()` runs in the tests
// below) — mirrors node-toolbar.test.tsx's file-parsing approach. Resolved
// against `process.cwd()` (vitest always runs from `frontend/`) rather than
// `import.meta.url` — the latter resolves to a non-`file:` scheme in this
// file once `vi.doMock` + dynamic `import()` are also present, throwing
// "The URL must be of scheme file" out of `fileURLToPath`.
const ADD_NODE_POPUP_SRC = readFileSync(path.resolve(process.cwd(), "src/components/editor/add-node-popup.tsx"), "utf8")
const NODE_TOOLBAR_SRC = readFileSync(path.resolve(process.cwd(), "src/components/editor/node-toolbar.tsx"), "utf8")

/**
 * Discovery-gating test for `generate-video-pro` — mirrors
 * `voice-changer-pro-gating.test.tsx`, extended to cover BOTH surfaces
 * (add-node popup AND the sidebar toolbar maintain separate NODE_OPTIONS
 * arrays per CLAUDE.md's New Node Registration steps 8 & 9) and both
 * `hasCredits()` states. `vi.resetModules()` + `vi.doMock()` + a dynamic
 * `import()` per test lets a single file exercise both the false and true
 * branches of the edition gate (a static top-level `vi.mock` can't flip
 * between tests).
 */

describe("generate-video-pro discovery gating", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  // 20s timeout: vi.resetModules + fresh dynamic imports re-evaluate the whole
  // editor import graph, which since the picker-ui seam includes the full
  // picker/editor surface — slow under a loaded parallel run, not a hang.
  it("4b: appears on BOTH surfaces even without credits — exclusives relay through nodaro.ai; generative-pipeline stays hidden", { timeout: 20_000 }, async () => {
    vi.doMock("@/lib/edition", () => ({ hasCredits: () => false, isCloud: () => false }))
    const { getNodeOptions: getPopupOptions } = await import("../add-node-popup")
    const { getNodeOptions: getToolbarOptions } = await import("../node-toolbar")

    expect(getPopupOptions().map((o) => o.type)).toContain("generate-video-pro")
    expect(getToolbarOptions().map((o) => o.type)).toContain("generate-video-pro")
    // The truly cloud-only engine keeps its gate.
    expect(getPopupOptions().map((o) => o.type)).not.toContain("generative-pipeline")
    expect(getToolbarOptions().map((o) => o.type)).not.toContain("generative-pipeline")
  })

  it("appears in BOTH the popup and the sidebar toolbar when the edition has credits (cloud)", async () => {
    vi.doMock("@/lib/edition", () => ({ hasCredits: () => true, isCloud: () => true }))
    const { getNodeOptions: getPopupOptions } = await import("../add-node-popup")
    const { getNodeOptions: getToolbarOptions } = await import("../node-toolbar")

    expect(getPopupOptions().map((o) => o.type)).toContain("generate-video-pro")
    expect(getToolbarOptions().map((o) => o.type)).toContain("generate-video-pro")
    expect(getPopupOptions().map((o) => o.type)).toContain("generative-pipeline")
  })
})

describe("both surfaces consume the shared gating module", () => {
  it("the shared sets carry the 4b split: exclusives relay via nodaro.ai, generative-pipeline stays cloud-only", () => {
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("voice-changer-pro")).toBe(true)
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("generate-video-pro")).toBe(true)
    expect(NODARO_EXCLUSIVE_NODE_TYPES.has("video-analysis")).toBe(true)
    expect(CLOUD_ONLY_NODE_TYPES.has("generative-pipeline")).toBe(true)
    // No overlap — a node is exclusive-relayed OR cloud-only, never both.
    expect([...NODARO_EXCLUSIVE_NODE_TYPES].filter((t) => CLOUD_ONLY_NODE_TYPES.has(t))).toEqual([])
  })

  // Source-text guard: the catalogue and its edition filter now live in one
  // module (#635), so what needs proving is that neither surface has grown a
  // private copy of either. A hand-rolled Set here is precisely how the two
  // lists drifted in the first place.
  it("declares CLOUD_ONLY_NODE_TYPES only in the shared module", () => {
    const surfaces = [
      ["add-node-popup.tsx", ADD_NODE_POPUP_SRC],
      ["node-toolbar.tsx", NODE_TOOLBAR_SRC],
    ] as const
    for (const [name, src] of surfaces) {
      expect(src, name).not.toMatch(/const\s+CLOUD_ONLY_NODE_TYPES\s*=\s*new Set/)
    }
  })

  it("routes both surfaces through the shared node-options module", () => {
    const NODE_OPTIONS_SRC = readFileSync(
      path.resolve(process.cwd(), "src/lib/node-options.tsx"),
      "utf8",
    )
    // The edition gate lives there now, once. Since the PR-4 surfacing only
    // the truly cloud-only set is filtered — the exclusive set is consumed
    // by the mark components, not the catalogue filter.
    expect(NODE_OPTIONS_SRC).toMatch(
      /import \{ CLOUD_ONLY_NODE_TYPES \} from ["']@\/lib\/cloud-only-nodes["']/,
    )
    expect(NODE_OPTIONS_SRC).toMatch(/hasCredits\(\)/)

    const surfaces = [
      ["add-node-popup.tsx", ADD_NODE_POPUP_SRC],
      ["node-toolbar.tsx", NODE_TOOLBAR_SRC],
    ] as const
    for (const [name, src] of surfaces) {
      expect(src, name).toMatch(/from ["']@\/lib\/node-options["']/)
    }
  })
})
