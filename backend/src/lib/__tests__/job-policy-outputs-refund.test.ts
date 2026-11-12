/**
 * A result-gate block deletes every object the job owns (`deleteOwnedObjects`)
 * and — with `refundOwner` — gives the bytes storage confirmed deleted back to
 * the job owner's storage: they were counted when the job stored them, and
 * nothing will ever name them now. Nothing is given back for a key storage
 * kept, nor where deletes are skipped (the files stay).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  deleteKeys: vi.fn(),
  size: vi.fn(),
  updateStorageUsage: vi.fn(async () => {}),
  skipped: vi.fn(() => false),
  owner: { user_id: "u1" } as { user_id: string | null },
}))

vi.mock("@/lib/storage-delete.js", () => ({ deleteKeysRecordingFailures: m.deleteKeys }))
vi.mock("@/lib/storage.js", () => ({ getR2ObjectSize: m.size, r2KeyFromOurUrl: (u: string) => u.replace("https://r2.example/", "") }))
vi.mock("@/lib/storage-deletes-setting.js", () => ({ storageDeletesSkipped: m.skipped }))
vi.mock("@/lib/withheld-objects-private.js", () => ({ keepWithheldObjectsPrivate: vi.fn(async () => {}) }))
vi.mock("@/utils/file-validation.js", () => ({ updateStorageUsage: m.updateStorageUsage }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: m.owner, error: null }) }) }) }) },
}))

import { deleteOwnedObjects } from "@/lib/job-policy-outputs.js"

const SIZES: Record<string, number> = { "images/j1.png": 1000, "images/j1-layers-1.png": 100, "images/j1-layers-2.png": 100 }
const objects = Object.keys(SIZES).map((key, index) => ({ key, kind: "image" as const, index }))

beforeEach(() => {
  vi.clearAllMocks()
  m.owner = { user_id: "u1" }
  m.skipped.mockReturnValue(false)
  m.size.mockImplementation(async (key: string) => SIZES[key] ?? 0)
  m.deleteKeys.mockImplementation(async (keys: string[]) => ({ deleted: keys.length, errors: 0, notDeleted: [], kept: [], failed: [] }))
})

describe("deleteOwnedObjects — giving the owner's storage back", () => {
  it("refundOwner: the bytes of every deleted object go back to the owner, once", async () => {
    await expect(deleteOwnedObjects("j1", objects, { refundOwner: true })).resolves.toBe(3)
    expect(m.updateStorageUsage).toHaveBeenCalledTimes(1)
    expect(m.updateStorageUsage).toHaveBeenCalledWith("u1", -1200)
  })

  it("a key storage did not delete gives nothing back (it is recorded for the retry pass)", async () => {
    m.deleteKeys.mockImplementationOnce(async (keys: string[]) => ({ deleted: keys.length - 1, errors: 1, notDeleted: ["images/j1.png"], kept: [], failed: ["images/j1.png"] }))
    await deleteOwnedObjects("j1", objects, { refundOwner: true })
    expect(m.updateStorageUsage).toHaveBeenCalledWith("u1", -200)
  })

  it("where deletes are skipped nothing is given back: the files stay", async () => {
    m.skipped.mockReturnValue(true)
    await deleteOwnedObjects("j1", objects, { refundOwner: true })
    expect(m.size).not.toHaveBeenCalled()
    expect(m.updateStorageUsage).not.toHaveBeenCalled()
  })

  it("without refundOwner (review reject, withdraw) nothing is sized or given back, as before", async () => {
    await deleteOwnedObjects("j1", objects)
    expect(m.size).not.toHaveBeenCalled()
    expect(m.updateStorageUsage).not.toHaveBeenCalled()
  })

  it("a job with no owner on record gives nothing back", async () => {
    m.owner = { user_id: null }
    await deleteOwnedObjects("j1", objects, { refundOwner: true })
    expect(m.updateStorageUsage).not.toHaveBeenCalled()
  })
})
