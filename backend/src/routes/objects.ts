import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { OBJECT_ATTACH_COLUMNS } from "@nodaro/shared"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { formatZodError } from "../lib/zod-error.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { batchDeleteFromR2 } from "../lib/storage.js"
import { config } from "../lib/config.js"

// Reference-photo entry — descriptive metadata in Phase 1 (the catalog of kinds
// is open-ended for objects, unlike locations which enforces an enum). The
// frontend studio passes whatever label it currently uses.
const referencePhoto = z.object({
  kind: z.string(),
  url: safeUrlSchema,
})

const upsertObjectBody = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  nodeId: z.string().min(1),
  workflowId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  style: z.string().max(50).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  // Asset buckets — worker-owned on UPDATE, free-to-set on INSERT. The UPDATE
  // branch deliberately drops these so the worker's atomic
  // `append_object_asset()` RPC cannot be clobbered by a Studio auto-save
  // that snapshotted a stale array.
  angles: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  materials: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  variations: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  motionClips: z.array(z.object({ name: z.string(), url: z.string() })).max(100).optional(),
  // User-owned mood-board + caption + style-lock flag. These ARE allowed in
  // both INSERT and UPDATE — the caller drives them.
  referencePhotos: z.array(referencePhoto).max(20).optional(),
  canonicalDescription: z.string().max(4000).optional(),
  styleLock: z.boolean().optional(),
  // Optimistic-concurrency token: when present, UPDATE only succeeds if the
  // row's `updated_at` still matches. On mismatch we return 409 so the Studio
  // can re-fetch + merge instead of silently overwriting a worker write.
  expectedUpdatedAt: z.string().datetime().optional(),
})

const deleteObjectParams = z.object({
  id: z.string().min(1),
})

// `?permanent=true` flips the DELETE handler from soft-archive into hard-delete
// (DB row + R2 assets). Defaults to soft-archive when absent or "false".
const deleteObjectQuery = z.object({
  permanent: z.enum(["true", "false"]).optional(),
})

// Extract the R2 key from a public-CDN URL. Returns null for non-R2 URLs (e.g.
// external CDNs a user pasted into source_image_url or reference_photos), which
// the caller filters out — we deliberately don't try to delete external blobs.
//
// Local copy of `r2KeyFromUrl` from `ee/billing/cleanup-service.ts` so this
// core route doesn't statically import from `ee/`. Mirrors the same helper in
// `locations.ts`.
function r2KeyFromPublicUrl(url: string): string | null {
  if (!config.R2_PUBLIC_URL || !url.startsWith(config.R2_PUBLIC_URL)) {
    return null
  }
  return url.replace(config.R2_PUBLIC_URL + "/", "")
}

// Collect every R2 key referenced by a single object row. Used by the
// permanent-delete path to feed `batchDeleteFromR2`. Operates on an already-
// fetched row to avoid a second round-trip (the caller has the row from the
// ownership + archive-status SELECT).
function collectObjectR2Keys(row: Record<string, unknown>): string[] {
  const keys: string[] = []
  if (typeof row.source_image_url === "string") {
    const key = r2KeyFromPublicUrl(row.source_image_url)
    if (key) keys.push(key)
  }
  for (const col of OBJECT_ATTACH_COLUMNS) {
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

const listObjectsQuery = z.object({
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  // Default view hides archived rows. `?archived=true` flips the filter for
  // the Studio's "Archived" tab.
  archived: z.enum(["true", "false"]).optional(),
})

// Single source of truth for the GET column list — keeps single + list in lock-step.
const SELECT_COLUMNS =
  "id, user_id, node_id, project_id, name, description, category, style, source_image_url, angles, materials, variations, motion_clips, reference_photos, canonical_description, style_lock, deleted_at, created_at, updated_at"

type ObjectRow = {
  id: string
  user_id: string
  node_id: string
  project_id: string | null
  name: string
  description: string | null
  category: string | null
  style: string | null
  source_image_url: string | null
  angles: { name: string; url: string }[] | null
  materials: { name: string; url: string }[] | null
  variations: { name: string; url: string }[] | null
  motion_clips: { name: string; url: string }[] | null
  reference_photos: { kind: string; url: string }[] | null
  canonical_description: string | null
  style_lock: boolean | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

// snake_case → camelCase wire shape. Coerces NULL canonical_description to ""
// so callers don't have to defensively `?? ""` everywhere.
function toCamel(obj: ObjectRow) {
  return {
    id: obj.id,
    userId: obj.user_id,
    nodeId: obj.node_id,
    projectId: obj.project_id,
    name: obj.name,
    description: obj.description,
    category: obj.category,
    style: obj.style,
    sourceImageUrl: obj.source_image_url,
    angles: obj.angles ?? [],
    materials: obj.materials ?? [],
    variations: obj.variations ?? [],
    motionClips: obj.motion_clips ?? [],
    referencePhotos: obj.reference_photos ?? [],
    canonicalDescription: obj.canonical_description ?? "",
    styleLock: obj.style_lock ?? true,
    deletedAt: obj.deleted_at,
    createdAt: obj.created_at,
    updatedAt: obj.updated_at,
  }
}

export async function objectRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // List objects for a project
  // ---------------------------------------------------------------------------
  app.get("/v1/objects", async (req, reply) => {
    const parsed = listObjectsQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid query",
        },
      })
    }

    const { projectId, archived } = parsed.data
    const userId = req.userId
    const wantArchived = archived === "true"

    let query = supabase
      .from("objects")
      .select(SELECT_COLUMNS)
      .order("created_at", { ascending: false })

    if (projectId) {
      query = query.eq("project_id", projectId)
    }
    if (userId) {
      query = query.eq("user_id", userId)
    }
    // Default view hides archived. Archived view flips the filter.
    if (wantArchived) {
      query = query.not("deleted_at", "is", null)
    } else {
      query = query.is("deleted_at", null)
    }

    const { data, error } = await query

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const objects = (data ?? []).map((o) => toCamel(o as ObjectRow))
    return { objects }
  })

  // ---------------------------------------------------------------------------
  // Get single object by ID
  // ---------------------------------------------------------------------------
  app.get("/v1/objects/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = deleteObjectParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid object ID",
        },
      })
    }

    const { id } = parsed.data

    const { data, error } = await supabase
      .from("objects")
      .select(SELECT_COLUMNS)
      .eq("id", id)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Object not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return toCamel(data as ObjectRow)
  })

  // ---------------------------------------------------------------------------
  // Upsert object (create or update)
  // ---------------------------------------------------------------------------
  app.post("/v1/objects", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    const parsed = upsertObjectBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const {
      id,
      nodeId,
      workflowId,
      projectId,
      name,
      description,
      category,
      style,
      sourceImageUrl,
      angles,
      materials,
      variations,
      motionClips,
      referencePhotos,
      canonicalDescription,
      styleLock,
      expectedUpdatedAt,
    } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (id) {
      // UPDATE — deliberately EXCLUDE worker-owned columns so a Studio
      // auto-save with a stale snapshot can't clobber the worker's atomic
      // `append_object_asset()` writes. Excluded columns:
      //   angles, materials, variations, motion_clips (worker-owned)
      //   source_image_url, canonical_description (route-owned by
      //   approve-main-image + llm-caption helpers)
      // User-owned columns (reference_photos, style_lock, identity fields)
      // flow through normally.
      //
      // Only touch columns the caller explicitly sent (omitted fields stay
      // untouched on the row). Mirrors the locations.ts UPDATE pattern.
      const updateRow: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      if (name !== undefined) updateRow.name = name
      if (description !== undefined) updateRow.description = description ?? null
      if (category !== undefined) updateRow.category = category ?? null
      if (style !== undefined) updateRow.style = style ?? null
      if (referencePhotos !== undefined) updateRow.reference_photos = referencePhotos
      if (styleLock !== undefined) updateRow.style_lock = styleLock

      let query = supabase
        .from("objects")
        .update(updateRow)
        .eq("id", id)
        .eq("user_id", userId)
      if (expectedUpdatedAt) {
        query = query.eq("updated_at", expectedUpdatedAt)
      }
      const { data: updated, error: updateErr } = await query.select("id, updated_at").single()

      if (updateErr || !updated) {
        // Optimistic-concurrency path: distinguish "row was modified
        // concurrently" (409 — caller passed a stale token) from "row doesn't
        // exist or isn't yours" (404). We only do the follow-up SELECT when
        // the caller actually sent expectedUpdatedAt.
        if (expectedUpdatedAt) {
          const { data: current } = await supabase
            .from("objects")
            .select("updated_at, name, source_image_url, canonical_description")
            .eq("id", id)
            .eq("user_id", userId)
            .single()
          if (current) {
            return reply.status(409).send({
              error: {
                code: "concurrent_modification",
                updatedAt: (current as { updated_at: string }).updated_at,
                message: "Object was modified concurrently",
              },
            })
          }
        }
        return reply.status(404).send({
          error: { code: "not_found", message: "Object not found" },
        })
      }
      return { id: updated.id, updatedAt: updated.updated_at }
    }

    // INSERT — accepts ALL fields including worker- + route-owned. New rows
    // start with empty asset buckets (unless the caller explicitly sent values,
    // useful for templates/imports).
    const insertRow = {
      user_id: userId,
      node_id: nodeId,
      workflow_id: workflowId ?? null,
      project_id: projectId ?? null,
      name,
      description: description ?? null,
      category: category ?? null,
      style: style ?? null,
      source_image_url: sourceImageUrl ?? null,
      angles: angles ?? [],
      materials: materials ?? [],
      variations: variations ?? [],
      motion_clips: motionClips ?? [],
      reference_photos: referencePhotos ?? [],
      canonical_description: canonicalDescription ?? null,
      style_lock: styleLock ?? true,
      updated_at: new Date().toISOString(),
    }

    const { data: created, error } = await supabase
      .from("objects")
      .insert(insertRow)
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { id: created.id }
  })

  // ---------------------------------------------------------------------------
  // Delete object
  //
  //   default          → soft-delete (sets deleted_at, leaves row intact for
  //                      restore via POST /v1/objects/:id/restore).
  //   ?permanent=true  → hard-delete the row AND batch-delete all referenced
  //                      R2 keys (main image, the 4 asset buckets, reference
  //                      photos). Row MUST already be archived — active rows
  //                      return 400 `not_archived` to guard against curl/SDK
  //                      callers bypassing the UI archive-first flow. The UI
  //                      only surfaces permanent-delete from the Archived
  //                      tab in `/library/objects` so this branch is
  //                      reachable only after the row has gone through DELETE
  //                      (no-query) → restore (optional) → DELETE
  //                      ?permanent=true.
  //
  // Permanent-delete is intentionally NOT mirrored on the SDK (`@nodaro/client`)
  // — programmatic callers can only soft-delete.
  // ---------------------------------------------------------------------------
  app.delete("/v1/objects/:id", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsedParams = deleteObjectParams.safeParse(req.params)
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsedParams.error.issues[0]?.message ?? "Invalid object ID",
        },
      })
    }

    const parsedQuery = deleteObjectQuery.safeParse(req.query)
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsedQuery.error.issues[0]?.message ?? "Invalid query parameters",
        },
      })
    }

    const { id } = parsedParams.data
    const isPermanent = parsedQuery.data.permanent === "true"

    if (isPermanent) {
      // Step 1: Fetch ownership + archive-status + every asset URL in one round-trip.
      // Archive-first policy mirrors the app_runs permanent-delete pattern in
      // CLAUDE.md (avoids a single-step destroy footgun).
      const { data: row, error: fetchErr } = await supabase
        .from("objects")
        .select(
          "id, deleted_at, source_image_url, angles, materials, variations, motion_clips, reference_photos",
        )
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle()

      if (fetchErr) {
        return reply.status(500).send({
          error: { code: "internal_error", message: fetchErr.message },
        })
      }
      if (!row) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Object not found" },
        })
      }
      if (!row.deleted_at) {
        return reply.status(400).send({
          error: {
            code: "not_archived",
            message:
              "Object must be archived before permanent deletion. Call DELETE first.",
          },
        })
      }

      // Step 2: Collect R2 keys from JSONB asset columns + reference photos.
      // External URLs (non-R2 CDN) are filtered out by r2KeyFromPublicUrl.
      const keys = collectObjectR2Keys(row as Record<string, unknown>)

      // Step 3: Best-effort batch-delete from R2. `batchDeleteFromR2` already
      // swallows per-key errors and returns counts; we never block DB delete
      // on R2 deletion (orphaned R2 blobs are reaped by the cleanup-cron).
      if (keys.length > 0) {
        try {
          await batchDeleteFromR2(keys)
        } catch (err) {
          // Should not happen — batchDeleteFromR2 catches its own errors —
          // but log defensively so a partial-failure doesn't silently swallow
          // a totally broken S3 client.
          console.error(
            `[objects] R2 batch delete failed for object ${id} (continuing to DB delete):`,
            err,
          )
        }
      }

      // Step 4: Hard-delete the DB row. Scoped by user_id again as defense in
      // depth — even if the ownership check above is somehow bypassed, the
      // DELETE itself cannot affect another user's row.
      const { error: deleteErr } = await supabase
        .from("objects")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)

      if (deleteErr) {
        return reply.status(500).send({
          error: { code: "delete_failed", message: deleteErr.message },
        })
      }

      return { success: true, permanent: true }
    }

    // Default path: soft-delete (sets deleted_at). Idempotent — the
    // `.is("deleted_at", null)` predicate makes a repeat call a no-op.
    const { error } = await supabase
      .from("objects")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .is("deleted_at", null)

    if (error) {
      return reply.status(500).send({
        error: { code: "delete_failed", message: error.message },
      })
    }

    return { success: true, archived: true }
  })
}
