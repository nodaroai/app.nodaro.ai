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

  it("blocks private IP ranges", () => {
    expect(safeUrlSchema.safeParse("http://10.0.0.1/internal").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://172.16.0.1/internal").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://192.168.1.1/internal").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://169.254.1.1/link-local").success).toBe(false)
  })

  it("blocks loopback IP range", () => {
    expect(safeUrlSchema.safeParse("http://127.0.0.1/secret").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://127.1.2.3/secret").success).toBe(false)
  })

  it("blocks non-http protocols", () => {
    expect(safeUrlSchema.safeParse("ftp://example.com/file").success).toBe(false)
    expect(safeUrlSchema.safeParse("file:///etc/passwd").success).toBe(false)
  })

  it("blocks 0.0.0.0", () => {
    expect(safeUrlSchema.safeParse("http://0.0.0.0/internal").success).toBe(false)
  })

  it("rejects invalid URLs", () => {
    expect(safeUrlSchema.safeParse("not-a-url").success).toBe(false)
    expect(safeUrlSchema.safeParse("").success).toBe(false)
  })
})
