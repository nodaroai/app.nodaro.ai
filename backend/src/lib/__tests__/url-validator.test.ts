import { describe, it, expect } from "vitest"
import { safeUrlSchema } from "@/lib/url-validator.js"

describe("safeUrlSchema", () => {
  describe("valid URLs", () => {
    it("accepts https with path", () => {
      const result = safeUrlSchema.safeParse("https://example.com/image.png")
      expect(result.success).toBe(true)
    })

    it("accepts plain http", () => {
      const result = safeUrlSchema.safeParse("http://example.com")
      expect(result.success).toBe(true)
    })

    it("accepts public IP 8.8.8.8", () => {
      const result = safeUrlSchema.safeParse("https://8.8.8.8/")
      expect(result.success).toBe(true)
    })

    it("accepts public IP 203.0.113.1", () => {
      const result = safeUrlSchema.safeParse("https://203.0.113.1/")
      expect(result.success).toBe(true)
    })

    it("accepts 172.15.0.1 (just outside private range)", () => {
      const result = safeUrlSchema.safeParse("http://172.15.0.1")
      expect(result.success).toBe(true)
    })
  })

  describe("blocked protocols", () => {
    it("rejects ftp://", () => {
      const result = safeUrlSchema.safeParse("ftp://example.com")
      expect(result.success).toBe(false)
    })

    it("rejects file://", () => {
      const result = safeUrlSchema.safeParse("file:///etc/passwd")
      expect(result.success).toBe(false)
    })

    it("rejects javascript:", () => {
      const result = safeUrlSchema.safeParse("javascript:alert(1)")
      expect(result.success).toBe(false)
    })
  })

  describe("blocked localhost", () => {
    it("rejects http://localhost", () => {
      const result = safeUrlSchema.safeParse("http://localhost")
      expect(result.success).toBe(false)
    })

    it("rejects http://[::1]", () => {
      const result = safeUrlSchema.safeParse("http://[::1]")
      expect(result.success).toBe(false)
    })
  })

  describe("blocked private IP ranges", () => {
    it("rejects 127.0.0.1 (loopback)", () => {
      const result = safeUrlSchema.safeParse("http://127.0.0.1")
      expect(result.success).toBe(false)
    })

    it("rejects 10.0.0.1 (10.x private)", () => {
      const result = safeUrlSchema.safeParse("http://10.0.0.1")
      expect(result.success).toBe(false)
    })

    it("rejects 172.16.0.1 (172.16-31 private start)", () => {
      const result = safeUrlSchema.safeParse("http://172.16.0.1")
      expect(result.success).toBe(false)
    })

    it("rejects 172.31.255.255 (172.16-31 private end)", () => {
      const result = safeUrlSchema.safeParse("http://172.31.255.255")
      expect(result.success).toBe(false)
    })

    it("rejects 192.168.1.1 (192.168 private)", () => {
      const result = safeUrlSchema.safeParse("http://192.168.1.1")
      expect(result.success).toBe(false)
    })

    it("rejects 0.0.0.0", () => {
      const result = safeUrlSchema.safeParse("http://0.0.0.0")
      expect(result.success).toBe(false)
    })

    it("rejects 169.254.1.1 (link-local)", () => {
      const result = safeUrlSchema.safeParse("http://169.254.1.1")
      expect(result.success).toBe(false)
    })
  })

  describe("malformed input", () => {
    it("rejects empty string", () => {
      const result = safeUrlSchema.safeParse("")
      expect(result.success).toBe(false)
    })

    it("rejects non-URL string", () => {
      const result = safeUrlSchema.safeParse("not a url at all")
      expect(result.success).toBe(false)
    })

    it("rejects ://invalid", () => {
      const result = safeUrlSchema.safeParse("://invalid")
      expect(result.success).toBe(false)
    })
  })
})
