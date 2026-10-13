import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import type { FastifyReply, FastifyRequest } from "fastify"
import { config } from "../../lib/config.js"

/**
 * The free-grant gate's server-signed browser cookie (PR 5 of the 2026-10
 * hardening).
 *
 * The browser and device keys are computed in the page and sent to us as
 * plain hex: a script that never runs a browser can send a fresh pair with
 * every signup. This cookie is the one browser signal it cannot mint — the
 * id is random and the signature is ours (HMAC with a key derived from
 * `INTERNAL_ORCHESTRATOR_SECRET`), so a forged or altered value fails
 * `verify` and is treated as absent. A browser that keeps its cookies
 * carries the same id into every later signup; that is the observation.
 *
 * What it is not: a block. The id is stored HASHED (`cookie_key`, 510) and
 * only ever compared, and the rule that reads it is off until an admin turns
 * it on (`signup_grant_cookie_rule`) — the shadow week first. A browser that
 * clears its cookies simply has none; the device and network rules still
 * see it.
 *
 * Domain: host-only by default. `SIGNUP_COOKIE_DOMAIN` (e.g. `.nodaro.ai`)
 * shares it with the sibling apps on the same registrable domain.
 */

export const SIGNUP_COOKIE_NAME = "ndr_sg"
const VERSION = "v1"
const ONE_YEAR_S = 365 * 24 * 60 * 60

/** The signing key, derived so the orchestrator secret itself never signs a browser value. */
function signingKey(): Buffer {
  return createHmac("sha256", config.INTERNAL_ORCHESTRATOR_SECRET).update("nodaro:signup-cookie:v1").digest()
}

function sign(id: string): string {
  return createHmac("sha256", signingKey()).update(id).digest("hex").slice(0, 32)
}

/** A fresh value: `v1.<32 hex id>.<32 hex signature>`. */
export function mintSignupCookie(): { value: string; id: string } {
  const id = randomBytes(16).toString("hex")
  return { value: `${VERSION}.${id}.${sign(id)}`, id }
}

/** The id inside a value we signed, or null for anything else — absent, malformed, altered or forged. */
export function verifySignupCookie(value: string | null | undefined): string | null {
  if (!value) return null
  const parts = value.split(".")
  if (parts.length !== 3 || parts[0] !== VERSION) return null
  const [, id, sig] = parts as [string, string, string]
  if (!/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-f]{32}$/.test(sig)) return null
  const expected = Buffer.from(sign(id), "utf8")
  const given = Buffer.from(sig, "utf8")
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null
}

/** What is stored and compared: a keyed hash of the id, never the id itself. */
export function cookieKeyOf(id: string): string {
  return createHmac("sha256", signingKey()).update(`store:${id}`).digest("hex")
}

/** The named cookie's raw value from the request's Cookie header, or null. */
export function readCookie(header: string | string[] | undefined, name: string): string | null {
  const raw = Array.isArray(header) ? header.join("; ") : header
  if (!raw) return null
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}

/** `localhost` and friends get no `Secure` flag: a dev server over plain HTTP would drop the cookie. */
function isLocalHost(req: FastifyRequest): boolean {
  const host = (req.headers["x-forwarded-host"] ?? req.headers.host ?? "").toString().split(":")[0] ?? ""
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")
}

export function signupCookieHeader(value: string, req: FastifyRequest): string {
  const parts = [`${SIGNUP_COOKIE_NAME}=${value}`, "Path=/", `Max-Age=${ONE_YEAR_S}`, "HttpOnly", "SameSite=Lax"]
  if (!isLocalHost(req)) parts.push("Secure")
  const domain = process.env.SIGNUP_COOKIE_DOMAIN?.trim()
  if (domain && /^\.?[a-z0-9.-]+$/i.test(domain)) parts.push(`Domain=${domain}`)
  return parts.join("; ")
}

/**
 * The claim's cookie key: the browser's existing signed cookie, or a new one
 * set on this reply (and recorded for this account). A forged value is
 * replaced, never trusted. Never throws: a cookie we could not read or set
 * is a missing observation, not a failed claim.
 */
export function signupCookieKey(req: FastifyRequest, reply: FastifyReply): { key: string; fresh: boolean } | null {
  try {
    const existing = verifySignupCookie(readCookie(req.headers.cookie, SIGNUP_COOKIE_NAME))
    if (existing) return { key: cookieKeyOf(existing), fresh: false }
    const minted = mintSignupCookie()
    const previous = reply.getHeader("set-cookie")
    const header = signupCookieHeader(minted.value, req)
    reply.header("set-cookie", previous ? [...(Array.isArray(previous) ? previous : [String(previous)]), header] : header)
    return { key: cookieKeyOf(minted.id), fresh: true }
  } catch {
    return null
  }
}
