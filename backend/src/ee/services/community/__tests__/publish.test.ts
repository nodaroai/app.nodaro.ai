import { describe, it, expect, vi, beforeEach } from "vitest"

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock("../../../../lib/supabase.js", () => ({ supabase: { from, rpc } }))
vi.mock("../asset-lifecycle.js", () => ({
  copyEntityAssetsToPrefix: vi.fn().mockResolvedValue({ copiedAssets: { source_image_url: "C" }, bytes: 50, previewImages: ["C"] }),
  purgeCommunityListingBlobs: vi.fn(),
}))
vi.mock("../../../../lib/marketplace-helpers.js", () => ({
  generateSlug: () => "hero-abc123", getCreatorDisplayName: vi.fn().mockResolvedValue("Admin"),
}))
import { publishListing } from "../publish.js"
import { copyEntityAssetsToPrefix, purgeCommunityListingBlobs } from "../asset-lifecycle.js"

beforeEach(() => { vi.clearAllMocks() })

function mockLookup(existing: { id: string } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  from.mockReturnValue({ select })
}

describe("publishListing (character)", () => {
  it("new publish generates id, copies, calls RPC", async () => {
    mockLookup(null)
    rpc.mockResolvedValue({ data: [{ id: "L-new", slug: "hero-abc123" }], error: null })
    const row = { id: "src1", name: "Hero", canonical_description: "cd", source_image_url: "u" }
    const res = await publishListing({
      entityType: "character", sourceRow: row, creatorId: "admin1",
      title: "Hero", description: "d", category: null, style: null, tags: [],
      likenessAttestation: true,
    })
    expect(res.slug).toBe("hero-abc123")
    expect(purgeCommunityListingBlobs).not.toHaveBeenCalled()
    expect(copyEntityAssetsToPrefix).toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith("publish_community_listing", expect.objectContaining({
      p_entity_type: "character", p_creator_id: "admin1", p_published_bytes: 50,
    }))
  })
  it("re-publish reuses id and purges old blobs first", async () => {
    mockLookup({ id: "L-old" })
    rpc.mockResolvedValue({ data: [{ id: "L-old", slug: "hero-abc123" }], error: null })
    await publishListing({
      entityType: "character", sourceRow: { id: "src1", name: "Hero", source_image_url: "u", canonical_description: "cd" },
      creatorId: "admin1", title: "Hero", description: "d", category: null, style: null, tags: [], likenessAttestation: true,
    })
    expect(purgeCommunityListingBlobs).toHaveBeenCalledWith("L-old")
  })
})
