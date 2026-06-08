import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { requireAppScope } from "../lib/scope-prehandler.js"

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * POST /v1/creatures/:id/restore
 *
 * Un-archive a soft-deleted creature. Mirrors the object-restore pattern
 * (`object-restore.ts`) with two creature-specific deltas:
 *
 *   1. **Uniform `"not_found"` 404 code** (spec Pass 10 F-90b + Pass 3
 *      F-32): all failure paths — doesn't-exist / cross-user / already-
 *      active — return the SAME 404 code. Creature DELIBERATELY diverges
 *      from location's per-path codes + location's idempotent-200 on
 *      already-active to prevent callees from enumerating creature IDs by
 *      observing which paths 404 vs which return 200.
 *
 *   2. **No idempotent-200 on already-active**: location returns 200 if
 *      the row is already active (deleted_at IS NULL). Creature returns
 *      404 "not_found" instead — the failure surface is uniform.
 *
 * Name-collision handling (preserved from object): if another active row
 * of the same user already owns the name, the restored row gets a
 * "(restored)" suffix so the un-archive doesn't fail behind the
 * conflicting active one and the user isn't forced to rename mid-restore.
 * Creatures have no `LOWER(name)` unique index (unlike characters), so the
 * collision check is a single existence probe — no retry loop on 23505.
 *
 * Auth: 401 unauthenticated; otherwise 404 "not_found" for all
 * failure paths.
 *
 * Permanent-delete is handled by a `?permanent=true` query param on the
 * existing DELETE route in creatures.ts (Phase C2 — matches location
 * convention).
 */
export async function creatureRestoreRoutes(app: FastifyInstance) {
  app.post("/v1/creatures/:id/restore", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = paramsSchema.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid creature ID" },
      })
    }
    const { id } = parsed.data

    // Load the archived row so we know its current name and whether
    // restoring it would collide with a since-created active row. Scoped
    // by user_id so cross-user returns null → uniform "not_found".
    const { data: row, error: fetchErr } = await supabase
      .from("creatures")
      .select("id, name, deleted_at")
      .eq("id", id)
      .eq("user_id", userId)
      .single()
    if (fetchErr || !row) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Not found" },
      })
    }

    // Already active — per spec Pass 10 F-90b + Pass 3 F-32, return
    // uniform "not_found" 404 (creature diverges from location's
    // idempotent-200) so the failure surface doesn't leak which IDs
    // exist as already-active vs which don't exist at all.
    if (!row.deleted_at) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Not found" },
      })
    }

    // Check whether another active row of this user already owns the
    // name. Case-insensitive (ilike) so "phoenix" and "Phoenix" are
    // treated equal.
    const { data: collision } = await supabase
      .from("creatures")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .ilike("name", row.name)
      .limit(1)
      .maybeSingle()

    const restoredName = collision ? `${row.name} (restored)` : row.name

    const { data: updated, error: updateErr } = await supabase
      .from("creatures")
      .update({
        deleted_at: null,
        name: restoredName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id, name")
      .single()

    if (updateErr || !updated) {
      return reply.status(500).send({
        error: { code: "restore_failed", message: updateErr?.message ?? "Failed to restore creature" },
      })
    }

    return { id: updated.id, name: updated.name }
  })
}
