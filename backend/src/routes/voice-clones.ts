import type { FastifyInstance, FastifyReply } from "fastify"
import { sendInternalError } from "../lib/http-errors.js"
import multipart from "@fastify/multipart"
import { z } from "zod"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { ELEVENLABS_BASE_URL } from "../providers/elevenlabs/client.js"
import { filterVoicesByAllowedGender } from "../lib/voice-policy.js"

/**
 * Voice clones — LIST / RENAME / DELETE only.
 *
 * Voice CLONING (creating a new clone from a sample) is retired platform-wide:
 * the two create routes below answer 410 Gone with a stable error code and
 * reserve nothing. They are kept as explicit handlers (rather than deleted)
 * so an old SDK / CLI / MCP client gets an honest, machine-readable answer
 * instead of a bare 404 — and so a multipart POST to `/v1/voice-clones`
 * still reaches the handler (the multipart parser stays registered for that).
 *
 * Clones users created BEFORE the retirement stay listable, renamable and
 * deletable here, and their `elevenlabs_voice_id` keeps resolving at
 * text-to-speech / voice-changer time. Nothing in the `voice_clones` table
 * is touched by the retirement.
 */

export const VOICE_CLONING_RETIRED_CODE = "voice_cloning_retired"
export const VOICE_CLONING_RETIRED_MESSAGE =
  "Voice cloning is no longer offered on Nodaro. Existing clones keep working; " +
  "to add a new custom voice, use Voice Design (POST /v1/voice-design) or pick a library voice."

const idParams = z.object({
  id: z.string().uuid(),
})

const renameBody = z.object({
  name: z.string().min(1).max(200),
})

export async function voiceCloneRoutes(app: FastifyInstance) {
  // Kept so a legacy multipart POST is answered by the 410 handler below
  // instead of Fastify's generic 415 for an unparseable content type.
  await app.register(multipart, {
    limits: { fileSize: 1024 },
  })

  app.get("/v1/voice-clones", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { data, error } = await supabase
      .from("voice_clones")
      .select("id, user_id, name, description, elevenlabs_voice_id, sample_audio_url, preview_url, gender, accent, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to fetch voice clones")
    }

    // B4c: under a voice lock, list only the clones whose recorded gender is
    // allowed — the lock refuses any other at use time (lib/voice-gender.ts),
    // a clone with no recorded gender included. Inert when unrestricted.
    const voiceClones = filterVoicesByAllowedGender(data ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      elevenlabsVoiceId: v.elevenlabs_voice_id,
      sampleAudioUrl: v.sample_audio_url,
      previewUrl: v.preview_url,
      gender: v.gender,
      accent: v.accent,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
    }))

    return { voiceClones }
  })

  // Retired create routes — see the file header. No credit guard, no job row,
  // no provider call: the answer is the same for every caller.
  const retired = async (_req: unknown, reply: FastifyReply) =>
    reply.status(410).send({
      error: { code: VOICE_CLONING_RETIRED_CODE, message: VOICE_CLONING_RETIRED_MESSAGE },
    })
  app.post("/v1/voice-clones", retired)
  app.post("/v1/voice-clones/from-url", retired)

  app.patch("/v1/voice-clones/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = idParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid voice clone ID" },
      })
    }

    const bodyParsed = renameBody.safeParse(req.body)
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: bodyParsed.error.issues[0]?.message ?? "Invalid request" },
      })
    }

    const { error } = await supabase
      .from("voice_clones")
      .update({ name: bodyParsed.data.name, updated_at: new Date().toISOString() })
      .eq("id", paramsParsed.data.id)
      .eq("user_id", userId)

    if (error) {
      return sendInternalError(reply, req, error, "Failed to update voice clone")
    }

    return { success: true }
  })

  app.delete("/v1/voice-clones/:id", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const paramsParsed = idParams.safeParse(req.params)
    if (!paramsParsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "Invalid voice clone ID" },
      })
    }

    const { data: voiceClone, error: fetchError } = await supabase
      .from("voice_clones")
      .select("elevenlabs_voice_id")
      .eq("id", paramsParsed.data.id)
      .eq("user_id", userId)
      .single()

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return reply.status(404).send({
          error: { code: "not_found", message: "Voice clone not found" },
        })
      }
      return sendInternalError(reply, req, fetchError, "Failed to delete voice clone")
    }

    if (config.ELEVENLABS_API_KEY && voiceClone.elevenlabs_voice_id) {
      try {
        await fetch(`${ELEVENLABS_BASE_URL}/v1/voices/${voiceClone.elevenlabs_voice_id}`, {
          method: "DELETE",
          headers: { "xi-api-key": config.ELEVENLABS_API_KEY },
        })
      } catch {
        // Best-effort: don't block DB delete
      }
    }

    const { error: deleteError } = await supabase
      .from("voice_clones")
      .delete()
      .eq("id", paramsParsed.data.id)
      .eq("user_id", userId)

    if (deleteError) {
      return sendInternalError(reply, req, deleteError, "Failed to delete voice clone")
    }

    return { success: true }
  })
}
