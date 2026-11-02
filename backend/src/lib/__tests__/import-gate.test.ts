/**
 * The import gate (lib/import-gate.ts): the site's policy first, then the
 * rights check, nothing written; the write half spends the confirmation and
 * does nothing without one; a refusal is one of the two gate errors.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../import-source-policy.js", () => ({
  ImportSourceError: class ImportSourceError extends Error {
    readonly code = "import_source_disabled"
    constructor() {
      super("This link can't be imported here.")
    }
  },
  assertImportSourceAllowed: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../content-rights.js", () => ({
  ContentRightsError: class ContentRightsError extends Error {
    constructor(readonly code: string, message: string) {
      super(message)
    }
  },
  checkRightsConfirmation: vi.fn().mockResolvedValue(null),
  consumeRightsConfirmation: vi.fn().mockResolvedValue(undefined),
}))

import { isImportRefusal, requireImportAllowed, spendImportConfirmation } from "../import-gate.js"
import { ImportSourceError, assertImportSourceAllowed } from "../import-source-policy.js"
import { ContentRightsError, checkRightsConfirmation, consumeRightsConfirmation } from "../content-rights.js"

const URL_ = "https://www.tiktok.com/@someone/video/1"
const ID = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"

beforeEach(() => vi.clearAllMocks())

describe("requireImportAllowed", () => {
  it("asks the site's policy first, then the rights check with the account, the confirmation and the lane", async () => {
    await requireImportAllowed(URL_, { userId: "u1", confirmationId: ID, lane: "route" })
    expect(assertImportSourceAllowed).toHaveBeenCalledWith(URL_)
    expect(checkRightsConfirmation).toHaveBeenCalledWith({ url: URL_, userId: "u1", confirmationId: ID, lane: "route" })
    expect(vi.mocked(assertImportSourceAllowed).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(checkRightsConfirmation).mock.invocationCallOrder[0]!)
    expect(consumeRightsConfirmation).not.toHaveBeenCalled()
  })

  it("a disabled site refuses before the rights are read; a rights refusal is the rights error", async () => {
    vi.mocked(assertImportSourceAllowed).mockRejectedValueOnce(new ImportSourceError())
    await expect(requireImportAllowed(URL_, { userId: "u1", lane: "run" })).rejects.toMatchObject({ code: "import_source_disabled" })
    expect(checkRightsConfirmation).not.toHaveBeenCalled()

    vi.mocked(checkRightsConfirmation).mockRejectedValueOnce(new ContentRightsError("rights_confirmation_required", "Confirm first"))
    await expect(requireImportAllowed(URL_, { userId: "u1", lane: "run" })).rejects.toMatchObject({ code: "rights_confirmation_required" })
  })
})

describe("spendImportConfirmation", () => {
  it("spends the confirmation with the lane and request, and does nothing without one", async () => {
    await spendImportConfirmation(URL_, { userId: "u1", lane: "route" })
    await spendImportConfirmation(URL_, { userId: "u1", confirmationId: null, lane: "route" })
    expect(consumeRightsConfirmation).not.toHaveBeenCalled()
    await spendImportConfirmation(URL_, { userId: "u1", confirmationId: ID, lane: "route", requestId: "req-1" })
    expect(consumeRightsConfirmation).toHaveBeenCalledWith({ confirmationId: ID, url: URL_, lane: "route", requestId: "req-1" })
  })
})

describe("isImportRefusal", () => {
  it("is true for the two gate errors only", () => {
    expect(isImportRefusal(new ImportSourceError())).toBe(true)
    expect(isImportRefusal(new ContentRightsError("rights_confirmation_used", "x"))).toBe(true)
    expect(isImportRefusal(new Error("yt-dlp failed"))).toBe(false)
    expect(isImportRefusal(null)).toBe(false)
  })
})
