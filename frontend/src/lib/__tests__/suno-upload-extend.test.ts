import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

import { sunoUploadExtendApi } from "../api"

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: null } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Regression test: the /v1/suno/upload-extend route Zod schema requires
 * `uploadUrl` + numeric `continueAt`. The frontend previously sent `audioUrl`
 * and omitted `continueAt`, which caused every single-node run to fail
 * Zod validation.
 */
describe("sunoUploadExtendApi — route Zod parity", () => {
  it("sends uploadUrl (not audioUrl) and numeric continueAt", async () => {
    const fetch = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", fetch)

    await sunoUploadExtendApi({
      uploadUrl: "https://r2/audio.mp3",
      continueAt: 15,
      model: "V5",
    })

    const [url, opts] = fetch.mock.calls[0]
    expect(url).toContain("/v1/suno/upload-extend")
    const body = JSON.parse(opts.body)
    expect(body.uploadUrl).toBe("https://r2/audio.mp3")
    expect(body.continueAt).toBe(15)
    expect(body.model).toBe("V5")
    // Must NOT send the legacy audioUrl key the route would reject.
    expect(body.audioUrl).toBeUndefined()
  })

  it("accepts continueAt=0 (start of track)", async () => {
    const fetch = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", fetch)

    await sunoUploadExtendApi({
      uploadUrl: "https://r2/audio.mp3",
      continueAt: 0,
      model: "V5",
    })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.continueAt).toBe(0)
  })

  it("defaults defaultParamFlag to true when unset", async () => {
    const fetch = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", fetch)

    await sunoUploadExtendApi({
      uploadUrl: "https://r2/audio.mp3",
      continueAt: 5,
      model: "V5",
    })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.defaultParamFlag).toBe(true)
  })

  it("forwards optional style/title/negativeStyle/vocalGender", async () => {
    const fetch = mockFetchJson({ jobId: "j1" })
    vi.stubGlobal("fetch", fetch)

    await sunoUploadExtendApi({
      uploadUrl: "https://r2/audio.mp3",
      continueAt: 10,
      model: "V5",
      style: "lo-fi",
      title: "Dawn",
      negativeStyle: "trap",
      vocalGender: "female",
      prompt: "warm synth pads",
      userId: "user-1",
    })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.style).toBe("lo-fi")
    expect(body.title).toBe("Dawn")
    expect(body.negativeStyle).toBe("trap")
    expect(body.vocalGender).toBe("female")
    expect(body.prompt).toBe("warm synth pads")
    expect(body.userId).toBe("user-1")
  })
})
