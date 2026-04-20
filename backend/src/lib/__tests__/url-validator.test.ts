import { describe, it, expect } from "vitest"
import { safeUrlSchema } from "../url-validator.js"

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
