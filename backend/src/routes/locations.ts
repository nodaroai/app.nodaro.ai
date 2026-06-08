import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { LOCATION_REFERENCE_PHOTO_KINDS, LOCATION_ATTACH_COLUMNS } from "@nodaro/shared"
import type { ReferenceSheet } from "@nodaro/shared"
import { safeUrlSchema } from "../lib/url-validator.js"
import { normalizeImageProvider } from "../lib/image-provider.js"
import { capSelectedAssetByVariant } from "../lib/selected-asset-by-variant.js"
import { supabase } from "../lib/supabase.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { formatZodError } from "../lib/zod-error.js"
import { batchDeleteFromR2 } from "../lib/storage.js"
import { config } from "../lib/config.js"

// Reference-photo kinds — mirrors the migration 124 schema. Single source of
// truth: `LOCATION_REFERENCE_PHOTO_KINDS` from `@nodaro/shared/entity-prompts`.
const referencePhoto = z.object({
  kind: z.enum(LOCATION_REFERENCE_PHOTO_KINDS),
  url: safeUrlSchema,
})

const upsertLocationBody = z.object({
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
  // Persistent image-model id (MODEL_CATALOG). Validated server-side via
  // normalizeImageProvider (unknown / non-image -> null).
  imageProvider: z.string().nullable().optional(),
  // Asset buckets — worker-owned on UPDATE, free-to-set on INSERT. The UPDATE
  // branch deliberately drops these so the worker's atomic
  // `append_location_asset()` RPC cannot be clobbered by a Studio auto-save
  // that snapshotted a stale array.
  timeOfDay: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  weather: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  angles: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  lighting: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  seasons: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  atmosphereMotions: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  // User-owned mood-board + caption + style-lock flag. These ARE allowed in
  // both INSERT and UPDATE — the caller drives them.
  referencePhotos: z.array(referencePhoto).max(20).optional(),
  canonicalDescription: z.string().max(4000).optional(),
  styleLock: z.boolean().optional(),
  // The user's chosen DEFAULT asset take per variant (Studio version-history
  // "pick this take"). OPAQUE string->string map: key "<bucket>:<variant>",
  // value = the chosen URL. User-owned (flows through INSERT + UPDATE). Validate
  // values are strings; caps + verbatim-key passthrough happen in
  // `capSelectedAssetByVariant` (soft-capped, overflow dropped — NOT a 400).
  selectedAssetByVariant: z.record(z.string()).optional(),
  // PII consent timestamp (Phase 2 #7). When the user first adds a reference
  // photo, the studio sends now() so the backend records the consent moment.
  // Once set, the studio's checkbox stays hidden and the user can add more
  // photos freely. The string is ISO-8601 (also accepted by Postgres as a
  // TIMESTAMPTZ literal).
  piiConsentAt: z.string().datetime().optional(),
  // Optimistic-concurrency token: when present, UPDATE only succeeds if the
  // row's `updated_at` still matches. On mismatch we return 409 so the Studio
  // can re-fetch + merge instead of silently overwriting a worker write.
  expectedUpdatedAt: z.string().datetime().optional(),
})

const deleteLocationParams = z.object({
  id: z.string().min(1),
})

// `?permanent=true` flips the DELETE handler from soft-archive into hard-delete
// (DB row + R2 assets). Defaults to soft-archive when absent or "false".
const deleteLocationQuery = z.object({
  permanent: z.enum(["true", "false"]).optional(),
})

// Extract the R2 key from a public-CDN URL. Returns null for non-R2 URLs (e.g.
// external CDNs a user pasted into source_image_url or reference_photos), which
// the caller filters out — we deliberately don't try to delete external blobs.
//
// Local copy of `r2KeyFromUrl` from `ee/billing/cleanup-service.ts` so this
// core route doesn't statically import from `ee/`. The shared helper is slated
// to move into a core facade in Phase 3.5 (see `tools/check-ee-imports.mjs`
// allowlist comment on `lib/collect-app-r2-keys.ts`).
function r2KeyFromPublicUrl(url: string): string | null {
  if (!config.R2_PUBLIC_URL || !url.startsWith(config.R2_PUBLIC_URL)) {
    return null
  }
  return url.replace(config.R2_PUBLIC_URL + "/", "")
}

// Collect every R2 key referenced by a single location row. Used by the
// permanent-delete path to feed `batchDeleteFromR2`. Operates on an already-
// fetched row to avoid a second round-trip (the caller has the row from the
// ownership + archive-status SELECT).
function collectLocationR2Keys(row: Record<string, unknown>): string[] {
  const keys: string[] = []
  if (typeof row.source_image_url === "string") {
    const key = r2KeyFromPublicUrl(row.source_image_url)
    if (key) keys.push(key)
  }
  for (const col of LOCATION_ATTACH_COLUMNS) {
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

const listLocationsQuery = z.object({
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  // Default view hides archived rows. `?archived=true` flips the filter for
  // the Studio's "Archived" tab.
  archived: z.enum(["true", "false"]).optional(),
})

// Single source of truth for the GET column list — keeps single + list in lock-step.
const SELECT_COLUMNS =
  "id, user_id, node_id, project_id, name, description, category, style, source_image_url, image_provider, time_of_day, weather, angles, lighting, seasons, atmosphere_motions, reference_photos, canonical_description, style_lock, pii_consent_at, selected_asset_by_variant, sheets, detail_closeups, deleted_at, created_at, updated_at"

type LocationRow = {
  id: string
  user_id: string
  node_id: string
  project_id: string | null
  name: string
  description: string | null
  category: string | null
  style: string | null
  source_image_url: string | null
  image_provider: string | null
  time_of_day: { name: string; url: string }[] | null
  weather: { name: string; url: string }[] | null
  angles: { name: string; url: string }[] | null
  lighting: { name: string; url: string }[] | null
  seasons: { name: string; url: string }[] | null
  atmosphere_motions: { name: string; url: string }[] | null
  reference_photos: { kind: string; url: string }[] | null
  canonical_description: string | null
  style_lock: boolean | null
  pii_consent_at: string | null
  selected_asset_by_variant: Record<string, string> | null
  // Reference-sheet buckets (migration 200).
  sheets: ReferenceSheet[] | null
  detail_closeups: unknown[] | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

// snake_case → camelCase wire shape. Coerces NULL canonical_description to ""
// so callers don't have to defensively `?? ""` everywhere.
function toCamel(loc: LocationRow) {
  return {
    id: loc.id,
    userId: loc.user_id,
    nodeId: loc.node_id,
    projectId: loc.project_id,
    name: loc.name,
    description: loc.description,
    category: loc.category,
    style: loc.style,
    sourceImageUrl: loc.source_image_url,
    imageProvider: loc.image_provider,
    timeOfDay: loc.time_of_day ?? [],
    weather: loc.weather ?? [],
    angles: loc.angles ?? [],
    lighting: loc.lighting ?? [],
    seasons: loc.seasons ?? [],
    atmosphereMotions: loc.atmosphere_motions ?? [],
    referencePhotos: loc.reference_photos ?? [],
    canonicalDescription: loc.canonical_description ?? "",
    styleLock: loc.style_lock ?? true,
    piiConsentAt: loc.pii_consent_at,
    selectedAssetByVariant: loc.selected_asset_by_variant ?? {},
    sheets: loc.sheets ?? [],
    detailCloseups: loc.detail_closeups ?? [],
    deletedAt: loc.deleted_at,
    createdAt: loc.created_at,
    updatedAt: loc.updated_at,
  }
}

export async function locationRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // List locations
  // ---------------------------------------------------------------------------
  app.get("/v1/locations", async (req, reply) => {
    const parsed = listLocationsQuery.safeParse(req.query)
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
      .from("locations")
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

    const locations = (data ?? []).map((loc) => toCamel(loc as LocationRow))
    return { locations }
  })

  // ---------------------------------------------------------------------------
  // Get single location by ID
  // ---------------------------------------------------------------------------
  app.get("/v1/locations/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = deleteLocationParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid location ID",
        },
      })
    }

    const { id } = parsed.data

    // The two queries below are independent — the pendingJobs query keys off
    // `userId` + route param `id` only, NOT the fetched location row. Run them
    // in parallel via Promise.all to shave ~30-80ms of sequential round-trip
    // latency. Mirrors the characters.ts GET /:id pattern.
    const [locationResult, jobsResult] = await Promise.all([
      supabase
        .from("locations")
        .select(SELECT_COLUMNS)
        .eq("id", id)
        .eq("user_id", userId)
        .single(),
      // pendingJobs: asset-generation jobs still in flight for this location so
      // the Studio can re-attach spinners on reopen. Defensive LIMIT 100 in case
      // a stuck worker has left dozens of pending rows; the studio only renders
      // a small grid of spinners.
      supabase
        .from("jobs")
        .select("id, input_data, status")
        .eq("user_id", userId)
        .in("status", ["pending", "running"])
        .filter("input_data->>attachToLocationId", "eq", id)
        .order("created_at", { ascending: false })
        .limit(100),
    ])

    const { data, error } = locationResult
    const { data: jobsRows } = jobsResult

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Location not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    type PendingJob = {
      jobId: string
      assetType: string
      name: string
      status: string
    }
    const pendingJobs: PendingJob[] = (jobsRows ?? []).map((row) => {
      const inp = (row.input_data ?? {}) as Record<string, unknown>
      const assetType = typeof inp.assetType === "string" ? inp.assetType : "main"
      const name = typeof inp.attachName === "string" ? inp.attachName : "(unnamed)"
      return {
        jobId: row.id as string,
        assetType,
        name,
        status: row.status as string,
      }
    })

    return { ...toCamel(data as LocationRow), pendingJobs }
  })

  // ---------------------------------------------------------------------------
  // Upsert location (create or update)
  // ---------------------------------------------------------------------------
  app.post("/v1/locations", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    const parsed = upsertLocationBody.safeParse(req.body)
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
      imageProvider,
      timeOfDay,
      weather,
      angles,
      lighting,
      seasons,
      atmosphereMotions,
      referencePhotos,
      canonicalDescription,
      styleLock,
      selectedAssetByVariant,
      piiConsentAt,
      expectedUpdatedAt,
    } = parsed.data
    const userId = req.userId

    // OPAQUE map — soft-capped only, keys passed through verbatim (no
    // lowercase/trim): the studio owns the "<bucket>:<variant>" id format.
    const cappedSelectedAssets = capSelectedAssetByVariant(selectedAssetByVariant)

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (id) {
      // UPDATE — deliberately EXCLUDE worker-owned columns so a Studio
      // auto-save with a stale snapshot can't clobber the worker's atomic
      // `append_location_asset()` writes. Excluded columns:
      //   lighting, seasons, atmosphere_motions, time_of_day, weather, angles.
      // User-owned columns (reference_photos, canonical_description,
      // style_lock, identity fields) flow through normally.
      //
      // Only touch columns the caller explicitly sent (omitted fields stay
      // untouched on the row). Mirrors the characters.ts UPDATE pattern so
      // partial-update semantics are consistent across studio routes.
      const updateRow: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      if (name !== undefined) updateRow.name = name
      if (description !== undefined) updateRow.description = description ?? null
      if (category !== undefined) updateRow.category = category ?? null
      if (style !== undefined) updateRow.style = style ?? null
      if (sourceImageUrl !== undefined) updateRow.source_image_url = sourceImageUrl ?? null
      if (imageProvider !== undefined) updateRow.image_provider = normalizeImageProvider(imageProvider)
      if (referencePhotos !== undefined) updateRow.reference_photos = referencePhotos
      if (canonicalDescription !== undefined) updateRow.canonical_description = canonicalDescription
      if (styleLock !== undefined) updateRow.style_lock = styleLock
      if (piiConsentAt !== undefined) updateRow.pii_consent_at = piiConsentAt
      if (cappedSelectedAssets !== undefined) updateRow.selected_asset_by_variant = cappedSelectedAssets

      let query = supabase
        .from("locations")
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
            .from("locations")
            .select("updated_at, name, source_image_url, canonical_description")
            .eq("id", id)
            .eq("user_id", userId)
            .single()
          if (current) {
            return reply.status(409).send({
              error: {
                code: "concurrent_modification",
                updatedAt: (current as { updated_at: string }).updated_at,
                message: "Location was modified concurrently",
              },
            })
          }
        }
        return reply.status(404).send({
          error: { code: "location_not_found", message: "Location not found" },
        })
      }
      return { id: updated.id, updatedAt: updated.updated_at }
    }

    // INSERT — accepts ALL fields. New rows start with empty asset buckets
    // (unless the caller explicitly sent values, useful for templates/imports).
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
      image_provider: normalizeImageProvider(imageProvider),
      time_of_day: timeOfDay ?? [],
      weather: weather ?? [],
      angles: angles ?? [],
      lighting: lighting ?? [],
      seasons: seasons ?? [],
      atmosphere_motions: atmosphereMotions ?? [],
      reference_photos: referencePhotos ?? [],
      canonical_description: canonicalDescription ?? null,
      style_lock: styleLock ?? true,
      pii_consent_at: piiConsentAt ?? null,
      selected_asset_by_variant: cappedSelectedAssets ?? {},
      updated_at: new Date().toISOString(),
    }

    const { data: created, error } = await supabase
      .from("locations")
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
  // Delete location
  //
  //   default          → soft-delete (sets deleted_at, leaves row intact for
  //                      restore via POST /v1/locations/:id/restore).
  //   ?permanent=true  → hard-delete the row AND batch-delete all referenced
  //                      R2 keys (main image, the 6 asset buckets, reference
  //                      photos). Row MUST already be archived — active rows
  //                      return 400 `not_archived` to guard against curl/SDK
  //                      callers bypassing the UI archive-first flow. The UI
  //                      only surfaces permanent-delete from the Archived
  //                      tab in `/library/locations` so this branch is
  //                      reachable only after the row has gone through DELETE
  //                      (no-query) → restore (optional) → DELETE
  //                      ?permanent=true.
  //
  // Permanent-delete is intentionally NOT mirrored on the SDK (`@nodaro/client`)
  // — programmatic callers can only soft-delete.
  // ---------------------------------------------------------------------------
  app.delete("/v1/locations/:id", { preHandler: requireAppScope("assets:write") }, async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsedParams = deleteLocationParams.safeParse(req.params)
    if (!parsedParams.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsedParams.error.issues[0]?.message ?? "Invalid location ID",
        },
      })
    }

    const parsedQuery = deleteLocationQuery.safeParse(req.query)
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
        .from("locations")
        .select(
          "id, deleted_at, source_image_url, time_of_day, weather, seasons, angles, lighting, atmosphere_motions, reference_photos",
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
          error: { code: "not_found", message: "Location not found" },
        })
      }
      if (!row.deleted_at) {
        return reply.status(400).send({
          error: {
            code: "not_archived",
            message:
              "Location must be archived before permanent deletion. Call DELETE first.",
          },
        })
      }

      // Step 2: Collect R2 keys from JSONB asset columns + reference photos.
      // External URLs (non-R2 CDN) are filtered out by r2KeyFromPublicUrl.
      const keys = collectLocationR2Keys(row as Record<string, unknown>)

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
            `[locations] R2 batch delete failed for location ${id} (continuing to DB delete):`,
            err,
          )
        }
      }

      // Step 4: Hard-delete the DB row. Scoped by user_id again as defense in
      // depth — even if the ownership check above is somehow bypassed, the
      // DELETE itself cannot affect another user's row.
      const { error: deleteErr } = await supabase
        .from("locations")
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
      .from("locations")
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
