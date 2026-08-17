import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { randomBytes, createHash } from "node:crypto"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { ALL_SCOPES } from "../lib/scopes.js"
import { hashSecret } from "./developer-apps.js"
import { sendInternalError } from "../lib/http-errors.js"

const SECRET_TTL_DAYS = 90
const CLIENT_ID_PREFIX = "ndr_dcr_"

// Abuse mitigations for unauthenticated DCR (RFC 7591 endpoint is public by design):
// - Per-IP rate limit: 10 req/min via @fastify/rate-limit (registered in app.ts).
//   Configured per-route below via the `config.rateLimit` option.
// - Open-registration cap: max N unconsumed registrations per identity in
//   the last 24 h (rejected with 429 once exceeded). "Consumed" = the row's
//   owner_user_id was set at first consent (oauth.ts). The IDENTITY differs
//   by kind, and that difference matters:
//     * dynamic_mcp — (client_name + overlapping redirect_uris), as before.
//     * community_instance — the CALLER (hashed X-Forwarded-For / ip). Every
//       default self-hosted install registers as "Nodaro instance
//       (localhost:3000)" with the same callback URL, so a name-keyed cap was
//       ONE bucket shared by every install in the world: five people clicking
//       Connect in a day and the sixth got 429 (#708, release check 10).
//   Storage exhaustion is bounded by this cap plus the stale-row sweep
//   (lib/oauth-dcr-sweep.ts).
const OPEN_REGISTRATIONS_CAP = 5
const OPEN_REGISTRATIONS_CAP_PER_CALLER = 10
const OPEN_REGISTRATION_LOOKBACK_MS = 24 * 60 * 60 * 1000

/**
 * The caller for the community-instance cap. Same derivation as the global
 * rate limiter's unauthenticated branch (app.ts rateLimitKeyGenerator): the
 * first X-Forwarded-For hop, else the socket ip. Hashed — an ip is personal
 * data and the row outlives the request.
 */
export function callerKeyHash(req: { headers: Record<string, string | string[] | undefined>; ip?: string }): string {
  const xff = req.headers["x-forwarded-for"]
  const raw = (typeof xff === "string" && xff.length > 0 ? xff.split(",")[0]!.trim() : req.ip) || "unknown"
  return createHash("sha256").update(raw).digest("hex")
}

// IMPORTANT: this schema must NOT be `.strict()`. RFC 7591 §2 requires the
// registration endpoint to IGNORE unrecognized client metadata, and real MCP
// clients (Claude.ai, Cursor, ChatGPT, …) send extra fields we don't model —
// `application_type`, `software_id`, `software_version`, `jwks`, etc. Zod's
// default object behavior strips unknown keys, which is exactly the
// spec-mandated "ignore" semantics. A `.strict()` here 400s the whole request
// and breaks DCR for every such client ("Couldn't register with Nodaro's
// sign-in service"). The route only ever reads the whitelisted fields below,
// so dropping the extras is safe. Regression test:
// __tests__/oauth-register.test.ts "ignores unknown RFC 7591 metadata fields".
const registerBody = z.object({
  client_name: z.string().min(1).max(100),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
  token_endpoint_auth_method: z.string().optional(),
  client_uri: z.string().url().optional(),
  logo_uri: z.string().url().optional(),
  policy_uri: z.string().url().optional(),
  tos_uri: z.string().url().optional(),
  contacts: z.array(z.string().email()).optional(),
  /** RFC 7591 software identifier. `"nodaro-community"` marks a self-hosted
   *  community instance registering for cloud-connect (Phase 4a) — routed to
   *  kind=community_instance behind COMMUNITY_CONNECT_ENABLED. */
  software_id: z.string().max(100).optional(),
})

const COMMUNITY_SOFTWARE_ID = "nodaro-community"

function genClientId(): string {
  return CLIENT_ID_PREFIX + randomBytes(16).toString("hex")
}

function genClientSecret(): string {
  return randomBytes(32).toString("hex")
}

function parseScope(scope?: string): string[] {
  if (!scope) return [...ALL_SCOPES]
  const requested = scope.split(/\s+/).filter(Boolean)
  const filtered = requested.filter((s) => (ALL_SCOPES as readonly string[]).includes(s))
  // DCR clients (Claude.ai, etc.) often declare legacy OAuth scopes like
  // "openid profile email" that don't intersect Nodaro's surface. Falling back
  // to [] would make the DB row's scopes_requested empty, then every later
  // authorize call fails with invalid_scope. Treat "no recognized scopes" as
  // "all scopes" — the consent UI is the actual gate.
  return filtered.length > 0 ? filtered : [...ALL_SCOPES]
}

async function countOpenRegistrations(clientName: string, redirectUris: string[], kind: string): Promise<number> {
  const cutoff = new Date(Date.now() - OPEN_REGISTRATION_LOOKBACK_MS).toISOString()
  // Open = same kind + same name + overlapping redirect URIs + no consummated
  // authorization yet. "No authorization" = owner_user_id IS NULL (set during
  // the first OAuth consent step, for MCP clients and community instances).
  const { count, error } = await supabase
    .from("developer_apps")
    .select("id", { count: "exact", head: true })
    .eq("kind", kind)
    .eq("name", clientName)
    .is("owner_user_id", null)
    .gte("created_at", cutoff)
    .overlaps("redirect_uris", redirectUris)
  if (error) {
    return 0
  }
  return count ?? 0
}

/** Community instances: open registrations from the same caller in the window. */
async function countOpenRegistrationsByCaller(ipHash: string): Promise<number> {
  const cutoff = new Date(Date.now() - OPEN_REGISTRATION_LOOKBACK_MS).toISOString()
  const { count, error } = await supabase
    .from("developer_apps")
    .select("id", { count: "exact", head: true })
    .eq("kind", "community_instance")
    .eq("registered_ip_hash", ipHash)
    .is("owner_user_id", null)
    .gte("created_at", cutoff)
  if (error) {
    return 0
  }
  return count ?? 0
}

export async function registerOauthRegister(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/oauth/register",
    {
      config: {
        // 10 req/min/IP. @fastify/rate-limit must be registered globally in app.ts.
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (req: FastifyRequest, reply) => {
      const parsed = registerBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid registration request",
          },
        })
      }
      const meta = parsed.data

      // Community-instance registrations ride their own flag, not the MCP
      // allowlist — an instance's client_name is its owner-chosen site name,
      // which an allowlist can never enumerate.
      const isCommunityInstance = meta.software_id === COMMUNITY_SOFTWARE_ID
      if (isCommunityInstance && !config.COMMUNITY_CONNECT_ENABLED) {
        return reply.status(403).send({
          error: {
            code: "community_connect_disabled",
            message: "Community cloud-connect is not enabled on this server.",
          },
        })
      }

      // Kill-switch: operator can disable DCR entirely without taking down /mcp.
      if (!isCommunityInstance && config.MCP_DYNAMIC_REGISTRATION === "off") {
        return reply.status(403).send({
          error: {
            code: "dcr_disabled",
            message: "Dynamic client registration is disabled on this server. Contact the operator for a static client_id/client_secret.",
          },
        })
      }
      // Allowlist gate (operator-controlled set of acceptable client_names).
      if (!isCommunityInstance && config.MCP_DYNAMIC_REGISTRATION === "allowlist") {
        const allowed = config.MCP_DCR_ALLOWLIST_PARSED
        if (!allowed.includes(meta.client_name)) {
          return reply.status(403).send({
            error: {
              code: "client_not_allowed",
              message: `client_name "${meta.client_name}" is not on the dynamic registration allowlist. Set MCP_DYNAMIC_REGISTRATION=open to disable, or contact the operator.`,
            },
          })
        }
      }

      // Open-registration cap — see the note at the top of the file for why
      // the identity differs by kind.
      const ipHash = callerKeyHash(req)
      if (isCommunityInstance) {
        const openByCaller = await countOpenRegistrationsByCaller(ipHash)
        if (openByCaller >= OPEN_REGISTRATIONS_CAP_PER_CALLER) {
          return reply.status(429).send({
            error: {
              code: "too_many_open_registrations",
              message: `${openByCaller} connection attempts from this address in the last 24 hours were never completed. Finish the nodaro.ai consent flow you already started, or try again later.`,
            },
          })
        }
      } else {
        const openCount = await countOpenRegistrations(meta.client_name, meta.redirect_uris, "dynamic_mcp")
        if (openCount >= OPEN_REGISTRATIONS_CAP) {
          return reply.status(429).send({
            error: {
              code: "too_many_open_registrations",
              message: `${openCount} unconsumed registration(s) for "${meta.client_name}" with these redirect_uris already exist. Complete the OAuth consent flow on an existing one, or wait for stale rows to be cleaned up.`,
            },
          })
        }
      }

      const clientId = genClientId()
      const clientSecret = genClientSecret()
      const scopes = parseScope(meta.scope)

      const { data, error } = await supabase
        .from("developer_apps")
        .insert({
          owner_user_id: null,
          kind: isCommunityInstance ? "community_instance" : "dynamic_mcp",
          name: meta.client_name,
          description: isCommunityInstance
            ? `Self-hosted Nodaro community instance (${meta.client_name})`
            : `Dynamically registered MCP client (${meta.client_name})`,
          logo_url: meta.logo_uri ?? null,
          homepage_url: meta.client_uri ?? null,
          // Instances get CORS for their own origin (dynamic-origins consumes
          // this) so their browser UI can talk to the cloud during connect.
          allowed_origins: isCommunityInstance && meta.client_uri
            ? [new URL(meta.client_uri).origin]
            : [],
          redirect_uris: meta.redirect_uris,
          client_id: clientId,
          client_secret_hash: await hashSecret(clientSecret),
          scopes_requested: scopes,
          status: "active",
          // Who registered (hashed) — the community-instance cap counts by it.
          registered_ip_hash: ipHash,
        })
        .select("id, client_id, created_at")
        .single()

      if (error || !data) {
        req.log.error({ err: error }, "DCR insert failed")
        return sendInternalError(reply, req, error, "Failed to register client")
      }

      const issuedAtSec = Math.floor(new Date(data.created_at).getTime() / 1000)
      const expiresAtSec = issuedAtSec + SECRET_TTL_DAYS * 86400

      return reply.status(201).send({
        client_id: data.client_id,
        client_secret: clientSecret,
        client_id_issued_at: issuedAtSec,
        client_secret_expires_at: expiresAtSec,
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        client_name: meta.client_name,
        redirect_uris: meta.redirect_uris,
        scope: scopes.join(" "),
      })
    },
  )
}
