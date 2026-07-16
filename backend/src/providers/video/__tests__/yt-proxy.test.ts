import { describe, it, expect, afterEach } from "vitest"

import { ytProxyArgs, ytProxyOption, parseProxyPool, resolveProxyChain } from "../yt-proxy.js"

const YT_WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
const YT_SHORT = "https://youtu.be/dQw4w9WgXcQ"
const YT_SHORTS = "https://www.youtube.com/shorts/GYKjQ-WT-vU"
const TIKTOK = "https://www.tiktok.com/@user/video/7300000000000000000"
const PROXY = "http://user:pass@gate.decodo.com:7000"

describe("yt-proxy", () => {
  afterEach(() => {
    delete process.env.YTDLP_PROXY
    delete process.env.YTDLP_PROXY_POOL
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

  describe("parseProxyPool", () => {
    it("splits tiers on | and proxies on , or whitespace, dropping empties", () => {
      expect(parseProxyPool("a,b,c | d")).toEqual([["a", "b", "c"], ["d"]])
      expect(parseProxyPool("a b  c|d")).toEqual([["a", "b", "c"], ["d"]])
      expect(parseProxyPool("a, ,b ||  | c")).toEqual([["a", "b"], ["c"]])
    })
    it("returns [] for unset / blank", () => {
      expect(parseProxyPool(undefined)).toEqual([])
      expect(parseProxyPool("   ")).toEqual([])
    })
  })

  describe("resolveProxyChain — the tiered pool + fallback", () => {
    const ISP = ["http://u:p@isp1:1", "http://u:p@isp2:2", "http://u:p@isp3:3"]

    it("is [] for a non-YouTube host even when a pool is set", () => {
      process.env.YTDLP_PROXY_POOL = ISP.join(",")
      expect(resolveProxyChain(TIKTOK)).toEqual([])
    })

    it("is [] when nothing is configured", () => {
      expect(resolveProxyChain(YT_WATCH)).toEqual([])
    })

    it("with only the legacy YTDLP_PROXY, the chain is exactly [that] (backward compat)", () => {
      process.env.YTDLP_PROXY = PROXY
      expect(resolveProxyChain(YT_WATCH)).toEqual([PROXY])
    })

    it("includes every pool IP, main tier before fallback tier, in tier order", () => {
      process.env.YTDLP_PROXY_POOL = `${ISP.join(",")} | ${PROXY}`
      const chain = resolveProxyChain(YT_WATCH)
      expect(new Set(chain)).toEqual(new Set([...ISP, PROXY]))
      // fallback tier (residential) comes AFTER all main-tier (ISP) IPs
      expect(chain[chain.length - 1]).toBe(PROXY)
      expect(chain.slice(0, ISP.length).every((p) => ISP.includes(p))).toBe(true)
    })

    it("appends the legacy YTDLP_PROXY as the FINAL fallback when both are set", () => {
      process.env.YTDLP_PROXY_POOL = ISP.join(",")
      process.env.YTDLP_PROXY = PROXY
      const chain = resolveProxyChain(YT_WATCH)
      expect(chain).toHaveLength(ISP.length + 1)
      expect(chain[chain.length - 1]).toBe(PROXY)
    })

    it("does not duplicate a proxy present in both the pool and YTDLP_PROXY", () => {
      process.env.YTDLP_PROXY_POOL = PROXY
      process.env.YTDLP_PROXY = PROXY
      expect(resolveProxyChain(YT_WATCH)).toEqual([PROXY])
    })

    it("rotates the in-tier start across calls so load spreads over the tier", () => {
      process.env.YTDLP_PROXY_POOL = ISP.join(",")
      // Over several calls, the first-tried IP should not be constant.
      const firsts = new Set(Array.from({ length: 6 }, () => resolveProxyChain(YT_WATCH)[0]))
      expect(firsts.size).toBeGreaterThan(1)
      // Every call still returns the full tier.
      expect(new Set(resolveProxyChain(YT_WATCH))).toEqual(new Set(ISP))
    })

    it("ytProxyArgs uses the main tier (first of the chain)", () => {
      process.env.YTDLP_PROXY_POOL = `${PROXY} | http://u:p@fallback:9`
      expect(ytProxyArgs(YT_WATCH)).toEqual(["--proxy", PROXY])
    })
  })
})
