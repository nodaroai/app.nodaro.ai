import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { appBaseUrl } from "../lib/deployment-urls.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  clearNodaroConnection,
  getNodaroConnection,
  getNodaroCredential,
  nodaroCloudBase,
  nodaroCloudFetch,
  readNodaroConnectionState,
  saveNodaroConnection,
} from "../lib/nodaro-connect.js"

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
      // `source` tells the card whether this is the OAuth connection (which it
      // can disconnect) or NODARO_API_KEY from .env (which it cannot).
      const source = credential.source
      let balance: unknown = null
      try {
        const res = await nodaroCloudFetch("/v1/credits/balance")
        if (res.ok) balance = await res.json()
      } catch {
        // Balance is best-effort — a cloud hiccup must not read as "not connected".
      }
      return reply.send({ connected: true, source, balance })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read Nodaro connection status")
    }
  })

  app.post("/v1/nodaro-connect/disconnect", async (req, reply) => {
    try {
      await clearNodaroConnection()
      return reply.send({ ok: true })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to disconnect")
    }
  })
}
