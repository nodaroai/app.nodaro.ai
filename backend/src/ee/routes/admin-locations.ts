import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { batchDeleteFromR2 } from "../../lib/storage.js"
import { config } from "../../lib/config.js"
import { formatZodError } from "../../lib/zod-error.js"

// ============================================================
// Admin Override Routes for Locations (Phase 2 #5)
// ============================================================
//
// Mirrors the per-user admin pattern in admin-credits.ts but for the
// `locations` table. Admin can:
//   - List + filter locations across ALL users
//   - Inspect any single location by ID
//   - Edit any field on any location (bypasses the worker-owned column
//     protections that the user-facing route enforces — admin
//     deliberately CAN clobber things like `time_of_day` or
//     `atmosphere_motions` to fix corrupt data)
//   - Permanently delete any location (DB row + R2 keys)
//
// Restore is INTENTIONALLY not exposed admin-side — admin can lift the
// `deleted_at` flag via PATCH if needed, but a dedicated /restore action
// is reserved for the resource owner (preserves the audit trail).
//
// Edition gate: registered in app.ts only when hasAdmin() is true.

const listQuery = z.object({
  userId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  // Default view includes BOTH active and soft-deleted rows so admin can
  // see the full history. `?archived=true` shows ONLY soft-deleted;
  // `?archived=false` shows ONLY active.
  archived: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().uuid().optional(),
})

const adminLocationIdParams = z.object({
  id: z.string().uuid(),
})

// Subset of fields admin can patch. Mirrors the user-facing schema in
// `routes/locations.ts` but DROPS the worker-owned-column protections —
// admin can clobber `time_of_day` etc. to fix corrupt data.
const adminPatchBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  style: z.string().max(100).nullable().optional(),
  sourceImageUrl: z.string().url().nullable().optional(),
  timeOfDay: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  weather: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  angles: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  lighting: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  seasons: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  atmosphereMotions: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  referencePhotos: z.array(z.object({ kind: z.string(), url: z.string() })).max(20).optional(),
  canonicalDescription: z.string().max(4000).nullable().optional(),
  styleLock: z.boolean().optional(),
  piiConsentAt: z.string().datetime().nullable().optional(),
  // Admin can lift soft-delete (set null) or set it (admin-initiated archive).
  deletedAt: z.string().datetime().nullable().optional(),
})

const deleteQuery = z.object({
  permanent: z.enum(["true", "false"]).optional(),
})

// Subset of the user-facing column list. Includes the admin-only
// `r2_assets_purged_at` and `pii_consent_at` so the admin UI can show
// audit context.
const ADMIN_SELECT_COLUMNS =
  "id, user_id, node_id, project_id, name, description, category, style, source_image_url, time_of_day, weather, angles, lighting, seasons, atmosphere_motions, reference_photos, canonical_description, style_lock, pii_consent_at, r2_assets_purged_at, deleted_at, created_at, updated_at"

function r2KeyFromPublicUrl(url: string): string | null {
  if (!config.R2_PUBLIC_URL || !url.startsWith(config.R2_PUBLIC_URL)) {
    return null
  }
  return url.replace(config.R2_PUBLIC_URL + "/", "")
}

// Collect every R2 key referenced by a single location row.
function collectLocationR2Keys(row: Record<string, unknown>): string[] {
  const keys: string[] = []
  if (typeof row.source_image_url === "string") {
    const key = r2KeyFromPublicUrl(row.source_image_url)
    if (key) keys.push(key)
  }
  const JSONB_COLUMNS = [
    "time_of_day",
    "weather",
    "seasons",
    "angles",
    "lighting",
    "atmosphere_motions",
  ] as const
  for (const col of JSONB_COLUMNS) {
    const items = row[col]
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const url = (item as { url?: unknown } | null)?.url
      if (typeof url !== "string") continue
      const key = r2KeyFromPublicUrl(url)
      if (key) keys.push(key)
    }
  }
  const refPhotos = row.reference_photos
  if (Array.isArray(refPhotos)) {
    for (const photo of refPhotos) {
      const url = (photo as { url?: unknown } | null)?.url
      if (typeof url !== "string") continue
      const key = r2KeyFromPublicUrl(url)
      if (key) keys.push(key)
    }
  }
  return keys
}

export async function adminLocationRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // GET /v1/admin/locations — list locations across all users.
  //
  // Filterable by userId / projectId / archived. Cursor-based pagination
  // ordered by created_at DESC for predictable scrolling in admin UIs.
  // ---------------------------------------------------------------------------
  app.get("/v1/admin/locations", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: formatZodError(parsed.error) },
      })
    }
    const { userId, projectId, archived, limit, cursor } = parsed.data

    let query = supabase
      .from("locations")
      .select(ADMIN_SELECT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (userId) query = query.eq("user_id", userId)
    if (projectId) query = query.eq("project_id", projectId)
    if (archived === "true") query = query.not("deleted_at", "is", null)
    if (archived === "false") query = query.is("deleted_at", null)
    if (cursor) query = query.lt("id", cursor)

    const { data, error } = await query
    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const rows = data ?? []
    const nextCursor = rows.length === limit ? rows[rows.length - 1]?.id : null
    return { data: rows, nextCursor }
  })

  // ---------------------------------------------------------------------------
  // GET /v1/admin/locations/:id — fetch a single location, any user.
  // ---------------------------------------------------------------------------
  app.get("/v1/admin/locations/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = adminLocationIdParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: formatZodError(parsed.error) },
      })
    }
    const { data, error } = await supabase
      .from("locations")
      .select(ADMIN_SELECT_COLUMNS)
      .eq("id", parsed.data.id)
      .maybeSingle()
    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }
    if (!data) {
      return reply.status(404).send({
        error: { code: "location_not_found", message: "Location not found" },
      })
    }
    return data
  })

  // ---------------------------------------------------------------------------
  // PATCH /v1/admin/locations/:id — admin edit any field on any location.
  //
  // Deliberately bypasses the worker-owned-column protection that the user-
  // facing UPDATE route enforces. Admin can fix corrupt asset arrays, lift
  // soft-delete (set `deletedAt` to null), or force-write `piiConsentAt`.
  // No optimistic-concurrency token — admin overrides win.
  // ---------------------------------------------------------------------------
  app.patch("/v1/admin/locations/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const paramsParsed = adminLocationIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: formatZodError(paramsParsed.error) },
      })
    }
    const bodyParsed = adminPatchBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: formatZodError(bodyParsed.error) },
      })
    }

    const updates = bodyParsed.data
    const updateRow: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (updates.name !== undefined) updateRow.name = updates.name
    if (updates.description !== undefined) updateRow.description = updates.description
    if (updates.category !== undefined) updateRow.category = updates.category
    if (updates.style !== undefined) updateRow.style = updates.style
    if (updates.sourceImageUrl !== undefined) updateRow.source_image_url = updates.sourceImageUrl
    if (updates.timeOfDay !== undefined) updateRow.time_of_day = updates.timeOfDay
    if (updates.weather !== undefined) updateRow.weather = updates.weather
    if (updates.angles !== undefined) updateRow.angles = updates.angles
    if (updates.lighting !== undefined) updateRow.lighting = updates.lighting
    if (updates.seasons !== undefined) updateRow.seasons = updates.seasons
    if (updates.atmosphereMotions !== undefined) updateRow.atmosphere_motions = updates.atmosphereMotions
    if (updates.referencePhotos !== undefined) updateRow.reference_photos = updates.referencePhotos
    if (updates.canonicalDescription !== undefined) updateRow.canonical_description = updates.canonicalDescription
    if (updates.styleLock !== undefined) updateRow.style_lock = updates.styleLock
    if (updates.piiConsentAt !== undefined) updateRow.pii_consent_at = updates.piiConsentAt
    if (updates.deletedAt !== undefined) updateRow.deleted_at = updates.deletedAt

    const { data, error } = await supabase
      .from("locations")
      .update(updateRow)
      .eq("id", paramsParsed.data.id)
      .select(ADMIN_SELECT_COLUMNS)
      .single()

    if (error || !data) {
      return reply.status(404).send({
        error: { code: "location_not_found", message: "Location not found" },
      })
    }
    return data
  })

  // ---------------------------------------------------------------------------
  // DELETE /v1/admin/locations/:id — soft-delete by default,
  //   ?permanent=true → hard-delete (DB row + R2 keys).
  //
  // Admin permanent-delete does NOT require archive-first (unlike the
  // user-facing route) — admin is the canonical destruction path for
  // corrupt or abusive rows.
  // ---------------------------------------------------------------------------
  app.delete("/v1/admin/locations/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const paramsParsed = adminLocationIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: formatZodError(paramsParsed.error) },
      })
    }
    const queryParsed = deleteQuery.safeParse(req.query)
    if (!queryParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: formatZodError(queryParsed.error) },
      })
    }

    const { id } = paramsParsed.data
    const isPermanent = queryParsed.data.permanent === "true"

    if (isPermanent) {
      const { data: row, error: fetchErr } = await supabase
        .from("locations")
        .select(
          "id, source_image_url, time_of_day, weather, seasons, angles, lighting, atmosphere_motions, reference_photos",
        )
        .eq("id", id)
        .maybeSingle()

      if (fetchErr) {
        return reply.status(500).send({
          error: { code: "internal_error", message: fetchErr.message },
        })
      }
      if (!row) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Location not found" },
        })
      }

      const keys = collectLocationR2Keys(row as Record<string, unknown>)
      if (keys.length > 0) {
        try {
          await batchDeleteFromR2(keys)
        } catch (err) {
          console.error(
            `[admin-locations] R2 batch delete failed for location ${id} (continuing to DB delete):`,
            err,
          )
        }
      }

      const { error: deleteErr } = await supabase
        .from("locations")
        .delete()
        .eq("id", id)

      if (deleteErr) {
        return reply.status(500).send({
          error: { code: "delete_failed", message: deleteErr.message },
        })
      }
      return { success: true, permanent: true }
    }

    // Default: soft-delete.
    const { error } = await supabase
      .from("locations")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)

    if (error) {
      return reply.status(500).send({
        error: { code: "delete_failed", message: error.message },
      })
    }
    return { success: true, permanent: false }
  })
}
