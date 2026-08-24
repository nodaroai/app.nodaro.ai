import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { ensureDefaultProject, PERSONAL_SPACE_DISABLED_ERROR } from "../lib/default-project.js"
import { buildDemoWorkflow } from "../lib/demo-workflow.js"
import { sendInternalError } from "../lib/http-errors.js"

/**
 * PostgREST error codes meaning "profiles.demo_seeded_at does not exist yet".
 * Code and migration 306 ship in the same PR but apply at different moments
 * (Railway deploys on merge; Supabase applies migrations on the PR event), so
 * inside that window the endpoint must degrade to a silent no-op instead of
 * 500ing on every empty-dashboard visit.
 *   - PGRST204: unknown column in the update payload (PostgREST schema cache)
 *   - 42703:    undefined column in the filter (raw Postgres)
 */
const MIGRATION_PENDING_CODES = new Set(["PGRST204", "42703"])

async function resetSeedClaim(userId: string): Promise<void> {
  // Best-effort rollback so a failed insert doesn't permanently burn the
  // user's one seed opportunity. Errors are logged and swallowed — the claim
  // staying set is an acceptable degraded state, a crash loop is not.
  const { error } = await supabase
    .from("profiles")
    .update({ demo_seeded_at: null })
    .eq("id", userId)
  if (error) {
    console.error("[onboarding] failed to reset demo seed claim:", error.message)
  }
}

export async function onboardingRoutes(app: FastifyInstance) {
  /**
   * POST /v1/onboarding/seed-demo — insert the Welcome Demo workflow into the
   * caller's default project, once per user ever.
   *
   * Idempotency: claim-first. The UPDATE below only matches while
   * demo_seeded_at IS NULL, so exactly one concurrent caller wins the claim;
   * everyone else (including every later call) gets { seeded: false }. The
   * workflow insert happens only after a successful claim, and a failed
   * insert releases the claim (best-effort) so the user can be seeded on a
   * retry rather than never.
   */
  app.post("/v1/onboarding/seed-demo", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply
        .status(401)
        .send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const { data: claimed, error: claimError } = await supabase
      .from("profiles")
      .update({ demo_seeded_at: new Date().toISOString() })
      .eq("id", userId)
      .is("demo_seeded_at", null)
      .select("id")

    if (claimError) {
      if (MIGRATION_PENDING_CODES.has(claimError.code ?? "")) {
        return reply.send({ seeded: false })
      }
      return sendInternalError(reply, req, claimError, "Failed to seed demo workflow")
    }
    if (!claimed || claimed.length === 0) {
      // Already seeded at some point (or profile row missing) — no-op.
      return reply.send({ seeded: false })
    }

    const resolution = await ensureDefaultProject(userId)
    if ("error" in resolution) {
      await resetSeedClaim(userId)
      return sendInternalError(
        reply,
        req,
        new Error(resolution.error),
        "Failed to seed demo workflow",
      )
    }
    if ("personalSpaceDisabled" in resolution) {
      // Release the claim: this is not "already seeded", it is "cannot seed
      // here". Holding it would mean the demo never appears for this user
      // even after they are given a workspace.
      await resetSeedClaim(userId)
      return reply.status(403).send({ error: PERSONAL_SPACE_DISABLED_ERROR })
    }

    const demo = buildDemoWorkflow()
    const { data: workflow, error: insertError } = await supabase
      .from("workflows")
      .insert({
        project_id: resolution.projectId,
        user_id: userId,
        name: demo.name,
        description: demo.description,
        nodes: demo.nodes,
        edges: demo.edges,
        settings: demo.settings,
        thumbnail_url: demo.thumbnailUrl,
      })
      .select("id")
      .single()

    if (insertError || !workflow) {
      await resetSeedClaim(userId)
      return sendInternalError(reply, req, insertError, "Failed to seed demo workflow")
    }

    return reply.send({
      seeded: true,
      workflowId: workflow.id as string,
      projectId: resolution.projectId,
    })
  })
}
