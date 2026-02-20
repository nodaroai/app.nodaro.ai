import { z } from "zod"

/**
 * SSRF-safe URL schema.
 * Validates that a URL uses http/https and does not point to localhost,
 * loopback, or private IP ranges.
 */
export const safeUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        const parsed = new URL(url)

        // Only allow http and https protocols
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return false
        }

        const hostname = parsed.hostname.toLowerCase()

        // Block localhost variants
        if (hostname === "localhost" || hostname === "[::1]") {
          return false
        }

        // Block IP-based hostnames in private/loopback ranges
        // Remove brackets from IPv6
        const ip = hostname.replace(/^\[|\]$/g, "")

        // IPv4 checks
        const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
        if (ipv4Match) {
          const [, a, b] = ipv4Match.map(Number)
          // 127.0.0.0/8 (loopback)
          if (a === 127) return false
          // 10.0.0.0/8 (private)
          if (a === 10) return false
          // 172.16.0.0/12 (private)
          if (a === 172 && b >= 16 && b <= 31) return false
          // 192.168.0.0/16 (private)
          if (a === 192 && b === 168) return false
          // 0.0.0.0
          if (a === 0 && b === 0) return false
          // 169.254.0.0/16 (link-local)
          if (a === 169 && b === 254) return false
        }

        // IPv6 loopback ::1
        if (ip === "::1") return false

        return true
      } catch {
        return false
      }
    },
    { message: "URL must use http(s) and must not point to localhost or private networks" },
  )
