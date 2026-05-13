import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { PLACEHOLDER_CHARACTER_NAME } from "@nodaro/shared"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { formatZodError } from "../lib/zod-error.js"

/**
 * Characters API. Soft-delete + case-insensitive unique name per user
 * (see migration 112). The library list filters out archived rows by default;
 * `GET /v1/characters/:id` ignores the archive flag so canvas nodes that hold
 * a stale `characterDbId` keep working.
 */

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
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  gender: z.string().max(50).optional(),
  style: z.string().max(50).optional(),
  baseOutfit: z.string().max(1000).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  expressions: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  poses: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  lightingVariations: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  angles: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  motions: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  voice: z.object({ voiceId: z.string(), voiceName: z.string(), traits: z.string() }).nullable().optional(),
  personality: z.object({ mood: z.string(), speechStyle: z.string(), movementStyle: z.string(), behavioralNotes: z.string() }).nullable().optional(),
})

const deleteCharacterParams = z.object({
  id: z.string().min(1),
})

const listCharactersQuery = z.object({
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  archived: z.enum(["true", "false"]).optional(),
})

const SELECT_COLUMNS =
  "id, user_id, node_id, project_id, name, description, gender, style, base_outfit, source_image_url, expressions, poses, lighting_variations, angles, motions, voice, personality, deleted_at, created_at, updated_at"

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
  motions: { name: string; url: string }[] | null
  voice: { voiceId: string; voiceName: string; traits: string } | null
  personality: { mood: string; speechStyle: string; movementStyle: string; behavioralNotes: string } | null
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
    motions: c.motions,
    voice: c.voice,
    personality: c.personality,
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

    const { projectId, archived } = parsed.data
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

    // Find any asset-generation jobs still in flight for this character so the
    // Character Studio can re-attach spinners on reopen (jobs survive page
    // closes because the worker auto-attaches to the row at completion — this
    // query is purely for the UX of "spinner reappears" continuity).
    const { data: pendingRows } = await supabase
      .from("jobs")
      .select("id, input_data")
      .eq("user_id", userId)
      .in("status", ["pending", "running"])
      .filter("input_data->>attachToCharacterId", "eq", id)

    type PendingJob = { jobId: string; assetType: "expressions" | "poses" | "angles" | "lighting" | "motions"; name: string }
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
        else if (col === "lighting_variations") assetType = "lighting"
      }
      if (!assetType) continue
      pendingJobs.push({ jobId: row.id, assetType, name: attachName })
    }

    return { ...toCamel(data as CharacterRow), pendingJobs }
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

    const { id, nodeId, workflowId, projectId, name, description, gender, style, baseOutfit, sourceImageUrl, expressions, poses, lightingVariations, angles, motions, voice, personality } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    if (id) {
      // UPDATE: only touch columns the caller explicitly sent.
      const patch: Record<string, unknown> = {
        name,
        updated_at: new Date().toISOString(),
      }
      if (description !== undefined) patch.description = description ?? null
      if (gender !== undefined) patch.gender = gender ?? null
      if (style !== undefined) patch.style = style ?? null
      if (baseOutfit !== undefined) patch.base_outfit = baseOutfit ?? null
      if (sourceImageUrl !== undefined) patch.source_image_url = sourceImageUrl ?? null
      if (expressions !== undefined) patch.expressions = expressions
      if (poses !== undefined) patch.poses = poses
      if (lightingVariations !== undefined) patch.lighting_variations = lightingVariations
      if (angles !== undefined) patch.angles = angles
      if (motions !== undefined) patch.motions = motions
      if (voice !== undefined) patch.voice = voice ?? null
      if (personality !== undefined) patch.personality = personality ?? null

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

    // INSERT
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
      motions: motions ?? [],
      voice: voice ?? null,
      personality: personality ?? null,
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
