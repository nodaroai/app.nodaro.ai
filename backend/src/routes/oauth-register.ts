import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { createHash, randomBytes } from "node:crypto"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { ALL_SCOPES } from "../lib/scopes.js"

const SECRET_TTL_DAYS = 90
const CLIENT_ID_PREFIX = "ndr_dcr_"

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
})

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
  return requested.filter((s) => (ALL_SCOPES as readonly string[]).includes(s))
}

export async function registerOauthRegister(app: FastifyInstance): Promise<void> {
  app.post("/v1/oauth/register", async (req, reply) => {
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
  })
}
