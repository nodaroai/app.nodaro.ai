import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { requirePlatformOperator } from "../middleware/require-platform-operator.js"
import { activateSignupGrant } from "../billing/signup-grant.js"

/**
 * Free-credit abuse gate: admin review of withheld grants.
 *
 * Read is admin; RESTORE is platform-operator, because restoring mints 1,500
 * credits — the same gate as the credit-adjust route. There is deliberately
 * no "confirm withhold" write: withheld is already the state, and the only
 * action an operator can take that changes money is to grant.
 */

const listQuery = z.object({
  state: z.enum(["withheld", "granted", "unclaimed"]).default("withheld"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

const userParams = z.object({ userId: z.uuid() })

export async function adminFreeGrantRoutes(app: FastifyInstance) {
  /** GET /v1/admin/free-grants?state=withheld — newest first, with the reasons. */
  app.get("/v1/admin/free-grants", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid query" } })
    }
    const { state, limit, offset } = parsed.data

    try {
      const { data: profiles, error, count } = await supabase
        .from("profiles")
        .select("id, email, full_name, created_at, subscription_credits, free_grant_state", { count: "exact" })
        .eq("free_grant_state", state)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1)
      if (error) return sendInternalError(reply, req, error, "Failed to list free grants")

      const ids = (profiles ?? []).map((p) => p.id as string)
      const signalsById = new Map<string, { decision: string | null; reasons: string[]; decided_at: string | null }>()
      if (ids.length > 0) {
        const { data: signals } = await supabase
          .from("signup_signals")
          .select("user_id, decision, reasons, decided_at")
          .in("user_id", ids)
          .eq("source", "claim")
        for (const s of signals ?? []) {
          signalsById.set(s.user_id as string, {
            decision: (s.decision as string | null) ?? null,
            reasons: Array.isArray(s.reasons) ? (s.reasons as string[]) : [],
            decided_at: (s.decided_at as string | null) ?? null,
          })
        }
      }

      return {
        data: (profiles ?? []).map((p) => ({
          userId: p.id,
          email: p.email,
          fullName: p.full_name,
          createdAt: p.created_at,
          subscriptionCredits: p.subscription_credits,
          state: p.free_grant_state,
          reasons: signalsById.get(p.id as string)?.reasons ?? [],
          decidedAt: signalsById.get(p.id as string)?.decided_at ?? null,
        })),
        total: count ?? 0,
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to list free grants")
    }
  })

  /** POST /v1/admin/free-grants/:userId/activate — restore a withheld grant. */
  app.post("/v1/admin/free-grants/:userId/activate", { preHandler: requirePlatformOperator }, async (req, reply) => {
    const parsed = userParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid user id" } })
    }
    try {
      const result = await activateSignupGrant(parsed.data.userId, "Free signup grant (restored by admin)")
      if (!result.activated) {
        return reply.status(409).send({
          error: { code: "not_withheld", message: `Account is '${result.state}', nothing to restore` },
        })
      }
      req.log.info({ userId: parsed.data.userId, adminId: req.userId }, "free grant restored by admin")
      return { data: { userId: parsed.data.userId, state: result.state } }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to restore the free grant")
    }
  })
}
