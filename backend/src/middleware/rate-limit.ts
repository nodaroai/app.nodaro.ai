import type { FastifyRequest, FastifyReply } from "fastify"
import { redis } from "../lib/queue.js"

interface RateLimitOptions {
  /** Time window in milliseconds */
  windowMs: number
  /** Max requests per window per user */
  max: number
  /** Redis key prefix */
  keyPrefix: string
  /**
   * Refuse (503) instead of allowing the request when Redis is unreachable.
   * Default false (read routes should not go dark with the cache). Set on
   * SPEND routes — an outage must not also remove the limit on spending.
   */
  failClosed?: boolean
}

/**
 * Redis-based per-user rate limiter.
 * Returns a Fastify preHandler that tracks request counts
 * with a sliding-window counter in Redis.
 */
export function rateLimiter(opts: RateLimitOptions) {
  const windowSec = Math.ceil(opts.windowMs / 1000)

  return async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string | undefined
    if (!userId) return // unauthenticated requests handled by auth middleware

    const key = `rl:${opts.keyPrefix}:${userId}`

    try {
      const current = await redis.incr(key)

      // Set TTL on first request in window
      if (current === 1) {
        await redis.expire(key, windowSec)
      }

      if (current > opts.max) {
        const ttl = await redis.ttl(key)
        reply.header("Retry-After", String(ttl > 0 ? ttl : windowSec))
        return reply.status(429).send({
          error: {
            code: "rate_limit_exceeded",
            message: `Too many requests. Limit: ${opts.max} per ${windowSec}s. Try again later.`,
          },
        })
      }
    } catch {
      // If Redis is down, allow the request through rather than blocking —
      // unless the route opted into failing closed (spend routes).
      if (opts.failClosed) {
        return reply.status(503).send({
          error: { code: "rate_limit_unavailable", message: "Rate limiting is temporarily unavailable. Try again shortly." },
        })
      }
    }
  }
}
