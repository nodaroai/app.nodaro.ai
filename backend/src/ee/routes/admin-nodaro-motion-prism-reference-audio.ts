/**
 * Nodaro Motion's Prism reference audio for direct runs (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/prism-reference-audio   the setting (null = never saved: the default) and what the engine takes of it
 *   PUT /v1/admin/nodaro-motion/prism-reference-audio   { prismReferenceAudio: { "480p"?, "720p"?, "1080p"? } }: save it; audit-logged; 422 for a value an environment's platform does not read, 409 for one its engine lacks
 *
 * The setting (`nodaro_motion_prism_reference_audio`,
 * lib/cast-swap-prism-reference-audio.ts) is what audio the reference video of
 * every DIRECT Prism run (either style) carries, per output resolution: a mode
 * (`"none"`, `"full"`, `"voice"`, `"full-one-tone"`, `"voice-one-tone"`) and a
 * pitch shift in semitones (-24 to 24 in steps of 0.5, 0 = none; never on
 * `"none"`), a resolution left out being the default (the full mix at +4). A
 * resolution is written as one of today's ids (`"full"`, `"voice"`, `"none"`,
 * `"one-tone"`, `"octave"`) or as `{ mode, semitones }`, and stored as the id
 * where one says the value (`castSwapPrismReferenceAudioSchema`); a plain id
 * (the setting's first shape) is still taken, and read, as that id at every
 * resolution. The original audio always goes back on the result. People
 * running Nodaro Motion never set it; a trend run keeps its own trend's
 * choice. The `/v1/cast-swap` hook sends it
 * (middleware/nodaro-motion-prism-reference-audio.ts), only to an engine that
 * declares `castSwap.prismReferenceAudioPitch` (the object form),
 * `castSwap.prismReferenceAudioPerResolution` (the object of ids) or
 * `castSwap.prismReferenceAudio` (the run's own resolution's id) —
 * `supported` answers whether this environment's declares any, `perResolution`
 * whether it takes the object, and `pitch` whether it takes the object form.
 *
 * A save that changes a resolution to what needs more of an engine
 * (`prismReferenceAudioRequirementsOf`: "one-tone" or "octave", listed in
 * `castSwap.prismReferenceAudioModes`, or a value no id says, which needs
 * `castSwap.prismReferenceAudioPitch`) is refused 409 `engine_unsupported`
 * while any environment's engine does not meet it; a value no id says, which
 * older code cannot read, is first held 422 `platform_unsupported` while any
 * environment's platform does not claim it (the row is shared by every
 * environment: nodaro-motion-prism-reference-audio-modes.ts). What the save
 * leaves as stored is never a reason to refuse it. `modes` answers the modes
 * this environment's engine takes at some pitch shift.
 *
 * Each save writes an `admin_actions` row
 * (`update_nodaro_motion_prism_reference_audio`) with the setting before and
 * after.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import {
  CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES,
  NODARO_MOTION_PRISM_REFERENCE_AUDIO_KEY,
  castSwapPrismReferenceAudioSchema,
  engineTakesPrismReferenceAudio,
  engineTakesPrismReferenceAudioModeAtAll,
  engineTakesPrismReferenceAudioPerResolution,
  engineTakesPrismReferenceAudioPitch,
  prismReferenceAudioChangedFrom,
  prismReferenceAudioChoiceOf,
  prismReferenceAudioRequirementsOf,
} from "../../lib/cast-swap-prism-reference-audio.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import { prismReferenceAudioRefusalOf } from "../lib/nodaro-motion-prism-reference-audio-modes.js"
import { readNodaroMotionPrismReferenceAudio, saveNodaroMotionPrismReferenceAudio } from "../../lib/nodaro-motion-prism-reference-audio-store.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { defineNodaroMotionSettingsSection, sendRefusal } from "../lib/nodaro-motion-settings-section.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Nodaro Motion settings'). */
export const NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f5"

const putBody = z.strictObject({ prismReferenceAudio: castSwapPrismReferenceAudioSchema })

/** The setting as a stored settings set holds it (admin-nodaro-motion-settings-sets.ts): saved as sent. */
export const NODARO_MOTION_PRISM_REFERENCE_AUDIO_SECTION = defineNodaroMotionSettingsSection({
  key: "prism-reference-audio",
  path: "/v1/admin/nodaro-motion/prism-reference-audio",
  label: "Prism reference audio",
  body: putBody,
  prepare: (body) => ({ value: { prismReferenceAudio: body.prismReferenceAudio } }),
  // What this save changes, only: a value only some engines (or platforms) take needs every environment's (the
  // row is shared); what it leaves as stored is never a reason to refuse it. The environments are read only then.
  engineRefusal: async ({ prismReferenceAudio }, before) => {
    const requirements = prismReferenceAudioRequirementsOf(
      prismReferenceAudioChangedFrom(prismReferenceAudioChoiceOf(prismReferenceAudio), prismReferenceAudioChoiceOf(before?.prismReferenceAudio ?? null)),
    )
    if (requirements.length === 0) return null
    return prismReferenceAudioRefusalOf(requirements, "setting", await listEngineEnvironments())
  },
  readLive: async () => {
    const { prismReferenceAudio } = await readNodaroMotionPrismReferenceAudio()
    return prismReferenceAudio === null ? null : { prismReferenceAudio }
  },
})

async function view() {
  const { prismReferenceAudio, updatedAt } = await readNodaroMotionPrismReferenceAudio()
  return {
    prismReferenceAudio,
    updatedAt,
    supported: engineTakesPrismReferenceAudio(),
    perResolution: engineTakesPrismReferenceAudioPerResolution(),
    pitch: engineTakesPrismReferenceAudioPitch(),
    // The modes this environment's engine takes at some pitch shift ("full" always; none beyond it when it takes the setting at all).
    modes: CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES.filter((m) => engineTakesPrismReferenceAudioModeAtAll(getPluginSupports().castSwap, m)),
  }
}

export function registerNodaroMotionPrismReferenceAudioRoutes(app: FastifyInstance): void {
  app.get("/v1/admin/nodaro-motion/prism-reference-audio", { preHandler: requireAdmin }, async (req, reply) => {
    try {
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the Nodaro Motion Prism reference audio")
    }
  })

  app.put("/v1/admin/nodaro-motion/prism-reference-audio", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = NODARO_MOTION_PRISM_REFERENCE_AUDIO_SECTION.body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const prepared = NODARO_MOTION_PRISM_REFERENCE_AUDIO_SECTION.prepare(parsed.data)
      if ("refusal" in prepared) return sendRefusal(reply, prepared.refusal)
      const before = (await readNodaroMotionPrismReferenceAudio()).prismReferenceAudio
      const refusal = await NODARO_MOTION_PRISM_REFERENCE_AUDIO_SECTION.engineRefusal!(prepared.value, before === null ? null : { prismReferenceAudio: before })
      if (refusal) return sendRefusal(reply, refusal)
      await saveNodaroMotionPrismReferenceAudio(prepared.value.prismReferenceAudio, req.userId!)
      await audit(req, "update_nodaro_motion_prism_reference_audio", "app_setting", NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET, {
        key: NODARO_MOTION_PRISM_REFERENCE_AUDIO_KEY,
        before,
        after: prepared.value.prismReferenceAudio,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion Prism reference audio")
    }
  })
}
