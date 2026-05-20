import { describe, expect, it, vi, beforeEach } from "vitest"

// Mock supabase BEFORE importing the module-under-test.
vi.mock("../supabase.js", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}))

import { supabase } from "../supabase.js"
import {
  attachAssetToObject,
  autoAttachObjectAsset,
  OBJECT_ATTACH_COLUMN_SET,
  setObjectMainImage,
} from "../object-auto-attach.js"

const mockRpc = vi.mocked(supabase.rpc)
const mockFrom = vi.mocked(supabase.from)

describe("OBJECT_ATTACH_COLUMN_SET", () => {
  it("contains the 4 worker-owned column names", () => {
    expect(OBJECT_ATTACH_COLUMN_SET.has("angles")).toBe(true)
    expect(OBJECT_ATTACH_COLUMN_SET.has("materials")).toBe(true)
    expect(OBJECT_ATTACH_COLUMN_SET.has("variations")).toBe(true)
    expect(OBJECT_ATTACH_COLUMN_SET.has("motion_clips")).toBe(true)
  })

  it("rejects non-whitelisted columns", () => {
    expect(OBJECT_ATTACH_COLUMN_SET.has("source_image_url")).toBe(false)
    expect(OBJECT_ATTACH_COLUMN_SET.has("canonical_description")).toBe(false)
    expect(OBJECT_ATTACH_COLUMN_SET.has("reference_photos")).toBe(false)
    expect(OBJECT_ATTACH_COLUMN_SET.has("")).toBe(false)
  })
})

describe("attachAssetToObject", () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it("calls the RPC with mapped param names", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null } as never)
    await attachAssetToObject("obj-1", "angles", { name: "front", url: "https://r2/img.png" })
    expect(mockRpc).toHaveBeenCalledWith("append_object_asset", {
      p_object_id: "obj-1",
      p_column: "angles",
      p_value: { name: "front", url: "https://r2/img.png" },
    })
  })

  it("logs + swallows RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "oops" } } as never)
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(
      attachAssetToObject("obj-1", "materials", { name: "wood", url: "https://r2/img.png" }),
    ).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("oops"))
    warnSpy.mockRestore()
  })

  it("logs + swallows thrown errors", async () => {
    mockRpc.mockRejectedValue(new Error("network failure"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(
      attachAssetToObject("obj-1", "angles", { name: "front", url: "https://r2/img.png" }),
    ).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("network failure"))
    warnSpy.mockRestore()
  })
})

describe("autoAttachObjectAsset", () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockFrom.mockReset()
  })

  const buildOkOwnershipFrom = () =>
    ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "obj-1" } } as never),
    }) as never

  const buildMissingOwnershipFrom = () =>
    ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null } as never),
    }) as never

  it("no-ops when any required arg is missing", async () => {
    mockFrom.mockReturnValue(buildOkOwnershipFrom())
    await autoAttachObjectAsset({ objectId: undefined, column: "angles", name: "x", userId: "u", url: "https://r2/" })
    await autoAttachObjectAsset({ objectId: "o", column: undefined, name: "x", userId: "u", url: "https://r2/" })
    await autoAttachObjectAsset({ objectId: "o", column: "angles", name: undefined, userId: "u", url: "https://r2/" })
    await autoAttachObjectAsset({ objectId: "o", column: "angles", name: "x", userId: undefined, url: "https://r2/" })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("no-ops when column is not in the whitelist", async () => {
    mockFrom.mockReturnValue(buildOkOwnershipFrom())
    await autoAttachObjectAsset({ objectId: "o", column: "expressions", name: "x", userId: "u", url: "https://r2/" })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("no-ops when ownership check returns no row", async () => {
    mockFrom.mockReturnValue(buildMissingOwnershipFrom())
    await autoAttachObjectAsset({ objectId: "o", column: "angles", name: "x", userId: "u", url: "https://r2/" })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("calls the RPC after a successful ownership re-query", async () => {
    mockFrom.mockReturnValue(buildOkOwnershipFrom())
    mockRpc.mockResolvedValue({ data: null, error: null } as never)
    await autoAttachObjectAsset({
      objectId: "obj-1",
      column: "angles",
      name: "front",
      userId: "user-1",
      url: "https://r2/img.png",
    })
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith("append_object_asset", {
      p_object_id: "obj-1",
      p_column: "angles",
      p_value: { name: "front", url: "https://r2/img.png" },
    })
  })
})

describe("setObjectMainImage", () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  const buildOkUpdate = () => ({
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ error: null } as never),
  })

  const buildErrUpdate = (message: string) => ({
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ error: { message } } as never),
  })

  it("UPDATEs source_image_url with ownership + soft-delete guard", async () => {
    const chain = buildOkUpdate()
    mockFrom.mockReturnValue(chain as never)
    const ok = await setObjectMainImage({
      objectId: "obj-1",
      userId: "user-1",
      url: "https://r2/img.png",
    })
    expect(ok).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith("objects")
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ source_image_url: "https://r2/img.png" }),
    )
    // Verify .eq("id", "obj-1") + .eq("user_id", "user-1") + .is("deleted_at", null) chain
    expect(chain.eq).toHaveBeenCalledTimes(2)
    expect(chain.eq).toHaveBeenNthCalledWith(1, "id", "obj-1")
    expect(chain.eq).toHaveBeenNthCalledWith(2, "user_id", "user-1")
    expect(chain.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("swallows + logs supabase errors and returns false", async () => {
    mockFrom.mockReturnValue(buildErrUpdate("permission denied") as never)
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const ok = await setObjectMainImage({
      objectId: "obj-1",
      userId: "user-1",
      url: "https://r2/img.png",
    })
    expect(ok).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("permission denied"))
    warnSpy.mockRestore()
  })

  it("swallows + logs thrown errors and returns false", async () => {
    const chain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockRejectedValue(new Error("network failure")),
    }
    mockFrom.mockReturnValue(chain as never)
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const ok = await setObjectMainImage({
      objectId: "obj-1",
      userId: "user-1",
      url: "https://r2/img.png",
    })
    expect(ok).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("network failure"))
    warnSpy.mockRestore()
  })

  it("sets explicit updated_at (belt-and-braces alongside trigger)", async () => {
    const chain = buildOkUpdate()
    mockFrom.mockReturnValue(chain as never)
    await setObjectMainImage({
      objectId: "obj-1",
      userId: "user-1",
      url: "https://r2/img.png",
    })
    const updateArg = chain.update.mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO timestamp
  })
})
