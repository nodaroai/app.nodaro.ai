import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { Readable, pipeline } from "node:stream"
import { safeUrlSchema } from "../lib/url-validator.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { config } from "../lib/config.js"
import { isOurCdnUrl } from "../lib/cdn-host.js"
import { isRestrictedAddress } from "../lib/content-restrictions.js"
import { videoDownloadTargetOf } from "../lib/video-download-original.js"
import path from "path"

/** The answer for bytes an administrator restricted after a complaint: one sentence, no detail. */
export const CONTENT_RESTRICTED_BODY = { error: { code: "content_restricted", message: "This content is not available." } } as const

/** How long a file's fetch may run, body included (`safeFetch` aborts the stream at this). */
const DOWNLOAD_TIMEOUT_MS = 120_000

/**
 * The same for a kept video original, which is usually several times its
 * preview's size (HEVC 10-bit, HDR): a 500 MB original at 10 Mbit/s takes
 * about 7 minutes.
 */
export const ORIGINAL_DOWNLOAD_TIMEOUT_MS = 15 * 60_000

const downloadQuery = z.object({
  url: safeUrlSchema,
  /**
   * `1`: the app's Download of a video result (lib/video-download-original.ts):
   * the kept original beside a preview when its job names one, else the file
   * itself. Without it the route serves exactly the file named, as it always
   * has (other clients of this route are unchanged).
   */
  original: z.literal("1").optional(),
  /**
   * With `original`: when there is no original, send the browser to the file
   * itself (a 302 to the address just checked as ours) instead of streaming
   * it, so a Download that opened the file in a new tab keeps doing so.
   */
  open: z.literal("1").optional(),
})

/**
 * The app's Download of a video result (`original=1`), per caller (the
 * platform's limiter: an anonymous caller by its network,
 * lib/rate-limit-key.ts). Generous for a person (a list's "Download all" sends
 * one request a file), a bound on a script that would hold the server's long
 * original streams open. A request without `original` is never counted: the
 * plain route keeps the no-limit it always had.
 */
export const DOWNLOAD_RATE_LIMIT = { max: 120, timeWindow: "1 minute" } as const

/** Whether a request asks for the app's video Download (`original` present, whatever its value). */
function asksOriginal(req: FastifyRequest): boolean {
  return (req.query as Record<string, unknown> | undefined)?.original !== undefined
}

/** No answer to the app's Download is cached: which file it names can change (a job moved to the Trash, an original restricted). */
const NO_STORE = "private, no-store"

/**
 * The name a downloaded file is saved under: the stored file's own, except a
 * kept original's, whose storage key says `-master` and whose download says
 * `-original` (`<id>-original.mov`).
 */
export function downloadFileName(address: string, isOriginal: boolean): string {
  const name = path.basename(new URL(address).pathname) || "download"
  return isOriginal ? name.replace(/-master(\.[a-z0-9]+)$/i, "-original$1") : name
}

/** An answer that says the stored file is not (or not yet) there: the original is then not served, and the address asked for is. */
function isMissingAnswer(status: number): boolean {
  return status === 404 || status >= 500
}

export async function downloadRoutes(app: FastifyInstance) {
  app.get(
    "/v1/download",
    {
      config: { rateLimit: { ...DOWNLOAD_RATE_LIMIT, allowList: (req: FastifyRequest) => !asksOriginal(req) } },
      // Ahead of the limiter's own hook (it is added after the route's), so
      // its 429 to `original=1` is not cached either.
      onRequest: async (req, reply) => {
        if (asksOriginal(req)) reply.header("Cache-Control", NO_STORE)
      },
    },
    async (req, reply) => {
      // A caller that goes away stops the fetch: the response's `close` comes
      // when it ended or its connection dropped (registered before any wait, so
      // a caller gone while the original is looked up is seen too), and aborting
      // a finished fetch does nothing.
      const gone = new AbortController()
      reply.raw.once("close", () => gone.abort())
      const parsed = downloadQuery.safeParse(req.query)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "Missing or invalid 'url' query parameter" },
        })
      }

      const { url } = parsed.data

      // Validate URL is from our configured asset storage via the shared
      // allowlist (cdn-host.ts) — exact-origin/exact-host equality (not prefix,
      // not substring) so a look-alike hostname like `assets.example.com.evil.com`
      // cannot satisfy it.
      if (!isOurCdnUrl(url, config.R2_PUBLIC_URL, config.R2_PUBLIC_FALLBACK_DOMAIN)) {
        return reply.status(403).send({
          error: { code: "forbidden", message: "Only files from the R2 bucket can be downloaded" },
        })
      }

      // A file an administrator restricted after a complaint is not served
      // (lib/content-restrictions.ts): 451, the status for exactly that.
      if (await isRestrictedAddress(url)) return reply.status(451).send(CONTENT_RESTRICTED_BODY)

      // The app's Download of a video result: the kept original beside a
      // preview when its job names one (lib/video-download-original.ts). The
      // original passes the same two gates as the address asked for.
      const resolved = parsed.data.original ? await videoDownloadTargetOf(url) : { url, isOriginal: false }
      const target = resolved.url
      if (target !== url) {
        if (!isOurCdnUrl(target, config.R2_PUBLIC_URL, config.R2_PUBLIC_FALLBACK_DOMAIN)) {
          return reply.status(403).send({
            error: { code: "forbidden", message: "Only files from the R2 bucket can be downloaded" },
          })
        }
        if (await isRestrictedAddress(target)) return reply.status(451).send(CONTENT_RESTRICTED_BODY)
      }
      if (!resolved.isOriginal && parsed.data.original && parsed.data.open) {
        // No original: the browser goes to the file itself, as the Download
        // that opened it in a new tab always did. `url` passed the allowlist
        // above, so this never sends anyone off our own storage. (An address
        // that IS a kept original — a job that completed on it — is saved.)
        return reply.redirect(url, 302)
      }

      // A HEAD asks the file's headers only, never its bytes.
      const method = req.method === "HEAD" ? "HEAD" : "GET"
      const fetchFile = (address: string, timeoutMs: number) => safeFetch(address, { method, timeoutMs, signal: gone.signal })

      // safeFetch: defense-in-depth. The origin allowlist above is the
      // primary gate (only our R2 bucket reaches this line), but routing the
      // fetch through safeFetch rules out any future regression where the
      // allowlist loosens or an attacker finds a bypass — DNS resolution to
      // private IPs is rejected at connect time regardless.
      let served = target
      let servesOriginal = resolved.isOriginal
      let upstream: Response | undefined
      try {
        upstream = await fetchFile(target, servesOriginal ? ORIGINAL_DOWNLOAD_TIMEOUT_MS : DOWNLOAD_TIMEOUT_MS)
      } catch (error) {
        if (target === url || gone.signal.aborted) {
          req.log.warn({ err: error, url: target }, "[download] upstream fetch failed")
          return reply.status(502).send({
            error: { code: "proxy_error", message: "Failed to fetch upstream file" },
          })
        }
        req.log.warn({ err: error, url: target }, "[download] the original could not be fetched; serving the address asked for")
      }
      // An original found beside a preview that storage cannot give (gone,
      // failing): the address asked for is served instead, as before.
      if (target !== url && (upstream === undefined || isMissingAnswer(upstream.status))) {
        if (upstream) await upstream.body?.cancel().catch(() => undefined)
        served = url
        servesOriginal = false
        try {
          upstream = await fetchFile(url, DOWNLOAD_TIMEOUT_MS)
        } catch (error) {
          req.log.warn({ err: error, url }, "[download] upstream fetch failed")
          return reply.status(502).send({
            error: { code: "proxy_error", message: "Failed to fetch upstream file" },
          })
        }
      }
      if (!upstream) {
        return reply.status(502).send({ error: { code: "proxy_error", message: "Failed to fetch upstream file" } })
      }

      if (!upstream.ok) {
        return reply.status(502).send({
          error: { code: "proxy_error", message: `Upstream returned ${upstream.status}` },
        })
      }

      // The file served names itself: a kept original keeps its own extension
      // (`.mov`, `.webm`, `.mkv`) and the content type it was stored with.
      const contentType = upstream.headers.get("content-type") ?? "application/octet-stream"
      const contentLength = upstream.headers.get("content-length")
      const headers = {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${downloadFileName(served, servesOriginal)}"`,
        "Cache-Control": parsed.data.original ? NO_STORE : "public, max-age=3600",
        ...(contentLength ? { "Content-Length": contentLength } : {}),
      }

      if (method === "HEAD") {
        reply.raw.writeHead(200, headers)
        reply.raw.end()
        return reply
      }

      if (!upstream.body) {
        return reply.status(502).send({
          error: { code: "proxy_error", message: "Upstream returned no body" },
        })
      }

      // Stream the body straight through instead of buffering the whole object
      // into a single Buffer. This route is PUBLIC + unauthenticated and R2
      // objects can be up to 500MB (the video upload cap), so the old
      // `Buffer.from(await upstream.arrayBuffer())` let a handful of concurrent
      // requests exhaust the single-process heap and OOM-kill the API for every
      // tenant. `pipeline` keeps per-request memory bounded and destroys the
      // source when either end fails or the caller goes away.
      reply.raw.writeHead(200, headers)
      pipeline(Readable.fromWeb(upstream.body as import("stream/web").ReadableStream), reply.raw, (err) => {
        if (!err) return
        // The caller going away is the ordinary end of a cancelled download, not a fault.
        const callerLeft = gone.signal.aborted || (err as { code?: unknown }).code === "ERR_STREAM_PREMATURE_CLOSE"
        gone.abort()
        if (callerLeft) req.log.debug({ url: served }, "[download] the caller went away mid-download")
        else req.log.warn({ err, url: served }, "[download] the stream ended early")
      })
      return reply
    },
  )
}
