/**
 * Nodaro Motion's Prism reference audio for direct runs (registered by
 * `adminNodaroMotionRoutes`, admin-nodaro-motion.ts, so it shares its edition
 * gate). Admin-only.
 *
 *   GET /v1/admin/nodaro-motion/prism-reference-audio   the setting (null = never saved: the full audio) and whether the engine takes it
 *   PUT /v1/admin/nodaro-motion/prism-reference-audio   { prismReferenceAudio: { "480p"?, "720p"?, "1080p"? } }: save it; audit-logged; 409 for a mode an environment's engine lacks
 *
 * The setting (`nodaro_motion_prism_reference_audio`,
 * lib/cast-swap-prism-reference-audio.ts) is what audio the reference video of
 * every DIRECT Prism run (either style) carries, per output resolution: the
 * clip's audio (`"full"`, the default and what a missing key means), only the
 * voice split from the music (`"voice"`), or none (`"none"`). A plain mode (the
 * setting's first shape) is still taken, and read, as that mode at every
 * resolution. The original audio
 * always goes back on the result. People running Nodaro Motion never set it;
 * a trend run keeps its own trend's choice. The `/v1/cast-swap` hook sends it
 * (middleware/nodaro-motion-prism-reference-audio.ts), only to an engine that
 * declares `castSwap.prismReferenceAudioPerResolution` (the object) or
 * `castSwap.prismReferenceAudio` (the run's own resolution's mode) —
 * `supported` answers whether this environment's declares either, and
 * `perResolution` whether it takes the object.
 *
 * A setting that names a mode only some engines take ("one-tone", "octave":
 * `DECLARED_ONLY_PRISM_REFERENCE_AUDIO_MODES`) is refused 409
 * `engine_unsupported` while any environment's engine does not list it in
 * `castSwap.prismReferenceAudioModes` (the row is shared by every
 * environment: nodaro-motion-prism-reference-audio-modes.ts). `modes`
 * answers the modes this environment's engine takes.
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
  declaredOnlyPrismReferenceAudioModesOf,
  engineTakesPrismReferenceAudio,
  engineTakesPrismReferenceAudioMode,
  engineTakesPrismReferenceAudioPerResolution,
} from "../../lib/cast-swap-prism-reference-audio.js"
import { getPluginSupports } from "../../lib/private-plugins/supports-registry.js"
import { listEngineEnvironments } from "../lib/engine-environments.js"
import {
  cannotTakePrismReferenceAudioModesMessage,
  environmentsThatCannotTakePrismReferenceAudioModes,
} from "../lib/nodaro-motion-prism-reference-audio-modes.js"
import { readNodaroMotionPrismReferenceAudio, saveNodaroMotionPrismReferenceAudio } from "../../lib/nodaro-motion-prism-reference-audio-store.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Every save of this deployment-wide setting is filed under this fixed id (its own, beside the other Nodaro Motion settings'). */
export const NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET = "00000000-0000-4000-8000-00000000a0f5"

const putBody = z.strictObject({ prismReferenceAudio: castSwapPrismReferenceAudioSchema })

async function view() {
  const { prismReferenceAudio, updatedAt } = await readNodaroMotionPrismReferenceAudio()
  return {
    prismReferenceAudio,
    updatedAt,
    supported: engineTakesPrismReferenceAudio(),
    perResolution: engineTakesPrismReferenceAudioPerResolution(),
    // The modes this environment's engine takes ("full" always; none beyond it when it takes the setting at all).
    modes: CAST_SWAP_PRISM_REFERENCE_AUDIO_MODES.filter((m) => engineTakesPrismReferenceAudioMode(getPluginSupports().castSwap, m)),
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
    const parsed = putBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      // A mode only some engines take: every environment's engine must list it (the row is shared).
      const modes = declaredOnlyPrismReferenceAudioModesOf(parsed.data.prismReferenceAudio)
      if (modes.length > 0) {
        const missing = environmentsThatCannotTakePrismReferenceAudioModes(await listEngineEnvironments(), modes)
        if (missing.length > 0) {
          return reply.status(409).send({
            error: { code: "engine_unsupported", message: cannotTakePrismReferenceAudioModesMessage(modes, missing), envs: missing },
          })
        }
      }
      const before = (await readNodaroMotionPrismReferenceAudio()).prismReferenceAudio
      await saveNodaroMotionPrismReferenceAudio(parsed.data.prismReferenceAudio, req.userId!)
      await audit(req, "update_nodaro_motion_prism_reference_audio", "app_setting", NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET, {
        key: NODARO_MOTION_PRISM_REFERENCE_AUDIO_KEY,
        before,
        after: parsed.data.prismReferenceAudio,
      })
      return { data: await view() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the Nodaro Motion Prism reference audio")
    }
  })
}
