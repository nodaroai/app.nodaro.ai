import { timingSafeEqual } from "node:crypto"

/**
 * Timing-safe string comparison that never throws for mismatched lengths.
 *
 * The one comparison both internal-secret listeners use — the API's auth hook
 * (`middleware/auth.ts`) and the plugin daemon host's internal listener
 * (`lib/plugin-daemons/host.ts`) — so the two doors cannot drift apart.
 */
export function constantTimeEqualStr(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8")
  const bBuf = Buffer.from(b, "utf8")
  if (aBuf.length !== bBuf.length) {
    // Still compare against a buffer of the same length to avoid a short-circuit
    // timing side channel. The result is discarded.
    timingSafeEqual(aBuf, Buffer.alloc(aBuf.length))
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}
