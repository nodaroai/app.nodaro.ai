import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"

const paramsSchema = z.object({ id: z.string().uuid() })

/**
 * POST /v1/locations/:id/restore
 *
 * Un-archive a soft-deleted location. Mirrors the character-restore pattern
 * (see `characters.ts`):
 *  - 401 when unauthenticated.
 *  - 404 when the row doesn't exist or isn't owned by the caller.
 *  - Idempotent no-op (returns existing `{ id, name }`) when the row is
 *    already active.
 *  - On name collision with another active row, auto-suffixes "(restored)"
 *    so the restored row doesn't disappear behind the conflicting active
 *    one and the user isn't forced to rename mid-restore.
 *
 * Locations have no `LOWER(name)` unique index (unlike characters), so the
 * collision check is a single existence probe — no retry loop on 23505.
 */
export async function locationRestoreRoutes(app: FastifyInstance) {
  app.post("/v1/locations/:id/restore", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = paramsSchema.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid location ID" },
      })
    }
    const { id } = parsed.data

    // Load the archived row so we know its current name and whether
    // restoring it would collide with a since-created active row.
    const { data: row, error: fetchErr } = await supabase
      .from("locations")
      .select("id, name, deleted_at")
      .eq("id", id)
      .eq("user_id", userId)
      .single()
    if (fetchErr || !row) {
      return reply.status(404).send({
        error: { code: "location_not_found", message: "Location not found" },
      })
    }

    // Already active — idempotent no-op so a double-click on Restore in the
    // UI doesn't error out.
    if (!row.deleted_at) {
      return { id: row.id, name: row.name }
    }

    // Check whether another active row of this user already owns the name.
    // Case-insensitive (ilike) so "forest" and "Forest" are treated equal.
    const { data: collision } = await supabase
      .from("locations")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .ilike("name", row.name)
      .limit(1)
      .maybeSingle()

    const restoredName = collision ? `${row.name} (restored)` : row.name

    const { data: updated, error: updateErr } = await supabase
      .from("locations")
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
        error: { code: "restore_failed", message: updateErr?.message ?? "Failed to restore location" },
      })
    }

    return { id: updated.id, name: updated.name }
  })
}
