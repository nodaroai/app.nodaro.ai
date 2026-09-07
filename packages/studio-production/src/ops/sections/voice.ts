/**
 * The `voice` section — a shot's VOICEOVER, set and cleared.
 *
 * Two operations, the server-side twins of the studio store's `setShotVoice`
 * and `clearShotVoice` (`production-store-cuts-audio.ts`): a voiceover is a
 * studio-LAYER object (`settings.studio`, no canvas node), independent of the
 * frame — a spoken line survives a still re-generation, so setting one touches
 * nothing but `shot.voice` and the recipe layer it consumes.
 *
 * The one rule that is not obvious from the shape: a set voiceover CONSUMES the
 * shot's `recipe.voice`. A recipe is the regeneration input of a media-less
 * import; real work must replace it, or a stale recipe would shadow the take
 * forever (`ShotRecipe`, and the studio's own recipe-consumption tests).
 * Clearing a voiceover does NOT put the recipe back — the recipe was consumed
 * by the generation, not by the assignment.
 */
import { TTS_PROVIDERS } from "@nodaro/shared"
import { z } from "zod"

import type { Shot, ShotRecipe, ShotVoice } from "../../shot"
import { shotDisplayName } from "../../shot"
import { VOICE_TYPES } from "../../tts-provider"
import { VOICE_DELIVERY_LEVERS } from "../../voice-delivery-settings"
import { opError } from "../errors"
import type { Production } from "../production"
import type { SectionClasses, SectionHandlers } from "../types"

// ── the schemas ─────────────────────────────────────────────────────────────

/**
 * The four delivery levers, derived from {@link VOICE_DELIVERY_LEVERS} rather
 * than hand-typed, so a lever added to the domain reaches the wire without an
 * edit here. Unbounded on purpose: the ranges are the `text-to-speech` route's
 * and it clamps them (`VOICE_DELIVERY_BOUNDS`) — a second copy of those numbers
 * here would be the drift the domain module exists to prevent.
 */
type DeliveryShape = {
  [K in (typeof VOICE_DELIVERY_LEVERS)[number]]: z.ZodOptional<z.ZodNumber>
}

const deliverySchema = z.object(
  Object.fromEntries(
    VOICE_DELIVERY_LEVERS.map((lever) => [lever, z.number().optional()]),
  ) as DeliveryShape,
)

/**
 * A {@link ShotVoice} on the wire — a generated result, so `url` and `text` are
 * required; everything else is the selection context a regenerate restores.
 * `apply.voice.test.ts` pins this against the interface in both directions.
 */
const shotVoiceSchema = z.object({
  url: z.string(),
  text: z.string(),
  voiceId: z.string().optional(),
  voiceType: z.enum(VOICE_TYPES).optional(),
  ttsProvider: z.enum(TTS_PROVIDERS).optional(),
  model: z.string().optional(),
  delivery: deliverySchema.optional(),
})

export const voiceOpSchemas = {
  set_voice: z.object({
    op: z.literal("set_voice"),
    shotId: z.string(),
    voice: shotVoiceSchema,
  }),
  clear_voice: z.object({
    op: z.literal("clear_voice"),
    shotId: z.string(),
  }),
} as const

// ── the helpers ─────────────────────────────────────────────────────────────

/**
 * The addressed shot and its position, or a refusal.
 *
 * The store no-ops on an unknown id (a reducer has a user in front of it); an
 * operation arrives over the wire, where "your id named nothing" is the only
 * useful answer — `SECTIONS.md` rule 5.
 */
function locateShot(
  production: Production,
  shotId: string,
): { readonly shot: Shot; readonly index: number } {
  const index = production.shots.findIndex((s) => s.id === shotId)
  if (index === -1) {
    throw opError("op_target_missing", `No shot ${shotId} in this production.`)
  }
  return { shot: production.shots[index]!, index }
}

/** Copy `production` with the shot at `index` replaced. Copy-on-write. */
function withShot(production: Production, index: number, shot: Shot): Production {
  return {
    ...production,
    shots: production.shots.map((s, i) => (i === index ? shot : s)),
  }
}

/**
 * Drop the CONSUMED `voice` layer off a shot's recipe, and the `recipe` key
 * itself once nothing is left in it (the minimal shape the codec round-trips).
 * A recipe-less shot comes back by identity, so the ordinary path pays nothing.
 *
 * A local copy of the store's `consumeRecipe` helper narrowed to this section's
 * one layer — the codec exports no equivalent (`production-store-helpers.ts`
 * lives in the studio app). The stills and clips sections need the same thing
 * for `framing` / `directing`; hoisting one shared helper into the codec is the
 * integrator's call, noted in this lane's report.
 */
function consumeVoiceRecipe(shot: Shot): Shot {
  if (!shot.recipe?.voice) return shot
  const rest: ShotRecipe = { ...shot.recipe }
  delete (rest as Record<string, unknown>).voice
  const next: Shot = { ...shot }
  if (Object.keys(rest).length > 0) {
    ;(next as { recipe?: ShotRecipe }).recipe = rest
  } else {
    delete (next as { recipe?: ShotRecipe }).recipe
  }
  return next
}

// ── the handlers ────────────────────────────────────────────────────────────

export const voiceHandlers: SectionHandlers<typeof voiceOpSchemas> = {
  set_voice: (production, op) => {
    const { shot, index } = locateShot(production, op.shotId)
    // Replace WHOLE: a voiceover is one generated result plus the selection it
    // was made with, so a partial merge would leave a `voiceId` describing
    // audio it did not produce.
    const next = consumeVoiceRecipe({ ...shot, voice: op.voice })
    return {
      production: withShot(production, index, next),
      receipt: {
        op: "set_voice",
        summary: `Set the voiceover on ${shotDisplayName(shot, index + 1)}.`,
      },
    }
  },

  clear_voice: (production, op) => {
    const { shot, index } = locateShot(production, op.shotId)
    const name = shotDisplayName(shot, index + 1)
    const receipt = { op: "clear_voice", summary: `Cleared the voiceover on ${name}.` }

    // Nothing to clear is not a failure — the document already reads the way
    // the caller asked for. Say so and hand back the SAME document.
    if (!shot.voice) {
      return { production, receipt, warnings: [`${name} had no voiceover.`] }
    }

    const next: Shot = { ...shot }
    delete (next as { voice?: ShotVoice }).voice
    return { production: withShot(production, index, next), receipt }
  },
}

/**
 * Clearing a voiceover DESTROYS nothing the bin holds — the audio result lives
 * on in R2 and the plan's voice line — but it is the loss of work the user
 * dictated, so it carries the delete class and its confirmation.
 */
export const voiceOpClasses: SectionClasses<typeof voiceOpSchemas> = {
  set_voice: "S",
  clear_voice: "D",
}
