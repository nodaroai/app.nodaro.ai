import { describe, it, expect, vi, beforeEach } from "vitest"

const purgeUpdate = vi.fn()
vi.mock("../../../../lib/supabase.js", () => ({ supabase: { from: vi.fn(() => purgeUpdate()) } }))
vi.mock("../../../../lib/storage.js", () => ({
  listObjectsByPrefix: vi.fn().mockResolvedValue(["community/L1/a", "community/L1/b"]),
  batchDeleteFromR2: vi.fn().mockResolvedValue({ deleted: 2, errors: 0 }),
  copyR2ObjectToPrefix: vi.fn(),
}))
vi.mock("../../../../utils/file-validation.js", () => ({ refundStorage: vi.fn() }))

import { purgeCommunityListingBlobs, copyEntityAssetsToPrefix } from "../asset-lifecycle.js"
import { listObjectsByPrefix, batchDeleteFromR2, copyR2ObjectToPrefix } from "../../../../lib/storage.js"
import { refundStorage } from "../../../../utils/file-validation.js"

beforeEach(() => vi.clearAllMocks())

function mockClaim(rows: Array<{ published_bytes: number; creator_id: string }>) {
  const select = vi.fn().mockResolvedValue({ data: rows })
  const is = vi.fn().mockReturnValue({ select })
  const eq = vi.fn().mockReturnValue({ is })
  const update = vi.fn().mockReturnValue({ eq })
  purgeUpdate.mockReturnValue({ update })
}

describe("copyEntityAssetsToPrefix — nested by-variant maps", () => {
  it("copies every URL inside a Record<string,string[]> field", async () => {
    vi.mocked(copyR2ObjectToPrefix).mockImplementation(
      async (url: string) => ({ url: `copied:${url}`, bytes: 1 }),
    )
    const row = { reference_videos_by_variant: { smile: ["a", "b"], angry: ["c"] } }
    const { copiedAssets } = await copyEntityAssetsToPrefix(
      "character", row as Record<string, unknown>, "L1", 8,
    )
    expect(copiedAssets.reference_videos_by_variant).toEqual({
      smile: ["copied:a", "copied:b"],
      angry: ["copied:c"],
    })
  })

  it("does NOT push video URLs into previewImages", async () => {
    vi.mocked(copyR2ObjectToPrefix).mockImplementation(
      async (url: string) => ({ url: `copied:${url}`, bytes: 1 }),
    )
    const row = { reference_videos_by_variant: { smile: ["a"] } }
    const { previewImages } = await copyEntityAssetsToPrefix(
      "character", row as Record<string, unknown>, "L1", 8,
    )
    expect(previewImages).toEqual([])
  })
})

describe("purgeCommunityListingBlobs", () => {
  it("claims, deletes, refunds once", async () => {
    mockClaim([{ published_bytes: 100, creator_id: "admin1" }])
    await purgeCommunityListingBlobs("L1")
    expect(listObjectsByPrefix).toHaveBeenCalledWith("community/L1/")
    expect(batchDeleteFromR2).toHaveBeenCalledWith(["community/L1/a", "community/L1/b"])
    expect(refundStorage).toHaveBeenCalledWith("admin1", 100)
  })
  it("no-ops when already purged (CAS returns 0 rows)", async () => {
    mockClaim([])
    await purgeCommunityListingBlobs("L1")
    expect(batchDeleteFromR2).not.toHaveBeenCalled()
    expect(refundStorage).not.toHaveBeenCalled()
  })
})
