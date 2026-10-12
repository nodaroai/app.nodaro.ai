/**
 * The editor's per-node Stop must reach the clip check: the signal rides every
 * ask of `POST /v1/media/clip-length`, so a request under way is cut and no
 * further ask is made after Stop (the poll loop alone only looked between asks).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getSession: mockGetSession } }) }))

import { measureClipLength } from "../api"

const ready = { data: { status: "ready", durationMs: 14_600, width: 3840, height: 2160 } }
const okJson = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) })

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: null } })
})
afterEach(() => vi.unstubAllGlobals())

describe("measureClipLength and the Stop signal", () => {
  it("hands the abort signal to the request itself", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(ready))
    vi.stubGlobal("fetch", fetchMock)
    const ctrl = new AbortController()
    await measureClipLength({ videoUrl: "https://cdn.example.test/clip.mp4", signal: ctrl.signal })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.signal).toBe(ctrl.signal)
  })

  it("sends no signal when none was given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(ready))
    vi.stubGlobal("fetch", fetchMock)
    await measureClipLength({ videoUrl: "https://cdn.example.test/clip.mp4" })
    expect("signal" in (fetchMock.mock.calls[0]![1] as RequestInit)).toBe(false)
  })

  it("stops asking once the signal is aborted mid-request", async () => {
    const ctrl = new AbortController()
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const pending = measureClipLength({ videoUrl: "https://cdn.example.test/clip.mp4", signal: ctrl.signal })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    ctrl.abort()
    await expect(pending).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
