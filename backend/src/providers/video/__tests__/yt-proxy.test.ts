import { describe, it, expect, afterEach } from "vitest"

import { ytProxyArgs, ytProxyOption, parseProxyPool, resolveProxyChain, resolveAttemptChain } from "../yt-proxy.js"

const YT_WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
const YT_SHORT = "https://youtu.be/dQw4w9WgXcQ"
const YT_SHORTS = "https://www.youtube.com/shorts/GYKjQ-WT-vU"
const TIKTOK = "https://www.tiktok.com/@user/video/7300000000000000000"
const INSTAGRAM = "https://www.instagram.com/reels/DYFWlx7xBi0/"
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

  /**
   * The DOWNLOAD attempt chain: null = a direct (no-proxy) attempt. Instagram
   * serves some datacenter IPs a degraded, audio-less format set per-post (the
   * download "succeeds" but arrives silent), so it gets the pool as FAILOVER —
   * direct first (free, works for most posts), paid proxy only when needed.
   * YouTube keeps its pool-first chain (the datacenter IP is hard-blocked, a
   * direct attempt is a wasted 429).
   */
  describe("resolveAttemptChain — direct-first failover for Instagram", () => {
    const ISP = ["http://u:p@isp1:1", "http://u:p@isp2:2"]

    it("YouTube with a pool: the proxy chain verbatim — no direct attempt", () => {
      process.env.YTDLP_PROXY_POOL = ISP.join(",")
      const attempts = resolveAttemptChain(YT_WATCH)
      expect(attempts).not.toContain(null)
      expect(new Set(attempts)).toEqual(new Set(ISP))
    })

    it("YouTube with nothing configured: one direct attempt", () => {
      expect(resolveAttemptChain(YT_WATCH)).toEqual([null])
    })

    it("Instagram with a pool: direct FIRST, then every pool proxy", () => {
      process.env.YTDLP_PROXY_POOL = `${ISP.join(",")} | ${PROXY}`
      const attempts = resolveAttemptChain(INSTAGRAM)
      expect(attempts[0]).toBeNull()
      expect(new Set(attempts.slice(1))).toEqual(new Set([...ISP, PROXY]))
      // fallback tier still comes after the main tier
      expect(attempts[attempts.length - 1]).toBe(PROXY)
    })

    it("Instagram appends the legacy YTDLP_PROXY as the final fallback", () => {
      process.env.YTDLP_PROXY = PROXY
      expect(resolveAttemptChain(INSTAGRAM)).toEqual([null, PROXY])
    })

    it("Instagram with nothing configured: one direct attempt (unchanged behaviour)", () => {
      expect(resolveAttemptChain(INSTAGRAM)).toEqual([null])
    })

    it("other social hosts stay a single direct attempt even with a pool set", () => {
      process.env.YTDLP_PROXY_POOL = ISP.join(",")
      expect(resolveAttemptChain(TIKTOK)).toEqual([null])
      expect(resolveAttemptChain("https://x.com/a/status/1")).toEqual([null])
      expect(resolveAttemptChain("https://www.facebook.com/watch?v=1")).toEqual([null])
    })

    it("direct video-file urls (arbitrary hosts) stay a single direct attempt", () => {
      process.env.YTDLP_PROXY_POOL = ISP.join(",")
      expect(resolveAttemptChain("https://cdn.example.com/clip.mp4")).toEqual([null])
    })
  })
})
