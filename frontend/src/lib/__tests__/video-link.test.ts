// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  AUTO_DOWNLOAD_MAX_SEC,
  classifyDownloadError,
  deriveVideoLinkView,
  extractVideoLinkId,
  formatTimecode,
  parseTimecode,
  validateRange,
} from "../video-link"

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const FILE = "https://cdn.nodaro.ai/videos/yt-1.mp4"

describe("extractVideoLinkId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=aqz-KE-bpKQ", "aqz-KE-bpKQ"],
    // `v` is not always the first parameter — a share link puts it second.
    ["https://www.youtube.com/watch?feature=share&v=aqz-KE-bpKQ", "aqz-KE-bpKQ"],
    ["https://youtu.be/aqz-KE-bpKQ?si=abc", "aqz-KE-bpKQ"],
    ["https://www.youtube.com/shorts/aqz-KE-bpKQ", "aqz-KE-bpKQ"],
    ["https://www.youtube.com/embed/aqz-KE-bpKQ", "aqz-KE-bpKQ"],
    ["https://www.youtube.com/live/aqz-KE-bpKQ?feature=share", "aqz-KE-bpKQ"],
    ["https://music.youtube.com/watch?v=aqz-KE-bpKQ", "aqz-KE-bpKQ"],
    ["https://www.tiktok.com/@someone/video/7676964064458738952", "7676964064458738952"],
    ["https://www.instagram.com/reels/DaK89TnRB5m/", "DaK89TnRB5m"],
    ["https://x.com/someone/status/1234567890", "1234567890"],
    ["https://www.facebook.com/reel/987654321", "987654321"],
  ])("%s → %s", (url, id) => {
    expect(extractVideoLinkId(url)).toBe(id)
  })

  it("falls back to the link itself for a supported host whose shape it does not know", () => {
    // A TikTok short link carries no numeric id — yt-dlp resolves it server-side.
    expect(extractVideoLinkId("https://vm.tiktok.com/ZS99nqdaG/")).toBe("https://vm.tiktok.com/ZS99nqdaG/")
    expect(extractVideoLinkId("https://fb.watch/abc/")).toBe("https://fb.watch/abc/")
  })

  it("is null for a YouTube page that is not a video, a foreign host, or junk", () => {
    expect(extractVideoLinkId("https://www.youtube.com/@channel")).toBeNull()
    expect(extractVideoLinkId("https://www.youtube.com/watch?v=short")).toBeNull()
    expect(extractVideoLinkId(FILE)).toBeNull()
    // "x.com" is a substring of "netflix.com" — it used to read as an X link.
    expect(extractVideoLinkId("https://www.netflix.com/watch/1")).toBeNull()
    expect(extractVideoLinkId("not a url")).toBeNull()
    expect(extractVideoLinkId("")).toBeNull()
  })
})

describe("classifyDownloadError", () => {
  it.each([
    ["This video has no audio track — Voice Changer needs audio to work.", "no_audio"],
    ["ERROR: [youtube] abc: Sign in to confirm your age", "age_restricted"],
    ["ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "private"],
    ["ERROR: The uploader has not made this video available in your country", "region"],
    ["ERROR: [youtube] abc: This live event will begin in 3 hours", "live"],
    ["Connection lost", "connection"],
    ["Download expired", "connection"],
    ["yt-dlp stalled (no output for 120s)", "generic"],
    ["", "generic"],
    [undefined, "generic"],
  ])("%s → %s", (raw, code) => {
    expect(classifyDownloadError(raw)).toBe(code)
  })

  it("checks the no-audio wording first — it must never fall through to a looser rule", () => {
    expect(classifyDownloadError("no audio track in this private live stream")).toBe("no_audio")
  })
})

describe("timecodes", () => {
  it.each([
    ["90", 90],
    ["1:30", 90],
    ["01:30", 90],
    ["1:02:03", 3723],
    ["0", 0],
    [" 2:05 ", 125],
    ["1:30.5", 90.5],
  ])("parses %s → %d", (text, sec) => {
    expect(parseTimecode(text)).toBe(sec)
  })

  it.each(["", "abc", "1:60", "1:2:3:4", "-5", "1:-2", ":30", "1:"])("rejects %j", (text) => {
    expect(parseTimecode(text)).toBeNull()
  })

  it("formats seconds the way people read a player", () => {
    expect(formatTimecode(0)).toBe("0:00")
    expect(formatTimecode(90)).toBe("1:30")
    expect(formatTimecode(3723)).toBe("1:02:03")
    expect(formatTimecode(59.9)).toBe("0:59")
  })
})

describe("validateRange", () => {
  it("accepts a range inside the video", () => {
    expect(validateRange("0:10", "0:40", 120)).toEqual({ ok: true, startSec: 10, endSec: 40 })
  })

  it("accepts any range when the length is unknown", () => {
    expect(validateRange("10", "5000", null)).toEqual({ ok: true, startSec: 10, endSec: 5000 })
  })

  it("names what is wrong", () => {
    expect(validateRange("x", "0:40", 120)).toEqual({ ok: false, reason: "format" })
    expect(validateRange("0:40", "0:10", 120)).toEqual({ ok: false, reason: "order" })
    expect(validateRange("0:40", "0:40", 120)).toEqual({ ok: false, reason: "order" })
    expect(validateRange("0:10", "3:00", 120)).toEqual({ ok: false, reason: "beyond" })
  })
})

describe("deriveVideoLinkView", () => {
  it("is empty with no link", () => {
    expect(deriveVideoLinkView({})).toEqual({ kind: "empty" })
  })

  it("passes a direct file link through — there is nothing to download", () => {
    expect(deriveVideoLinkView({ youtubeUrl: FILE })).toEqual({ kind: "passthrough" })
  })

  it("is ready once a file matches the link, whatever the status says", () => {
    expect(
      deriveVideoLinkView({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT, downloadStatus: "failed" }),
    ).toEqual({ kind: "ready" })
  })

  it("does not call a file from ANOTHER link ready", () => {
    expect(
      deriveVideoLinkView({
        youtubeUrl: "https://youtu.be/otherVideo01",
        downloadedVideoUrl: FILE,
        downloadedFromUrl: YT,
        downloadStatus: "completed",
      }),
    ).toEqual({ kind: "idle" })
  })

  it("reports the live download", () => {
    expect(deriveVideoLinkView({ youtubeUrl: YT, downloadStatus: "checking" })).toEqual({ kind: "checking" })
    expect(
      deriveVideoLinkView({ youtubeUrl: YT, downloadStatus: "downloading", downloadPercent: 41, downloadPhase: "processing" }),
    ).toEqual({ kind: "downloading", percent: 41, phase: "processing" })
    // The percent is transient — gone after a reload, never NaN on screen.
    expect(deriveVideoLinkView({ youtubeUrl: YT, downloadStatus: "downloading" })).toEqual({
      kind: "downloading",
      percent: 0,
      phase: "downloading",
    })
  })

  it("asks for a choice on a long video, and carries its length", () => {
    expect(deriveVideoLinkView({ youtubeUrl: YT, needsRangeChoice: true, videoDurationSec: 5530 })).toEqual({
      kind: "choose",
      durationSec: 5530,
    })
    expect(deriveVideoLinkView({ youtubeUrl: YT, needsRangeChoice: true })).toEqual({ kind: "choose", durationSec: null })
  })

  it("offers the silent retry only for a no-audio failure", () => {
    expect(
      deriveVideoLinkView({ youtubeUrl: YT, downloadStatus: "failed", downloadErrorCode: "no_audio" }),
    ).toEqual({ kind: "failed", code: "no_audio", canRetrySilent: true })
    expect(
      deriveVideoLinkView({ youtubeUrl: YT, downloadStatus: "failed", downloadError: "Private video" }),
    ).toEqual({ kind: "failed", code: "private", canRetrySilent: false })
  })

  it("is idle for a social link nobody has downloaded — a node an agent wrote, or one saved before downloads existed", () => {
    expect(deriveVideoLinkView({ youtubeUrl: YT })).toEqual({ kind: "idle" })
    expect(deriveVideoLinkView({ youtubeUrl: YT, downloadStatus: "idle" })).toEqual({ kind: "idle" })
  })

  it("keeps the threshold where Recast and Studio have it", () => {
    expect(AUTO_DOWNLOAD_MAX_SEC).toBe(240)
  })
})
