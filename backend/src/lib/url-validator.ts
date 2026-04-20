import { z } from "zod"
import { isPrivateOrReservedIP } from "./safe-fetch.js"

/**
 * Syntactic SSRF gate — rejects URLs whose string form already targets
 * localhost, a private/reserved IP literal, or a non-http(s) protocol.
 *
 * **This is the first of two layers. It is NOT sufficient on its own.**
 * It cannot resolve DNS, so a hostname `attacker.example` that A-records
 * to `10.x`, `127.x`, `169.254.169.254`, etc. passes this schema. Any
 * server-side fetch of a URL accepted by this schema MUST go through
 * `safeFetch` in `./safe-fetch.ts`, which validates the resolved IP at
 * connection time (and re-validates each redirect hop).
 *
 * Pair:
 *   - Route boundary: `z.object({ url: safeUrlSchema })` — rejects the
 *     obvious attacks at Zod parse (fast-fail, cheap).
 *   - Network boundary: `safeFetch(url, init)` — rejects DNS-based
 *     attacks at connect time (authoritative).
 */
export const safeUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return false
        }
        const hostname = parsed.hostname.toLowerCase()
        if (hostname === "localhost" || hostname === "[::1]") {
          return false
        }
        // Hostnames from URL parsing retain brackets for IPv6. Strip them
        // before handing to the shared IP classifier so `::1`, `fe80::…`,
        // IPv4-mapped, etc. are all handled consistently with safeFetch.
        const ip = hostname.replace(/^\[|\]$/g, "")
        if (isPrivateOrReservedIP(ip)) return false
        return true
      } catch {
        return false
      }
    },
    { message: "URL must use http(s) and must not point to localhost or private networks" },
  )
