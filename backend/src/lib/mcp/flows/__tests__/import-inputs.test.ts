/**
 * The MCP flow's copy of an outside picture (`importOutsideImages`) is an
 * import of a link by an agent: the gate is read before the fetch on the
 * agent's way in (the account's standing authorization), the confirmation
 * derived from it is spent right before the fetch, and a refusal keeps the
 * link as it was, like any failed import.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  importImageFromUrl: vi.fn(),
  requireImportAllowed: vi.fn(),
  spendImportConfirmation: vi.fn(),
}))

vi.mock("../../../storage.js", () => ({ r2KeyFromOurUrl: (url: string) => (url.includes("pub-test.r2.dev") ? "uploads/x" : null) }))
vi.mock("../../../media-import.js", () => ({ importImageFromUrl: mocks.importImageFromUrl }))
vi.mock("../../../import-gate.js", () => ({ requireImportAllowed: mocks.requireImportAllowed, spendImportConfirmation: mocks.spendImportConfirmation }))

import { importOutsideImages } from "../import-inputs.js"

const OUTSIDE = "https://images.example.com/face.jpg"
const OURS = "https://pub-test.r2.dev/uploads/images/a.jpg"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.importImageFromUrl.mockImplementation(async (_userId: string, _url: string, opts?: { beforeFetch?: () => Promise<void> }) => {
    await opts?.beforeFetch?.()
    return { ok: true, url: OURS, assetId: "asset-1", thumbnailUrl: null }
  })
  mocks.spendImportConfirmation.mockResolvedValue("derived-1")
})

describe("importOutsideImages", () => {
  it("reads the gate before the fetch, for the user, on the agent's way in; spends right before the fetch; copies the picture", async () => {
    const out = await importOutsideImages("u1", [{ kind: "image", url: OUTSIDE } as never, { kind: "image", url: OURS } as never])
    const rights = { userId: "u1", lane: "mcp", via: "mcp" }
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(OUTSIDE, rights)
    expect(mocks.spendImportConfirmation).toHaveBeenCalledWith(OUTSIDE, rights)
    expect(mocks.requireImportAllowed.mock.invocationCallOrder[0]).toBeLessThan(mocks.importImageFromUrl.mock.invocationCallOrder[0]!)
    expect(mocks.importImageFromUrl).toHaveBeenCalledTimes(1)
    expect(out.get(OUTSIDE)).toEqual({ url: OURS, assetId: "asset-1", thumbnailUrl: null })
  })

  it("a refusal keeps the link as it was and fetches nothing — at the read, or at the spend", async () => {
    mocks.requireImportAllowed.mockRejectedValueOnce(new Error("This link can't be imported here."))
    expect((await importOutsideImages("u1", [{ kind: "image", url: OUTSIDE } as never])).size).toBe(0)
    expect(mocks.importImageFromUrl).not.toHaveBeenCalled()

    mocks.spendImportConfirmation.mockRejectedValueOnce(new Error("Authorize first"))
    expect((await importOutsideImages("u1", [{ kind: "image", url: OUTSIDE } as never])).size).toBe(0)
  })
})
