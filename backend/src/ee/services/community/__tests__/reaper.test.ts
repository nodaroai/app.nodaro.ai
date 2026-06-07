import { describe, it, expect, vi, beforeEach } from "vitest"
const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock("../../../../lib/supabase.js", () => ({ supabase: { from } }))
vi.mock("../asset-lifecycle.js", () => ({ purgeCommunityListingBlobs: vi.fn() }))
import { sweepOrphanedCommunityBlobs } from "../reaper.js"
import { purgeCommunityListingBlobs } from "../asset-lifecycle.js"

beforeEach(() => vi.clearAllMocks())

describe("sweepOrphanedCommunityBlobs", () => {
  it("purges + hard-deletes inactive listings past grace", async () => {
    const del = vi.fn().mockResolvedValue({})
    from.mockImplementation((t: string) => {
      if (t === "community_listings") {
        return {
          select: () => ({ eq: () => ({ lt: () => ({ limit: () => ({ data: [{ id: "L1" }] }) }) }) }),
          delete: () => ({ in: del }),
        }
      }
      return {}
    })
    await sweepOrphanedCommunityBlobs(0)
    expect(purgeCommunityListingBlobs).toHaveBeenCalledWith("L1")
    expect(del).toHaveBeenCalled()
  })
})
