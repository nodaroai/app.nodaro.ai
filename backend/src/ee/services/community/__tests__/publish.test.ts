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
vi.mock("../../../../utils/file-validation.js", () => ({ accountStorage: vi.fn() }))
import { publishListing } from "../publish.js"
import { copyEntityAssetsToPrefix, purgeCommunityListingBlobs } from "../asset-lifecycle.js"
import { accountStorage } from "../../../../utils/file-validation.js"

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
    expect(accountStorage).toHaveBeenCalledWith("admin1", 50)
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

describe("publishListing (creature)", () => {
  it("routes entityType=creature through the creature adapter end-to-end", async () => {
    mockLookup(null)
    rpc.mockResolvedValue({ data: [{ id: "L-cr", slug: "hero-abc123" }], error: null })
    const row = { id: "cr1", name: "Smaug", species: "dragon", source_image_url: "u", canonical_description: "cd" }
    const res = await publishListing({
      entityType: "creature", sourceRow: row, creatorId: "admin1",
      title: "Smaug", description: "a dragon", category: "mythical", style: "epic", tags: ["dragon"],
      // likenessAttestation is irrelevant for non-character entities — the RPC arg
      // is hard-NULL unless entityType === "character".
      likenessAttestation: false,
    })
    expect(res.slug).toBe("hero-abc123")
    // listingId is a freshly generated UUID on a new publish (the "L-cr" above is
    // only the RPC return id), so assert the adapter routing + preview budget, not it.
    expect(copyEntityAssetsToPrefix).toHaveBeenCalledWith("creature", row, expect.any(String), 4)
    expect(rpc).toHaveBeenCalledWith("publish_community_listing", expect.objectContaining({
      p_entity_type: "creature",
      p_creator_id: "admin1",
      p_likeness_attestation_at: null,
    }))
    expect(accountStorage).toHaveBeenCalledWith("admin1", 50)
  })
})
