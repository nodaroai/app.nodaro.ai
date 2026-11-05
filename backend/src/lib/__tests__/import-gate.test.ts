/**
 * The import gate (lib/import-gate.ts): a measure on the account first, then
 * the site's policy, then the rights check, nothing written; the write half
 * asks the account's measures again, then spends the confirmation sent, or
 * derives one from a standing authorization for a key's or an agent's
 * import, and answers the one the download runs under; a refusal is one of
 * the three gate errors. The plugin lane passes both halves without the
 * rights part: measures and the site's policy only, nothing read, spent or
 * counted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../account-measures.js", () => ({ assertImportsAllowed: vi.fn().mockResolvedValue(undefined) }))

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
vi.mock("../unconfirmed-imports.js", () => ({ recordUnconfirmedImport: vi.fn().mockResolvedValue(undefined) }))

import {
  ImportOwnerUnknownError,
  isImportRefusal,
  laneExemptFromRights,
  requireAccountlessImportAllowed,
  requireImportAllowed,
  spendImportConfirmation,
} from "../import-gate.js"
import { recordUnconfirmedImport } from "../unconfirmed-imports.js"
import { assertImportsAllowed } from "../account-measures.js"
import { AccountMeasureError } from "../account-measure-error.js"
import { ImportSourceError, assertImportSourceAllowed } from "../import-source-policy.js"
import { ContentRightsError, checkRightsConfirmation, consumeRightsConfirmation, contentRightsRequired, deriveAndConsumeConfirmation } from "../content-rights.js"

const URL_ = "https://www.tiktok.com/@someone/video/1"
const ID = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"

beforeEach(() => {
  vi.clearAllMocks()
  // Calls are cleared above, implementations are not: a test that turns the setting on must not leave it on.
  vi.mocked(contentRightsRequired).mockResolvedValue(false)
})

describe("requireImportAllowed", () => {
  it("asks the account's measures first, then the site's policy, then the rights check with the account, the confirmation, the lane and the way in", async () => {
    await requireImportAllowed(URL_, { userId: "u1", confirmationId: ID, lane: "route" })
    expect(assertImportsAllowed).toHaveBeenCalledWith("u1")
    expect(vi.mocked(assertImportsAllowed).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(assertImportSourceAllowed).mock.invocationCallOrder[0]!)
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

  it("an account whose imports are blocked is refused before the site or the rights are read", async () => {
    vi.mocked(assertImportsAllowed).mockRejectedValueOnce(new AccountMeasureError("2026-12-03T10:00:00.000Z", "imports_blocked"))
    const refusal = await requireImportAllowed(URL_, { userId: "u1", confirmationId: ID, lane: "route" }).catch((e: unknown) => e)
    expect(refusal).toBeInstanceOf(AccountMeasureError)
    expect(refusal).toMatchObject({ code: "imports_blocked", deterministic: true })
    expect(isImportRefusal(refusal)).toBe(true)
    expect(assertImportSourceAllowed).not.toHaveBeenCalled()
    expect(checkRightsConfirmation).not.toHaveBeenCalled()
  })

  it("a record that could not be read fails the import: never let through unread", async () => {
    vi.mocked(assertImportsAllowed).mockRejectedValueOnce(new Error("Account measures read failed: timeout"))
    const failure = await requireImportAllowed(URL_, { userId: "u1", lane: "route" }).catch((e: unknown) => e)
    expect(failure).toMatchObject({ message: "Account measures read failed: timeout" })
    expect(isImportRefusal(failure)).toBe(false)
    expect(checkRightsConfirmation).not.toHaveBeenCalled()
  })
})

describe("spendImportConfirmation", () => {
  it("asks the account's measures again first: a block applied while the download waited is refused before anything is spent", async () => {
    vi.mocked(assertImportsAllowed).mockRejectedValueOnce(new AccountMeasureError(null, "closed"))
    await expect(spendImportConfirmation(URL_, { userId: "u1", confirmationId: ID, lane: "route", via: "api" })).rejects.toMatchObject({ code: "imports_blocked", measure: "closed" })
    expect(consumeRightsConfirmation).not.toHaveBeenCalled()
    expect(deriveAndConsumeConfirmation).not.toHaveBeenCalled()

    await spendImportConfirmation(URL_, { userId: "u1", confirmationId: ID, lane: "route" })
    expect(assertImportsAllowed).toHaveBeenLastCalledWith("u1")
    expect(vi.mocked(assertImportsAllowed).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(consumeRightsConfirmation).mock.invocationCallOrder[0]!)
  })

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

  it("without one: a session's import is refused, and not counted, once the setting is on (it turned on while the download waited)", async () => {
    vi.mocked(contentRightsRequired).mockResolvedValueOnce(true)
    const refused = spendImportConfirmation(URL_, { userId: "u1", lane: "route", via: "session" })
    await expect(refused).rejects.toBeInstanceOf(ContentRightsError)
    await expect(spendImportConfirmation(URL_, { userId: "u1", lane: "route", via: "session" })).resolves.toBeNull()
    vi.mocked(contentRightsRequired).mockResolvedValueOnce(true)
    await expect(spendImportConfirmation(URL_, { userId: "u1", lane: "run" })).rejects.toMatchObject({ code: "rights_confirmation_required" })
    expect(recordUnconfirmedImport).toHaveBeenCalledTimes(1)
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

  describe("an import that goes ahead with no confirmation is counted (lib/unconfirmed-imports.ts)", () => {
    it("a session's or an unnamed import: counted with its account (for the count's cap), link, lane, way in, app and request", async () => {
      await spendImportConfirmation(URL_, { userId: "u1", lane: "route", requestId: "req-1", via: "session" })
      expect(recordUnconfirmedImport).toHaveBeenCalledWith({ userId: "u1", url: URL_, lane: "route", via: "session", appId: null, requestId: "req-1" })
      await spendImportConfirmation(URL_, { userId: "u1", lane: "run" })
      expect(recordUnconfirmedImport).toHaveBeenLastCalledWith({ userId: "u1", url: URL_, lane: "run", via: null, appId: null, requestId: null })
    })

    it("a key's, an app's or an agent's import with no standing authorization, while the setting is off: counted", async () => {
      vi.mocked(deriveAndConsumeConfirmation).mockResolvedValueOnce(null)
      await spendImportConfirmation(URL_, { userId: "u1", lane: "route", requestId: "job-1", via: "app", appId: "app-1" })
      expect(recordUnconfirmedImport).toHaveBeenCalledWith({ userId: "u1", url: URL_, lane: "route", via: "app", appId: "app-1", requestId: "job-1" })
    })

    it("an import that carried one, sent or derived, or that is refused, is not counted", async () => {
      await spendImportConfirmation(URL_, { userId: "u1", confirmationId: ID, lane: "route" })
      await spendImportConfirmation(URL_, { userId: "u1", lane: "route", via: "api" })
      vi.mocked(deriveAndConsumeConfirmation).mockResolvedValueOnce(null)
      vi.mocked(contentRightsRequired).mockResolvedValueOnce(true)
      await expect(spendImportConfirmation(URL_, { userId: "u1", lane: "run", via: "mcp" })).rejects.toMatchObject({ code: "rights_authorization_required" })
      vi.mocked(assertImportsAllowed).mockRejectedValueOnce(new AccountMeasureError(null, "closed"))
      await expect(spendImportConfirmation(URL_, { userId: "u1", lane: "route" })).rejects.toMatchObject({ code: "imports_blocked" })
      expect(recordUnconfirmedImport).not.toHaveBeenCalled()
    })

    it("the import never waits for the count: a count that never answers holds up no step", async () => {
      const never = (): Promise<void> => new Promise(() => undefined)
      const settles = (step: Promise<unknown>) =>
        Promise.race([step.then(() => "settled"), new Promise((resolve) => setTimeout(() => resolve("held up"), 100))])
      vi.mocked(recordUnconfirmedImport).mockReturnValueOnce(never()).mockReturnValueOnce(never()).mockReturnValueOnce(never())
      await expect(settles(spendImportConfirmation(URL_, { userId: "u1", lane: "route", via: "session" }))).resolves.toBe("settled")
      vi.mocked(deriveAndConsumeConfirmation).mockResolvedValueOnce(null)
      await expect(settles(spendImportConfirmation(URL_, { userId: "u1", lane: "route", via: "api" }))).resolves.toBe("settled")
      await expect(settles(requireAccountlessImportAllowed(URL_, "route"))).resolves.toBe("settled")
      expect(recordUnconfirmedImport).toHaveBeenCalledTimes(3)
    })
  })
})

describe("isImportRefusal", () => {
  it("is true for the three gate errors only", () => {
    expect(isImportRefusal(new AccountMeasureError(null, "imports_blocked"))).toBe(true)
    expect(isImportRefusal(new ImportSourceError())).toBe(true)
    expect(isImportRefusal(new ContentRightsError("rights_confirmation_used", "x"))).toBe(true)
    expect(isImportRefusal(new Error("yt-dlp failed"))).toBe(false)
    expect(isImportRefusal(null)).toBe(false)
    // An import whose account could not be read is not the person's refusal: it may be tried again.
    expect(isImportRefusal(new ImportOwnerUnknownError())).toBe(false)
  })
})

describe("an import with no account behind it", () => {
  it("a job whose owner could not be read never passes either half, and nothing is read, spent or counted", async () => {
    await expect(requireImportAllowed(URL_, { userId: "", confirmationId: ID, lane: "route" })).rejects.toBeInstanceOf(ImportOwnerUnknownError)
    await expect(spendImportConfirmation(URL_, { userId: "", confirmationId: ID, lane: "route" })).rejects.toBeInstanceOf(ImportOwnerUnknownError)
    await expect(spendImportConfirmation(URL_, { userId: "", lane: "run" })).rejects.toBeInstanceOf(ImportOwnerUnknownError)
    expect(assertImportsAllowed).not.toHaveBeenCalled()
    expect(assertImportSourceAllowed).not.toHaveBeenCalled()
    expect(checkRightsConfirmation).not.toHaveBeenCalled()
    expect(consumeRightsConfirmation).not.toHaveBeenCalled()
    expect(deriveAndConsumeConfirmation).not.toHaveBeenCalled()
    expect(recordUnconfirmedImport).not.toHaveBeenCalled()
  })

  it("an accountless import in a lane the declaration reaches asks the site's policy, then the rule with no confirmation and no way in, spends nothing, and is counted with no account", async () => {
    await requireAccountlessImportAllowed(URL_, "route")
    expect(assertImportsAllowed).not.toHaveBeenCalled()
    expect(assertImportSourceAllowed).toHaveBeenCalledWith(URL_)
    expect(checkRightsConfirmation).toHaveBeenCalledWith({ url: URL_, userId: "", confirmationId: null, lane: "route", via: null })
    expect(vi.mocked(assertImportSourceAllowed).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(checkRightsConfirmation).mock.invocationCallOrder[0]!)
    expect(consumeRightsConfirmation).not.toHaveBeenCalled()
    expect(deriveAndConsumeConfirmation).not.toHaveBeenCalled()
    expect(recordUnconfirmedImport).toHaveBeenCalledWith({ userId: "", url: URL_, lane: "route", via: null, appId: null, requestId: null })
    expect(vi.mocked(checkRightsConfirmation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(recordUnconfirmedImport).mock.invocationCallOrder[0]!)
  })

  it("an accountless import refused by the site's policy or by the rule is the gate's own refusal, and is not counted", async () => {
    vi.mocked(assertImportSourceAllowed).mockRejectedValueOnce(new ImportSourceError())
    await expect(requireAccountlessImportAllowed(URL_, "route")).rejects.toBeInstanceOf(ImportSourceError)
    expect(checkRightsConfirmation).not.toHaveBeenCalled()
    vi.mocked(checkRightsConfirmation).mockRejectedValueOnce(new ContentRightsError("rights_confirmation_required", "Confirm first."))
    await expect(requireAccountlessImportAllowed(URL_, "route")).rejects.toMatchObject({ code: "rights_confirmation_required" })
    expect(recordUnconfirmedImport).not.toHaveBeenCalled()
  })
})

describe("the plugin lane is exempt from the declaration (a private plugin's own download, decided 2026-11-05)", () => {
  it("names the exempt lane alone", () => {
    expect(laneExemptFromRights("plugin")).toBe(true)
    for (const lane of ["editor", "app", "api", "mcp", "admin", "run", "route"] as const) expect(laneExemptFromRights(lane)).toBe(false)
  })

  it("in a job: the account's measures and the site's policy are asked, the rights never read, nothing spent, nothing counted, whatever the setting says", async () => {
    vi.mocked(contentRightsRequired).mockResolvedValue(true)
    await requireImportAllowed(URL_, { userId: "u1", confirmationId: ID, lane: "plugin", requestId: "job-1" })
    expect(assertImportsAllowed).toHaveBeenCalledWith("u1")
    expect(assertImportSourceAllowed).toHaveBeenCalledWith(URL_)
    expect(checkRightsConfirmation).not.toHaveBeenCalled()

    await expect(spendImportConfirmation(URL_, { userId: "u1", confirmationId: ID, lane: "plugin", requestId: "job-1" })).resolves.toBeNull()
    await expect(spendImportConfirmation(URL_, { userId: "u1", lane: "plugin", requestId: "job-1" })).resolves.toBeNull()
    expect(assertImportsAllowed).toHaveBeenCalledTimes(3)
    expect(consumeRightsConfirmation).not.toHaveBeenCalled()
    expect(deriveAndConsumeConfirmation).not.toHaveBeenCalled()
    expect(contentRightsRequired).not.toHaveBeenCalled()
    expect(recordUnconfirmedImport).not.toHaveBeenCalled()
  })

  it("outside any job: the site's policy alone decides, the rule is never asked, nothing is counted", async () => {
    vi.mocked(contentRightsRequired).mockResolvedValue(true)
    await requireAccountlessImportAllowed(URL_, "plugin")
    expect(assertImportSourceAllowed).toHaveBeenCalledWith(URL_)
    expect(assertImportsAllowed).not.toHaveBeenCalled()
    expect(checkRightsConfirmation).not.toHaveBeenCalled()
    expect(contentRightsRequired).not.toHaveBeenCalled()
    expect(recordUnconfirmedImport).not.toHaveBeenCalled()
  })

  it("the exemption is from the declaration only: a blocked account, a disabled site and an unreadable owner still refuse the plugin lane", async () => {
    vi.mocked(assertImportsAllowed).mockRejectedValueOnce(new AccountMeasureError(null, "imports_blocked"))
    await expect(requireImportAllowed(URL_, { userId: "u1", lane: "plugin" })).rejects.toMatchObject({ code: "imports_blocked" })
    vi.mocked(assertImportsAllowed).mockRejectedValueOnce(new AccountMeasureError(null, "closed"))
    await expect(spendImportConfirmation(URL_, { userId: "u1", lane: "plugin" })).rejects.toMatchObject({ code: "imports_blocked", measure: "closed" })
    vi.mocked(assertImportSourceAllowed).mockRejectedValueOnce(new ImportSourceError())
    await expect(requireImportAllowed(URL_, { userId: "u1", lane: "plugin" })).rejects.toBeInstanceOf(ImportSourceError)
    vi.mocked(assertImportSourceAllowed).mockRejectedValueOnce(new ImportSourceError())
    await expect(requireAccountlessImportAllowed(URL_, "plugin")).rejects.toBeInstanceOf(ImportSourceError)
    await expect(requireImportAllowed(URL_, { userId: "", lane: "plugin" })).rejects.toBeInstanceOf(ImportOwnerUnknownError)
    await expect(spendImportConfirmation(URL_, { userId: "", lane: "plugin" })).rejects.toBeInstanceOf(ImportOwnerUnknownError)
    expect(checkRightsConfirmation).not.toHaveBeenCalled()
    expect(recordUnconfirmedImport).not.toHaveBeenCalled()
  })
})
