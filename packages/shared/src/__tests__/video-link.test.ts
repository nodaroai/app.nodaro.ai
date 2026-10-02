import { describe, it, expect } from "vitest"
import {
  SOCIAL_VIDEO_HOSTS,
  YOUTUBE_HOSTS,
  INSTAGRAM_HOSTS,
  VIDEO_LINK_TOLERANT_CONSUMER_TYPES,
  hasUrlParserHazard,
  hostnameMatchesAllowlist,
  isSocialVideoUrl,
  detectVideoLinkPlatform,
  videoLinkDownloadedFile,
  resolveVideoLinkOutput,
  videoLinkNeedsDownload,
} from "../video-link.js"

describe("social video host allowlist", () => {
  it("admits the domain itself and true subdomains only", () => {
    expect(hostnameMatchesAllowlist("youtube.com", YOUTUBE_HOSTS)).toBe(true)
    expect(hostnameMatchesAllowlist("www.youtube.com", YOUTUBE_HOSTS)).toBe(true)
    expect(hostnameMatchesAllowlist("m.youtu.be", YOUTUBE_HOSTS)).toBe(true)
    expect(hostnameMatchesAllowlist("YOUTUBE.COM.", YOUTUBE_HOSTS)).toBe(true)
  })

  it("rejects a lookalike host that merely CONTAINS an allowlisted name", () => {
    expect(hostnameMatchesAllowlist("evilyoutube.com", YOUTUBE_HOSTS)).toBe(false)
    expect(hostnameMatchesAllowlist("youtube.com.attacker.example", YOUTUBE_HOSTS)).toBe(false)
    // "x.com" is a substring of "netflix.com" — the old loose regex called this X.
    expect(isSocialVideoUrl("https://www.netflix.com/watch/1")).toBe(false)
  })

  it("keeps the YouTube and Instagram subsets inside the full list", () => {
    for (const h of [...YOUTUBE_HOSTS, ...INSTAGRAM_HOSTS]) {
      expect(SOCIAL_VIDEO_HOSTS).toContain(h)
    }
  })

  it("isSocialVideoUrl never throws on junk", () => {
    expect(isSocialVideoUrl("")).toBe(false)
    expect(isSocialVideoUrl("not a url")).toBe(false)
    expect(isSocialVideoUrl("ftp://youtube.com/x")).toBe(false)
    expect(isSocialVideoUrl("https://www.tiktok.com/@a/video/1")).toBe(true)
    expect(isSocialVideoUrl("https://www.tiktok.com/@a/video/1", YOUTUBE_HOSTS)).toBe(false)
  })
})

describe("links that URL parsers read differently", () => {
  const BACKSLASH = "https://tiktok.com\\@169.254.169.254/latest/meta-data"

  it("flags a backslash and every ASCII control character, and nothing else", () => {
    expect(hasUrlParserHazard(BACKSLASH)).toBe(true)
    for (const ch of ["\t", "\n", "\r", "\u0000", "\u001f", "\u007f"]) {
      expect(hasUrlParserHazard(`https://youtu.be/aqz${ch}-KE-bpKQ`)).toBe(true)
    }
    expect(hasUrlParserHazard("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30s#x")).toBe(false)
    expect(hasUrlParserHazard("https://pub-x.r2.dev/avideo%20preview/98.mp4")).toBe(false)
    expect(hasUrlParserHazard("https://example.com/שלום עולם.mp4")).toBe(false)
    expect(hasUrlParserHazard("")).toBe(false)
  })

  it("is refused as a social link even though its WHATWG host is allowlisted", () => {
    // The reading THIS file would make: host tiktok.com. The download tool is
    // handed the raw string and may read 169.254.169.254.
    expect(new URL(BACKSLASH).hostname).toBe("tiktok.com")
    expect(isSocialVideoUrl(BACKSLASH)).toBe(false)
    expect(detectVideoLinkPlatform(BACKSLASH)).toBe("unknown")
    expect(videoLinkNeedsDownload({ youtubeUrl: BACKSLASH })).toBe(false)
  })
})

describe("consumers that do not need the video file", () => {
  it("names exactly the readers that take the audio track or the page link", () => {
    expect([...VIDEO_LINK_TOLERANT_CONSUMER_TYPES].sort()).toEqual(["content-recipe", "dubbing", "suno-cover", "transcribe"])
  })
})

describe("detectVideoLinkPlatform", () => {
  it.each([
    ["https://www.youtube.com/watch?v=aqz-KE-bpKQ", "youtube"],
    ["https://youtu.be/aqz-KE-bpKQ?si=x", "youtube"],
    ["https://music.youtube.com/watch?v=aqz-KE-bpKQ", "youtube"],
    ["https://www.instagram.com/reels/DaK89TnRB5m/", "instagram"],
    ["https://vm.tiktok.com/ZS99nqdaG/", "tiktok"],
    ["https://x.com/someone/status/123", "twitter"],
    ["https://twitter.com/someone/status/123", "twitter"],
    ["https://fb.watch/abc/", "facebook"],
    ["https://www.facebook.com/reel/123", "facebook"],
    ["https://cdn.nodaro.ai/videos/yt-1.mp4", "unknown"],
    ["https://www.netflix.com/watch/1", "unknown"],
    ["garbage", "unknown"],
  ])("%s → %s", (url, platform) => {
    expect(detectVideoLinkPlatform(url)).toBe(platform)
  })
})

describe("Video URL node output", () => {
  const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
  const FILE = "https://cdn.nodaro.ai/videos/yt-1.mp4"

  it("emits the downloaded file when there is one", () => {
    expect(resolveVideoLinkOutput({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT })).toBe(FILE)
  })

  it("trusts a downloaded file with no recorded source — every node saved before the field existed", () => {
    expect(resolveVideoLinkOutput({ youtubeUrl: YT, downloadedVideoUrl: FILE })).toBe(FILE)
  })

  it("does NOT emit a file that was downloaded from a different link", () => {
    const data = { youtubeUrl: "https://youtu.be/otherVideo01", downloadedVideoUrl: FILE, downloadedFromUrl: YT }
    expect(videoLinkDownloadedFile(data)).toBeUndefined()
    // Falls back to the link itself, never to the wrong video.
    expect(resolveVideoLinkOutput(data)).toBe("https://youtu.be/otherVideo01")
  })

  it("passes a direct file link through untouched (the Welcome Demo / saved-template shape)", () => {
    expect(resolveVideoLinkOutput({ youtubeUrl: ` ${FILE} ` })).toBe(FILE)
    expect(videoLinkNeedsDownload({ youtubeUrl: FILE })).toBe(false)
  })

  it("is undefined for an empty node", () => {
    expect(resolveVideoLinkOutput({})).toBeUndefined()
    expect(resolveVideoLinkOutput({ youtubeUrl: "   " })).toBeUndefined()
  })

  it("needs a download exactly when the link is social and no file matches it", () => {
    expect(videoLinkNeedsDownload({ youtubeUrl: YT })).toBe(true)
    expect(videoLinkNeedsDownload({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT })).toBe(false)
    expect(videoLinkNeedsDownload({ youtubeUrl: YT, downloadedVideoUrl: FILE })).toBe(false)
    expect(videoLinkNeedsDownload({ youtubeUrl: "https://youtu.be/otherVideo01", downloadedVideoUrl: FILE, downloadedFromUrl: YT })).toBe(true)
    expect(videoLinkNeedsDownload({ youtubeUrl: "https://example.com/page" })).toBe(false)
    expect(videoLinkNeedsDownload({})).toBe(false)
  })

  it("ignores non-string junk in the fields", () => {
    expect(resolveVideoLinkOutput({ youtubeUrl: 5, downloadedVideoUrl: null })).toBeUndefined()
    expect(videoLinkNeedsDownload({ youtubeUrl: { a: 1 } })).toBe(false)
  })
})
