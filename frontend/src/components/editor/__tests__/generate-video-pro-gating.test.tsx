import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { CLOUD_ONLY_NODE_TYPES } from "@/lib/cloud-only-nodes"

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

  it("is hidden from BOTH the popup and the sidebar toolbar when the edition has no credits (community/business)", async () => {
    vi.doMock("@/lib/edition", () => ({ hasCredits: () => false, isCloud: () => false }))
    const { getNodeOptions: getPopupOptions } = await import("../add-node-popup")
    const { getNodeOptions: getToolbarOptions } = await import("../node-toolbar")

    expect(getPopupOptions().map((o) => o.type)).not.toContain("generate-video-pro")
    expect(getToolbarOptions().map((o) => o.type)).not.toContain("generate-video-pro")
  })

  it("appears in BOTH the popup and the sidebar toolbar when the edition has credits (cloud)", async () => {
    vi.doMock("@/lib/edition", () => ({ hasCredits: () => true, isCloud: () => true }))
    const { getNodeOptions: getPopupOptions } = await import("../add-node-popup")
    const { getNodeOptions: getToolbarOptions } = await import("../node-toolbar")

    expect(getPopupOptions().map((o) => o.type)).toContain("generate-video-pro")
    expect(getToolbarOptions().map((o) => o.type)).toContain("generate-video-pro")
  })
})

describe("both surfaces consume the shared CLOUD_ONLY_NODE_TYPES module", () => {
  it("the shared set includes the cloud-only nodes", () => {
    expect(CLOUD_ONLY_NODE_TYPES.has("voice-changer-pro")).toBe(true)
    expect(CLOUD_ONLY_NODE_TYPES.has("generate-video-pro")).toBe(true)
    // video-analysis's implementation moved to @nodaroai/cloud-plugins, so its
    // node is Cloud-only too (else it would 404 on run under community/business).
    expect(CLOUD_ONLY_NODE_TYPES.has("video-analysis")).toBe(true)
  })

  // Source-text guard (mirrors node-toolbar.test.tsx's file-parsing approach,
  // used there because these modules render JSX icons at module scope): proves
  // neither surface reverted to a local hand-copied `Set` — both must import
  // the shared module, not just happen to agree with it today.
  it("add-node-popup.tsx imports CLOUD_ONLY_NODE_TYPES from the shared module (no local re-declaration)", () => {
    expect(ADD_NODE_POPUP_SRC).toMatch(/import\s*\{\s*CLOUD_ONLY_NODE_TYPES\s*\}\s*from\s*["']@\/lib\/cloud-only-nodes["']/)
    expect(ADD_NODE_POPUP_SRC).not.toMatch(/const\s+CLOUD_ONLY_NODE_TYPES\s*=\s*new Set/)
  })

  it("node-toolbar.tsx imports CLOUD_ONLY_NODE_TYPES from the shared module (no local re-declaration)", () => {
    expect(NODE_TOOLBAR_SRC).toMatch(/import\s*\{\s*CLOUD_ONLY_NODE_TYPES\s*\}\s*from\s*["']@\/lib\/cloud-only-nodes["']/)
    expect(NODE_TOOLBAR_SRC).not.toMatch(/const\s+CLOUD_ONLY_NODE_TYPES\s*=\s*new Set/)
  })
})
