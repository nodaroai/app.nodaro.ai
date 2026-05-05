import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { createHash, randomBytes } from "node:crypto"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { ALL_SCOPES } from "../lib/scopes.js"

const SECRET_TTL_DAYS = 90
const CLIENT_ID_PREFIX = "ndr_dcr_"

// Abuse mitigations for unauthenticated DCR (RFC 7591 endpoint is public by design):
// - Per-IP rate limit: 10 req/min via @fastify/rate-limit (registered in app.ts).
//   Configured per-route below via the `config.rateLimit` option.
// - Per-(client_name + redirect_uris) open-registration cap: max 5 unconsumed
//   registrations from the same identity (rejected with 429 once exceeded).
//   Storage exhaustion is bounded by this cap.
const OPEN_REGISTRATIONS_CAP = 5
const OPEN_REGISTRATION_LOOKBACK_MS = 24 * 60 * 60 * 1000

const registerBody = z
  .object({
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
  })
  .strict()

function genClientId(): string {
  return CLIENT_ID_PREFIX + randomBytes(16).toString("hex")
}

function genClientSecret(): string {
  return randomBytes(32).toString("hex")
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex")
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

async function countOpenRegistrations(clientName: string, redirectUris: string[]): Promise<number> {
  const cutoff = new Date(Date.now() - OPEN_REGISTRATION_LOOKBACK_MS).toISOString()
  // Open = kind=dynamic_mcp + same name + overlapping redirect URIs + no consummated authorization yet.
  // We approximate "no authorization" by checking owner_user_id IS NULL
  // (set during the first OAuth consent step, see /v1/oauth/authorize).
  const { count, error } = await supabase
    .from("developer_apps")
    .select("id", { count: "exact", head: true })
    .eq("kind", "dynamic_mcp")
    .eq("name", clientName)
    .is("owner_user_id", null)
    .gte("created_at", cutoff)
    .overlaps("redirect_uris", redirectUris)
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

      // Kill-switch: operator can disable DCR entirely without taking down /mcp.
      if (config.MCP_DYNAMIC_REGISTRATION === "off") {
        return reply.status(403).send({
          error: {
            code: "dcr_disabled",
            message: "Dynamic client registration is disabled on this server. Contact the operator for a static client_id/client_secret.",
          },
        })
      }
      // Allowlist gate (operator-controlled set of acceptable client_names).
      if (config.MCP_DYNAMIC_REGISTRATION === "allowlist") {
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

      // Per-(client_name + redirect_uris) cap. Prevents storage exhaustion via
      // repeated registrations from the same caller before any consents.
      const openCount = await countOpenRegistrations(meta.client_name, meta.redirect_uris)
      if (openCount >= OPEN_REGISTRATIONS_CAP) {
        return reply.status(429).send({
          error: {
            code: "too_many_open_registrations",
            message: `${openCount} unconsumed registration(s) for "${meta.client_name}" with these redirect_uris already exist. Complete the OAuth consent flow on an existing one, or wait for stale rows to be cleaned up.`,
          },
        })
      }

      const clientId = genClientId()
      const clientSecret = genClientSecret()
      const scopes = parseScope(meta.scope)

      const { data, error } = await supabase
        .from("developer_apps")
        .insert({
          owner_user_id: null,
          kind: "dynamic_mcp",
          name: meta.client_name,
          description: `Dynamically registered MCP client (${meta.client_name})`,
          logo_url: meta.logo_uri ?? null,
          homepage_url: meta.client_uri ?? null,
          allowed_origins: [],
          redirect_uris: meta.redirect_uris,
          client_id: clientId,
          client_secret_hash: hashSecret(clientSecret),
          scopes_requested: scopes,
          status: "active",
        })
        .select("id, client_id, created_at")
        .single()

      if (error || !data) {
        req.log.error({ err: error }, "DCR insert failed")
        return reply.status(500).send({ error: { code: "internal_error", message: "Failed to register client" } })
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
