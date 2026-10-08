import { describe, it, expect } from "vitest"
import { classifyVideoLinkInput, isVideoLinkInputReady, videoLinkInputValues } from "../video-link-input"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const FILE = "https://cdn.example.com/ep-12.mp4"

describe("classifyVideoLinkInput — the app runner's card and the server read one rule", () => {
  it("names the four things a field can hold", () => {
    expect(classifyVideoLinkInput("")).toEqual({ kind: "empty" })
    expect(classifyVideoLinkInput("   ")).toEqual({ kind: "empty" })
    expect(classifyVideoLinkInput(undefined)).toEqual({ kind: "empty" })
    expect(classifyVideoLinkInput(YT)).toEqual({ kind: "social", link: YT })
    expect(classifyVideoLinkInput(`  ${FILE} `)).toEqual({ kind: "direct", link: FILE })
    expect(classifyVideoLinkInput("hello")).toEqual({ kind: "invalid" })
  })

  it("a supported host with no video in the address is invalid (nothing to download)", () => {
    expect(classifyVideoLinkInput("https://www.youtube.com/")).toEqual({ kind: "invalid" })
    expect(classifyVideoLinkInput("https://www.youtube.com/@somechannel")).toEqual({ kind: "invalid" })
  })

  it("agrees with the shared rule: any other http(s) link is a direct link, as the canvas node passes it through", () => {
    for (const link of [
      "https://www.netflix.com/watch/1", // "x.com" inside "netflix.com" — not a supported post host
      "https://youtube.com.attacker.example/watch?v=aqz-KE-bpKQ",
      "https://example.com/page",
      "https://cdn.example.com/stream/ep-12", // no video extension
    ]) {
      expect(classifyVideoLinkInput(link), link).toEqual({ kind: "direct", link })
    }
    expect(classifyVideoLinkInput("not a link").kind).toBe("invalid")
    expect(classifyVideoLinkInput("ftp://cdn.example.com/a.mp4").kind).toBe("invalid")
  })
})

// Review round (decided 2026-10-07): the server refuses a direct link whose host
// is this machine or a private address (`safeUrlSchema`); the card says so
// instead of showing "ready" and letting the run bounce with a 400.
describe("classifyVideoLinkInput — a direct link to a private or local address is invalid", () => {
  it.each([
    "http://localhost:9000/a.mp4",
    "http://LOCALHOST/a.mp4",
    "http://localhost./a.mp4",
    "http://app.localhost/a.mp4",
    "http://127.0.0.1/a.mp4",
    "http://192.168.1.5/v.mp4",
    "http://10.0.0.2/x.mov",
    "http://172.16.0.9/x.webm",
    "http://169.254.169.254/latest/a.mp4",
    "http://100.64.0.1/a.mp4",
    "http://0.0.0.0/a.mp4",
    "http://[::1]/a.mp4",
    "http://[fd00::1]/a.mp4",
    "http://[::ffff:127.0.0.1]/a.mp4",
    "http://2130706433/a.mp4",
    "http://0x7f.1/a.mp4",
    "http://127.0.0.1/stream/no-extension",
    "http://10.0.0.2/page",
  ])("%s", (link) => {
    expect(classifyVideoLinkInput(link)).toEqual({ kind: "invalid" })
    expect(isVideoLinkInputReady({ youtubeUrl: link })).toBe(false)
  })

  it("a public address stays a direct link", () => {
    for (const link of ["http://93.184.216.34/a.mp4", "https://cdn.example.com/a.mp4", "http://[2606:4700::1]/a.mp4"]) {
      expect(classifyVideoLinkInput(link), link).toEqual({ kind: "direct", link })
    }
  })
})

describe("isVideoLinkInputReady — whether Run may start", () => {
  it("a direct file link is ready as it is", () => {
    expect(isVideoLinkInputReady({ youtubeUrl: FILE })).toBe(true)
  })

  it("a post link is ready only with a file downloaded FOR THAT link", () => {
    expect(isVideoLinkInputReady({ youtubeUrl: YT })).toBe(false)
    expect(isVideoLinkInputReady({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT })).toBe(true)
    expect(isVideoLinkInputReady({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: "https://youtu.be/other" })).toBe(false)
  })

  it("an empty or invalid link is never ready", () => {
    expect(isVideoLinkInputReady({ youtubeUrl: "" })).toBe(false)
    expect(isVideoLinkInputReady({ youtubeUrl: "hello" })).toBe(false)
    expect(isVideoLinkInputReady({})).toBe(false)
    expect(isVideoLinkInputReady({ youtubeUrl: "hello" }, "audio")).toBe(false)
  })

  // Decided 2026-10-08: when every node after the link reads only its sound or its
  // page address, the run fetches that itself — Run does not wait for a video file.
  it("a post link that feeds only audio readers (or link readers) is ready without a file", () => {
    expect(isVideoLinkInputReady({ youtubeUrl: YT }, "audio")).toBe(true)
    expect(isVideoLinkInputReady({ youtubeUrl: YT }, "none")).toBe(true)
    expect(isVideoLinkInputReady({ youtubeUrl: YT }, "file")).toBe(false)
  })
})

describe("videoLinkInputValues — the runner's value over the creator's sample", () => {
  const data = { youtubeUrl: YT, downloadedVideoUrl: "https://cdn/creator.mp4", downloadedFromUrl: YT, title: "x" }

  it("before the runner touches it, the creator's sample is the value", () => {
    expect(videoLinkInputValues(data, undefined)).toMatchObject({ youtubeUrl: YT, downloadedVideoUrl: "https://cdn/creator.mp4" })
  })

  it("once the runner has set a link, the creator's file is NOT merged under it", () => {
    const values = videoLinkInputValues(data, { youtubeUrl: "https://youtu.be/BBBBBBBBBBB" })
    expect(values.youtubeUrl).toBe("https://youtu.be/BBBBBBBBBBB")
    expect(values.downloadedVideoUrl).toBeUndefined()
    expect(values.downloadedFromUrl).toBeUndefined()
  })
})
