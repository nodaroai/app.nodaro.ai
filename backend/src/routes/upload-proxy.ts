/**
 * Upload-proxy route: receives a PUT from the LLM's code interpreter and
 * forwards the body to R2 with our server-side credentials.
 *
 * Why this exists: Claude.ai's code-interpreter has a domain allowlist
 * that blocks `*.r2.cloudflarestorage.com` (so direct presigned-URL
 * uploads fail with HTTP 403 "Host not in allowlist"). Routing through
 * our own domain (`mcp.nodaro.ai`, which IS allowlisted because of OAuth
 * discovery) sidesteps the issue.
 *
 * The URL is unauthenticated by design — the path-segment token IS the
 * auth. Token is an HMAC-signed payload {userId, key, mime, exp}; an
 * attacker can't mint or replay without the server secret.
 *
 * Token TTL: 1 hour. Body size: up to 256 MB (matches video upload cap).
 */
import type { FastifyInstance } from "fastify"
import { createHmac, timingSafeEqual } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { s3 } from "../lib/storage.js"
import { config } from "../lib/config.js"

export interface TokenPayload {
  userId: string
  key: string
  mime: string
  exp: number
  // "proxy" (default, back-compat) — curl PUT directly to R2 with a pre-set
  // content-type. "handoff" — user-facing browser upload page where the
  // mime isn't known until the file is picked, so we store with whatever
  // Content-Type the multipart upload reports.
  purpose?: "proxy" | "handoff"
  kind?: "image" | "audio" | "video"
}

function hmac(payload: string): string {
  return createHmac("sha256", config.INTERNAL_ORCHESTRATOR_SECRET)
    .update(payload)
    .digest("base64url")
}

export function signUploadToken(payload: TokenPayload): string {
  const json = JSON.stringify(payload)
  const data = Buffer.from(json, "utf8").toString("base64url")
  return `${data}.${hmac(data)}`
}

export function verifyUploadToken(token: string): TokenPayload | null {
  const dot = token.indexOf(".")
  if (dot < 0) return null
  const data = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = hmac(data)
  // Timing-safe compare
  const sigBuf = Buffer.from(sig, "utf8")
  const expBuf = Buffer.from(expected, "utf8")
  if (sigBuf.length !== expBuf.length) return null
  if (!timingSafeEqual(sigBuf, expBuf)) return null
  try {
    const json = Buffer.from(data, "base64url").toString("utf8")
    const payload = JSON.parse(json) as TokenPayload
    if (Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

const MAX_UPLOAD_BYTES = 256 * 1024 * 1024 // 256 MB

export async function uploadProxyRoutes(app: FastifyInstance): Promise<void> {
  // Register a body parser that captures arbitrary binary content as a
  // Buffer. Fastify's default JSON parser would 415 on image/video bytes.
  app.addContentTypeParser(
    /^(image|audio|video)\//,
    { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES },
    (_req, body, done) => {
      done(null, body)
    },
  )
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES },
    (_req, body, done) => {
      done(null, body)
    },
  )

  // PUT /v1/upload-proxy/:token
  // Body: raw file bytes (any binary).
  // The token IS the auth — middleware whitelists this path.
  app.put<{ Params: { token: string } }>(
    "/v1/upload-proxy/:token",
    {
      bodyLimit: MAX_UPLOAD_BYTES,
    },
    async (req, reply) => {
      const payload = verifyUploadToken(req.params.token)
      if (!payload || (payload.purpose && payload.purpose !== "proxy")) {
        return reply.status(403).send({
          error: { code: "invalid_token", message: "Token invalid or expired." },
        })
      }

      const body = req.body
      if (!body || (typeof body !== "object" && typeof body !== "string")) {
        return reply.status(400).send({
          error: { code: "empty_body", message: "Request body is empty." },
        })
      }

      let buffer: Buffer
      if (Buffer.isBuffer(body)) buffer = body
      else if (typeof body === "string") buffer = Buffer.from(body, "binary")
      else if (body instanceof Uint8Array) buffer = Buffer.from(body)
      else
        return reply.status(400).send({
          error: { code: "invalid_body", message: "Unable to read request body as binary." },
        })

      if (buffer.length === 0) {
        return reply.status(400).send({
          error: { code: "empty_body", message: "Empty body." },
        })
      }

      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: config.R2_BUCKET_NAME,
            Key: payload.key,
            Body: buffer,
            ContentType: payload.mime,
            CacheControl: "public, max-age=31536000, immutable",
          }),
        )
      } catch (err) {
        req.log.error({ err }, "[upload-proxy] R2 upload failed")
        return reply.status(502).send({
          error: { code: "r2_upload_failed", message: (err as Error).message },
        })
      }

      const publicUrl = `${config.R2_PUBLIC_URL}/${payload.key}`
      return reply.send({
        ok: true,
        url: publicUrl,
        bytes: buffer.length,
      })
    },
  )
}
