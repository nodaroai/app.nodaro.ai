import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { formatZodError } from "../lib/zod-error.js"

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
})

export async function characterRoutes(app: FastifyInstance) {
  // List characters for a project
  app.get("/v1/characters", async (req, reply) => {
    const parsed = listCharactersQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid query",
        },
      })
    }

    const { projectId } = parsed.data
    const userId = req.userId

    let query = supabase
      .from("characters")
      .select("id, user_id, node_id, project_id, name, description, gender, style, base_outfit, source_image_url, expressions, poses, lighting_variations, angles, motions, voice, personality, created_at, updated_at")
      .order("created_at", { ascending: false })

    if (projectId) {
      query = query.eq("project_id", projectId)
    }
    if (userId) {
      query = query.eq("user_id", userId)
    }

    const { data, error } = await query

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Transform snake_case to camelCase for frontend
    const characters = (data ?? []).map((c) => ({
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
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }))

    return { characters }
  })

  // Get single character by ID
  app.get("/v1/characters/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = deleteCharacterParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid character ID",
        },
      })
    }

    const { id } = parsed.data

    const { data, error } = await supabase
      .from("characters")
      .select("id, user_id, node_id, project_id, name, description, gender, style, base_outfit, source_image_url, expressions, poses, lighting_variations, angles, motions, voice, personality, created_at, updated_at")
      .eq("id", id)
      .eq("user_id", userId)
      .single()

    if (error) {
      if (error.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Character not found" },
        })
      }
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
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
      // generate-character (portrait) writes source_image_url directly — the
      // Appearance tab has its own one-off poll, so we don't surface it here.
      if (!assetType) continue
      pendingJobs.push({ jobId: row.id, assetType, name: attachName })
    }

    // Transform snake_case to camelCase for frontend
    return {
      id: data.id,
      userId: data.user_id,
      nodeId: data.node_id,
      projectId: data.project_id,
      name: data.name,
      description: data.description,
      gender: data.gender,
      style: data.style,
      baseOutfit: data.base_outfit,
      sourceImageUrl: data.source_image_url,
      expressions: data.expressions,
      poses: data.poses,
      lightingVariations: data.lighting_variations,
      angles: data.angles,
      motions: data.motions,
      voice: data.voice,
      personality: data.personality,
      pendingJobs,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  })

  // Upsert character (create or update)
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
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (id) {
      // UPDATE: only touch columns the caller explicitly sent. `name` is
      // always present in the schema, so it always updates. All other fields
      // are `undefined` when omitted → we skip them, letting the worker's
      // auto-attach writes survive a concurrent debounce save.
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
      // node_id / workflow_id / project_id are set on insert and intentionally
      // not patched here — the studio cannot legitimately move a row.

      // Scope by user_id so a caller cannot overwrite another user's row by
      // passing their id (the update would otherwise rewrite user_id to the
      // caller, silently stealing the record).
      const { data: updated, error } = await supabase
        .from("characters")
        .update(patch)
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }
      return { id: updated.id }
    }

    // Insert new — full row with sensible defaults for arrays/nullable fields.
    const row = {
      user_id: userId,
      node_id: nodeId,
      workflow_id: workflowId ?? null,
      project_id: projectId ?? null,
      name,
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
    const { data: created, error } = await supabase
      .from("characters")
      .insert(row)
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { id: created.id }
  })

  // Delete character permanently
  app.delete("/v1/characters/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = deleteCharacterParams.safeParse(req.params)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid character ID",
        },
      })
    }

    const { id } = parsed.data

    const { error } = await supabase
      .from("characters")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    return { success: true }
  })
}
