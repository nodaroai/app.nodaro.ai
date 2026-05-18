import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { PLACEHOLDER_CHARACTER_NAME } from "@nodaro/shared"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { formatZodError } from "../lib/zod-error.js"
import { hasCredits } from "../lib/config.js"
import { cancelCharacterTraining, deleteCharacterLora } from "../providers/replicate/training.js"
import { refundReservedCreditsForJob } from "../lib/character-lora.js"
import { CHARACTER_LORA_TRAINING_JOB_TYPE } from "@nodaro/shared"

/**
 * Characters API. Soft-delete + case-insensitive unique name per user
 * (see migration 112). The library list filters out archived rows by default;
 * `GET /v1/characters/:id` ignores the archive flag so canvas nodes that hold
 * a stale `characterDbId` keep working.
 */

// Reference-photo kinds drive the identity-foundation gallery slots. Every
// `kind` except `"other"` may appear at most once (one front-face shot, one
// side shot, etc.); `"other"` is unconstrained so users can attach extra
// references.
//
// Migration 118 renamed `front` → `frontFace` and `fullBody` → `frontBody`
// (the original names were ambiguous — `front` could be face-only or body, and
// `fullBody` collapsed front-body and back-body into one slot).
const REFERENCE_PHOTO_KINDS = [
  "frontFace",
  "sideLeft",
  "sideRight",
  "threeQuarterLeft",
  "threeQuarterRight",
  "frontBody",
  "other",
] as const

const referencePhoto = z.object({
  url: safeUrlSchema,
  kind: z.enum(REFERENCE_PHOTO_KINDS),
})

const upsertCharacterBody = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  nodeId: z.string().min(1),
  workflowId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  // On UPDATE, a field that's `undefined` (omitted from the request body)
  // means "don't touch this column" — Character Studio relies on this so its
  // debounced auto-save can write identity fields without overwriting asset
  // arrays that the worker is concurrently appending to. INSERT always uses
  // the full row (with sensible defaults).
  //
  // `name` is OPTIONAL at the schema level so partial updates ({id, gender})
  // typecheck without forcing the caller to re-send the same name they
  // already have. The handler still requires `name` on INSERT (rejects with
  // a `validation_error` when `id` is missing AND `name` is missing) and
  // only writes `name` into the patch on UPDATE when it's defined.
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  gender: z.string().max(50).optional(),
  style: z.string().max(50).optional(),
  baseOutfit: z.string().max(1000).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  expressions: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  poses: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  lightingVariations: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  angles: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  bodyAngles: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  motions: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  voice: z.object({ voiceId: z.string(), voiceName: z.string(), traits: z.string() }).nullable().optional(),
  personality: z.object({ mood: z.string(), speechStyle: z.string(), movementStyle: z.string(), behavioralNotes: z.string() }).nullable().optional(),
  // Identity-foundation fields (migration 114). Length caps mirror the DB
  // CHECK constraints so we reject at the boundary with a 400 rather than a
  // 500 from Postgres. `referencePhotos` further enforces "at most one per
  // non-`other` kind"; `realLifeRefsByVariant` caps total keys + per-key URLs
  // so a runaway client can't blow up the row.
  seedPrompt: z.string().max(2000).optional(),
  canonicalDescription: z.string().max(4000).optional(),
  referencePhotos: z
    .array(referencePhoto)
    .max(20)
    .optional()
    .refine(
      (arr) => {
        if (!arr) return true
        const counts = new Map<string, number>()
        for (const p of arr) {
          if (p.kind === "other") continue
          counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1)
          if ((counts.get(p.kind) ?? 0) > 1) return false
        }
        return true
      },
      { message: "Each non-`other` kind may appear at most once" },
    ),
  realLifeRefsByVariant: z
    .record(z.array(safeUrlSchema).max(5))
    .optional()
    .refine((obj) => !obj || Object.keys(obj).length <= 20, {
      message: "real_life_refs_by_variant: max 20 keys",
    }),
})

const deleteCharacterParams = z.object({
  id: z.string().min(1),
})

const listCharactersQuery = z.object({
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  archived: z.enum(["true", "false"]).optional(),
  // Default 100 = enough for the library list at typical scale; cap at 500 so
  // a misbehaving SDK consumer can't drag the whole table over the wire.
  // The route APPLIES `.limit(parsed.limit)` so this both validates AND drives
  // the actual DB cap.
  limit: z.coerce.number().int().positive().max(500).optional().default(100),
})

const SELECT_COLUMNS =
  "id, user_id, node_id, project_id, name, description, gender, style, base_outfit, source_image_url, expressions, poses, lighting_variations, angles, body_angles, motions, voice, personality, lora_training_status, lora_replicate_version, lora_trigger_word, lora_trained_at, deleted_at, created_at, updated_at"

type CharacterRow = {
  id: string
  user_id: string
  node_id: string
  project_id: string | null
  name: string
  description: string | null
  gender: string | null
  style: string | null
  base_outfit: string | null
  source_image_url: string | null
  expressions: { name: string; url: string }[] | null
  poses: { name: string; url: string }[] | null
  lighting_variations: { name: string; url: string }[] | null
  angles: { name: string; url: string }[] | null
  body_angles: { name: string; url: string }[] | null
  motions: { name: string; url: string }[] | null
  voice: { voiceId: string; voiceName: string; traits: string } | null
  personality: { mood: string; speechStyle: string; movementStyle: string; behavioralNotes: string } | null
  lora_training_status: string | null
  lora_replicate_version: string | null
  lora_trigger_word: string | null
  lora_trained_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

function toCamel(c: CharacterRow) {
  return {
    id: c.id,
    userId: c.user_id,
    nodeId: c.node_id,
    projectId: c.project_id,
    name: c.name,
    description: c.description,
    gender: c.gender,
    style: c.style,
    baseOutfit: c.base_outfit,
    sourceImageUrl: c.source_image_url,
    expressions: c.expressions,
    poses: c.poses,
    lightingVariations: c.lighting_variations,
    angles: c.angles,
    bodyAngles: c.body_angles,
    motions: c.motions,
    voice: c.voice,
    personality: c.personality,
    loraTrainingStatus: c.lora_training_status,
    loraReplicateVersion: c.lora_replicate_version,
    loraTriggerWord: c.lora_trigger_word,
    loraTrainedAt: c.lora_trained_at,
    deletedAt: c.deleted_at,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }
}

/**
 * Find the next available name for this user matching `baseName` (or `baseName N`).
 * Used for placeholder auto-numbering ("Untitled character 2"), duplicate
 * suffixes ("Kira (copy)", "Kira (copy 2)"), and restore-on-conflict ("Kira (restored)").
 * Case-insensitive comparison since the unique index is `LOWER(name)`.
 *
 * Pure computation off a live snapshot — a concurrent insert can still race
 * past us, so callers should retry on 23505 (see `insertWithUniqueName`).
 */
async function deriveAvailableName(userId: string, baseName: string): Promise<string> {
  const { data } = await supabase
    .from("characters")
    .select("name")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .ilike("name", `${baseName}%`)
  const existing = new Set<string>((data ?? []).map((r) => r.name.toLowerCase()))
  if (!existing.has(baseName.toLowerCase())) return baseName
  for (let n = 2; n < 1000; n++) {
    const candidate = `${baseName} ${n}`
    if (!existing.has(candidate.toLowerCase())) return candidate
  }
  // 1000 collisions is implausible — but bail gracefully rather than spin.
  throw new Error(`No available name based on '${baseName}'`)
}

/**
 * Insert a character row whose `name` is auto-derived from `baseName`.
 * Retries up to 5 times on 23505 (unique violation) to absorb concurrent races.
 */
async function insertWithUniqueName(
  payload: Record<string, unknown>,
  userId: string,
  baseName: string,
): Promise<{ id: string; name: string } | { error: { code: string; message: string } }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = await deriveAvailableName(userId, baseName)
    const { data, error } = await supabase
      .from("characters")
      .insert({ ...payload, name })
      .select("id")
      .single()
    if (!error && data) return { id: data.id, name }
    if (error && error.code !== "23505") return { error: { code: "internal_error", message: error.message } }
    // 23505 — another writer took our derived name. Loop and pick the next.
  }
  return { error: { code: "name_conflict", message: `Couldn't insert a unique '${baseName}*' after retries.` } }
}

const NAME_TAKEN_MESSAGE = "A character with that name already exists. Pick a different name."

export async function characterRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // List characters for a project (active by default; `?archived=true` flips).
  // -----------------------------------------------------------------------
  app.get("/v1/characters", async (req, reply) => {
    const parsed = listCharactersQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid query" },
      })
    }

    const { projectId, archived, limit } = parsed.data
    const userId = req.userId
    const wantArchived = archived === "true"

    let query = supabase
      .from("characters")
      .select(SELECT_COLUMNS)
      .order("created_at", { ascending: false })

    if (projectId) query = query.eq("project_id", projectId)
    if (userId) query = query.eq("user_id", userId)
    // Default view excludes archived. Archived view flips the filter.
    if (wantArchived) query = query.not("deleted_at", "is", null)
    else query = query.is("deleted_at", null)
    query = query.limit(limit)

    const { data, error } = await query

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    return { characters: (data ?? []).map(toCamel) }
  })

  // -----------------------------------------------------------------------
  // Get single character by ID. Intentionally ignores `deleted_at` so canvas
  // nodes pointing at archived rows keep loading.
  // -----------------------------------------------------------------------
  app.get("/v1/characters/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const parsed = deleteCharacterParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid character ID" },
      })
    }

    const { id } = parsed.data

    const { data, error } = await supabase
      .from("characters")
      .select(SELECT_COLUMNS)
      .eq("id", id)
      .eq("user_id", userId)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({ error: { code: "not_found", message: "Character not found" } })
      }
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    // The three buckets below are independent (only previousCandidates needs
    // the character row's `source_image_url`, already fetched above). Run them
    // in parallel via Promise.all to shave ~30-150ms of sequential round-trip
    // latency off the GET /v1/characters/:id path. Per-query semantics are
    // documented inline below.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const [pendingResult, portraitPendingResult, previousCompletedResult] = await Promise.all([
      // pendingJobs: asset-generation jobs still in flight for this character
      // so the Character Studio can re-attach spinners on reopen (jobs survive
      // page closes because the worker auto-attaches to the row at completion
      // — this query is purely for the UX of "spinner reappears" continuity).
      // limit(50) caps the response under a stuck-worker scenario where a user
      // has dozens of orphaned pending rows — the studio only renders a small
      // grid of spinners, never the full set.
      supabase
        .from("jobs")
        .select("id, input_data")
        .eq("user_id", userId)
        .in("status", ["pending", "running"])
        .filter("input_data->>attachToCharacterId", "eq", id)
        .limit(50),
      // portraitCandidates: in-flight `generate-character` jobs for THIS row.
      // The studio polls this bucket to keep the Appearance tab's "generating
      // portrait" tile responsive across reloads. URL may be undefined while
      // the job is still pending; the worker writes `output_data.imageUrl`
      // once it has uploaded the R2 result (often before the final commit
      // completes), so we surface it as soon as it's there. limit(50) is the
      // same defensive cap as pendingJobs above.
      supabase
        .from("jobs")
        .select("id, status, progress, output_data, input_data")
        .eq("user_id", userId)
        .in("status", ["pending", "running"])
        .filter("input_data->>type", "eq", "generate-character")
        .filter("input_data->>attachToCharacterId", "eq", id)
        .limit(50),
      // previousCandidates: recently-completed `generate-character` jobs for
      // THIS row, with URL ≠ current portrait, within the last 7 days. We
      // over-fetch (limit 10) to absorb URL-collisions with the active portrait
      // and the rare row missing `output_data.imageUrl`, then trim to 5 in JS.
      // ORDER BY created_at DESC so the user sees their latest alternatives.
      // We project `imageUrl` directly via JSONB path so we don't drag the
      // whole `output_data` blob across the wire.
      supabase
        .from("jobs")
        .select("id, image_url:output_data->>imageUrl, created_at")
        .eq("user_id", userId)
        .eq("status", "completed")
        .filter("input_data->>type", "eq", "generate-character")
        .filter("input_data->>attachToCharacterId", "eq", id)
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(10),
    ])

    const { data: pendingRows } = pendingResult
    const { data: portraitPendingRows } = portraitPendingResult
    const { data: previousCompletedRows } = previousCompletedResult

    type PendingJob = {
      jobId: string
      assetType: "expressions" | "poses" | "angles" | "bodyAngles" | "lighting" | "motions"
      name: string
    }
    const pendingJobs: PendingJob[] = []
    for (const row of pendingRows ?? []) {
      const inp = (row.input_data ?? {}) as Record<string, unknown>
      const jobType = typeof inp.type === "string" ? inp.type : undefined
      const attachName = typeof inp.attachName === "string" ? inp.attachName : undefined
      if (!attachName) continue
      let assetType: PendingJob["assetType"] | null = null
      if (jobType === "generate-character-motion") {
        assetType = "motions"
      } else if (jobType === "generate-character-asset" || jobType === "image-to-image") {
        const col = typeof inp.attachToColumn === "string" ? inp.attachToColumn : undefined
        if (col === "expressions" || col === "poses" || col === "angles") assetType = col
        else if (col === "body_angles") assetType = "bodyAngles"
        else if (col === "lighting_variations") assetType = "lighting"
      }
      if (!assetType) continue
      pendingJobs.push({ jobId: row.id, assetType, name: attachName })
    }

    type PortraitCandidate = { jobId: string; url: string | undefined; progress: number; status: string }
    const portraitCandidates: PortraitCandidate[] = (portraitPendingRows ?? []).map((row) => {
      const out = (row.output_data ?? null) as Record<string, unknown> | null
      const rawUrl = out?.imageUrl
      return {
        jobId: row.id,
        url: typeof rawUrl === "string" ? rawUrl : undefined,
        progress: typeof row.progress === "number" ? row.progress : 0,
        status: row.status,
      }
    })

    const currentPortrait = (data as { source_image_url?: string | null }).source_image_url ?? null
    type PreviousCandidate = { jobId: string; url: string; createdAt: string }
    const previousCandidates: PreviousCandidate[] = (previousCompletedRows ?? [])
      .map((row) => {
        // image_url is the projected alias from `output_data->>imageUrl` in the
        // SELECT above. ->> always yields text|null so we still defend against
        // non-string and currentPortrait-collisions in JS.
        const u = (row as { image_url?: unknown }).image_url
        if (typeof u !== "string" || u === currentPortrait) return null
        return { jobId: row.id as string, url: u, createdAt: row.created_at as string }
      })
      .filter((x): x is PreviousCandidate => x !== null)
      .slice(0, 5)

    return { ...toCamel(data as CharacterRow), pendingJobs, portraitCandidates, previousCandidates }
  })

  // -----------------------------------------------------------------------
  // Usage check — how many of the caller's workflows reference this character.
  // Used by the library "Archive" confirmation modal to show the impact.
  // -----------------------------------------------------------------------
  app.get("/v1/characters/:id/usage", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = deleteCharacterParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid character ID" },
      })
    }
    const { id } = parsed.data
    const { data, error } = await supabase.rpc("character_workflow_usage", {
      p_character_id: id,
      p_user_id: userId,
    })
    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }
    const rows = (data ?? []) as { workflow_id: string; workflow_name: string }[]
    return {
      workflowCount: rows.length,
      workflows: rows.map((r) => ({ id: r.workflow_id, name: r.workflow_name })),
    }
  })

  // -----------------------------------------------------------------------
  // Upsert character (create or update).
  //   • INSERT with name === PLACEHOLDER_CHARACTER_NAME auto-numbers
  //     ("Untitled character", "Untitled character 2", …).
  //   • INSERT/UPDATE with a user-typed name returns 409 on conflict so the
  //     studio can surface a "name already taken" toast.
  // -----------------------------------------------------------------------
  app.post("/v1/characters", async (req, reply) => {
    const parsed = upsertCharacterBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { id, nodeId, workflowId, projectId, name, description, gender, style, baseOutfit, sourceImageUrl, expressions, poses, lightingVariations, angles, bodyAngles, motions, voice, personality, seedPrompt, canonicalDescription, referencePhotos, realLifeRefsByVariant } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    // Normalize per-variant keys before persisting. The column is keyed by a
    // lowercased+trimmed slug (e.g. "smile") so the UI can look refs up by the
    // canonical preset id regardless of how the caller spells/spaces the key.
    // Done once here so both INSERT and UPDATE write the same shape.
    const normalizedVariantRefs = realLifeRefsByVariant
      ? Object.fromEntries(
          Object.entries(realLifeRefsByVariant).map(([k, v]) => [k.toLowerCase().trim(), v]),
        )
      : undefined

    if (id) {
      // UPDATE: only touch columns the caller explicitly sent. `name` itself
      // is OPTIONAL on UPDATE — when omitted we leave the existing row.name
      // alone. This is what lets CLI partial updates (`nodaro characters
      // update <id> --gender female`) succeed without forcing every caller
      // to round-trip and re-send the current name.
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }
      if (name !== undefined) patch.name = name
      if (description !== undefined) patch.description = description ?? null
      if (gender !== undefined) patch.gender = gender ?? null
      if (style !== undefined) patch.style = style ?? null
      if (baseOutfit !== undefined) patch.base_outfit = baseOutfit ?? null
      if (sourceImageUrl !== undefined) patch.source_image_url = sourceImageUrl ?? null
      if (expressions !== undefined) patch.expressions = expressions
      if (poses !== undefined) patch.poses = poses
      if (lightingVariations !== undefined) patch.lighting_variations = lightingVariations
      if (angles !== undefined) patch.angles = angles
      if (bodyAngles !== undefined) patch.body_angles = bodyAngles
      if (motions !== undefined) patch.motions = motions
      if (voice !== undefined) patch.voice = voice ?? null
      if (personality !== undefined) patch.personality = personality ?? null
      if (seedPrompt !== undefined) patch.seed_prompt = seedPrompt ?? null
      if (canonicalDescription !== undefined) patch.canonical_description = canonicalDescription ?? null
      if (referencePhotos !== undefined) patch.reference_photos = referencePhotos
      if (normalizedVariantRefs !== undefined) patch.real_life_refs_by_variant = normalizedVariantRefs

      const { data: updated, error } = await supabase
        .from("characters")
        .update(patch)
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .single()

      if (error) {
        if (error.code === "23505") {
          return reply.status(409).send({ error: { code: "name_taken", message: NAME_TAKEN_MESSAGE } })
        }
        return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
      }
      return { id: updated.id }
    }

    // INSERT — `name` is required when creating a new row.
    if (name === undefined) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: "name is required when creating a new character (id omitted).",
        },
      })
    }

    const basePayload = {
      user_id: userId,
      node_id: nodeId,
      workflow_id: workflowId ?? null,
      project_id: projectId ?? null,
      description: description ?? null,
      gender: gender ?? null,
      style: style ?? null,
      base_outfit: baseOutfit ?? null,
      source_image_url: sourceImageUrl ?? null,
      expressions: expressions ?? [],
      poses: poses ?? [],
      lighting_variations: lightingVariations ?? [],
      angles: angles ?? [],
      body_angles: bodyAngles ?? [],
      motions: motions ?? [],
      voice: voice ?? null,
      personality: personality ?? null,
      seed_prompt: seedPrompt ?? null,
      canonical_description: canonicalDescription ?? null,
      reference_photos: referencePhotos ?? [],
      real_life_refs_by_variant: normalizedVariantRefs ?? {},
      updated_at: new Date().toISOString(),
    }

    if (name === PLACEHOLDER_CHARACTER_NAME) {
      // Auto-numbered placeholder path: derive the next available
      // "Untitled character N" so the library always shows distinct rows.
      const result = await insertWithUniqueName(basePayload, userId, PLACEHOLDER_CHARACTER_NAME)
      if ("error" in result) {
        return reply.status(500).send({ error: result.error })
      }
      return { id: result.id, name: result.name }
    }

    // User-typed name: a 23505 means they picked something they already own.
    // Surface it as 409 so the studio can show a toast and let them retry.
    const { data: created, error } = await supabase
      .from("characters")
      .insert({ ...basePayload, name })
      .select("id")
      .single()
    if (error) {
      if (error.code === "23505") {
        return reply.status(409).send({ error: { code: "name_taken", message: NAME_TAKEN_MESSAGE } })
      }
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }
    return { id: created.id, name }
  })

  // -----------------------------------------------------------------------
  // Duplicate (fork) — copy a character to a new row with " (copy)" suffix.
  // Asset URLs are shared (R2 references); the new character can diverge by
  // regenerating. Caller picks the source `nodeId` so the new row can be
  // re-bound to the spawning canvas node.
  // -----------------------------------------------------------------------
  app.post("/v1/characters/:id/duplicate", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const idsParsed = deleteCharacterParams.safeParse(req.params)
    if (!idsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid character ID" },
      })
    }
    const bodyParsed = z
      .object({ nodeId: z.string().min(1).optional(), projectId: z.string().uuid().optional() })
      .safeParse(req.body ?? {})
    if (!bodyParsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid duplicate body" } })
    }

    // Fetch the source row, scoped to the caller.
    const { data: source, error: fetchErr } = await supabase
      .from("characters")
      .select(SELECT_COLUMNS)
      .eq("id", idsParsed.data.id)
      .eq("user_id", userId)
      .single()
    if (fetchErr || !source) {
      return reply.status(404).send({ error: { code: "not_found", message: "Character not found" } })
    }

    const srcName = (source as CharacterRow).name
    const baseName = `${srcName} (copy)`
    const payload = {
      user_id: userId,
      node_id: bodyParsed.data.nodeId ?? (source as CharacterRow).node_id,
      workflow_id: null,
      project_id: bodyParsed.data.projectId ?? (source as CharacterRow).project_id,
      description: (source as CharacterRow).description,
      gender: (source as CharacterRow).gender,
      style: (source as CharacterRow).style,
      base_outfit: (source as CharacterRow).base_outfit,
      source_image_url: (source as CharacterRow).source_image_url,
      expressions: (source as CharacterRow).expressions ?? [],
      poses: (source as CharacterRow).poses ?? [],
      lighting_variations: (source as CharacterRow).lighting_variations ?? [],
      angles: (source as CharacterRow).angles ?? [],
      body_angles: (source as CharacterRow).body_angles ?? [],
      motions: (source as CharacterRow).motions ?? [],
      voice: (source as CharacterRow).voice,
      personality: (source as CharacterRow).personality,
      updated_at: new Date().toISOString(),
    }
    const result = await insertWithUniqueName(payload, userId, baseName)
    if ("error" in result) {
      return reply.status(500).send({ error: result.error })
    }
    return { id: result.id, name: result.name }
  })

  // -----------------------------------------------------------------------
  // Restore from archive. The original name may now collide with an active
  // row created since the archive; we auto-suffix "(restored)" to keep the
  // restored row visible without forcing the user to rename mid-restore.
  // -----------------------------------------------------------------------
  app.post("/v1/characters/:id/restore", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = deleteCharacterParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid character ID" } })
    }
    const { id } = parsed.data

    // Load the archived row so we know what name it currently has + whether
    // restoring it would conflict with a since-created active row.
    const { data: archived, error: fetchErr } = await supabase
      .from("characters")
      .select("id, name, deleted_at")
      .eq("id", id)
      .eq("user_id", userId)
      .single()
    if (fetchErr || !archived) {
      return reply.status(404).send({ error: { code: "not_found", message: "Character not found" } })
    }
    if (!archived.deleted_at) {
      // Already active — no-op success.
      return { id: archived.id, name: archived.name }
    }

    // Check whether the archived name is taken by any active row of this user.
    const { data: conflicts } = await supabase
      .from("characters")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .ilike("name", archived.name)
    const taken = (conflicts ?? []).length > 0
    let restoredName = archived.name
    if (taken) {
      restoredName = await deriveAvailableName(userId, `${archived.name} (restored)`)
    }

    // Retry up to 3× on 23505 to absorb a concurrent restorer.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: updated, error } = await supabase
        .from("characters")
        .update({ deleted_at: null, name: restoredName, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
        .select("id, name")
        .single()
      if (!error && updated) return { id: updated.id, name: updated.name }
      if (error && error.code !== "23505") {
        return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
      }
      // Conflict — recompute and try again.
      restoredName = await deriveAvailableName(userId, `${archived.name} (restored)`)
    }
    return reply.status(409).send({ error: { code: "name_taken", message: "Couldn't find a free name to restore under." } })
  })

  // -----------------------------------------------------------------------
  // Archive (soft delete). Canvas nodes pointing at the row continue to load
  // via GET /v1/characters/:id. The library list hides archived; the picker
  // list also hides them. Restore via POST /v1/characters/:id/restore.
  // -----------------------------------------------------------------------
  app.delete("/v1/characters/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const parsed = deleteCharacterParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid character ID" },
      })
    }

    const { id } = parsed.data

    // Pre-fetch character to learn about any in-flight LoRA training or
    // trained model that needs cleanup BEFORE we soft-delete (per design §9.3).
    // Cloud edition only — Community/Business never populate the lora_* columns.
    // The entire block is best-effort: any failure (DB blip, race with another
    // delete, missing column on old schemas) logs and falls through to the
    // actual soft-delete, which must always succeed when the user clicks it.
    if (hasCredits()) {
      try {
        const { data: character } = await supabase
          .from("characters")
          .select("id, lora_training_status, lora_training_replicate_id, lora_replicate_version")
          .eq("id", id)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .single()
        if (character) {
          // (a) Cancel in-flight Replicate training.
          if (
            (character.lora_training_status === "queued" ||
              character.lora_training_status === "training") &&
            character.lora_training_replicate_id
          ) {
            await cancelCharacterTraining(character.lora_training_replicate_id)
            // (b) Refund any reserved credits for that training job.
            const { data: trainingJob } = await supabase
              .from("jobs")
              .select("id")
              .eq("user_id", userId)
              .eq("job_type", CHARACTER_LORA_TRAINING_JOB_TYPE)
              .eq("metadata->>replicate_id", character.lora_training_replicate_id)
              .order("created_at", { ascending: false })
              .limit(1)
              .single()
            if (trainingJob) {
              await refundReservedCreditsForJob(trainingJob.id).catch(() => {})
              await supabase
                .from("jobs")
                .update({ status: "cancelled" })
                .eq("id", trainingJob.id)
                .eq("user_id", userId)
                .then(() => {}, () => {})
            }
          }
          // (c) Delete the trained Replicate model. Idempotent (404 swallowed).
          if (character.lora_replicate_version || character.lora_training_status === "succeeded") {
            await deleteCharacterLora(`nodaroai/char-${id}`)
          }
        }
      } catch (err) {
        req.log.warn(
          { err: (err as Error).message, characterId: id },
          "[characters/delete] LoRA pre-fetch failed; proceeding with soft-delete",
        )
      }
    }

    const { error } = await supabase
      .from("characters")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    return { success: true, archived: true }
  })
}
