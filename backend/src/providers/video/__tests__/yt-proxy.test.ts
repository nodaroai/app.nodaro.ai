import { describe, it, expect, afterEach } from "vitest"

import { ytProxyArgs, ytProxyOption } from "../yt-proxy.js"

const YT_WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
const YT_SHORT = "https://youtu.be/dQw4w9WgXcQ"
const YT_SHORTS = "https://www.youtube.com/shorts/GYKjQ-WT-vU"
const TIKTOK = "https://www.tiktok.com/@user/video/7300000000000000000"
const PROXY = "http://user:pass@gate.decodo.com:7000"

describe("yt-proxy", () => {
  afterEach(() => {
    delete process.env.YTDLP_PROXY
  })

  describe("YTDLP_PROXY unset — a no-op everywhere", () => {
    it("ytProxyArgs returns [] and ytProxyOption returns {} for a YouTube url", () => {
      delete process.env.YTDLP_PROXY
      expect(ytProxyArgs(YT_WATCH)).toEqual([])
      expect(ytProxyOption(YT_WATCH)).toEqual({})
    })
  })

  describe("YTDLP_PROXY set — YouTube only", () => {
    it("adds the proxy for youtube.com/watch, youtu.be and /shorts", () => {
      process.env.YTDLP_PROXY = PROXY
      for (const url of [YT_WATCH, YT_SHORT, YT_SHORTS]) {
        expect(ytProxyArgs(url)).toEqual(["--proxy", PROXY])
        expect(ytProxyOption(url)).toEqual({ proxy: PROXY })
      }
    })

    it("does NOT proxy a non-YouTube (TikTok) url — residential bandwidth is YouTube-only", () => {
      process.env.YTDLP_PROXY = PROXY
      expect(ytProxyArgs(TIKTOK)).toEqual([])
      expect(ytProxyOption(TIKTOK)).toEqual({})
    })

    it("trims surrounding whitespace in the env value", () => {
      process.env.YTDLP_PROXY = `  ${PROXY}  `
      expect(ytProxyArgs(YT_WATCH)).toEqual(["--proxy", PROXY])
    })

    it("treats a whitespace-only value as unset", () => {
      process.env.YTDLP_PROXY = "   "
      expect(ytProxyArgs(YT_WATCH)).toEqual([])
      expect(ytProxyOption(YT_WATCH)).toEqual({})
    })
  })
})
