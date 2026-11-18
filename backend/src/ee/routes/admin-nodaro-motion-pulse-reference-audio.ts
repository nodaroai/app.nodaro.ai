/**
 * Video Remake's Pulse reference audio ("audio in") for direct runs
 * (registered by `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it
 * shares its edition gate). Admin-only.
 *
 *   GET /v1/admin/video-remake/pulse-reference-audio   the setting (null = never saved: the default) and whether the engine takes it
 *   PUT /v1/admin/video-remake/pulse-reference-audio   { pulseReferenceAudio: { "720p"?, "1080p"? } }: save it; audit-logged; 422 while an environment's platform does not read it, 409 while its engine lacks it
 *
 * The setting (`nodaro_motion_pulse_reference_audio`,
 * lib/cast-swap-pulse-reference-audio.ts, its own row beside
 * `nodaro_motion_pulse_audio`) is what audio the clip of every DIRECT Pulse
 * run sends to the video model, per output resolution: a mode (`"none"`,
 * `"full"`, `"voice"`, `"full-one-tone"`, `"voice-one-tone"`) and a pitch shift
 * in semitones (-24 to 24 in steps of 0.5; never on `"none"`). A resolution
 * left out follows the Pulse audio out (the full mix at +4 with the original
 * audio, unpitched with Kling's own), and a save stores only the resolutions
 * off the default of the Pulse audio stored when it is saved (a value equal to
 * it is dropped). What the final video carries stays the Pulse audio's
 * choice. People running Video Remake never set it; a trend run keeps its own
 * trend's choice. The `/v1/cast-swap` hook sends it
 * (middleware/nodaro-motion-pulse-reference-audio.ts), only to an engine that
 * declares `castSwap.pulseReferenceAudio` — `supported` answers whether this
 * environment's does.
 *
 * A save that changes a resolution to a value off the default
 * (`pulseReferenceAudioChangedFrom`) is held 422 `platform_unsupported` while
 * any environment's platform does not claim it, then refused 409
 * `engine_unsupported` while any environment's engine lacks it (the row is
 * shared by every environment: nodaro-motion-pulse-reference-audio-holds.ts).
 * What the save leaves as stored, or takes back to the default, is never a
 * reason to refuse it.
 *
 * Each save writes an `admin_actions` row
 * (`update_nodaro_motion_pulse_reference_audio`) with the setting before and
 * after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import {
  NODARO_MOTION_PULSE_REFERENCE_AUDIO_KEY,
  castSwapPulseReferenceAudioSchema,
  engineTakesPulseReferenceAudio,
  pulseReferenceAudioChangesToOffDefault,
  pulseReferenceAudioNotDefault,
  type CastSwapPulseReferenceAudio,
} from "../../lib/cast-swap-pulse-reference-audio.js"
import { readNodaroMotionPulseAudio } from "../../lib/nodaro-motion-pulse-audio-store.js"
import { readNodaroMotionPulseReferenceAudio, saveNodaroMotionPulseReferenceAudio } from "../../lib/nodaro-motion-pulse-reference-audio-store.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { pulseReferenceAudioRefusalOf } from "../lib/nodaro-motion-pulse-reference-audio-holds.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Video Remake settings'). */
export const NODARO_MOTION_PULSE_REFERENCE_AUDIO_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0fd"

const putBody = z.strictObject({ pulseReferenceAudio: castSwapPulseReferenceAudioSchema })

/**
 * The setting as a stored settings set holds it (admin-nodaro-motion-settings-sets.ts): each resolution in its written
 * form. What is the default is dropped by the save itself, against the Pulse audio stored then (a set saves the Pulse
 * audio first: it comes before this section).
 */
export const NODARO_MOTION_PULSE_REFERENCE_AUDIO_SECTION = defineNodaroMotionSettingsSection({
  key: "pulse-reference-audio",
  path: "/v1/admin/video-remake/pulse-reference-audio",
  label: "Pulse reference audio",
  body: putBody,
  prepare: (body) => ({ value: { pulseReferenceAudio: { ...body.pulseReferenceAudio } } }),
  // What this save changes to a value off the default, only, read against the stored Pulse audio (the audio out every
  // direct run has): a value only newer platforms and engines take needs every environment's (the row is shared). The
  // Pulse audio is read for any save that sets a resolution; the environments only for a change off the default.
  engineRefusal: async ({ pulseReferenceAudio }, before) => {
    if (Object.keys(pulseReferenceAudio).length === 0) return null
    const out = (await readNodaroMotionPulseAudio()).pulseAudio
    if (!pulseReferenceAudioChangesToOffDefault(pulseReferenceAudio, out, before?.pulseReferenceAudio ?? null, out)) return null
    return pulseReferenceAudioRefusalOf("setting", await listEngineEnvironments())
  },
  readLive: async () => {
    const { pulseReferenceAudio } = await readNodaroMotionPulseReferenceAudio()
    return pulseReferenceAudio === null ? null : { pulseReferenceAudio }
  },
})

async function view() {
  const { pulseReferenceAudio, updatedAt } = await readNodaroMotionPulseReferenceAudio()
  return { pulseReferenceAudio, updatedAt, supported: engineTakesPulseReferenceAudio() }
}

export function registerNodaroMotionPulseReferenceAudioRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/video-remake/pulse-reference-audio", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Pulse reference audio")
    }
  })

  app.put("/v1/admin/video-remake/pulse-reference-audio", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = NODARO_MOTION_PULSE_REFERENCE_AUDIO_SECTION.body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const prepared = NODARO_MOTION_PULSE_REFERENCE_AUDIO_SECTION.prepare(parsed.data)
      if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
      const before = (await readNodaroMotionPulseReferenceAudio()).pulseReferenceAudio
      const refusal = await NODARO_MOTION_PULSE_REFERENCE_AUDIO_SECTION.engineRefusal!(prepared.value, before === null ? null : { pulseReferenceAudio: before })
      if (refusal) return sendRefusal(reply, refusal)
      // Stored as it is sent: only the resolutions off the default of the Pulse audio stored now.
      const out = (await readNodaroMotionPulseAudio()).pulseAudio
      const after: CastSwapPulseReferenceAudio = pulseReferenceAudioNotDefault(prepared.value.pulseReferenceAudio, out) ?? {}
      await saveNodaroMotionPulseReferenceAudio(after, req.userId!)
      await audit(req, "update_nodaro_motion_pulse_reference_audio", "app_setting", NODARO_MOTION_PULSE_REFERENCE_AUDIO_AUDIT_TARGET, {
        key: NODARO_MOTION_PULSE_REFERENCE_AUDIO_KEY,
        before,
        after,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Pulse reference audio")
    }
  })
}
