import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { sendInternalError } from "../../lib/http-errors.js"

/**
 * Connected Instances — the user-facing containment surface for community
 * cloud-connect (Phase 4a). Lists the caller's community_instance
 * authorizations with spend attribution, lets them set/clear the monthly
 * cap, and revoke an instance outright (tokens die immediately — same
 * semantics as OAuth revocation).
 *
 * JWT-only surface (settings-grade): app tokens cannot manage themselves.
 */

const capBody = z.object({
  monthlySpendCapCredits: z.number().int().min(100).max(1_000_000).nullable(),
})

interface AuthorizationRow {
  id: string
  app_id: string
  created_at: string
  revoked_at: string | null
  monthly_spend_cap_credits: number | null
  developer_apps: {
    kind: string | null
    name: string | null
    homepage_url: string | null
  } | null
}

export async function connectedInstancesRoutes(app: FastifyInstance) {
  app.get("/v1/me/connected-instances", async (req, reply) => {
    if (!req.userId || req.authKind !== "jwt") {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Sign in required" } })
    }
    try {
      const { data, error } = await supabase
        .from("developer_app_authorizations")
        .select(
          "id, app_id, created_at, revoked_at, monthly_spend_cap_credits, developer_apps!inner ( kind, name, homepage_url )"
        )
        .eq("user_id", req.userId)
        .is("revoked_at", null)
        .eq("developer_apps.kind", "community_instance")
        .order("created_at", { ascending: false })
      if (error) throw error

      const rows = (data ?? []) as unknown as AuthorizationRow[]
      const monthStart = new Date()
      monthStart.setUTCDate(1)
      monthStart.setUTCHours(0, 0, 0, 0)

      const instances = await Promise.all(
        rows.map(async (row) => {
          const { data: spendRows } = await supabase
            // trash-read: totals of credits spent count a deleted job until the purge.
            .from("jobs")
            .select("credits, created_at")
            .eq("user_id", req.userId!)
            .eq("source", "app")
            .eq("source_detail", row.app_id)
            .gte("created_at", monthStart.toISOString())
          const spentThisMonth = (spendRows ?? []).reduce(
            (sum, j) => sum + ((j as { credits: number | null }).credits ?? 0),
            0
          )
          const lastUsedAt = (spendRows ?? []).reduce<string | null>((latest, j) => {
            const c = (j as { created_at: string }).created_at
            return !latest || c > latest ? c : latest
          }, null)
          return {
            authorizationId: row.id,
            name: row.developer_apps?.name ?? "Unnamed instance",
            instanceUrl: row.developer_apps?.homepage_url ?? null,
            connectedAt: row.created_at,
            lastUsedAt,
            spentThisMonth,
            monthlySpendCapCredits: row.monthly_spend_cap_credits,
          }
        })
      )

      return reply.send({ instances })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to list connected instances")
    }
  })

  app.patch<{ Params: { id: string } }>(
    "/v1/me/connected-instances/:id",
    async (req, reply) => {
      if (!req.userId || req.authKind !== "jwt") {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Sign in required" } })
      }
      const parsed = capBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "monthlySpendCapCredits must be 100-1,000,000 or null" },
        })
      }
      try {
        const { data, error } = await supabase
          .from("developer_app_authorizations")
          .update({ monthly_spend_cap_credits: parsed.data.monthlySpendCapCredits })
          .eq("id", req.params.id)
          .eq("user_id", req.userId)
          .is("revoked_at", null)
          .select("id")
          .maybeSingle()
        if (error) throw error
        if (!data) {
          return reply.status(404).send({ error: { code: "not_found", message: "Instance not found" } })
        }
        return reply.send({ ok: true })
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to update instance cap")
      }
    }
  )

  app.post<{ Params: { id: string } }>(
    "/v1/me/connected-instances/:id/revoke",
    async (req, reply) => {
      if (!req.userId || req.authKind !== "jwt") {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Sign in required" } })
      }
      try {
        const now = new Date().toISOString()
        const { data, error } = await supabase
          .from("developer_app_authorizations")
          .update({ revoked_at: now })
          .eq("id", req.params.id)
          .eq("user_id", req.userId)
          .is("revoked_at", null)
          .select("id")
          .maybeSingle()
        if (error) throw error
        if (!data) {
          return reply.status(404).send({ error: { code: "not_found", message: "Instance not found" } })
        }
        // Kill the instance's live tokens with the authorization (the auth
        // middleware checks token.revoked_at too — belt and suspenders).
        await supabase
          .from("developer_app_tokens")
          .update({ revoked_at: now })
          .eq("authorization_id", req.params.id)
          .is("revoked_at", null)
        return reply.send({ ok: true })
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to revoke instance")
      }
    }
  )
}
