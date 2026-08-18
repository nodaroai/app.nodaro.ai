import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { appBaseUrl } from "../lib/deployment-urls.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  clearNodaroConnection,
  forgetNodaroClient,
  getNodaroConnection,
  getNodaroCredential,
  getNodaroProviderPrefs,
  nodaroCloudBase,
  nodaroCloudFetch,
  readNodaroConnectionState,
  saveNodaroConnection,
} from "../lib/nodaro-connect.js"
import { saveNodaroProviderPrefs } from "../lib/app-settings.js"
import { rejectProgrammaticAuth } from "../lib/api-auth-mode.js"
import { hasAdmin } from "../lib/config.js"
import { checkIsAdmin } from "../lib/admin-check.js"
import { unregisterNodaroCloudProvider } from "../providers/nodaro/index.js"

/**
 * Instance-side connect flow (Phase 4a, self-hosted editions only).
 *
 * start    -> self-register via the cloud's DCR (once) and hand the browser
 *             the cloud consent URL.
 * callback -> exchange the one-shot code for the instance's ndr_app_ token.
 * status   -> connected? + live balance proxied from the cloud (the token
 *             never reaches the browser).
 * disconnect -> forget the connection locally (cloud-side revocation lives
 *             in the cloud's Connected Instances page).
 */

const INSTANCE_SCOPES = "assets:write workflows:execute jobs:read credits:read"

function instanceBase(): string {
  return appBaseUrl()
}

function callbackUrl(): string {
  return `${instanceBase()}/v1/nodaro-connect/callback`
}

/**
 * Every failure of /start must be something a self-hoster can act on: the
 * setup screen renders it inline and the integrations card toasts it. Two
 * rules — say WHO refused (nodaro.ai, not "this server": the cloud's own
 * refusal wording reads as a local misconfiguration when relayed verbatim),
 * and never leak transport detail (a probe in tools/community-smoke.mjs
 * fails on raw error codes / stack fragments in these messages).
 */
const CLOUD_HOST = () => new URL(nodaroCloudBase()).host

function cloudRefusal(status: number, body: { error?: { code?: string; message?: string } } | null) {
  // Too many unfinished connection attempts from this address (the cloud's
  // 24 h open-registration cap). The old relay said "complete the flow on an
  // existing one" — which the install cannot do on the user's behalf. Say
  // what to do instead.
  if (body?.error?.code === "too_many_open_registrations") {
    return {
      status: 429,
      code: "cloud_connect_rate_limited",
      message:
        "Too many unfinished nodaro.ai connection attempts from this address in the last 24 hours. " +
        "Try again later, or paste your own provider key on Install health in the meantime.",
    }
  }
  if (body?.error?.code === "community_connect_disabled") {
    return {
      status: 503,
      code: "cloud_connect_unavailable",
      message:
        "nodaro.ai is not accepting connections from self-hosted instances right now. " +
        "Use your own provider keys, or try again later.",
    }
  }
  const detail = body?.error?.message?.trim()
  return {
    status: 502,
    code: "cloud_registration_failed",
    message: `nodaro.ai rejected this instance's registration${detail ? `: ${detail}` : ""}. Use your own provider keys, or try again later.`,
  }
}

export async function nodaroConnectRoutes(app: FastifyInstance) {
  app.post("/v1/nodaro-connect/start", async (req, reply) => {
    try {
      // "Nothing stored" and "the store is unreachable" must not both read as
      // "register again": on a transient read failure that would mint a
      // duplicate DCR client on the cloud and overwrite the stored one.
      const stored = await readNodaroConnectionState()
      if (stored.state === "unavailable") {
        return reply.status(503).send({
          error: {
            code: "settings_unavailable",
            message:
              "This install could not read its own settings just now, so the nodaro.ai connection cannot start. " +
              "Check Install health and try again in a moment.",
          },
        })
      }

      let conn = await getNodaroConnection()

      // A kept registration can DIE cloud-side (Connected Instances →
      // Disconnect revokes it; stale never-consented registrations expire) —
      // reusing it blindly hands the browser a consent screen that can only
      // say "Unknown client_id" (hit live 2026-08-18). Probe the PUBLIC
      // app-info endpoint first: an explicit not-found means re-register
      // fresh; any transient failure keeps the reuse path (#708's
      // registration-cap protection stays intact for live clients).
      if (conn) {
        try {
          const probe = await fetch(
            `${nodaroCloudBase()}/v1/oauth/app-info?client_id=${encodeURIComponent(conn.clientId)}`,
          )
          if (probe.status === 404) {
            req.log.warn(
              { clientId: conn.clientId },
              "[nodaro-connect] stored registration no longer exists on the cloud — re-registering",
            )
            await forgetNodaroClient()
            conn = null
          }
        } catch {
          // Cloud unreachable — the register/consent steps will surface it.
        }
      }

      if (!conn) {
        // One-time self-registration against the cloud DCR.
        let res: Response
        try {
          res = await fetch(`${nodaroCloudBase()}/v1/oauth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_name: `Nodaro instance (${new URL(instanceBase()).host})`,
              redirect_uris: [callbackUrl()],
              client_uri: instanceBase(),
              software_id: "nodaro-community",
              scope: INSTANCE_SCOPES,
            }),
          })
        } catch (err) {
          req.log.warn({ err }, "[nodaro-connect] cloud registration unreachable")
          return reply.status(503).send({
            error: {
              code: "cloud_unreachable",
              message:
                `Could not reach nodaro.ai (${CLOUD_HOST()}) from this install. ` +
                "Check its outbound network access or NODARO_CLOUD_URL, or use your own provider keys.",
            },
          })
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
          const refusal = cloudRefusal(res.status, body)
          req.log.warn({ status: res.status, body }, "[nodaro-connect] cloud registration refused")
          return reply.status(refusal.status).send({ error: { code: refusal.code, message: refusal.message } })
        }
        const reg = (await res.json()) as { client_id: string; client_secret: string }
        conn = { clientId: reg.client_id, clientSecret: reg.client_secret }
        await saveNodaroConnection(conn)
      }

      const authorizeUrl =
        `${nodaroCloudBase()}/oauth/authorize` +
        `?client_id=${encodeURIComponent(conn.clientId)}` +
        `&redirect_uri=${encodeURIComponent(callbackUrl())}` +
        `&scope=${encodeURIComponent(INSTANCE_SCOPES)}` +
        `&response_type=code`
      return reply.send({ authorizeUrl })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to start Nodaro connect")
    }
  })

  app.get("/v1/nodaro-connect/callback", async (req, reply) => {
    const query = z.object({ code: z.string().min(1) }).safeParse(req.query)
    if (!query.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Missing code" } })
    }
    try {
      const conn = await getNodaroConnection()
      if (!conn) {
        return reply.status(409).send({ error: { code: "not_registered", message: "Start the connect flow first" } })
      }
      const res = await fetch(`${nodaroCloudBase()}/v1/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code: query.data.code,
          client_id: conn.clientId,
          client_secret: conn.clientSecret,
          redirect_uri: callbackUrl(),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        return reply.status(502).send({
          error: {
            code: "token_exchange_failed",
            message: body?.error?.message ?? `Token exchange failed (${res.status})`,
          },
        })
      }
      const token = (await res.json()) as { access_token: string }
      await saveNodaroConnection({
        ...conn,
        accessToken: token.access_token,
        connectedAt: new Date().toISOString(),
      })
      // Land the operator back on the integrations page with a success flag.
      return reply.redirect(`${instanceBase()}/integrations?nodaro=connected`)
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to complete Nodaro connect")
    }
  })

  app.get("/v1/nodaro-connect/status", async (req, reply) => {
    try {
      const credential = await getNodaroCredential()
      if (!credential) return reply.send({ connected: false })
      // `source` tells the card how to render controls: "oauth" can be
      // disconnected here; "env" is .env-managed (read-only); "app" is a key
      // pasted in the app — managed (Change/Remove) on the provider tiles.
      const source = credential.source
      let balance: unknown = null
      try {
        const res = await nodaroCloudFetch("/v1/credits/balance")
        if (res.ok) balance = await res.json()
      } catch {
        // Balance is best-effort — a cloud hiccup must not read as "not connected".
      }
      const prefs = await getNodaroProviderPrefs()
      return reply.send({ connected: true, source, balance, prefs })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read Nodaro connection status")
    }
  })

  app.post("/v1/nodaro-connect/disconnect", async (req, reply) => {
    try {
      await clearNodaroConnection()
      // Symmetry with registration. Without this the provider stays in the
      // registry with no token behind it, so the router keeps selecting it and
      // the cloud client throws a raw "nodaro.ai is not connected" instead of
      // the empty-chain path that explains what to configure. The router's
      // self-heal can ADD the provider but never removes it, so the stale entry
      // survived until the process restarted (#771).
      unregisterNodaroCloudProvider()
      return reply.send({ ok: true })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to disconnect")
    }
  })

  // ── Routing prefs (4b): the post-connect choice, changeable later ──────
  // scope: "all" (nodaro serves everything) | "exclusives" (only the
  // exclusive nodes). precedence (meaningful for scope "all"): "nodaro"
  // ("ignore my other providers") | "local" (user keys first — the legacy
  // OAuth semantics). Absent row = legacy default, so pre-dialog installs
  // keep routing unchanged. Write gate mirrors provider-keys: first-party
  // JWT only, admin where the edition has admins.
  const prefsSchema = z.object({
    scope: z.enum(["all", "exclusives"]),
    precedence: z.enum(["nodaro", "local"]),
  })

  app.get("/v1/nodaro-connect/prefs", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    return reply.send({ prefs: await getNodaroProviderPrefs() })
  })

  app.put("/v1/nodaro-connect/prefs", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (rejectProgrammaticAuth(req, reply, "Nodaro routing preferences can only be changed from the Nodaro editor, not with an API or app token.")) return
    if (hasAdmin() && !(await checkIsAdmin(req.userId))) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Only an admin can change routing preferences on this edition" } })
    }
    const parsed = prefsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: 'scope must be "all"|"exclusives" and precedence "nodaro"|"local"' } })
    }
    try {
      // Write + cache-invalidate live in lib/app-settings.ts — the worker
      // picks the change up on its own cache expiry (≤60s) — routing
      // prefs, not correctness.
      await saveNodaroProviderPrefs(parsed.data)
      req.log.info({ userId: req.userId, ...parsed.data }, "[nodaro-connect] routing prefs set")
      return reply.send({ prefs: parsed.data })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to store routing preferences")
    }
  })
}
