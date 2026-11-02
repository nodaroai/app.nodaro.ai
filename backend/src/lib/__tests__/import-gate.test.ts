/**
 * The import gate (lib/import-gate.ts): the site's policy first, then the
 * rights check, nothing written; the write half spends the confirmation sent,
 * or derives one from a standing authorization for a key's or an agent's
 * import, and answers the one the download runs under; a refusal is one of
 * the two gate errors.
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
  contentRightsRequired: vi.fn().mockResolvedValue(false),
  coversStandingAuthorization: (via: unknown) => via === "api" || via === "app" || via === "mcp",
  deriveAndConsumeConfirmation: vi.fn().mockResolvedValue("derived-1"),
}))

import { isImportRefusal, requireImportAllowed, spendImportConfirmation } from "../import-gate.js"
import { ImportSourceError, assertImportSourceAllowed } from "../import-source-policy.js"
import { ContentRightsError, checkRightsConfirmation, consumeRightsConfirmation, contentRightsRequired, deriveAndConsumeConfirmation } from "../content-rights.js"

const URL_ = "https://www.tiktok.com/@someone/video/1"
const ID = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"

beforeEach(() => vi.clearAllMocks())

describe("requireImportAllowed", () => {
  it("asks the site's policy first, then the rights check with the account, the confirmation, the lane and the way in", async () => {
    await requireImportAllowed(URL_, { userId: "u1", confirmationId: ID, lane: "route" })
    expect(assertImportSourceAllowed).toHaveBeenCalledWith(URL_)
    expect(checkRightsConfirmation).toHaveBeenCalledWith({ url: URL_, userId: "u1", confirmationId: ID, lane: "route", via: null })
    expect(vi.mocked(assertImportSourceAllowed).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(checkRightsConfirmation).mock.invocationCallOrder[0]!)
    expect(consumeRightsConfirmation).not.toHaveBeenCalled()
    expect(deriveAndConsumeConfirmation).not.toHaveBeenCalled()

    await requireImportAllowed(URL_, { userId: "u1", lane: "run", via: "mcp" })
    expect(checkRightsConfirmation).toHaveBeenLastCalledWith(expect.objectContaining({ confirmationId: undefined, via: "mcp" }))
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
  it("spends the confirmation sent with the lane and request, answers it, and never derives one beside it", async () => {
    await expect(spendImportConfirmation(URL_, { userId: "u1", confirmationId: ID, lane: "route", requestId: "req-1", via: "api" })).resolves.toBe(ID)
    expect(consumeRightsConfirmation).toHaveBeenCalledWith({ confirmationId: ID, url: URL_, lane: "route", requestId: "req-1" })
    expect(deriveAndConsumeConfirmation).not.toHaveBeenCalled()
  })

  it("without one: a session's or an unnamed import spends nothing and runs under none", async () => {
    await expect(spendImportConfirmation(URL_, { userId: "u1", lane: "route" })).resolves.toBeNull()
    await expect(spendImportConfirmation(URL_, { userId: "u1", confirmationId: null, lane: "route", via: "session" })).resolves.toBeNull()
    await expect(spendImportConfirmation(URL_, { userId: "u1", lane: "run", via: null })).resolves.toBeNull()
    expect(consumeRightsConfirmation).not.toHaveBeenCalled()
    expect(deriveAndConsumeConfirmation).not.toHaveBeenCalled()
  })

  it("without one: a key's, an app's or an agent's import derives one from the standing authorization, with the app grant and the request", async () => {
    for (const via of ["api", "app", "mcp"] as const) {
      vi.mocked(deriveAndConsumeConfirmation).mockClear()
      await expect(
        spendImportConfirmation(URL_, { userId: "u1", lane: "route", requestId: "job-1", via, appId: via === "app" ? "app-1" : null, authorizationId: via === "app" ? "grant-1" : null }),
      ).resolves.toBe("derived-1")
      expect(deriveAndConsumeConfirmation).toHaveBeenCalledWith({
        userId: "u1",
        url: URL_,
        via,
        requestId: "job-1",
        appId: via === "app" ? "app-1" : null,
        authorizationId: via === "app" ? "grant-1" : null,
      })
    }
    expect(consumeRightsConfirmation).not.toHaveBeenCalled()
  })

  it("no standing authorization: the import runs under none while the setting is off, and is refused once it is on (a revoke during the slot wait)", async () => {
    vi.mocked(deriveAndConsumeConfirmation).mockResolvedValueOnce(null)
    await expect(spendImportConfirmation(URL_, { userId: "u1", lane: "route", via: "api" })).resolves.toBeNull()
    vi.mocked(deriveAndConsumeConfirmation).mockResolvedValueOnce(null)
    vi.mocked(contentRightsRequired).mockResolvedValueOnce(true)
    await expect(spendImportConfirmation(URL_, { userId: "u1", lane: "run", via: "mcp" })).rejects.toMatchObject({ code: "rights_authorization_required" })
    // A derived confirmation needs no look at the setting.
    vi.mocked(contentRightsRequired).mockClear()
    await expect(spendImportConfirmation(URL_, { userId: "u1", lane: "run", via: "mcp" })).resolves.toBe("derived-1")
    expect(contentRightsRequired).not.toHaveBeenCalled()
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
