import { describe, it, expect, vi, beforeEach } from "vitest"

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock("../../../../lib/supabase.js", () => ({ supabase: { from, rpc } }))
vi.mock("../../../../utils/file-validation.js", () => ({
  reserveStorageIfWithinLimit: vi.fn().mockResolvedValue(true), refundStorage: vi.fn(),
}))
vi.mock("../../../../lib/default-project.js", () => ({
  ensureDefaultProject: vi.fn().mockResolvedValue({ projectId: "proj1" }),
}))
vi.mock("../../../../lib/entity-naming.js", () => ({ deriveAvailableName: vi.fn().mockResolvedValue("Hero (community)") }))
vi.mock("../../../../lib/storage.js", () => ({
  copyR2ObjectToPrefix: vi.fn().mockResolvedValue({ url: "CC", bytes: 10 }),
  batchDeleteFromR2: vi.fn(),
  r2KeyFromOurUrl: vi.fn().mockReturnValue("key"),
}))
import { cloneListing } from "../clone.js"
import { reserveStorageIfWithinLimit, refundStorage } from "../../../../utils/file-validation.js"
import { copyR2ObjectToPrefix } from "../../../../lib/storage.js"

beforeEach(() => vi.clearAllMocks())

function mockSnapshotAndInsert(snapshot: unknown, insertOk: boolean) {
  from.mockImplementation((table: string) => {
    if (table === "community_listings") {
      const single = vi.fn().mockResolvedValue({ data: { is_active: true } })
      return { select: () => ({ eq: () => ({ single }) }) }
    }
    if (table === "community_listing_snapshots") {
      const single = vi.fn().mockResolvedValue({ data: { snapshot } })
      return { select: () => ({ eq: () => ({ single }) }) }
    }
    const single = vi.fn().mockResolvedValue(insertOk ? { data: { id: "new1" }, error: null } : { data: null, error: { message: "boom" } })
    return { insert: () => ({ select: () => ({ single }) }) }
  })
}

describe("cloneListing", () => {
  it("reserves, copies, inserts, records", async () => {
    mockSnapshotAndInsert({ name: "Hero", source_image_url: "u" }, true)
    rpc.mockResolvedValue({ data: 5, error: null })
    const res = await cloneListing({ listingId: "L1", entityType: "character", userId: "u1" })
    expect(res.id).toBe("new1")
    expect(reserveStorageIfWithinLimit).toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith("record_clone", expect.objectContaining({ p_listing_id: "L1", p_user_id: "u1" }))
  })
  it("refunds reservation when the entity insert fails", async () => {
    mockSnapshotAndInsert({ name: "Hero", source_image_url: "u" }, false)
    await expect(cloneListing({ listingId: "L1", entityType: "character", userId: "u1" })).rejects.toThrow()
    expect(refundStorage).toHaveBeenCalled()
  })
  it("re-copies emotion-clip URLs inside reference_videos_by_variant", async () => {
    mockSnapshotAndInsert(
      { name: "Hero", reference_videos_by_variant: { smile: ["x", "y"] } },
      true,
    )
    await cloneListing({ listingId: "L1", entityType: "character", userId: "u1" })
    expect(copyR2ObjectToPrefix).toHaveBeenCalledWith("x", expect.any(String))
    expect(copyR2ObjectToPrefix).toHaveBeenCalledWith("y", expect.any(String))
  })
  it("rejects with listing_unavailable when the listing is inactive (no clone recorded)", async () => {
    from.mockImplementation((table: string) => {
      if (table === "community_listings") {
        const single = vi.fn().mockResolvedValue({ data: { is_active: false } })
        return { select: () => ({ eq: () => ({ single }) }) }
      }
      throw new Error(`unexpected table access: ${table}`)
    })
    await expect(
      cloneListing({ listingId: "L1", entityType: "character", userId: "u1" }),
    ).rejects.toMatchObject({ code: "listing_unavailable" })
    expect(reserveStorageIfWithinLimit).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it("clones a creature: inserts into the creatures table + copies the poses asset slot", async () => {
    const insertedTables: string[] = []
    from.mockImplementation((table: string) => {
      if (table === "community_listings") {
        const single = vi.fn().mockResolvedValue({ data: { is_active: true } })
        return { select: () => ({ eq: () => ({ single }) }) }
      }
      if (table === "community_listing_snapshots") {
        const single = vi.fn().mockResolvedValue({
          data: { snapshot: { name: "Smaug", species: "dragon", main_image_url: "m", poses: [{ name: "coiled", url: "p" }] } },
        })
        return { select: () => ({ eq: () => ({ single }) }) }
      }
      insertedTables.push(table)
      const single = vi.fn().mockResolvedValue({ data: { id: "cr-new" }, error: null })
      return { insert: () => ({ select: () => ({ single }) }) }
    })
    rpc.mockResolvedValue({ data: 1, error: null })
    const res = await cloneListing({ listingId: "L-cr", entityType: "creature", userId: "u1" })
    expect(res).toEqual({ entityType: "creature", id: "cr-new" })
    // The entity row landed in the creatures table (adapter.table = "creatures").
    expect(insertedTables).toContain("creatures")
    // poses is a creature assetField (the renamed object materials slot) → its url is re-copied.
    expect(copyR2ObjectToPrefix).toHaveBeenCalledWith("m", expect.any(String))
    expect(copyR2ObjectToPrefix).toHaveBeenCalledWith("p", expect.any(String))
    expect(rpc).toHaveBeenCalledWith("record_clone", expect.objectContaining({
      p_listing_id: "L-cr", p_user_id: "u1", p_entity_type: "creature", p_new_entity_id: "cr-new",
    }))
  })
})
