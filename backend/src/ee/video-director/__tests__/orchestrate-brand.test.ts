/**
 * Unit tests for runVideoDirector brand threading (Phase 3a — Task 7).
 *
 * Mirrors the harness in orchestrate.test.ts (buildDeps / BASE_OPTS / mockBake
 * via vi.mock on the baker) and adds the brand-resolution assertions:
 *   (a) preset-name brand  → baked brief.brandTokens deep-equals BRAND_PRESETS[name]
 *   (b) inline BrandTokens → passed through verbatim to the baked brief
 *   (c) no brand           → baked brief.brandTokens stays whatever the author
 *                            produced (undefined in this harness).
 *
 * These exercise the REAL runVideoDirector + REAL resolveBrandInput — only the
 * side-effecting deps (author, speech, alignment, render) and bakeShotSequence
 * are mocked, exactly as orchestrate.test.ts does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { BRAND_PRESETS, type BrandTokens } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Mock bakeShotSequence BEFORE importing the module under test so vitest's
// mock-hoisting intercepts the dynamic import that orchestrate.ts makes.
// ---------------------------------------------------------------------------
const { mockBake } = vi.hoisted(() => ({
  mockBake: vi.fn(),
}))
vi.mock("@/services/shot-sequence/baker.js", () => ({
  bakeShotSequence: mockBake,
}))

import { runVideoDirector } from "../orchestrate.js"
import { MOCK_AUTHORED, MOCK_PLAN, BASE_OPTS, buildDeps } from "./orchestrate-fixtures.js"

// ---------------------------------------------------------------------------
// bakedBrief reads the per-file `mockBake`, so it stays in this file. The plain
// fixtures + buildDeps are shared via ./orchestrate-fixtures.ts (same harness
// as orchestrate.test.ts).
// ---------------------------------------------------------------------------

/** The first argument bakeShotSequence received (the brief). */
function bakedBrief(): Record<string, unknown> {
  return mockBake.mock.calls[0][0] as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("runVideoDirector brand", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBake.mockReturnValue({ plan: MOCK_PLAN, warnings: [] })
  })

  it("resolves a preset-name brand and injects brandTokens into the baked brief", async () => {
    const deps = buildDeps()

    await runVideoDirector({ ...BASE_OPTS, brand: "cobalt-corporate" }, deps)

    expect(mockBake).toHaveBeenCalledTimes(1)
    // The brief handed to bake carries the RESOLVED preset tokens.
    expect(bakedBrief().brandTokens).toEqual(BRAND_PRESETS["cobalt-corporate"])
    // Sanity: the author itself produced no brandTokens — orchestrate injected them.
    expect(MOCK_AUTHORED.shotSequenceBrief).not.toHaveProperty("brandTokens")
  })

  it("passes an inline BrandTokens object through to the brief", async () => {
    const inline: BrandTokens = {
      palette: { bg: "#101820", text: "#F5F5F5", accent: "#FF5A5F" },
      fonts: { heading: "Anton", body: "Inter" },
      logo: { name: "Acme", tagline: "Ship it" },
    }
    const deps = buildDeps()

    await runVideoDirector({ ...BASE_OPTS, brand: inline }, deps)

    expect(mockBake).toHaveBeenCalledTimes(1)
    expect(bakedBrief().brandTokens).toEqual(inline)
  })

  it("leaves brandTokens undefined when no brand is provided (unless the author set it)", async () => {
    const deps = buildDeps()

    await runVideoDirector(BASE_OPTS, deps)

    expect(mockBake).toHaveBeenCalledTimes(1)
    expect(bakedBrief().brandTokens).toBeUndefined()
  })
})
