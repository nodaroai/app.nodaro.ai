import { describe, it, expect } from "vitest"
import { httpLink, linkSiteName } from "../post-site"

describe("httpLink", () => {
  it("keeps an http(s) link, trimmed", () => {
    expect(httpLink(" https://www.instagram.com/p/abc/ ")).toBe("https://www.instagram.com/p/abc/")
    expect(httpLink("http://example.com")).toBe("http://example.com")
  })

  it("refuses anything else: post data is untrusted", () => {
    expect(httpLink("javascript:alert(1)")).toBeNull()
    expect(httpLink("data:text/html,hi")).toBeNull()
    expect(httpLink("instagram.com/p/abc")).toBeNull()
    expect(httpLink("")).toBeNull()
    expect(httpLink(null)).toBeNull()
    expect(httpLink(42)).toBeNull()
  })
})

describe("linkSiteName", () => {
  it.each([
    ["https://www.instagram.com/p/abc/", "Instagram"],
    ["https://instagram.com/reel/abc", "Instagram"],
    ["https://x.com/nodaro/status/1", "X"],
    ["https://twitter.com/nodaro/status/1", "X"],
    ["https://mobile.twitter.com/nodaro/status/1", "X"],
    ["https://www.tiktok.com/@a/video/1", "TikTok"],
    ["https://youtu.be/abc", "YouTube"],
    ["https://m.youtube.com/watch?v=abc", "YouTube"],
    ["https://old.reddit.com/r/a/comments/1", "Reddit"],
    ["https://www.linkedin.com/posts/a", "LinkedIn"],
    ["https://m.facebook.com/a/posts/1", "Facebook"],
    ["https://fb.watch/abc", "Facebook"],
    ["https://t.me/tech_cyber_ai_israel/3392", "Telegram"],
    ["https://www.threads.net/@a/post/1", "Threads"],
  ])("%s opens on %s", (url, site) => {
    expect(linkSiteName(url)).toBe(site)
  })

  it("names any other site by its host, without www", () => {
    expect(linkSiteName("https://www.nytimes.com/2026/10/07/tech.html")).toBe("nytimes.com")
    expect(linkSiteName("https://blog.example.com/a")).toBe("blog.example.com")
  })

  it("a look-alike host is not the platform", () => {
    expect(linkSiteName("https://notinstagram.com/p/abc")).toBe("notinstagram.com")
    expect(linkSiteName("https://instagram.com.evil.io/p/abc")).toBe("instagram.com.evil.io")
  })

  it("no http(s) link, no site", () => {
    expect(linkSiteName("javascript:alert(1)")).toBeNull()
    expect(linkSiteName(null)).toBeNull()
    expect(linkSiteName(undefined)).toBeNull()
  })
})
