import { createHmac, timingSafeEqual } from "node:crypto"
import type { FastifyInstance } from "fastify"
import { appBaseUrl } from "../lib/deployment-urls.js"
import { sendInternalError } from "../lib/http-errors.js"
import { supabase } from "../lib/supabase.js"
import { PROVIDERS } from "../services/social/providers/registry.js"

/**
 * Meta's privacy plumbing: the Data Deletion Request callback (required to pass
 * App Review) and the Deauthorize callback (fired when a user removes the app
 * from their Facebook settings).
 *
 * Both are server-to-server POSTs from Meta carrying a `signed_request` and no
 * session of ours, so they are PUBLIC routes — the HMAC over our app secret IS
 * the authentication, exactly like the Stripe webhook's signature.
 */

const META_APP_ID_ENV = "META_APP_ID"

/**
 * Platforms served by our Meta app, DERIVED from the registry instead of a
 * hardcoded ["facebook", "instagram"]: every provider that needs META_APP_ID
 * authenticates through the same app, so a Meta-backed provider added later is
 * covered by these callbacks the day it is registered.
 */
function metaPlatformIds(): string[] {
  return Object.values(PROVIDERS)
    .filter((p) => (p.requiredEnv ?? []).includes(META_APP_ID_ENV))
    .map((p) => p.id)
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64")
}

function hmacEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Verify and parse Meta's `signed_request`. Returns null on ANY problem —
 * malformed, bad signature, unexpected algorithm, or no user id — so a caller
 * can never accidentally act on unverified input.
 */
export function parseSignedRequest(signed: string, appSecret: string): { metaUserId: string } | null {
  const dot = signed.indexOf(".")
  if (dot <= 0) return null
  const sigPart = signed.slice(0, dot)
  const payloadPart = signed.slice(dot + 1)
  if (!payloadPart) return null

  const expected = createHmac("sha256", appSecret).update(payloadPart).digest()
  if (!hmacEqual(base64UrlDecode(sigPart), expected)) return null

  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8")) as {
      algorithm?: string
      user_id?: string
    }
    // Meta signs these with HMAC-SHA256; anything else is an algorithm downgrade.
    if (payload.algorithm && payload.algorithm.toUpperCase() !== "HMAC-SHA256") return null
    if (!payload.user_id) return null
    return { metaUserId: payload.user_id }
  } catch {
    return null
  }
}

/**
 * The confirmation code Meta shows the user. Self-verifying (HMAC over the Meta
 * user id plus issue time) so the status endpoint can validate it without a new
 * table: deletion runs synchronously BEFORE we mint a code, so any code we
 * issued describes a deletion that already completed.
 */
export function issueConfirmationCode(metaUserId: string, appSecret: string, issuedAtMs: number): string {
  const body = `${metaUserId}.${issuedAtMs}`
  const sig = createHmac("sha256", appSecret).update(body).digest("hex").slice(0, 24)
  return `${Buffer.from(body, "utf8").toString("base64url")}.${sig}`
}

export function verifyConfirmationCode(code: string, appSecret: string): boolean {
  const dot = code.lastIndexOf(".")
  if (dot <= 0) return false
  const body = Buffer.from(code.slice(0, dot), "base64url").toString("utf8")
  const expected = createHmac("sha256", appSecret).update(body).digest("hex").slice(0, 24)
  return hmacEqual(Buffer.from(code.slice(dot + 1), "utf8"), Buffer.from(expected, "utf8"))
}

/**
 * Drop every Meta connection belonging to this Meta user. Matches on
 * `root_internal_id` — the Facebook user id behind the login (see
 * meta-accounts.ts::fetchRootId) — which is the same app-scoped id Meta signs
 * into the request. `platform_user_id` would be WRONG here: it holds the Page
 * or IG-business id, not the person's.
 */
async function deleteMetaConnections(metaUserId: string): Promise<number> {
  const { data, error } = await supabase
    .from("social_connections")
    .delete()
    .eq("root_internal_id", metaUserId)
    .in("platform", metaPlatformIds())
    .select("id")

  if (error) throw new Error(`social_connections delete failed: ${error.message}`)
  return (data ?? []).length
}

function readSignedRequest(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const value = (body as { signed_request?: unknown }).signed_request
  return typeof value === "string" && value.length > 0 ? value : null
}

function statusPage(state: "deleted" | "unknown"): string {
  const message =
    state === "deleted"
      ? "Your Facebook and Instagram connections have been deleted from Nodaro."
      : "We could not find a deletion request matching this confirmation code."
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Data deletion status - Nodaro</title></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.6">
<h1 style="font-size:1.25rem">Data deletion status</h1>
<p>${message}</p>
<p style="color:#666;font-size:.875rem">Questions? Contact support via nodaro.ai.</p>
</body></html>`
}

export async function metaCallbackRoutes(app: FastifyInstance) {
  // POST /v1/social/meta/data-deletion — Meta's "Data Deletion Request" callback.
  app.post("/v1/social/meta/data-deletion", async (req, reply) => {
    const appSecret = process.env.META_APP_SECRET
    if (!appSecret) {
      return reply.status(503).send({ error: { code: "provider_not_configured" } })
    }

    const signed = readSignedRequest(req.body)
    const parsed = signed ? parseSignedRequest(signed, appSecret) : null
    if (!parsed) {
      return reply.status(400).send({ error: { code: "invalid_signed_request" } })
    }

    try {
      const deleted = await deleteMetaConnections(parsed.metaUserId)
      req.log.info({ deleted }, "[meta] data deletion request fulfilled")

      // Mint the code only AFTER the delete succeeds, so a code always means done.
      const code = issueConfirmationCode(parsed.metaUserId, appSecret, Date.now())
      return {
        url: `${appBaseUrl()}/v1/social/meta/data-deletion/status?code=${encodeURIComponent(code)}`,
        confirmation_code: code,
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to process the deletion request")
    }
  })

  // POST /v1/social/meta/deauthorize — fired when a user removes the app in
  // their Facebook settings. Same signature scheme; we treat it as a deletion
  // because a revoked login leaves the stored tokens dead anyway.
  app.post("/v1/social/meta/deauthorize", async (req, reply) => {
    const appSecret = process.env.META_APP_SECRET
    if (!appSecret) {
      return reply.status(503).send({ error: { code: "provider_not_configured" } })
    }

    const signed = readSignedRequest(req.body)
    const parsed = signed ? parseSignedRequest(signed, appSecret) : null
    if (!parsed) {
      return reply.status(400).send({ error: { code: "invalid_signed_request" } })
    }

    try {
      const deleted = await deleteMetaConnections(parsed.metaUserId)
      req.log.info({ deleted }, "[meta] deauthorize callback fulfilled")
      return { success: true }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to process the deauthorization")
    }
  })

  // GET /v1/social/meta/data-deletion/status?code=... — the human-readable page
  // Meta links the user to. Public by design: the code is the capability.
  app.get("/v1/social/meta/data-deletion/status", async (req, reply) => {
    const appSecret = process.env.META_APP_SECRET
    const { code } = req.query as { code?: string }
    const valid = Boolean(appSecret && code && verifyConfirmationCode(code, appSecret))
    return reply.status(valid ? 200 : 404).type("text/html; charset=utf-8").send(statusPage(valid ? "deleted" : "unknown"))
  })
}
