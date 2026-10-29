/**
 * A picture link is imported with `POST /v1/media/import-url`; any refusal
 * throws (the caller keeps the link as it is), carrying only the platform's
 * status and code, never the server's text, which can quote the remote host's
 * own error. `discardMedia` is best effort.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getSession: mockGetSession } }) }))

import { importMediaUrl, discardMedia, DISCARD_TIMEOUT_MS } from "../api"

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
})

const imported = {
  url: "https://r2.example.test/uploads/images/a.png",
  thumbnailUrl: null,
  assetId: "asset-1",
  mimeType: "image/png",
  sizeBytes: 3,
  filename: "a.png",
  width: 10,
  height: 20,
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } })
})
afterEach(() => vi.unstubAllGlobals())

describe("importMediaUrl", () => {
  it("posts the link with the person's auth and answers the imported file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer(200, { data: imported }))
    vi.stubGlobal("fetch", fetchMock)
    await expect(importMediaUrl("https://example.test/a.png")).resolves.toEqual(imported)
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toMatch(/\/v1\/media\/import-url$/)
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ url: "https://example.test/a.png" })
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok")
  })

  it.each([
    [400, "validation_error"],
    [422, "fetch_failed"],
    [413, "file_too_large"],
    [413, "storage_limit_exceeded"],
    [500, "internal_error"],
  ])("throws on a %i %s, naming only the status and code", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(status, { error: { code, message: "Couldn't fetch that URL: ECONNREFUSED 10.0.0.1" } })))
    const err = await importMediaUrl("https://example.test/a.png").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe(`media import refused: ${status} ${code}`)
  })

  it("throws when the request never reaches the platform", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    await expect(importMediaUrl("https://example.test/a.png")).rejects.toThrow("Failed to fetch")
  })
})

describe("discardMedia", () => {
  it("posts the url to the discard route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer(200, { data: { discarded: true } }))
    vi.stubGlobal("fetch", fetchMock)
    await discardMedia(imported.url)
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toMatch(/\/v1\/media\/discard$/)
    expect(JSON.parse(init.body as string)).toEqual({ url: imported.url })
  })

  it("gives up a discard that is not answered in time, without throwing", async () => {
    const ctrl = new AbortController()
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(ctrl.signal)
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")))
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const pending = discardMedia(imported.url)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(timeout).toHaveBeenCalledWith(DISCARD_TIMEOUT_MS)
    expect(DISCARD_TIMEOUT_MS).toBe(5000)
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).toBe(ctrl.signal)
    ctrl.abort()
    await expect(pending).resolves.toBeUndefined()
    timeout.mockRestore()
  })

  it("swallows a refusal and a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(409, { error: { code: "not_discardable" } })))
    await expect(discardMedia(imported.url)).resolves.toBeUndefined()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    await expect(discardMedia(imported.url)).resolves.toBeUndefined()
  })
})
