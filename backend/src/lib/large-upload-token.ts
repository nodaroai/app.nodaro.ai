import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto"
import { config } from "./config.js"

/**
 * The large-upload lane's token (`routes/large-upload.ts`): what
 * `POST /v1/uploads/large/start` hands the browser and `/complete` / `/abort`
 * take back. HMAC-signed and expiring, like the upload-proxy token
 * (`routes/upload-proxy.ts`), but with its OWN HKDF-derived key: a token of one
 * purpose can never verify as the other's (a proxy token names a key it may
 * PUT bytes to; this one names a multipart upload the server will finish and
 * bill). It is not single-use — `/complete` is made safe against a repeat by
 * its own claim on the upload id.
 */
const LARGE_UPLOAD_SIGNING_KEY = Buffer.from(
  hkdfSync("sha256", config.INTERNAL_ORCHESTRATOR_SECRET, "", "nodaro-large-upload-token-v1", 32),
)

export interface LargeUploadTokenPayload {
  readonly v: 1
  readonly userId: string
  readonly key: string
  readonly uploadId: string
  readonly sizeBytes: number
  readonly partSize: number
  readonly mimeType: string
  readonly filename: string
  readonly category: "video" | "audio"
  /** Expiry, epoch milliseconds. */
  readonly exp: number
}

function hmac(data: string): string {
  return createHmac("sha256", LARGE_UPLOAD_SIGNING_KEY).update(data).digest("base64url")
}

export function signLargeUploadToken(payload: LargeUploadTokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return `${data}.${hmac(data)}`
}

function isPayload(value: unknown): value is LargeUploadTokenPayload {
  if (!value || typeof value !== "object") return false
  const p = value as Record<string, unknown>
  return (
    p.v === 1 &&
    typeof p.userId === "string" &&
    typeof p.key === "string" &&
    typeof p.uploadId === "string" &&
    typeof p.sizeBytes === "number" &&
    typeof p.partSize === "number" &&
    typeof p.mimeType === "string" &&
    typeof p.filename === "string" &&
    (p.category === "video" || p.category === "audio") &&
    typeof p.exp === "number"
  )
}

/** The payload of a token this lane signed and that has not expired; null otherwise. */
export function verifyLargeUploadToken(token: string, now: number = Date.now()): LargeUploadTokenPayload | null {
  const dot = token.indexOf(".")
  if (dot <= 0) return null
  const data = token.slice(0, dot)
  const sigBuf = Buffer.from(token.slice(dot + 1), "utf8")
  const expBuf = Buffer.from(hmac(data), "utf8")
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(data, "base64url").toString("utf8"))
    if (!isPayload(parsed)) return null
    if (now > parsed.exp) return null
    return parsed
  } catch {
    return null
  }
}
