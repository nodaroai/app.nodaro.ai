import { describe, it, expect } from "vitest"
import {
  safeUrlSchema,
  hostnameMatchesAllowlist,
  isAllowedSocialVideoUrl,
  isDirectVideoFileUrl,
  isAllowedVideoImportUrl,
  SOCIAL_VIDEO_HOSTS,
  YOUTUBE_HOSTS,
} from "../url-validator.js"

describe("safeUrlSchema", () => {
  it("accepts valid HTTPS URLs", () => {
    expect(safeUrlSchema.safeParse("https://example.com/image.jpg").success).toBe(true)
    expect(safeUrlSchema.safeParse("https://cdn.example.com/video.mp4").success).toBe(true)
  })

  it("accepts valid HTTP URLs", () => {
    expect(safeUrlSchema.safeParse("http://example.com/file.txt").success).toBe(true)
  })

  it("blocks localhost", () => {
    expect(safeUrlSchema.safeParse("http://localhost:8000/api").success).toBe(false)
    expect(safeUrlSchema.safeParse("https://localhost/secret").success).toBe(false)
  })

  it("blocks IPv6 loopback", () => {
    expect(safeUrlSchema.safeParse("http://[::1]:8000/api").success).toBe(false)
  })

  it("blocks IPv6 unspecified ::", () => {
    expect(safeUrlSchema.safeParse("http://[::]/api").success).toBe(false)
  })

  it("blocks IPv6 link-local (fe80::/10)", () => {
    expect(safeUrlSchema.safeParse("http://[fe80::1]/api").success).toBe(false)
  })

  it("blocks IPv6 unique-local (fc00::/7)", () => {
    expect(safeUrlSchema.safeParse("http://[fc00::1]/api").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://[fd12:3456::1]/api").success).toBe(false)
  })

  it("blocks IPv6 multicast (ff00::/8)", () => {
    expect(safeUrlSchema.safeParse("http://[ff02::1]/api").success).toBe(false)
  })

  it("blocks IPv4-mapped IPv6 addresses", () => {
    // ::ffff:127.0.0.1 embeds loopback inside an IPv6 address.
    expect(safeUrlSchema.safeParse("http://[::ffff:127.0.0.1]/api").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://[::ffff:10.0.0.1]/api").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://[::ffff:169.254.169.254]/api").success).toBe(false)
  })

  it("blocks private IP ranges", () => {
    expect(safeUrlSchema.safeParse("http://10.0.0.1/internal").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://172.16.0.1/internal").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://192.168.1.1/internal").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://169.254.1.1/link-local").success).toBe(false)
  })

  it("blocks the AWS/GCP metadata endpoint specifically", () => {
    expect(safeUrlSchema.safeParse("http://169.254.169.254/latest/meta-data/").success).toBe(false)
  })

  it("blocks loopback IP range", () => {
    expect(safeUrlSchema.safeParse("http://127.0.0.1/secret").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://127.1.2.3/secret").success).toBe(false)
  })

  it("blocks 0.0.0.0", () => {
    expect(safeUrlSchema.safeParse("http://0.0.0.0/internal").success).toBe(false)
  })

  it("blocks CGN range (100.64.0.0/10)", () => {
    expect(safeUrlSchema.safeParse("http://100.64.0.1/internal").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://100.127.0.1/internal").success).toBe(false)
  })

  it("blocks multicast + reserved (>= 224)", () => {
    expect(safeUrlSchema.safeParse("http://224.0.0.1/").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://239.255.255.255/").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://255.255.255.255/").success).toBe(false)
  })

  it("blocks non-http protocols", () => {
    expect(safeUrlSchema.safeParse("ftp://example.com/file").success).toBe(false)
    expect(safeUrlSchema.safeParse("file:///etc/passwd").success).toBe(false)
  })

  it("rejects invalid URLs", () => {
    expect(safeUrlSchema.safeParse("not-a-url").success).toBe(false)
    expect(safeUrlSchema.safeParse("").success).toBe(false)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // The schema is SYNTACTIC only — it does not resolve DNS. A hostname that
  // resolves to a private IP still passes the schema and must be caught at
  // fetch time by `safeFetch`. This test documents that expected gap.
  // ──────────────────────────────────────────────────────────────────────────
  it("passes hostnames whose DNS resolution isn't checked (documented limitation)", () => {
    // Would resolve to a private IP in a rebinding attack; schema alone can't
    // detect this — the runtime gate in `safeFetch` does.
    expect(safeUrlSchema.safeParse("https://attacker.example/").success).toBe(true)
    expect(safeUrlSchema.safeParse("https://subdomain.corp.internal/").success).toBe(true)
  })
})

describe("hostnameMatchesAllowlist / isAllowedSocialVideoUrl (SSRF allowlist)", () => {
  it("accepts the exact allowlisted domains and true subdomains", () => {
    expect(isAllowedSocialVideoUrl("https://youtube.com/watch?v=abc")).toBe(true)
    expect(isAllowedSocialVideoUrl("https://www.youtube.com/watch?v=abc")).toBe(true)
    expect(isAllowedSocialVideoUrl("https://m.youtube.com/watch?v=abc")).toBe(true)
    expect(isAllowedSocialVideoUrl("https://youtu.be/abc")).toBe(true)
    expect(isAllowedSocialVideoUrl("https://www.tiktok.com/@x/video/1")).toBe(true)
    expect(isAllowedSocialVideoUrl("https://x.com/i/status/1")).toBe(true)
    expect(isAllowedSocialVideoUrl("https://fb.watch/abc")).toBe(true)
  })

  it("REJECTS the substring-bypass hosts the old .includes() check let through", () => {
    // attacker-controlled domains that contain an allowlisted token as a substring
    expect(isAllowedSocialVideoUrl("https://youtube.com.attacker.example/x")).toBe(false)
    expect(isAllowedSocialVideoUrl("https://youtu.be.evil.com/x")).toBe(false)
    expect(isAllowedSocialVideoUrl("https://notyoutube.com/x")).toBe(false)
    expect(isAllowedSocialVideoUrl("https://x.com.evil.com/x")).toBe(false)
    expect(isAllowedSocialVideoUrl("https://evil-x.com/x")).toBe(false)
    // the classic SSRF target a substring host could resolve to
    expect(isAllowedSocialVideoUrl("https://youtube.com.169.254.169.254.nip.io/x")).toBe(false)
  })

  it("rejects non-allowlisted hosts and malformed URLs", () => {
    expect(isAllowedSocialVideoUrl("https://vimeo.com/123")).toBe(false)
    expect(isAllowedSocialVideoUrl("not a url")).toBe(false)
  })

  it("YOUTUBE_HOSTS subset rejects other social hosts", () => {
    expect(isAllowedSocialVideoUrl("https://youtube.com/x", YOUTUBE_HOSTS)).toBe(true)
    expect(isAllowedSocialVideoUrl("https://tiktok.com/x", YOUTUBE_HOSTS)).toBe(false)
  })

  it("handles FQDN trailing dot and case", () => {
    expect(hostnameMatchesAllowlist("YouTube.com.", SOCIAL_VIDEO_HOSTS)).toBe(true)
    expect(hostnameMatchesAllowlist("youtube.com.attacker.example.", SOCIAL_VIDEO_HOSTS)).toBe(false)
  })
})

describe("isDirectVideoFileUrl (direct CDN-style video links)", () => {
  it("accepts http(s) URLs whose PATH ends in a video extension — any host", () => {
    expect(isDirectVideoFileUrl("https://cdn.nodaro.ai/uploads/videos/5b3f3a3b-c532-4b60-9815-c9525791389e.mp4")).toBe(true)
    expect(isDirectVideoFileUrl("https://some.other.cdn.example/path/clip.webm")).toBe(true)
    expect(isDirectVideoFileUrl("https://example.com/a/b/movie.mov")).toBe(true)
    expect(isDirectVideoFileUrl("http://example.com/old.avi")).toBe(true)
  })

  it("matches case-insensitively and ignores query/fragment (signed CDN URLs)", () => {
    expect(isDirectVideoFileUrl("https://cdn.example/CLIP.MP4")).toBe(true)
    expect(isDirectVideoFileUrl("https://cdn.example/clip.mp4?X-Amz-Signature=abc&Expires=1")).toBe(true)
    expect(isDirectVideoFileUrl("https://cdn.example/clip.mp4#t=30")).toBe(true)
  })

  it("rejects when the extension is only in the query, not the path", () => {
    expect(isDirectVideoFileUrl("https://example.com/download?file=clip.mp4")).toBe(false)
  })

  it("rejects non-video paths, streams, and pages", () => {
    expect(isDirectVideoFileUrl("https://example.com/watch?v=abc")).toBe(false)
    expect(isDirectVideoFileUrl("https://example.com/stream.m3u8")).toBe(false)
    expect(isDirectVideoFileUrl("https://example.com/clip.mp3")).toBe(false)
    expect(isDirectVideoFileUrl("https://example.com/")).toBe(false)
  })

  it("rejects non-http protocols and malformed URLs", () => {
    expect(isDirectVideoFileUrl("ftp://example.com/clip.mp4")).toBe(false)
    expect(isDirectVideoFileUrl("file:///tmp/clip.mp4")).toBe(false)
    expect(isDirectVideoFileUrl("not a url")).toBe(false)
  })
})

describe("isAllowedVideoImportUrl (social OR direct file)", () => {
  it("accepts social hosts exactly as isAllowedSocialVideoUrl does", () => {
    expect(isAllowedVideoImportUrl("https://www.youtube.com/watch?v=abc")).toBe(true)
    expect(isAllowedVideoImportUrl("https://www.tiktok.com/@x/video/1")).toBe(true)
  })

  it("accepts direct video-file URLs on arbitrary public hosts", () => {
    expect(isAllowedVideoImportUrl("https://cdn.nodaro.ai/uploads/videos/x.mp4")).toBe(true)
  })

  it("still rejects a non-social page URL without a video-file path", () => {
    expect(isAllowedVideoImportUrl("https://vimeo.com/123")).toBe(false)
    // the substring-bypass host stays rejected even with a .mp4-less path
    expect(isAllowedVideoImportUrl("https://youtube.com.attacker.example/x")).toBe(false)
  })
})
