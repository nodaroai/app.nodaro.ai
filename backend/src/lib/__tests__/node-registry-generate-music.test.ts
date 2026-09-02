/**
 * W3 (spec 2026-09-01-app-reports-triage-design.md §5, item 4).
 *
 * `generate-music` dispatches MiniMax only — routes/generate-music.ts:18 is
 * `z.enum(MUSIC_PROVIDERS)` and MUSIC_PROVIDERS is `["minimax"]`. The registry
 * descriptor advertised Suno and a stale "7-13" credit range on GET /v1/nodes,
 * the discovery contract SDK / CLI / MCP callers build against. Suno music runs
 * through the dedicated suno-* nodes (docs/nodes/ai-audio/generate-music.md:30).
 *
 * `providers` is DERIVED from MUSIC_PROVIDERS, never hand-kept — same rule as
 * node-registry-generate-video-pro.test.ts.
 */
import { describe, it, expect, vi } from "vitest"
import { MUSIC_PROVIDERS } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"

// getEnrichedRegistry() strips creditCost entirely on an edition with no credit
// system (node-registry.ts:1249-1251), and the test env is not cloud. Pin
// hasCredits() the way node-registry-edition.test.ts does, so the enrichment
// assertion below tests enrichment and not the edition gate.
vi.mock("../config.js", async (orig) => {
  const actual = await orig<typeof import("../config.js")>()
  return { ...actual, hasCredits: () => true }
})

const { NODE_REGISTRY, getEnrichedRegistry } = await import("../node-registry.js")

describe("generate-music discovery descriptor", () => {
  const entry = NODE_REGISTRY.find((n) => n.type === "generate-music")

  it("exists", () => {
    expect(entry).toBeDefined()
  })

  it("providers are the DERIVED shared MUSIC_PROVIDERS list", () => {
    expect(entry!.providers).toEqual([...MUSIC_PROVIDERS])
  })

  it("advertises no Suno model — Suno runs through the dedicated suno-* nodes", () => {
    for (const p of entry!.providers ?? []) {
      expect(p.startsWith("suno")).toBe(false)
    }
  })

  it("no 'suno' anywhere in the descriptor (stringified, case-insensitive)", () => {
    expect(JSON.stringify(entry).toLowerCase()).not.toContain("suno")
  })

  it("declares no literal creditCost, so enrichment supplies the real price", () => {
    expect(entry!.creditCost).toBeUndefined()
  })

  it("the enriched descriptor quotes STATIC_CREDIT_COSTS", () => {
    const enriched = getEnrichedRegistry().find((n) => n.type === "generate-music")
    expect(enriched!.creditCost).toBe(STATIC_CREDIT_COSTS["generate-music"])
  })
})
