import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { redis } from "../lib/queue.js"
import { callerKeyHash } from "./oauth-register.js"
import { getSsoProvider, getSsoProviders, ssoPublicInfo, type SsoProviderConfig } from "../lib/sso-providers.js"
import { isAllowedRequestHost, requestHostname } from "../lib/allowed-origins.js"
import { verifyAssertion, SsoAssertionError } from "../lib/sso-assertion.js"
import { claimAssertionJti } from "../lib/sso-replay.js"
import { resolveSsoUser } from "../lib/sso-linking.js"

const ParamsSchema = z.object({ provider: z.string() })
const QuerySchema = z.object({
  assertion: z.string().optional(),
  next: z.string().optional(),
  via: z.string().max(512).optional(),
})

/** Same-origin relative path only (§5.6 rule 5 — open-redirect guard). Mirrors
 *  the frontend consumeRedirect / auth-callback guard. */
function safeNext(raw: string | undefined): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw
  return "/projects"
}

/**
 * Where the login-button entry point bounces to for THIS request's host.
 *
 * One studio can be reached on more than one hostname, and each may have its own
 * IdP deployment; `initiateUrlByHost` names them, `initiateUrl` is the default
 * for every other host. Read with an OWN-key check: the host comes from an
 * attacker-influencable header, and a plain JSON object inherits
 * Object.prototype — a host literally named "constructor" would otherwise
 * resolve to a function.
 */
function initiateUrlFor(provider: SsoProviderConfig, host: string | null): string | undefined {
  const byHost = provider.initiateUrlByHost
  if (host && byHost && Object.prototype.hasOwnProperty.call(byHost, host)) return byHost[host]
  return provider.initiateUrl
}

/**
 * The IdP bounce re-pointed at the site the user originally came from.
 *
 * One IdP can sit behind several sites of the same family — a community's own
 * subdomain (`gur.example.com`) beside the shared `example.com` — each with its
 * own login session. The browser remembers which one the user arrived from and
 * passes it as `via`; sending re-login to that site instead of the shared
 * default keeps the user in the session they already have.
 *
 * `via` is a hint from the browser, so it can only NARROW within the host the
 * config already names: an https origin (no port, no credentials, no path)
 * whose host is the configured initiate host or a subdomain of it, and never
 * this studio's own host. Only the origin changes — the configured path is kept.
 * Anything else falls back to the configured URL rather than refusing, because
 * a stale or odd hint must never stop someone signing in.
 */
function initiateUrlVia(initiate: string, via: string | undefined, requestHost: string | null): string {
  if (!via) return initiate
  let base: URL
  let hint: URL
  try {
    base = new URL(initiate)
    hint = new URL(via)
  } catch {
    return initiate
  }
  if (base.protocol !== "https:" || hint.protocol !== "https:") return initiate
  if (hint.port || hint.username || hint.password || hint.search || hint.hash) return initiate
  if (hint.pathname !== "/") return initiate
  const host = hint.hostname
  if (host === requestHost) return initiate
  if (host !== base.hostname && !host.endsWith(`.${base.hostname}`)) return initiate
  const target = new URL(base)
  target.hostname = host
  return target.toString()
}

// Unauthenticated crypto + DB + Redis route ⇒ per-IP rate limit (the shared
// rateLimiter middleware keys on req.userId, which is undefined here, so it is
// inert on public routes — key on the caller IP instead, X-Forwarded-For-aware
// behind Caddy via callerKeyHash).
const RATE_WINDOW_SEC = 60
const RATE_MAX = 20
async function ssoRateLimited(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const key = `rl:sso:${callerKeyHash(req as never)}`
  try {
    // Create the counter WITH its TTL atomically on the first hit (SET .. EX .. NX).
    // A bare INCR followed by a separate EXPIRE leaves a TTL-less, forever-growing
    // key if that EXPIRE throws (a Redis blip) — permanently locking out the IP.
    const created = await redis.set(key, "1", "EX", RATE_WINDOW_SEC, "NX")
    const n = created === "OK" ? 1 : await redis.incr(key)
    if (created !== "OK") {
      // Self-heal a key that somehow has no TTL (a legacy row, or a crash between
      // a prior incr and its expire) so it can't accumulate past the window.
      const ttl = await redis.ttl(key)
      if (ttl < 0) await redis.expire(key, RATE_WINDOW_SEC)
    }
    if (n > RATE_MAX) {
      const ttl = await redis.ttl(key)
      reply.header("Retry-After", String(ttl > 0 ? ttl : RATE_WINDOW_SEC))
      await reply.status(429).send({ error: { code: "rate_limit_exceeded", message: "Too many SSO attempts. Try again later." } })
      return true
    }
  } catch {
    // Redis down: fail OPEN (a login path must not go dark with the cache);
    // the assertion signature is still the real gate.
  }
  return false
}

export async function ssoRoutes(app: FastifyInstance): Promise<void> {
  // Fail LOUD at BOOT: parse + validate EXTERNAL_SSO_PROVIDERS now. app.ts
  // `await`s this register, so a malformed provider list (e.g. a typo'd
  // secret-bearing entry) aborts startup rather than silently disabling auth
  // and 500ing every /v1/sso/* request on first hit. Memoized — the handlers
  // below reuse the parsed result.
  getSsoProviders()

  // Public provider metadata — id + label + kind ONLY. NEVER secrets.
  app.get("/v1/sso/providers", async () => {
    return { providers: getSsoProviders().map(ssoPublicInfo) }
  })

  // The exchange. The assertion rides the query string (spec-dictated GET);
  // Fastify request logging is enabled in app.ts, but its `req` serializer
  // (lib/log-redaction.ts) redacts the `assertion` + `sso_token` params
  // globally, so neither the assertion nor the minted token is ever persisted
  // to the logs. Do not log `req.url` here.
  app.get("/v1/sso/:provider", async (req, reply) => {
    if (await ssoRateLimited(req, reply)) return

    const params = ParamsSchema.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: { code: "invalid_request" } })
    const provider = getSsoProvider(params.data.provider)
    if (!provider) return reply.status(404).send({ error: { code: "unknown_provider" } })

    const query = QuerySchema.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: { code: "invalid_request" } })
    const { assertion, next, via } = query.data

    // Supabase-native providers are handled client-side (signInWithSSO /
    // signInWithOAuth) — the assertion exchange is only for bespoke issuers.
    if (provider.kind !== "assertion") {
      return reply.status(400).send({
        error: { code: "not_assertion_provider", message: "This provider uses Supabase-native OIDC/SAML; sign in from the login page." },
      })
    }

    // No assertion ⇒ this is the login-button entry point: bounce to the IdP
    // this request's host belongs to (initiateUrl for every unmapped host),
    // on the site the user came from when the browser knows it.
    if (!assertion) {
      const host = requestHostname(req)
      const initiate = initiateUrlFor(provider, host)
      if (initiate) return reply.redirect(initiateUrlVia(initiate, via, host))
      return reply.status(400).send({ error: { code: "no_assertion" } })
    }

    // 1. Verify signature / aud / exp / lifetime / jti.
    let verified
    try {
      verified = await verifyAssertion(provider, assertion)
    } catch (e) {
      if (e instanceof SsoAssertionError) return reply.status(401).send({ error: { code: e.code } })
      throw e
    }

    // 2. Replay guard — one redemption per jti.
    const fresh = await claimAssertionJti(provider.id, verified.jti, verified.expSeconds)
    if (!fresh) return reply.status(401).send({ error: { code: "assertion_replayed" } })

    // 3. Account-linking rules — reject BEFORE minting any token.
    const link = await resolveSsoUser(provider, verified)
    if (!link.ok) return reply.status(403).send({ error: { code: link.code, message: link.message } })

    // 4. Mint a one-time Supabase login token and hand it to the /sso landing.
    const { data, error } = await supabase.auth.admin.generateLink({ type: "magiclink", email: link.email })
    const hashedToken = data?.properties?.hashed_token
    if (error || !hashedToken) {
      return reply.status(500).send({ error: { code: "session_mint_failed" } })
    }

    // 5. Redirect to the landing. Relative for any allow-listed host (the hosted
    //    lane is same-origin by construction — Caddy fronts both the SPA and
    //    /v1, and the studio may answer on more than one hostname while
    //    PUBLIC_URL can only name one); PUBLIC_URL only for a host that is NOT
    //    allow-listed, i.e. a split-origin dev setup. The test is on the HOST,
    //    not the whole origin, on purpose: whether the forwarded scheme
    //    survives at all depends on the proxy chain (frontend/Caddyfile's
    //    trusted_proxies decides it), and a relative redirect never needs a
    //    scheme — the browser resolves it against the page it is already on.
    const base = isAllowedRequestHost(req) ? "" : config.PUBLIC_URL || ""
    const url = `${base}/sso?sso_token=${encodeURIComponent(hashedToken)}&next=${encodeURIComponent(safeNext(next))}`
    return reply.redirect(url)
  })
}
