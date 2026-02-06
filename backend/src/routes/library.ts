import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { isCloud } from "../lib/config.js"
import { deleteFromR2 } from "../lib/storage.js"
import { updateStorageUsage } from "../utils/file-validation.js"

// ============================================================
// Helpers
// ============================================================

async function checkIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single()

  if (error) {
    if (error.code === "PGRST116") return false
    throw new Error(`Admin check failed: ${error.message}`)
  }

  if (!data) return false
  return data.role === "admin" || data.role === "super_admin"
}

// ============================================================
// Schemas
// ============================================================

const listLibraryQuery = z.object({
  userId: z.string().uuid(),
  type: z.enum(["all", "image", "video", "audio"]).optional().default("all"),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(40),
  cursor: z.string().uuid().optional(),
})

const assetIdParams = z.object({
  id: z.string().uuid(),
})

const deleteLibraryQuery = z.object({
  userId: z.string().uuid(),
})

const promoteBody = z.object({
  userId: z.string().uuid(),
})

const saveGeneratedBody = z.object({
  userId: z.string().uuid(),
  url: z.string().url(),
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
    const parsed = listLibraryQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid query",
        },
      })
    }

    const { userId, type, search, limit, cursor } = parsed.data

    let query = supabase
      .from("assets")
      .select("id, user_id, type, filename, mime_type, size_bytes, r2_key, r2_url, metadata, is_library_item, upload_source, created_at")
      .or(`user_id.eq.${userId},is_library_item.eq.true`)
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

    const { data, error } = await query

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

    return { data: assets, nextCursor }
  })

  // POST /v1/library/:id/promote - Promote asset to shared library (admin only)
  app.post("/v1/library/:id/promote", async (req, reply) => {
    const paramsParsed = assetIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsParsed.error.issues[0]?.message ?? "Invalid asset ID",
        },
      })
    }

    const bodyParsed = promoteBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyParsed.error.issues[0]?.message ?? "userId is required",
        },
      })
    }

    const { id } = paramsParsed.data
    const { userId } = bodyParsed.data

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
    const paramsParsed = assetIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsParsed.error.issues[0]?.message ?? "Invalid asset ID",
        },
      })
    }

    const bodyParsed = promoteBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: bodyParsed.error.issues[0]?.message ?? "userId is required",
        },
      })
    }

    const { id } = paramsParsed.data
    const { userId } = bodyParsed.data

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

  // DELETE /v1/library/:id - Delete asset and R2 file
  app.delete("/v1/library/:id", async (req, reply) => {
    const paramsParsed = assetIdParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsParsed.error.issues[0]?.message ?? "Invalid asset ID",
        },
      })
    }

    const queryParsed = deleteLibraryQuery.safeParse(req.query)
    if (!queryParsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: queryParsed.error.issues[0]?.message ?? "userId is required",
        },
      })
    }

    const { id } = paramsParsed.data
    const { userId } = queryParsed.data

    // Fetch asset to verify ownership
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

    // Delete file from R2 (best-effort, don't fail if R2 delete fails)
    try {
      if (asset.r2_key) {
        await deleteFromR2(asset.r2_key)
      }
    } catch (err) {
      console.error("[library] R2 delete failed (continuing):", err)
    }

    // Delete asset record from database
    const { error: deleteError } = await supabase
      .from("assets")
      .delete()
      .eq("id", id)

    if (deleteError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: deleteError.message },
      })
    }

    // Decrement storage usage (guard against negative)
    try {
      const sizeBytes = asset.size_bytes ?? 0
      if (sizeBytes > 0) {
        await updateStorageUsage(userId, -sizeBytes)
      }
    } catch (err) {
      console.error("[library] Storage usage update failed:", err)
    }

    return { success: true }
  })

  // POST /v1/library/save-generated - Save a generated asset to the library
  app.post("/v1/library/save-generated", async (req, reply) => {
    const parsed = saveGeneratedBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { userId, url, type, filename, metadata, isLibraryItem } = parsed.data

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
        return reply.status(409).send({
          error: {
            code: "already_exists",
            message: "This asset is already in your library",
          },
        })
      }

      // Create asset record
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
