/**
 * The MCP flow's copy of an outside picture (`importOutsideImages`) is an
 * import of a link: the gate is read before the fetch, and a refusal keeps
 * the link as it was, like any failed import; nothing is spent (the lane
 * carries no confirmation).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  importImageFromUrl: vi.fn(),
  requireImportAllowed: vi.fn(),
}))

vi.mock("../../../storage.js", () => ({ r2KeyFromOurUrl: (url: string) => (url.includes("pub-test.r2.dev") ? "uploads/x" : null) }))
vi.mock("../../../media-import.js", () => ({ importImageFromUrl: mocks.importImageFromUrl }))
vi.mock("../../../import-gate.js", () => ({ requireImportAllowed: mocks.requireImportAllowed }))

import { importOutsideImages } from "../import-inputs.js"

const OUTSIDE = "https://images.example.com/face.jpg"
const OURS = "https://pub-test.r2.dev/uploads/images/a.jpg"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.importImageFromUrl.mockResolvedValue({ ok: true, url: OURS, assetId: "asset-1", thumbnailUrl: null })
})

describe("importOutsideImages", () => {
  it("reads the gate before the fetch, for the user, on the mcp lane, and copies the picture", async () => {
    const out = await importOutsideImages("u1", [{ kind: "image", url: OUTSIDE } as never, { kind: "image", url: OURS } as never])
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(OUTSIDE, { userId: "u1", lane: "mcp" })
    expect(mocks.requireImportAllowed.mock.invocationCallOrder[0]).toBeLessThan(mocks.importImageFromUrl.mock.invocationCallOrder[0]!)
    expect(mocks.importImageFromUrl).toHaveBeenCalledTimes(1)
    expect(out.get(OUTSIDE)).toEqual({ url: OURS, assetId: "asset-1", thumbnailUrl: null })
  })

  it("a refusal keeps the link as it was and fetches nothing", async () => {
    mocks.requireImportAllowed.mockRejectedValueOnce(new Error("This link can't be imported here."))
    const out = await importOutsideImages("u1", [{ kind: "image", url: OUTSIDE } as never])
    expect(out.size).toBe(0)
    expect(mocks.importImageFromUrl).not.toHaveBeenCalled()
  })
})
