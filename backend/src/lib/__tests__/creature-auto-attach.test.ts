import { describe, it, expect, vi, beforeEach } from "vitest"
const rpc = vi.fn()
const from = vi.fn()
vi.mock("../supabase.js", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }))
import { autoAttachCreatureAsset, setCreatureMainImage } from "../creature-auto-attach.js"
beforeEach(() => { rpc.mockReset(); from.mockReset() })
describe("autoAttachCreatureAsset", () => {
  it("no-ops on a column not in CREATURE_ATTACH_COLUMNS (e.g. 'materials')", async () => {
    await autoAttachCreatureAsset({ creatureId: "c1", column: "materials", name: "x", userId: "u1", url: "http://a" })
    expect(rpc).not.toHaveBeenCalled()
  })
  it("calls append_creature_asset for a valid owned row", async () => {
    from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ single: () => ({ data: { id: "c1" } }) }) }) }) }) })
    rpc.mockResolvedValue({ error: null })
    await autoAttachCreatureAsset({ creatureId: "c1", column: "poses", name: "sit", userId: "u1", url: "http://a" })
    expect(rpc).toHaveBeenCalledWith("append_creature_asset", expect.objectContaining({ p_creature_id: "c1", p_column: "poses" }))
  })
  it("setCreatureMainImage updates source_image_url for the owned row", async () => {
    const update = vi.fn().mockReturnValue({ eq: () => ({ eq: () => ({ is: () => ({ error: null }) }) }) })
    from.mockReturnValue({ update })
    const ok = await setCreatureMainImage({ creatureId: "c1", userId: "u1", url: "http://hero" })
    expect(ok).toBe(true)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ source_image_url: "http://hero" }))
  })
})
