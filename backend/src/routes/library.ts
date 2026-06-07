import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { config, isCloud } from "../lib/config.js"
import { deleteFromR2 } from "../lib/storage.js"
import { updateStorageUsage } from "../utils/file-validation.js"
import { checkIsAdmin } from "../lib/admin-check.js"
import { formatZodError } from "../lib/zod-error.js"

// ============================================================
// Schemas
// ============================================================

const listLibraryQuery = z.object({
  type: z.enum(["all", "image", "video", "audio"]).optional().default("all"),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(40),
  cursor: z.string().uuid().optional(),
  owned: z.coerce.boolean().optional().default(false),
})

const assetIdParams = z.object({
  id: z.string().uuid(),
})

const saveGeneratedBody = z.object({
  url: safeUrlSchema,
  type: z.enum(["image", "video", "audio"]),
  filename: z.string().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
  isLibraryItem: z.boolean().optional().default(false),
})

// ============================================================
// Routes
// ============================================================

export async function libraryRoutes(app: FastifyInstance) {
  // GET /v1/library - List user's uploaded assets
  app.get("/v1/library", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = listLibraryQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid query",
        },
      })
    }

    const { type, search, limit, cursor, owned } = parsed.data

    // Count query (only on first page — when no cursor). Built here but NOT
    // awaited yet so it can run concurrently with the page fetch below
    // (Promise.all) instead of serializing two round-trips. Exact count drives
    // preview-nav bounds, so it must stay `count: "exact"`.
    let countPromise: PromiseLike<{ count: number | null }> | null = null
    if (!cursor) {
      let cq = supabase
        .from("assets")
        .select("id", { count: "exact", head: true })

      if (owned) {
        cq = cq.eq("user_id", userId)
      } else {
        cq = cq.or(`and(user_id.eq.${userId},in_library.eq.true),is_library_item.eq.true`)
      }

      if (type !== "all") {
        cq = cq.eq("type", type)
      }

      if (search) {
        cq = cq.ilike("filename", `%${search}%`)
      }

      countPromise = cq
    }

    let query = supabase
      .from("assets")
      .select("id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url, metadata, is_library_item, upload_source, created_at")

    if (owned) {
      // Storage page: show ALL user assets (regardless of in_library flag)
      query = query.eq("user_id", userId)
    } else {
      // Workflow modal: only show assets explicitly saved to library + shared items
      query = query.or(`and(user_id.eq.${userId},in_library.eq.true),is_library_item.eq.true`)
    }

    query = query
      .order("created_at", { ascending: false })
      .limit(limit + 1) // Fetch one extra to determine nextCursor

    if (type !== "all") {
      query = query.eq("type", type)
    }

    if (search) {
      query = query.ilike("filename", `%${search}%`)
    }

    if (cursor) {
      // Cursor-based pagination: fetch items created before the cursor item
      const { data: cursorRow } = await supabase
        .from("assets")
        .select("created_at")
        .eq("id", cursor)
        .single()

      if (cursorRow) {
        query = query.lt("created_at", cursorRow.created_at)
      }
    }

    // Run the page fetch and the (optional) exact-count query concurrently so
    // the count round-trip doesn't add latency on top of the page fetch.
    const [{ data, error }, countResult] = await Promise.all([
      query,
      countPromise ?? Promise.resolve(null),
    ])

    const totalCount: number | null = countResult?.count ?? null

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const rows = data ?? []
    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null

    // Transform snake_case to camelCase
    const assets = items.map((a) => ({
      id: a.id,
      type: a.type,
      filename: a.filename,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      url: a.r2_url,
      thumbnailUrl: (a.metadata as Record<string, unknown>)?.thumbnail_url ?? null,
      metadata: a.metadata ?? {},
      isLibraryItem: a.is_library_item ?? false,
      uploadSource: a.upload_source ?? "manual_upload",
      createdAt: a.created_at,
    }))

    return { data: assets, nextCursor, ...(totalCount !== null && { totalCount }) }
  })

  // POST /v1/library/:id/promote - Promote asset to shared library (admin only)
  app.post("/v1/library/:id/promote", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = assetIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsParsed.error.issues[0]?.message ?? "Invalid asset ID",
        },
      })
    }

    const { id } = paramsParsed.data

    // Only admins can promote
    const isAdmin = await checkIsAdmin(userId)
    if (!isAdmin) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only admins can promote assets to the shared library" },
      })
    }

    const { error } = await supabase
      .from("assets")
      .update({ is_library_item: true })
      .eq("id", id)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })

  // POST /v1/library/:id/demote - Demote asset from shared library (admin only)
  app.post("/v1/library/:id/demote", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = assetIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsParsed.error.issues[0]?.message ?? "Invalid asset ID",
        },
      })
    }

    const { id } = paramsParsed.data

    // Only admins can demote
    const isAdmin = await checkIsAdmin(userId)
    if (!isAdmin) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only admins can remove assets from the shared library" },
      })
    }

    const { error } = await supabase
      .from("assets")
      .update({ is_library_item: false })
      .eq("id", id)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })

  // DELETE /v1/library/:id - Remove or permanently delete an asset
  // ?permanent=true → delete R2 file + DB record (used by /library storage page)
  // default         → set in_library=false only (used by workflow Media Library modal)
  app.delete("/v1/library/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = assetIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsParsed.error.issues[0]?.message ?? "Invalid asset ID",
        },
      })
    }

    const { id } = paramsParsed.data
    const permanent = (req.query as Record<string, string>)?.permanent === "true"

    if (permanent) {
      // Permanent delete: remove R2 file + DB record + update storage
      const { data: asset, error: fetchError } = await supabase
        .from("assets")
        .select("id, user_id, r2_key, size_bytes")
        .eq("id", id)
        .single()

      if (fetchError || !asset) {
        return reply.status(404).send({
          error: { code: "not_found", message: "Asset not found" },
        })
      }

      if (asset.user_id !== userId) {
        return reply.status(403).send({
          error: { code: "forbidden", message: "You do not own this asset" },
        })
      }

      try {
        if (asset.r2_key) {
          // Content-addressed safety: another row may reference the SAME R2
          // object, so deleting it would turn that row into a permanent broken
          // link (R2 objects are unrecoverable). We must check BOTH tables:
          //
          //   1. assets — another user may have saved this output from the public
          //      gallery via save-generated, which dedups per-user, not per-object.
          //   2. jobs — every completed generation auto-creates an asset whose
          //      r2_key is derived from the same R2 object that jobs.output_data
          //      independently points at (see workers/shared.ts). The gallery /
          //      job-history reads from jobs.output_data, so destroying the object
          //      breaks that entry even when this is the only assets row.
          //
          // Only delete the R2 object when NO other referrer exists in EITHER
          // table. Any query error is treated as "a referrer may exist" so we
          // fail safe toward keeping data.
          const { count: otherAssetRefs } = await supabase
            .from("assets")
            .select("id", { count: "exact", head: true })
            .eq("r2_key", asset.r2_key)
            .neq("id", id)

          const assetRefsExist = !!otherAssetRefs && otherAssetRefs > 0

          // Reconstruct the public URL exactly as stored in jobs.output_data
          // (mirror of workers/shared.ts: r2Key = url.replace(R2_PUBLIC_URL + "/", "")).
          const publicUrl = config.R2_PUBLIC_URL
            ? `${config.R2_PUBLIC_URL}/${asset.r2_key}`
            : asset.r2_key
          // Check the media-URL keys the gallery/job-history extractors read,
          // one .eq() per key — NOT a hand-built .or() string. PostgREST does
          // NOT quote values inside an .or() filter, and a public URL contains
          // reserved chars (`:` `.` `,`) that corrupt the filter; passing the
          // value as an .eq() argument lets supabase-js encode it safely (same
          // pattern as suno.ts `.eq("metadata->>kie_task_id", …)`). Skipped
          // entirely when an asset referrer already keeps the object alive.
          let otherJobRefs = 0
          let jobRefError: { message: string } | null = null
          if (!assetRefsExist) {
            for (const key of ["imageUrl", "videoUrl", "audioUrl"] as const) {
              const { count, error } = await supabase
                .from("jobs")
                .select("id", { count: "exact", head: true })
                .eq("user_id", userId)
                .eq(`output_data->>${key}`, publicUrl)
              if (error) {
                jobRefError = error
                break
              }
              otherJobRefs += count ?? 0
              if (otherJobRefs > 0) break
            }
          }
          // Fail safe: a query error means we can't prove there are no
          // referrers, so treat it as if one exists and skip the R2 delete.
          const jobRefsExist = !!jobRefError || otherJobRefs > 0

          if (!assetRefsExist && !jobRefsExist) {
            await deleteFromR2(asset.r2_key)
          } else {
            console.log(
              `[library] Skipping R2 delete for ${asset.r2_key}: ` +
                `${otherAssetRefs ?? 0} other asset(s) and ${otherJobRefs ?? 0} job(s) reference it` +
                (jobRefError ? ` (jobs check errored: ${jobRefError.message})` : ""),
            )
          }
        }
      } catch (err) {
        console.error("[library] R2 delete failed (continuing):", err)
      }

      const { error: deleteError } = await supabase
        .from("assets")
        .delete()
        .eq("id", id)

      if (deleteError) {
        return reply.status(500).send({
          error: { code: "internal_error", message: deleteError.message },
        })
      }

      try {
        const sizeBytes = asset.size_bytes ?? 0
        if (sizeBytes > 0) {
          await updateStorageUsage(userId, -sizeBytes)
        }
      } catch (err) {
        console.error("[library] Storage usage update failed:", err)
      }

      return { success: true }
    }

    // Soft remove: set in_library = false (keeps R2 file and asset record)
    const { error: updateError } = await supabase
      .from("assets")
      .update({ in_library: false })
      .eq("id", id)
      .eq("user_id", userId)

    if (updateError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: updateError.message },
      })
    }

    return { success: true }
  })

  // POST /v1/library/save-generated - Save a generated asset to the library
  app.post("/v1/library/save-generated", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = saveGeneratedBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { url, type, filename, metadata, isLibraryItem } = parsed.data

    try {
      console.log("[save-generated] Request:", { userId, url: url.slice(0, 80), type, isLibraryItem })

      // Only admins on cloud edition can save to shared library
      if (isLibraryItem) {
        if (!isCloud()) {
          return reply.status(403).send({
            error: {
              code: "forbidden",
              message: "Shared library is only available on cloud edition",
            },
          })
        }

        const isAdmin = await checkIsAdmin(userId)
        console.log("[save-generated] Admin check:", isAdmin)
        if (!isAdmin) {
          return reply.status(403).send({
            error: {
              code: "forbidden",
              message: "Only admins can save to the shared library",
            },
          })
        }
      }

      // Extract R2 key from public URL
      const r2Key = config.R2_PUBLIC_URL
        ? url.replace(config.R2_PUBLIC_URL + "/", "")
        : url

      // Determine filename from URL if not provided
      const resolvedFilename =
        filename ?? url.split("/").pop() ?? `generated-${type}`

      // Determine mime type from type
      const mimeTypeMap: Record<string, string> = {
        image: "image/png",
        video: "video/mp4",
        audio: "audio/mpeg",
      }

      console.log("[save-generated] Inserting:", { r2Key: r2Key.slice(0, 80), resolvedFilename, type })

      // Check if asset already exists for this URL + user
      const { data: existing, error: existingError } = await supabase
        .from("assets")
        .select("id")
        .eq("user_id", userId)
        .eq("r2_url", url)
        .maybeSingle()

      if (existingError) {
        console.error("[save-generated] Existing check error:", existingError)
        return reply.status(500).send({
          error: { code: "internal_error", message: existingError.message },
        })
      }

      if (existing) {
        // Asset record exists — just mark it as in_library
        const { error: updateError } = await supabase
          .from("assets")
          .update({ in_library: true })
          .eq("id", existing.id)

        if (updateError) {
          console.error("[save-generated] Update error:", updateError)
          return reply.status(500).send({
            error: { code: "internal_error", message: updateError.message },
          })
        }

        console.log("[save-generated] Existing asset marked in_library:", existing.id)
        return { data: { id: existing.id, isLibraryItem } }
      }

      // Create asset record with in_library = true
      const { data: asset, error: insertError } = await supabase
        .from("assets")
        .insert({
          user_id: userId,
          type,
          filename: resolvedFilename,
          mime_type: mimeTypeMap[type] ?? "application/octet-stream",
          size_bytes: 0,
          r2_key: r2Key,
          r2_url: url,
          metadata: metadata ?? {},
          is_library_item: isLibraryItem,
          upload_source: "generated",
          in_library: true,
        })
        .select("id")
        .single()

      if (insertError) {
        console.error("[save-generated] Insert error:", insertError)
        return reply.status(500).send({
          error: { code: "internal_error", message: insertError.message },
        })
      }

      console.log("[save-generated] Success:", asset.id)
      return { data: { id: asset.id, isLibraryItem } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[save-generated] Unhandled error:", err)
      return reply.status(500).send({
        error: { code: "save_generated_failed", message },
      })
    }
  })
}
