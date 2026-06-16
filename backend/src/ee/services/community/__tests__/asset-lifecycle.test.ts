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

describe("copyEntityAssetsToPrefix — sheets deep-copy (ReferenceSheet nested URLs)", () => {
  it("rewrites url, sourceImageUrlAtGen, every panelUrls entry, and panelSources[].url", async () => {
    vi.mocked(copyR2ObjectToPrefix).mockImplementation(
      async (url: string) => ({ url: `copied:${url}`, bytes: 1 }),
    )
    const row = {
      sheets: [
        {
          id: "s1",
          type: "turnaround",
          url: "https://r2/orig/main.png",
          sourceImageUrlAtGen: "https://r2/orig/src.png",
          panelUrls: ["https://r2/orig/p1.png", "https://r2/orig/p2.png"],
          panelSources: [{ board: "b", variant: "v", url: "https://r2/orig/ps1.png" }],
        },
      ],
    }
    const { copiedAssets, previewImages } = await copyEntityAssetsToPrefix(
      "character", row as Record<string, unknown>, "L1", 8,
    )
    const sheet = (copiedAssets.sheets as Array<Record<string, unknown>>)[0]!
    // Every nested R2 URL deep-copied to the destination prefix.
    expect(sheet.url).toBe("copied:https://r2/orig/main.png")
    expect(sheet.sourceImageUrlAtGen).toBe("copied:https://r2/orig/src.png")
    expect(sheet.panelUrls).toEqual([
      "copied:https://r2/orig/p1.png",
      "copied:https://r2/orig/p2.png",
    ])
    expect((sheet.panelSources as Array<Record<string, unknown>>)[0]!.url).toBe(
      "copied:https://r2/orig/ps1.png",
    )
    // Non-URL fields pass through untouched.
    expect(sheet.id).toBe("s1")
    expect(sheet.type).toBe("turnaround")
    expect((sheet.panelSources as Array<Record<string, unknown>>)[0]!.board).toBe("b")
    // copyUrl invoked for EACH of the 5 nested URLs (top + gen src + 2 panels + 1 panel source).
    expect(copyR2ObjectToPrefix).toHaveBeenCalledTimes(5)
    for (const u of [
      "https://r2/orig/main.png",
      "https://r2/orig/src.png",
      "https://r2/orig/p1.png",
      "https://r2/orig/p2.png",
      "https://r2/orig/ps1.png",
    ]) {
      expect(copyR2ObjectToPrefix).toHaveBeenCalledWith(u, "community/L1/")
    }
    // Only the top-level sheet url seeds the preview set (panels do not).
    expect(previewImages).toEqual(["copied:https://r2/orig/main.png"])
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
