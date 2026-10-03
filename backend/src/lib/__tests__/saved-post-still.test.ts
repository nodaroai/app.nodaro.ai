import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/safe-fetch.js", () => ({ safeFetch: vi.fn() }))
vi.mock("@/lib/storage.js", () => ({ isStorageConfigured: vi.fn(() => true) }))
vi.mock("@/lib/media-import.js", () => ({
  readBodyCapped: vi.fn(async () => Buffer.from("img")),
  storeImportedImageBuffer: vi.fn(),
}))
vi.mock("@/lib/asset-delete.js", () => ({ permanentlyDeleteAsset: vi.fn(async () => ({ ok: true, r2Deleted: true })) }))

import type { SocialPost } from "@nodaro/shared"
import { mirrorSavedPostStill, deleteSavedPostStill } from "../saved-post-still.js"
import { supabase } from "../supabase.js"
import { safeFetch } from "../safe-fetch.js"
import { isStorageConfigured } from "../storage.js"
import { storeImportedImageBuffer } from "../media-import.js"
import { permanentlyDeleteAsset } from "../asset-delete.js"

const USER = "00000000-0000-4000-8000-000000000001"
const ASSET = "00000000-0000-4000-8000-0000000000bb"

const fetchMock = safeFetch as ReturnType<typeof vi.fn>
const storeMock = storeImportedImageBuffer as ReturnType<typeof vi.fn>
const deleteMock = permanentlyDeleteAsset as ReturnType<typeof vi.fn>
const fromMock = supabase.from as ReturnType<typeof vi.fn>
const storageMock = isStorageConfigured as ReturnType<typeof vi.fn>

function post(thumbnailUrl?: string): SocialPost {
  return {
    id: "instagram:C1:x",
    platform: "instagram",
    url: "https://www.instagram.com/reel/C1/",
    text: "",
    author: { handle: "maker", name: "Maker" },
    metrics: {},
    media: { kind: "video", ...(thumbnailUrl ? { thumbnailUrl } : {}) },
    hashtags: [],
    extra: {},
  }
}

function assetLookup(data: unknown, error: unknown = null) {
  const qb: Record<string, unknown> = {}
  qb.select = vi.fn(() => qb)
  qb.eq = vi.fn(() => qb)
  qb.maybeSingle = vi.fn(async () => ({ data, error }))
  return qb
}

describe("mirrorSavedPostStill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storageMock.mockReturnValue(true)
  })

  it("copies the still into the saver's storage, out of the media picker", async () => {
    fetchMock.mockResolvedValue({ ok: true })
    storeMock.mockResolvedValue({ ok: true, url: "https://media.example.com/a.jpg", assetId: ASSET })
    const still = await mirrorSavedPostStill(USER, post("https://cdn.example.com/s.jpg"))

    expect(still).toEqual({ assetId: ASSET, url: "https://media.example.com/a.jpg" })
    expect(storeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        uploadSource: "url_import",
        sourceUrl: "https://cdn.example.com/s.jpg",
        filename: "saved-post-instagram-C1-x",
        sourceDetail: "maker",
        inLibrary: false,
      }),
    )
  })

  it("copies nothing for a post without a still, or without storage", async () => {
    expect(await mirrorSavedPostStill(USER, post())).toBeNull()
    storageMock.mockReturnValue(false)
    expect(await mirrorSavedPostStill(USER, post("https://cdn.example.com/s.jpg"))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never throws: a dead link, a refused store or a fetch error are no copy", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })
    expect(await mirrorSavedPostStill(USER, post("https://cdn.example.com/s.jpg"))).toBeNull()

    fetchMock.mockResolvedValueOnce({ ok: true })
    storeMock.mockResolvedValueOnce({ ok: false, status: 413, code: "storage_limit_exceeded", message: "full" })
    expect(await mirrorSavedPostStill(USER, post("https://cdn.example.com/s.jpg"))).toBeNull()

    fetchMock.mockResolvedValueOnce({ ok: true })
    storeMock.mockResolvedValueOnce({ ok: true, url: "https://media.example.com/a.jpg", assetId: null })
    expect(await mirrorSavedPostStill(USER, post("https://cdn.example.com/s.jpg"))).toBeNull()

    fetchMock.mockRejectedValueOnce(new Error("blocked address"))
    expect(await mirrorSavedPostStill(USER, post("http://10.0.0.1/s.jpg"))).toBeNull()
  })
})

describe("deleteSavedPostStill", () => {
  beforeEach(() => vi.clearAllMocks())

  it("deletes the caller's still, keeping bytes a job still reads", async () => {
    const row = { id: ASSET, r2_key: "uploads/images/a.jpg", size_bytes: 10, job_id: null, relay_job_id: null, in_library: false }
    const qb = assetLookup(row)
    fromMock.mockReturnValue(qb)
    await deleteSavedPostStill(USER, ASSET)

    expect(qb.eq).toHaveBeenCalledWith("user_id", USER)
    expect(deleteMock).toHaveBeenCalledWith({ userId: USER, asset: row, blockOnOwnJobReferrers: true })
  })

  it("keeps a still the person has since put in their library", async () => {
    fromMock.mockReturnValue(assetLookup({ id: ASSET, r2_key: "k", size_bytes: 1, in_library: true }))
    await deleteSavedPostStill(USER, ASSET)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it("removes only the row when the storage cleanup already took the bytes", async () => {
    const remove: Record<string, unknown> = {}
    remove.delete = vi.fn(() => remove)
    remove.eq = vi.fn(() => remove)
    remove.then = (resolve: (v: unknown) => unknown) => resolve({ error: null })
    fromMock
      .mockReturnValueOnce(assetLookup({ id: ASSET, r2_key: null, size_bytes: 0, job_id: null, relay_job_id: null, in_library: false }))
      .mockReturnValueOnce(remove)
    await deleteSavedPostStill(USER, ASSET)

    expect(deleteMock).not.toHaveBeenCalled()
    expect(remove.delete).toHaveBeenCalled()
    expect(remove.eq).toHaveBeenCalledWith("id", ASSET)
    expect(remove.eq).toHaveBeenCalledWith("user_id", USER)
  })

  it("never throws when the lookup fails", async () => {
    fromMock.mockReturnValue(assetLookup(null, { message: "down" }))
    await expect(deleteSavedPostStill(USER, ASSET)).resolves.toBeUndefined()
    expect(deleteMock).not.toHaveBeenCalled()
  })
})
