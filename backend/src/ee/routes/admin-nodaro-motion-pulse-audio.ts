/**
 * Nodaro Motion's Pulse audio for direct runs (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/pulse-audio   the setting (null = never saved: the original audio) and whether the engine takes it
 *   PUT /v1/admin/nodaro-motion/pulse-audio   { pulseAudio: "original" | "generated" }: save it; audit-logged
 *
 * The setting (`nodaro_motion_pulse_audio`, lib/cast-swap-pulse-audio.ts) is
 * what sound every DIRECT Pulse run delivers (either style): the original
 * audio put back on the result (the default), or Kling's own track as is.
 * People running Nodaro Motion never set it; a trend run keeps its own
 * trend's choice. The `/v1/cast-swap` hook sends it
 * (middleware/nodaro-motion-pulse-audio.ts), only to an engine that declares
 * `castSwap.pulseAudio` — `supported` answers whether this environment's does.
 *
 * Each save writes an `admin_actions` row (`update_nodaro_motion_pulse_audio`)
 * with the setting before and after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { NODARO_MOTION_PULSE_AUDIO_KEY, castSwapPulseAudioSchema, engineTakesPulseAudio } from "../../lib/cast-swap-pulse-audio.js"
import { readNodaroMotionPulseAudio, saveNodaroMotionPulseAudio } from "../../lib/nodaro-motion-pulse-audio-store.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Nodaro Motion settings'). */
export const NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f4"

const putBody = z.strictObject({ pulseAudio: castSwapPulseAudioSchema })

async function view() {
  const { pulseAudio, updatedAt } = await readNodaroMotionPulseAudio()
  return { pulseAudio, updatedAt, supported: engineTakesPulseAudio() }
}

export function registerNodaroMotionPulseAudioRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/pulse-audio", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion Pulse audio")
    }
  })

  app.put("/v1/admin/nodaro-motion/pulse-audio", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const before = (await readNodaroMotionPulseAudio()).pulseAudio
      await saveNodaroMotionPulseAudio(parsed.data.pulseAudio, req.userId!)
      await audit(req, "update_nodaro_motion_pulse_audio", "app_setting", NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET, {
        key: NODARO_MOTION_PULSE_AUDIO_KEY,
        before,
        after: parsed.data.pulseAudio,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion Pulse audio")
    }
  })
}
