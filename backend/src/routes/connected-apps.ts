import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { sendInternalError } from "../lib/http-errors.js"

/**
 * Connected apps — every app the signed-in user has granted access to their
 * account through OAuth (a developer app, the MCP connector of an AI client,
 * a self-hosted install), and the one place to take that access back.
 *
 * Until this surface, a grant could be undone only by the app itself
 * (`POST /v1/oauth/revoke` with the token it holds); only self-hosted
 * installs had a revoke button, under billing. Revoking here ends the grant
 * and every token issued under it at once — the auth middleware refuses a
 * token whose authorization is revoked.
 *
 * Browser sessions only: an app token (or an API token) cannot list or revoke
 * the grants it lives under.
 */

const idParams = z.object({ id: z.string().uuid() })

interface AuthorizationRow {
  id: string
  scopes_granted: string[] | null
  created_at: string
  developer_apps: { name: string | null; kind: string | null; homepage_url: string | null } | null
}

function refuseNonSession(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.userId && req.authKind === "jwt") return false
  void reply.status(401).send({ error: { code: "unauthorized", message: "Sign in required" } })
  return true
}

export async function connectedAppsRoutes(app: FastifyInstance) {
  app.get("/v1/me/connected-apps", async (req, reply) => {
    if (refuseNonSession(req, reply)) return reply
    try {
      const { data, error } = await supabase
        .from("developer_app_authorizations")
        .select("id, scopes_granted, created_at, developer_apps!inner ( name, kind, homepage_url )")
        .eq("user_id", req.userId!)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
      if (error) throw error
      const rows = (data ?? []) as unknown as AuthorizationRow[]

      // When each grant was last used: its tokens' latest use, in one read.
      const lastUsed = new Map<string, string>()
      if (rows.length > 0) {
        const { data: tokens, error: tokenError } = await supabase
          .from("developer_app_tokens")
          .select("authorization_id, last_used_at")
          .in("authorization_id", rows.map((r) => r.id))
          .not("last_used_at", "is", null)
        if (tokenError) throw tokenError
        for (const token of (tokens ?? []) as Array<{ authorization_id: string; last_used_at: string }>) {
          const seen = lastUsed.get(token.authorization_id)
          if (!seen || token.last_used_at > seen) lastUsed.set(token.authorization_id, token.last_used_at)
        }
      }

      return reply.send({
        apps: rows.map((row) => ({
          authorizationId: row.id,
          name: row.developer_apps?.name ?? null,
          kind: row.developer_apps?.kind ?? "user",
          homepageUrl: row.developer_apps?.homepage_url ?? null,
          scopes: row.scopes_granted ?? [],
          connectedAt: row.created_at,
          lastUsedAt: lastUsed.get(row.id) ?? null,
        })),
      })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to list connected apps")
    }
  })

  app.post("/v1/me/connected-apps/:id/revoke", async (req, reply) => {
    if (refuseNonSession(req, reply)) return reply
    const parsed = idParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid connected app id" } })
    }
    const { id } = parsed.data
    try {
      const now = new Date().toISOString()
      const { data, error } = await supabase
        .from("developer_app_authorizations")
        .update({ revoked_at: now })
        .eq("id", id)
        .eq("user_id", req.userId!)
        .is("revoked_at", null)
        .select("id")
        .maybeSingle()
      if (error) throw error
      if (!data) {
        return reply.status(404).send({ error: { code: "not_found", message: "Connected app not found" } })
      }
      // The grant's live tokens die with it (the auth middleware also refuses
      // any token whose authorization is revoked).
      const { error: tokenError } = await supabase
        .from("developer_app_tokens")
        .update({ revoked_at: now })
        .eq("authorization_id", (data as { id: string }).id)
        .is("revoked_at", null)
      if (tokenError) throw tokenError
      return reply.send({ ok: true })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to revoke connected app")
    }
  })
}
