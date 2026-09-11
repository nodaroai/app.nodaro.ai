import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify"
import { createHash } from "node:crypto"
import { z } from "zod"
import { config } from "../lib/config.js"
import { appBaseUrl } from "../lib/deployment-urls.js"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { redeemCode } from "../lib/oauth-codes.js"
import { mintAppAccessToken } from "../lib/oauth-tokens.js"
import {
  PLUGIN_CLIENTS,
  USER_CODE_MAX_ATTEMPTS,
  confirmUserCode,
  createSession,
  holdGrant,
  markDenied,
  peekSession,
  pollSession,
  type PluginClient,
} from "../lib/plugin-connect.js"
import type { Scope } from "../lib/scopes.js"
import { formatZodError } from "../lib/zod-error.js"
import { findAppByClientId } from "./developer-apps.js"

/**
 * The plugin connect handshake — see `lib/plugin-connect.ts` for why a plugin
 * cannot take the ordinary redirect. Four public routes:
 *
 *   POST /v1/oauth/plugin/session       the plugin opens a session
 *   GET  /v1/oauth/plugin/callback      the browser lands here after consent;
 *                                       holds the grant and asks for the code
 *   POST /v1/oauth/plugin/confirm       the user types the code the plugin shows
 *   GET  /v1/oauth/plugin/session/:id   the plugin polls, poll key in a header
 *
 * Each plugin connects through a developer app the operator registers once
 * (dashboard or `POST /v1/developer-apps`) with this deployment's callback URL
 * in `redirect_uris` and `PLUGIN_SCOPES` in `scopes_requested`, then names by
 * client id in the env. Unset, every route answers 503 and nothing else
 * changes.
 */

/**
 * What a plugin gets: enough to run the media routes and follow its jobs.
 * `jobs:read` is the one a route enforces today; the rest are on the consent
 * screen so the user sees what the plugin will actually do. The callback
 * refuses a grant carrying anything outside this set — the consent URL is
 * built here, but a hand-built one could ask the app's whole registration.
 */
export const PLUGIN_SCOPES: readonly Scope[] = ["jobs:read", "assets:read", "assets:write", "credits:read"]

export const POLL_KEY_HEADER = "x-plugin-poll-key"

/** The developer app each plugin connects through. Empty = not configured on this deployment. */
const CLIENT_ID_OF: Record<PluginClient, () => string> = {
  figma: () => config.FIGMA_PLUGIN_OAUTH_CLIENT_ID,
}

/**
 * One string, used as `redirect_uri` when sending the user out AND when
 * redeeming the code — `redeemCode` compares them byte for byte.
 */
export function pluginCallbackUrl(): string {
  return `${appBaseUrl()}/v1/oauth/plugin/callback`
}

const SESSION_ID = z.string().regex(/^pcs_[0-9a-f]{48}$/)

const sessionBody = z.object({ client: z.enum(PLUGIN_CLIENTS) })

const callbackQuery = z.object({
  state: SESSION_ID,
  code: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
})

const confirmBody = z.object({
  state: SESSION_ID,
  code: z.string().min(1).max(32),
})

const pollParams = z.object({ id: SESSION_ID })
const pollHeaders = z.object({ [POLL_KEY_HEADER]: z.string().min(1).max(256) })

/**
 * The global limiter keys on any `Authorization` header before falling back to
 * the address — on a public route that lets a caller pick a fresh bucket per
 * request with a random bearer. These routes key on what they actually trust:
 * the poll key for the poll, the client address for the rest.
 */
type RateLimitedRequest = { headers: Record<string, string | string[] | undefined>; ip?: string }

function addressKey(req: RateLimitedRequest): string {
  const xff = req.headers["x-forwarded-for"]
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim()
  return req.ip || "unknown"
}

function pollKeyKey(req: RateLimitedRequest): string {
  const key = req.headers[POLL_KEY_HEADER]
  if (typeof key === "string" && key.length > 0) return "poll:" + createHash("sha256").update(key).digest("hex")
  return addressKey(req)
}

type Resolved =
  | { app: NonNullable<Awaited<ReturnType<typeof findAppByClientId>>> }
  | { error: "plugin_connect_not_configured" | "plugin_connect_misconfigured" }

/**
 * The developer app behind a plugin, checked the way the consent screen will
 * check it — so a misregistered app fails here, loudly and in the log, rather
 * than as a mystery on the consent page. The detail stays in the log: the
 * route is public, and what a deployment got wrong is the operator's to read.
 */
async function resolvePluginApp(client: PluginClient, log: FastifyBaseLogger): Promise<Resolved> {
  const clientId = CLIENT_ID_OF[client]()
  if (!clientId) return { error: "plugin_connect_not_configured" }

  const misconfigured = (detail: string): Resolved => {
    log.error({ client, clientId, detail }, "[plugin-connect] developer app is misregistered")
    return { error: "plugin_connect_misconfigured" }
  }

  const dApp = await findAppByClientId(clientId)
  if (!dApp) return misconfigured("unknown or suspended client_id")

  const callback = pluginCallbackUrl()
  if (!((dApp.redirect_uris as string[] | null) ?? []).includes(callback)) {
    return misconfigured(`redirect_uris must include ${callback}`)
  }

  // No exemption for DCR-registered apps here: the consent route waives its
  // scope check for those, which is exactly the ceiling this flow relies on.
  const requested = (dApp.scopes_requested as string[] | null) ?? []
  const missing = PLUGIN_SCOPES.filter((s) => !requested.includes(s))
  if (missing.length > 0) return misconfigured(`scopes_requested is missing ${missing.join(", ")}`)

  return { app: dApp }
}

const RESOLVE_MESSAGES: Record<Exclude<Resolved, { app: unknown }>["error"], string> = {
  plugin_connect_not_configured: "Plugin connect is not configured on this deployment.",
  plugin_connect_misconfigured: "The plugin's developer app is not registered correctly. The server log names what is missing.",
}

/** Session ids are public, but the redaction policy still treats `state` as sensitive — log a handle, not the id. */
const handleOf = (sessionId: string) => sessionId.slice(0, 12)

// ---------------------------------------------------------------------------
// The pages the browser sees. Nothing from the request is ever interpolated
// except the session id, which the Zod regex has already confined to
// `pcs_` + hex, and is escaped regardless.
// ---------------------------------------------------------------------------

type PageKind = "connected" | "declined" | "expired" | "invalid" | "denied"

const PAGE_COPY: Record<PageKind, { title: string; body: string }> = {
  connected: { title: "Connected", body: "Nodaro is connected. You can close this tab and go back to your plugin." },
  declined: { title: "Not connected", body: "You declined the connection. Nothing was changed — close this tab and try again from the plugin whenever you like." },
  expired: { title: "This link has expired", body: "The connection request is no longer valid. Go back to the plugin and press Connect again." },
  invalid: { title: "Something is not right", body: "This connection request could not be completed. Go back to the plugin and press Connect again." },
  denied: { title: "Not connected", body: "That code was wrong too many times, so this connection request has been cancelled. Go back to the plugin and press Connect again." },
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c)

function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} - Nodaro</title></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.6">
${inner}
</body></html>`
}

function statusPage(kind: PageKind): string {
  const { title, body } = PAGE_COPY[kind]
  return shell(title, `<h1 style="font-size:1.25rem">${escapeHtml(title)}</h1>\n<p>${escapeHtml(body)}</p>`)
}

/** The one step that ties the person pressing Allow to the plugin that asked. */
function codeFormPage(sessionId: string, attemptsLeft: number | null): string {
  const wrong = attemptsLeft === null
    ? ""
    : `<p style="color:#b42318">That code did not match. ${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left.</p>`
  return shell(
    "Enter the code from your plugin",
    `<h1 style="font-size:1.25rem">One more step</h1>
<p>Type the code your plugin is showing. This is how Nodaro knows the plugin asking is the one in front of you.</p>
${wrong}
<form method="post" action="/v1/oauth/plugin/confirm">
<input type="hidden" name="state" value="${escapeHtml(sessionId)}">
<label for="code" style="display:block;margin-bottom:.5rem">Code</label>
<input id="code" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required
  placeholder="XXXX-XXXX" style="font:inherit;font-size:1.25rem;letter-spacing:.15em;padding:.5rem .75rem;width:12em">
<button type="submit" style="font:inherit;padding:.5rem 1rem;margin-left:.5rem">Connect</button>
</form>`,
  )
}

// ---------------------------------------------------------------------------

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/oauth/plugin/session",
  description: "Open a plugin connect session. Public. Returns the consent URL to send the user to, the poll key that authorises reading the outcome, and the code the user will type after consenting.",
  request: { body: { content: { "application/json": { schema: sessionBody } } } },
  responses: {
    200: { description: "Session opened" },
    503: { description: "Plugin connect is not configured, or the plugin's developer app is misregistered" },
  },
})
openApiRegistry.registerPath({
  method: "get",
  path: "/v1/oauth/plugin/callback",
  description: "Where the consent screen sends the browser. Holds the grant against the session named by `state` and asks the user for the plugin's code; renders a page either way.",
  request: { query: callbackQuery },
  responses: { 200: { description: "HTML: code form, or declined" }, 400: { description: "HTML: expired or invalid" } },
})
openApiRegistry.registerPath({
  method: "post",
  path: "/v1/oauth/plugin/confirm",
  description: "The user types the code the plugin is showing. Releases the held grant on a match; five wrong codes settle the session as denied.",
  request: { body: { content: { "application/x-www-form-urlencoded": { schema: confirmBody }, "application/json": { schema: confirmBody } } } },
  responses: { 200: { description: "HTML: connected, or the form again" }, 400: { description: "HTML: expired, invalid or denied" } },
})
openApiRegistry.registerPath({
  method: "get",
  path: "/v1/oauth/plugin/session/{id}",
  description: `Poll a plugin connect session. Public; authorised by the \`${POLL_KEY_HEADER}\` header. A granted session answers once with the access token and is then gone.`,
  request: { params: pollParams, headers: pollHeaders },
  responses: {
    200: { description: "`{ status: pending }`, `{ status: denied }`, or `{ status: granted, token, tokenType, scope, expiresIn }`" },
    404: { description: "Unknown session, expired session, or wrong poll key — indistinguishable on purpose" },
  },
})

export async function oauthPluginConnectRoutes(app: FastifyInstance) {
  const html = (reply: FastifyReply, status: number, body: string) =>
    reply.status(status).type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(body)

  app.post(
    "/v1/oauth/plugin/session",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: addressKey } } },
    async (req, reply) => {
      const parsed = sessionBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }

      const resolved = await resolvePluginApp(parsed.data.client, req.log)
      if ("error" in resolved) {
        return reply.status(503).send({ error: { code: resolved.error, message: RESOLVE_MESSAGES[resolved.error] } })
      }

      const session = await createSession(parsed.data.client)

      const authorize = new URL(`${appBaseUrl()}/oauth/authorize`)
      authorize.searchParams.set("client_id", resolved.app.client_id as string)
      authorize.searchParams.set("redirect_uri", pluginCallbackUrl())
      authorize.searchParams.set("response_type", "code")
      authorize.searchParams.set("scope", PLUGIN_SCOPES.join(" "))
      authorize.searchParams.set("state", session.sessionId)

      return reply.header("Cache-Control", "no-store").send({
        sessionId: session.sessionId,
        pollKey: session.pollKey,
        userCode: session.userCode,
        authorizeUrl: authorize.toString(),
        expiresIn: session.expiresIn,
      })
    },
  )

  app.get("/v1/oauth/plugin/callback", async (req, reply) => {
    const parsed = callbackQuery.safeParse(req.query)
    if (!parsed.success) return html(reply, 400, statusPage("invalid"))
    const { state, code, error } = parsed.data

    // The session first, and it has to be untouched: an unknown, expired or
    // already-settled state must not redeem a code — that would burn a valid
    // code for nothing, or hold a grant for nobody.
    const session = await peekSession(state)
    if (!session) return html(reply, 400, statusPage("expired"))

    if (error) {
      const recorded = await markDenied(state)
      return html(reply, recorded ? 200 : 400, statusPage(recorded ? "declined" : "expired"))
    }
    if (session.status !== "pending") return html(reply, 400, statusPage("expired"))
    if (!code) return html(reply, 400, statusPage("invalid"))

    const grant = redeemCode(code, pluginCallbackUrl())
    if (!grant) return html(reply, 400, statusPage("expired"))

    // Three things the code has to be, all of which a hand-built consent URL
    // could break. It must belong to the plugin's own app — any developer may
    // list our callback in their app's redirect_uris. It must carry exactly the
    // plugin's scopes — the consent screen accepts anything the app registered,
    // and minting rewrites the app↔user authorization's scopes for every token
    // that user holds. And it must not carry a PKCE challenge — this flow never
    // sets one, and redeeming such a code here would be redemption with the
    // verifier stripped.
    const resolved = await resolvePluginApp(session.client, req.log)
    if ("error" in resolved || grant.appId !== resolved.app.id) {
      req.log.warn({ session: handleOf(state), grantAppId: grant.appId }, "[plugin-connect] code does not belong to the plugin's app")
      return html(reply, 400, statusPage("invalid"))
    }
    const scopesAllowed = grant.scopes.length > 0 && grant.scopes.every((s) => (PLUGIN_SCOPES as readonly string[]).includes(s))
    if (!scopesAllowed || grant.codeChallenge) {
      req.log.warn({ session: handleOf(state), scopes: grant.scopes, pkce: Boolean(grant.codeChallenge) }, "[plugin-connect] code is not the plugin flow's own")
      return html(reply, 400, statusPage("invalid"))
    }

    const held = await holdGrant(state, { appId: grant.appId, userId: grant.userId, scopes: grant.scopes })
    return held ? html(reply, 200, codeFormPage(state, null)) : html(reply, 400, statusPage("expired"))
  })

  app.post(
    "/v1/oauth/plugin/confirm",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: addressKey } } },
    async (req, reply) => {
      const parsed = confirmBody.safeParse(req.body)
      if (!parsed.success) return html(reply, 400, statusPage("invalid"))
      const { state, code } = parsed.data

      const result = await confirmUserCode(state, code)
      switch (result) {
        case "granted":
          return html(reply, 200, statusPage("connected"))
        case "denied":
          return html(reply, 400, statusPage("denied"))
        case "wrong": {
          const attemptsLeft = Math.max(USER_CODE_MAX_ATTEMPTS - (await attemptsUsed(state)), 1)
          return html(reply, 200, codeFormPage(state, attemptsLeft))
        }
        default:
          return html(reply, 400, statusPage("expired"))
      }
    },
  )

  app.get(
    "/v1/oauth/plugin/session/:id",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: pollKeyKey } } },
    async (req, reply) => {
      const params = pollParams.safeParse(req.params)
      if (!params.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(params.error) } })
      }
      const headers = pollHeaders.safeParse(req.headers)
      if (!headers.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(headers.error) } })
      }
      const { id } = params.data
      const pollKey = headers.data[POLL_KEY_HEADER]

      reply.header("Cache-Control", "no-store")

      const result = await pollSession(id, pollKey)
      if (result.status === "unknown") {
        return reply.status(404).send({ error: { code: "not_found", message: "Unknown or expired session" } })
      }
      if (result.status !== "granted") return reply.send({ status: result.status })

      const minted = await mintAppAccessToken(result.grant)
      if (!minted.ok) {
        // Put the consent back so the plugin's next poll can try again; the
        // user should not have to redo the browser for a database hiccup.
        await result.restore()
        req.log.error({ session: handleOf(id), failed: minted.failed }, "[plugin-connect] could not mint the access token")
        return reply.status(500).send({ error: { code: "server_error", message: "Failed to mint token" } })
      }
      return reply.send({
        status: "granted",
        token: minted.accessToken,
        tokenType: minted.tokenType,
        scope: minted.scope,
        expiresIn: minted.expiresIn,
      })
    },
  )
}

/** How many wrong codes a session has taken, for the "tries left" line. */
async function attemptsUsed(sessionId: string): Promise<number> {
  const session = await peekSession(sessionId)
  return session?.attempts ?? 0
}
