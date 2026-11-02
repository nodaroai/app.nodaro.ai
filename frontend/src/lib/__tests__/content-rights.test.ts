// The declaration as the page holds it: read once for every box, and one
// confirmation per download; a changed declaration is read again and unticks.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, renderHook } from "@testing-library/react"

const declaration = vi.fn()
const confirm = vi.fn()
vi.mock("@/lib/nodaro-client", () => ({
  nodaroClient: { contentRights: { declaration: (...a: unknown[]) => declaration(...a), confirm: (...a: unknown[]) => confirm(...a) } },
}))

import { DeclarationChangedError, __resetContentRightsForTests, confirmLink, loadDeclaration, reloadDeclaration, useRightsDeclaration } from "../content-rights"

const TIKTOK = "https://www.tiktok.com/@someone/video/7676964064458738952"
const TEXT = { version: 3, text: "I hold the rights." }
const CONFIRMATION = { id: "conf-1", declarationVersion: 3, expiresAt: "2099-01-01T00:00:00.000Z" }

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetContentRightsForTests()
  declaration.mockResolvedValue(TEXT)
  confirm.mockResolvedValue(CONFIRMATION)
})

describe("the declaration", () => {
  it("is read once, however many ask, and answered from memory after", async () => {
    const pending = deferred<typeof TEXT>()
    declaration.mockReturnValue(pending.promise)
    const first = loadDeclaration()
    const second = loadDeclaration()
    pending.resolve(TEXT)
    expect(await first).toEqual(TEXT)
    expect(await second).toEqual(TEXT)
    expect(await loadDeclaration()).toEqual(TEXT)
    expect(declaration).toHaveBeenCalledTimes(1)
  })

  it("the hook reads it on first use and follows it: loading, then ready; failed, then read again on request", async () => {
    const pending = deferred<typeof TEXT>()
    declaration.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useRightsDeclaration())
    expect(result.current).toEqual({ status: "loading" })
    await act(async () => {
      pending.resolve(TEXT)
      await pending.promise
    })
    expect(result.current).toEqual({ status: "ready", declaration: TEXT })

    __resetContentRightsForTests()
    declaration.mockRejectedValueOnce(new Error("offline"))
    const failed = renderHook(() => useRightsDeclaration())
    await act(async () => {
      await Promise.resolve()
    })
    expect(failed.result.current).toEqual({ status: "failed" })
    await act(async () => {
      reloadDeclaration()
      await Promise.resolve()
    })
    expect(failed.result.current).toEqual({ status: "ready", declaration: TEXT })
  })
})

describe("confirmLink", () => {
  it("confirms the version the person saw and answers the confirmation", async () => {
    expect(await confirmLink(TIKTOK)).toEqual(CONFIRMATION)
    expect(confirm).toHaveBeenCalledWith({ url: TIKTOK, declarationVersion: 3 })
  })

  it("a declaration that changed under the page is read again, and the caller is told to untick", async () => {
    await loadDeclaration()
    confirm.mockRejectedValueOnce(Object.assign(new Error("stale"), { code: "rights_confirmation_stale" }))
    declaration.mockResolvedValueOnce({ version: 4, text: "New text." })
    await expect(confirmLink(TIKTOK)).rejects.toBeInstanceOf(DeclarationChangedError)
    expect(await loadDeclaration()).toEqual({ version: 4, text: "New text." })
    expect(declaration).toHaveBeenCalledTimes(2)
  })

  it("any other refusal is passed on as it is, and the declaration kept", async () => {
    await loadDeclaration()
    confirm.mockRejectedValueOnce(new Error("Authentication required"))
    await expect(confirmLink(TIKTOK)).rejects.toThrow("Authentication required")
    expect(declaration).toHaveBeenCalledTimes(1)
  })
})
