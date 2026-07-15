import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { youtubeVideoId, parseIso8601Duration, ytDataApiProbe } from "../youtube-data-api.js"

// Mock the SSRF-safe fetch the module uses for the API call.
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: vi.fn() }))
import { safeFetch } from "../../../lib/safe-fetch.js"
const mockFetch = safeFetch as unknown as ReturnType<typeof vi.fn>

const jsonRes = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
})

describe("youtubeVideoId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=CHHH8tNioSc", "CHHH8tNioSc"],
    ["https://youtube.com/watch?v=CHHH8tNioSc&t=30s", "CHHH8tNioSc"],
    ["https://m.youtube.com/watch?v=CHHH8tNioSc", "CHHH8tNioSc"],
    ["https://music.youtube.com/watch?v=CHHH8tNioSc", "CHHH8tNioSc"],
    ["https://youtu.be/CHHH8tNioSc", "CHHH8tNioSc"],
    ["https://youtu.be/CHHH8tNioSc?si=abc", "CHHH8tNioSc"],
    ["https://www.youtube.com/shorts/GYKjQ-WT-vU", "GYKjQ-WT-vU"],
    ["https://www.youtube.com/embed/CHHH8tNioSc", "CHHH8tNioSc"],
    ["https://www.youtube.com/live/CHHH8tNioSc", "CHHH8tNioSc"],
  ])("extracts the id from %s", (url, id) => {
    expect(youtubeVideoId(url)).toBe(id)
  })

  it.each([
    ["https://www.youtube.com/watch?v=tooShort"], // not 11 chars
    ["https://www.youtube.com/playlist?list=PLxyz"], // playlist, no v
    ["https://www.youtube.com/@channel"], // channel
    ["https://vimeo.com/watch?v=CHHH8tNioSc"], // non-YouTube host
    ["https://tiktok.com/@u/video/123"], // non-YouTube
    ["not a url"],
    [""],
  ])("returns null for %s", (url) => {
    expect(youtubeVideoId(url)).toBeNull()
  })
})

describe("parseIso8601Duration", () => {
  it.each([
    ["PT30S", 30],
    ["PT4M13S", 253],
    ["PT1H2M3S", 3723],
    ["PT1H", 3600],
    ["PT2M", 120],
    ["P0D", 0], // live / unknown
    ["P1DT2H", 93600],
  ])("parses %s → %d sec", (iso, sec) => {
    expect(parseIso8601Duration(iso)).toBe(sec)
  })

  it.each([["", null], ["P", null], ["PT", null], ["garbage", null], ["4M13S", null]])(
    "returns null for unparseable %s",
    (iso, expected) => {
      expect(parseIso8601Duration(iso as string)).toBe(expected)
    },
  )
})

describe("ytDataApiProbe", () => {
  beforeEach(() => {
    mockFetch.mockReset()
    delete process.env.YOUTUBE_API_KEY
  })
  afterEach(() => {
    delete process.env.YOUTUBE_API_KEY
  })

  it("returns parsed metadata for a normal video", async () => {
    mockFetch.mockResolvedValue(
      jsonRes({
        items: [
          {
            snippet: { title: "Test Video", liveBroadcastContent: "none" },
            contentDetails: { duration: "PT4M13S" },
          },
        ],
      }),
    )
    const r = await ytDataApiProbe("https://youtu.be/CHHH8tNioSc", { apiKey: "k" })
    expect(r).toEqual({ durationSec: 253, title: "Test Video", isLive: false })
  })

  it("flags a live broadcast", async () => {
    mockFetch.mockResolvedValue(
      jsonRes({
        items: [{ snippet: { title: "Live!", liveBroadcastContent: "live" }, contentDetails: { duration: "P0D" } }],
      }),
    )
    const r = await ytDataApiProbe("https://youtu.be/CHHH8tNioSc", { apiKey: "k" })
    expect(r).toMatchObject({ isLive: true, title: "Live!" })
  })

  it("returns null (→ yt-dlp fallback) when no API key is configured", async () => {
    const r = await ytDataApiProbe("https://youtu.be/CHHH8tNioSc")
    expect(r).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("reads the key from YOUTUBE_API_KEY env when not passed explicitly", async () => {
    process.env.YOUTUBE_API_KEY = "env-key"
    mockFetch.mockResolvedValue(
      jsonRes({ items: [{ snippet: { title: "X" }, contentDetails: { duration: "PT10S" } }] }),
    )
    const r = await ytDataApiProbe("https://youtu.be/CHHH8tNioSc")
    expect(r).toMatchObject({ durationSec: 10, title: "X" })
    // key must be in the query string sent to the API
    expect(String(mockFetch.mock.calls[0][0])).toContain("key=env-key")
  })

  it("returns null without calling the API when the id can't be extracted", async () => {
    const r = await ytDataApiProbe("https://www.youtube.com/playlist?list=abc", { apiKey: "k" })
    expect(r).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("returns null when the video is not found (empty items)", async () => {
    mockFetch.mockResolvedValue(jsonRes({ items: [] }))
    const r = await ytDataApiProbe("https://youtu.be/CHHH8tNioSc", { apiKey: "k" })
    expect(r).toBeNull()
  })

  it("returns null on a non-2xx API response", async () => {
    mockFetch.mockResolvedValue(jsonRes({ error: "bad key" }, false, 403))
    const r = await ytDataApiProbe("https://youtu.be/CHHH8tNioSc", { apiKey: "k" })
    expect(r).toBeNull()
  })

  it("returns null (never throws) on a network error", async () => {
    mockFetch.mockRejectedValue(new Error("ETIMEDOUT"))
    const r = await ytDataApiProbe("https://youtu.be/CHHH8tNioSc", { apiKey: "k" })
    expect(r).toBeNull()
  })

  it("requests part=snippet,contentDetails for the extracted id", async () => {
    mockFetch.mockResolvedValue(
      jsonRes({ items: [{ snippet: { title: "X" }, contentDetails: { duration: "PT1S" } }] }),
    )
    await ytDataApiProbe("https://www.youtube.com/watch?v=CHHH8tNioSc", { apiKey: "k" })
    const calledUrl = String(mockFetch.mock.calls[0][0])
    expect(calledUrl).toContain("part=snippet%2CcontentDetails")
    expect(calledUrl).toContain("id=CHHH8tNioSc")
  })
})
