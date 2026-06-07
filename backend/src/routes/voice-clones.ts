import type { FastifyInstance } from "fastify"
import multipart from "@fastify/multipart"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { uploadBufferToR2 } from "../lib/storage.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { formatZodError } from "../lib/zod-error.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"

const fromUrlBody = z.object({
  audioUrl: safeUrlSchema,
  name: z.string().min(1).max(200),
})

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io"
const MAX_AUDIO_SIZE = 10 * 1024 * 1024 // 10 MB

const idParams = z.object({
  id: z.string().uuid(),
})

const renameBody = z.object({
  name: z.string().min(1).max(200),
})

function audioExtensionFromMime(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav"
  if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return "mp3"
  return "webm"
}

export async function voiceCloneRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: MAX_AUDIO_SIZE },
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
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const voiceClones = (data ?? []).map((v) => ({
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

  app.post("/v1/voice-clones", {
    // dedup: false — voice-clone returns { id, elevenlabsVoiceId, sampleAudioUrl }
    // (a voice_clones row, not a job row) so the dedup short-circuit response
    // { jobId, deduped: true } wouldn't match the frontend's expected shape.
    preHandler: creditGuard(() => "voice-clone", { dedup: false }),
  }, async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    if (!config.ELEVENLABS_API_KEY) {
      return reply.status(503).send({
        error: { code: "service_unavailable", message: "Voice cloning is not available — ElevenLabs API key not configured" },
      })
    }

    const data = await req.file()
    if (!data) {
      return reply.status(400).send({
        error: { code: "validation_error", message: "No audio file provided" },
      })
    }

    const fields = data.fields as Record<string, { value?: string } | undefined>
    const name = fields?.name?.value?.trim()
    if (!name) {
      data.file.resume()
      return reply.status(400).send({
        error: { code: "validation_error", message: "Voice name is required" },
      })
    }

    const buffer = await data.toBuffer()
    const mimeType = data.mimetype

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { type: "voice-clone", name },
      })
      .select("id")
      .single()

    if (jobError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: jobError.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "voice-clone")
    if (reply.sent) return

    try {
      const ext = audioExtensionFromMime(mimeType)
      const r2Key = `voice-samples/${userId}/${randomUUID()}.${ext}`
      const sampleAudioUrl = await uploadBufferToR2(buffer, r2Key, mimeType, userId)

      const formData = new FormData()
      formData.append("name", name)
      formData.append("remove_background_noise", "true")
      const blob = new Blob([buffer as BlobPart], { type: mimeType })
      formData.append("files", blob, `sample.${ext}`)

      await markProviderCallStart(job.id, "elevenlabs-sync")
      const cloneResponse = await fetch(`${ELEVENLABS_BASE_URL}/v1/voices/add`, {
        method: "POST",
        headers: {
          "xi-api-key": config.ELEVENLABS_API_KEY,
        },
        body: formData,
      })

      if (!cloneResponse.ok) {
        const errorText = await cloneResponse.text().catch(() => "Unknown error")
        throw new Error(`ElevenLabs voice clone failed (${cloneResponse.status}): ${errorText}`)
      }

      const cloneResult = (await cloneResponse.json()) as { voice_id: string }

      const { data: voiceClone, error: insertError } = await supabase
        .from("voice_clones")
        .insert({
          user_id: userId,
          name,
          elevenlabs_voice_id: cloneResult.voice_id,
          sample_audio_url: sampleAudioUrl,
        })
        .select("id, name, elevenlabs_voice_id, sample_audio_url, created_at")
        .single()

      if (insertError) {
        throw new Error(`Failed to save voice clone: ${insertError.message}`)
      }

      await supabase
        .from("jobs")
        .update({
          status: "completed",
          progress: 100,
          output_data: { voiceCloneId: voiceClone.id, elevenlabsVoiceId: cloneResult.voice_id },
          completed_at: new Date().toISOString(),
          provider: "elevenlabs-direct",
        })
        .eq("id", job.id)

      if (reservation?.usageLogId) {
        const { commitJobCredits } = await import("../workers/shared.js")
        await commitJobCredits(reservation.usageLogId, job.id)
      }

      return {
        id: voiceClone.id,
        name: voiceClone.name,
        elevenlabsVoiceId: voiceClone.elevenlabs_voice_id,
        sampleAudioUrl: voiceClone.sample_audio_url,
        createdAt: voiceClone.created_at,
      }
    } catch (err) {
      await supabase
        .from("jobs")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown error",
        })
        .eq("id", job.id)

      // This is a SYNCHRONOUS route (ElevenLabs called inline, not via BullMQ), so
      // the worker failure-path refund never runs, and the reconcile cron skips
      // status='failed' rows. Refund the reservation here or every failed clone
      // permanently leaks the reserved credits (charge-without-delivery).
      if (reservation?.usageLogId) {
        const { refundJobCredits } = await import("../workers/shared.js")
        await refundJobCredits(reservation.usageLogId, job.id, err)
      }

      return reply.status(500).send({
        error: { code: "clone_failed", message: err instanceof Error ? err.message : "Voice cloning failed" },
      })
    }
  })

  // JSON variant for callers that already have an audio URL (MCP, dev API).
  // Mirrors the multipart path's job lifecycle + ElevenLabs flow.
  app.post("/v1/voice-clones/from-url", {
    // dedup: false — voice-clone returns { id, elevenlabsVoiceId, sampleAudioUrl }
    // (a voice_clones row, not a job row) so the dedup short-circuit response
    // { jobId, deduped: true } wouldn't match the frontend's expected shape.
    preHandler: creditGuard(() => "voice-clone", { dedup: false }),
  }, async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    if (!config.ELEVENLABS_API_KEY) {
      return reply.status(503).send({
        error: { code: "service_unavailable", message: "Voice cloning is not available — ElevenLabs API key not configured" },
      })
    }
    const parsed = fromUrlBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    const { audioUrl, name } = parsed.data

    // safeFetch: audioUrl is user-supplied and its body is re-uploaded to a
    // PUBLIC R2 URL we return — a raw fetch here is a full SSRF read-oracle
    // for internal HTTP services. safeFetch gates DNS/IP at connect time
    // (safeUrlSchema is only a syntactic check and can't see resolved IPs).
    const fetched = await safeFetch(audioUrl, { timeoutMs: 30_000 })
    if (!fetched.ok) {
      return reply.status(400).send({
        error: { code: "fetch_failed", message: `Could not fetch audioUrl (${fetched.status})` },
      })
    }
    // Early-reject oversized bodies via Content-Length before buffering them
    // into memory (defense-in-depth alongside the post-read byteLength cap,
    // since Content-Length can be absent or understated).
    const declaredLength = Number(fetched.headers.get("content-length") ?? 0)
    if (declaredLength > MAX_AUDIO_SIZE) {
      return reply.status(413).send({
        error: { code: "too_large", message: `Audio sample exceeds ${MAX_AUDIO_SIZE / 1024 / 1024}MB cap` },
      })
    }
    const arrayBuf = await fetched.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    if (buffer.byteLength > MAX_AUDIO_SIZE) {
      return reply.status(413).send({
        error: { code: "too_large", message: `Audio sample exceeds ${MAX_AUDIO_SIZE / 1024 / 1024}MB cap` },
      })
    }
    const mimeType = fetched.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg"

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { type: "voice-clone", name },
      })
      .select("id")
      .single()
    if (jobError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: jobError.message },
      })
    }
    const reservation = await reserveCreditsForJob(req, reply, job.id, "voice-clone")
    if (reply.sent) return

    try {
      const ext = audioExtensionFromMime(mimeType)
      const r2Key = `voice-samples/${userId}/${randomUUID()}.${ext}`
      const sampleAudioUrl = await uploadBufferToR2(buffer, r2Key, mimeType, userId)

      const formData = new FormData()
      formData.append("name", name)
      formData.append("remove_background_noise", "true")
      const blob = new Blob([buffer as BlobPart], { type: mimeType })
      formData.append("files", blob, `sample.${ext}`)

      await markProviderCallStart(job.id, "elevenlabs-sync")
      const cloneResponse = await fetch(`${ELEVENLABS_BASE_URL}/v1/voices/add`, {
        method: "POST",
        headers: { "xi-api-key": config.ELEVENLABS_API_KEY },
        body: formData,
      })
      if (!cloneResponse.ok) {
        const errorText = await cloneResponse.text().catch(() => "Unknown error")
        throw new Error(`ElevenLabs voice clone failed (${cloneResponse.status}): ${errorText}`)
      }
      const cloneResult = (await cloneResponse.json()) as { voice_id: string }

      const { data: voiceClone, error: insertError } = await supabase
        .from("voice_clones")
        .insert({
          user_id: userId,
          name,
          elevenlabs_voice_id: cloneResult.voice_id,
          sample_audio_url: sampleAudioUrl,
        })
        .select("id, name, elevenlabs_voice_id, sample_audio_url, created_at")
        .single()
      if (insertError) {
        throw new Error(`Failed to save voice clone: ${insertError.message}`)
      }

      await supabase
        .from("jobs")
        .update({
          status: "completed",
          progress: 100,
          output_data: { voiceCloneId: voiceClone.id, elevenlabsVoiceId: cloneResult.voice_id },
          completed_at: new Date().toISOString(),
          provider: "elevenlabs-direct",
        })
        .eq("id", job.id)

      if (reservation?.usageLogId) {
        const { commitJobCredits } = await import("../workers/shared.js")
        await commitJobCredits(reservation.usageLogId, job.id)
      }

      return {
        jobId: job.id,
        id: voiceClone.id,
        name: voiceClone.name,
        elevenlabsVoiceId: voiceClone.elevenlabs_voice_id,
        sampleAudioUrl: voiceClone.sample_audio_url,
        createdAt: voiceClone.created_at,
      }
    } catch (err) {
      await supabase
        .from("jobs")
        .update({
          status: "failed",
          error_message: err instanceof Error ? err.message : "Unknown error",
        })
        .eq("id", job.id)

      // This is a SYNCHRONOUS route (ElevenLabs called inline, not via BullMQ), so
      // the worker failure-path refund never runs, and the reconcile cron skips
      // status='failed' rows. Refund the reservation here or every failed clone
      // permanently leaks the reserved credits (charge-without-delivery).
      if (reservation?.usageLogId) {
        const { refundJobCredits } = await import("../workers/shared.js")
        await refundJobCredits(reservation.usageLogId, job.id, err)
      }

      return reply.status(500).send({
        error: { code: "clone_failed", message: err instanceof Error ? err.message : "Voice cloning failed" },
      })
    }
  })

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
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
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
      return reply.status(500).send({
        error: { code: "internal_error", message: fetchError.message },
      })
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
      return reply.status(500).send({
        error: { code: "internal_error", message: deleteError.message },
      })
    }

    return { success: true }
  })
}
