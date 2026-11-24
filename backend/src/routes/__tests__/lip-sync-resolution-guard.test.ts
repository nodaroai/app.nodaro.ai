// @test-units-by-name looks up only the Lip Sync rows its models name
/**
 * The Lip Sync resolution menu offers exactly what the server runs and prices
 * for each model (decided 2026-11-23): for every model and every resolution
 * the shared table lists, the route's schema takes it and the run is priced on
 * an existing row at that resolution; and every resolution the route prices a
 * model at (its own row at that resolution) is listed. The table is derived
 * from the same rules the route reads, so this holds them to each other.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { LIP_SYNC_PROVIDERS, lipSyncResolutionChoices } from "@nodaro/shared/models"
import { drivingAudioRun } from "@nodaro/shared/credits"
import { STATIC_CREDIT_COSTS } from "../../ee/billing/credits.js"
import { lipSyncBody, resolveLipSyncIdentifier } from "../lip-sync.js"

const ROUTE_RESOLUTIONS = lipSyncBody.shape.resolution.unwrap().options as readonly string[]
const MEASURED = { audioSec: 10, billedSeconds: 15 }

/** The row a run of `provider` asked `resolution` is held on, as the route resolves it. */
function heldId(provider: string, resolution: string): string {
  const driving = drivingAudioRun({ provider, resolution, audioSec: 5 })
  return resolveLipSyncIdentifier({ provider, resolution }, MEASURED, driving.ok ? { ...driving, audioSec: 5 } : undefined)
}

describe("the Lip Sync resolution menu = what the server runs and prices", () => {
  for (const provider of LIP_SYNC_PROVIDERS) {
    const choices = lipSyncResolutionChoices(provider)
    if (!choices) continue
    it(`${provider}: every listed choice is taken by the route and held on a priced row`, () => {
      expect(choices.values).toContain(choices.def)
      for (const r of choices.values) {
        expect(ROUTE_RESOLUTIONS, `${provider} ${r}`).toContain(r)
        const id = heldId(provider, r)
        expect(STATIC_CREDIT_COSTS[id], `${provider} ${r} → ${id}`).toBeGreaterThan(0)
      }
    })
    it(`${provider}: every resolution the route holds on a row of its own is listed`, () => {
      for (const r of ROUTE_RESOLUTIONS) {
        const id = heldId(provider, r)
        // A priced row that names this resolution is one the run renders and charges at it. (A row that
        // does not exist prices nothing: the guard answers it as not configured, as it did.)
        if (STATIC_CREDIT_COSTS[id] !== undefined && new RegExp(`(^|:)${r}($|:)`, "i").test(id)) {
          expect(choices.values, `${provider} prices ${r} (${id})`).toContain(r)
        }
      }
    })
  }

  it("the added tiers are the ones the server already ran: 1080p on Seedance 2.5, 4K on Seedance 2", () => {
    expect(lipSyncResolutionChoices("seedance-2-5")?.values).toEqual(["480p", "720p", "1080p"])
    expect(lipSyncResolutionChoices("seedance-2")?.values).toEqual(["480p", "720p", "1080p", "4k"])
    expect(heldId("seedance-2-5", "1080p")).toBe("seedance-2-5:8s:1080p")
    expect(heldId("seedance-2", "4k")).toBe("seedance-2:8s:4k")
  })
})
