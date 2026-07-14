import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema, isAllowedSocialVideoUrl, YOUTUBE_HOSTS } from "../lib/url-validator.js"
import { ytMetadataProbe } from "../providers/video/youtube-video.js"
import { formatZodError } from "../lib/zod-error.js"

/**
 * POST /v1/video-metadata — a lightweight, YouTube-only metadata probe the VCP
 * import flow calls BEFORE deciding how to present a YouTube import (e.g. to
 * bucket by duration or flag a livestream). It wraps `ytMetadataProbe`, which
 * runs yt-dlp `--dump-json` through the same client-retry ladder and 15s hard
 * timeout the video download uses — no extra timeout layer is added here.
 *
 * Response: `{ durationSec: number | null, title: string | null, isLive: boolean }`.
 *
 * Contract, load-bearing:
 *   - A PROBE FAILURE IS A 200 WITH NULLS. The client treats unknown duration
 *     as "show the full flow", so a flaky/blocked probe must NEVER block an
 *     import. Only a disallowed/invalid URL is a 400; missing auth is a 401.
 *   - Non-YouTube (but still allowlisted) hosts return nulls WITHOUT probing:
 *     `ytMetadataProbe` validates against the NARROW `YOUTUBE_HOSTS` and throws
 *     `YtUrlNotAllowedError` for anything else BEFORE spawning, so calling it
 *     for a TikTok/Instagram/X/Facebook URL would only ever throw. The client
 *     calls this for YouTube URLs only, but the route must not error on the
 *     other hosts its (download-video-shaped) body gate admits.
 */
const NULL_METADATA = { durationSec: null, title: null, isLive: false } as const

// Same URL gate as POST /v1/download-video: syntactic SSRF check + broad social
// allowlist. yt-dlp does its own DNS+HTTP, so this allowlist is the SSRF gate.
const videoMetadataBody = z.object({
  url: safeUrlSchema.refine((url) => isAllowedSocialVideoUrl(url), {
    message: "Must be a valid video URL (YouTube, Facebook, TikTok, Instagram, or X)",
  }),
})

export async function videoMetadataRoutes(app: FastifyInstance) {
  app.post("/v1/video-metadata", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = videoMetadataBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { url } = parsed.data

    // The probe is YouTube-only; short-circuit every other allowlisted host to
    // nulls rather than calling a probe that would only throw for them.
    if (!isAllowedSocialVideoUrl(url, YOUTUBE_HOSTS)) {
      return NULL_METADATA
    }

    // Probe failure never blocks an import — return nulls on ANY error.
    try {
      return await ytMetadataProbe(url)
    } catch (err) {
      console.warn(
        `[video-metadata] probe failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return NULL_METADATA
    }
  })
}
