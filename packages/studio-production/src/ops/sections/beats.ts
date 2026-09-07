/**
 * The `beats` section — a scene's prose and its cues.
 *
 * Three operations, each the server-side twin of one studio store reducer
 * (`src/store/production-store-scene.ts`): the scene's standing description
 * (`setShotScenePrompt`), its motion beats (`setShotBeats`) and how it goes out
 * (`patchShotEndTransition`). The beats vocabulary itself lives in
 * `../../beats.ts` and the persisted narrowers in `../../shot-graph-read.ts` —
 * neither is reimplemented here.
 *
 * The three share one shape, which is the reducers' own and is load-bearing:
 *
 *  - **An empty write DROPS the field.** A blank scene prompt, an empty beat
 *    list and a `null` transition each `delete` rather than store `undefined`,
 *    so a scene without one serializes byte-identical to a scene that never had
 *    one. (Here that is a rest-destructure, not the store's `delete` on a cast
 *    copy — same result, no mutation.)
 *  - **A no-op is truly a no-op.** Clearing a field a shot does not have hands
 *    back the SAME production (and so the same `shots` array), because the
 *    studio's re-render is driven by referential change and churning the array
 *    for nothing would repaint the timeline. It reports a warning instead.
 *  - **Nothing is aliased.** A beat, its `picks` and a transition node are all
 *    copied — the dialog hands its own object down and the document may never
 *    hold a reference the caller can still mutate.
 *
 * The one generalisation over the reducers: an unknown `shotId` throws
 * `op_target_missing` where the store silently no-ops. An operation is a
 * caller's instruction, and "that shot is gone" is the answer it needs.
 */
import { z } from "zod"

import type { ConnectedReference } from "@nodaro/shared"

import { isVoiceDirectionKind, type VoiceDirectionKind } from "../../voice-direction"
import type { Shot, ShotBeat, ShotTransition } from "../../shot"
import { opError } from "../errors"
import type { Production } from "../production"
import type { OpReceipt, OpResult, SectionClasses, SectionHandlers } from "../types"

// ── argument shapes ─────────────────────────────────────────────────────────

/**
 * A bound `@`-chip on a beat, passed through UNTOUCHED.
 *
 * `z.custom` rather than a zod twin of {@link ConnectedReference}: that
 * interface carries thirty-odd provenance fields (character/location slugs,
 * canonical descriptions, variant buckets), a hand-built object schema would
 * either strip the ones it forgot or drift from the platform's the first time
 * one is added. The predicate checks the four fields that make a reference a
 * reference; everything else rides through as it came.
 */
const connectedReference = z.custom<ConnectedReference>((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    typeof v.defaultName === "string" &&
    typeof v.source === "string" &&
    typeof v.url === "string"
  )
}, "Not a connected reference.")

/** A `/` audio cue on a beat. The kinds come from the vocabulary's own guard,
 *  so a kind added there is accepted here without an edit. */
const voiceDirection = z.object({
  kind: z.custom<VoiceDirectionKind>(isVoiceDirectionKind, "Not an audio cue kind."),
  text: z.string(),
  speaker: z.string().optional(),
  voice: z.string().optional(),
})

/**
 * A catalog pick plus its timing levers — a transition or a Character FX node.
 *
 * **THE ID IS REQUIRED** — by the refinement, not by the field, so the schema's
 * output type stays the document's own (`id?`) while a parse still refuses an
 * id-less node. That is the document's own rule, not an extra one: `readTransition` /
 * `readCharacterFx` (`shot-graph-read.ts`) DROP an id-less node at the next
 * load, because a transition IS its catalog pick and the levers only tune one.
 * Accepting `{ position: "start" }` here would write a node the very next
 * reload erases — the "the schema allowed it, the document refuses it" case, so
 * the schema refuses it instead.
 */
const leverNode = z
  .object({
    // Optional in the TYPE so the schema's output IS `ShotTransition` /
    // `ShotCharacterFx` (both spell every field optional) — and required at
    // PARSE by the refinement below, which is the document's rule said once.
    id: z.string().min(1).optional(),
    position: z.string().optional(),
    duration: z.string().optional(),
    intensity: z.string().optional(),
  })
  .refine((node) => node.id !== undefined, "A lever node needs its catalog id.")

/** One timed motion beat, as an operation carries it. */
const shotBeat = z.object({
  id: z.string().min(1),
  // Windows are tenths and a window that rounds to nothing is malformed
  // (`readBeats` drops such a list whole) — so it is refused at the door.
  seconds: z.number().positive(),
  // Unconstrained: the editor stores an empty beat while it is being written.
  text: z.string(),
  label: z.string().optional(),
  picks: z.record(z.string(), z.string()).optional(),
  // `.readonly()` on both lists: a beat's chips and cues are `ReadonlyArray`
  // on the codec's own {@link ShotBeat}, and a schema that inferred a mutable
  // array would be a second, looser spelling of the same field — the drift
  // this section exists to prevent. (It also freezes the parsed array, which
  // is the copy-on-write rule enforced rather than merely documented.)
  references: z.array(connectedReference).readonly().optional(),
  transition: leverNode.optional(),
  characterFx: leverNode.optional(),
  directions: z.array(voiceDirection).readonly().optional(),
})

export const beatsOpSchemas = {
  set_scene_prompt: z.object({
    op: z.literal("set_scene_prompt"),
    shotId: z.string(),
    text: z.string(),
  }),
  set_beats: z.object({
    op: z.literal("set_beats"),
    shotId: z.string(),
    beats: z.array(shotBeat),
  }),
  set_end_transition: z.object({
    op: z.literal("set_end_transition"),
    shotId: z.string(),
    transition: leverNode.nullable(),
  }),
} as const

// ── local helpers (pure; no codec module is edited from a section) ───────────

/**
 * How a shot is NAMED to a person — its own name when it has one, else
 * `Shot <n>` by its 1-based timeline position. Receipts carry no ids
 * (`SECTIONS.md`, "How a receipt reads"), so every section needs this; it lives
 * here until the integrator hoists one copy.
 */
function shotLabel(production: Production, index: number): string {
  const name = production.shots[index]?.name?.trim()
  return name && name.length > 0 ? name : `Shot ${index + 1}`
}

/** The shot this op addresses, with its position — or `op_target_missing`. */
function locateShot(
  production: Production,
  shotId: string,
  op: string,
): { readonly shot: Shot; readonly index: number } {
  const index = production.shots.findIndex((s) => s.id === shotId)
  if (index < 0) {
    throw opError("op_target_missing", `No shot ${shotId} in this production (${op}).`)
  }
  return { shot: production.shots[index], index }
}

/** A production carrying `shot` at `index`, copy-on-write. */
function withShot(production: Production, index: number, shot: Shot): Production {
  return {
    ...production,
    shots: production.shots.map((s, i) => (i === index ? shot : s)),
  }
}

/** The batch's answer when a clear found nothing to clear: the SAME document. */
function unchanged(
  production: Production,
  receipt: OpReceipt,
  warning: string,
): OpResult {
  return { production, receipt, warnings: [warning] }
}

// ── handlers ────────────────────────────────────────────────────────────────

export const beatsHandlers: SectionHandlers<typeof beatsOpSchemas> = {
  set_scene_prompt: (production, op, _ctx) => {
    const { shot, index } = locateShot(production, op.shotId, op.op)
    const label = shotLabel(production, index)
    if (!op.text.trim()) {
      const receipt: OpReceipt = {
        op: op.op,
        summary: `Cleared the scene description on ${label}.`,
      }
      if (!shot.scenePrompt) {
        return unchanged(production, receipt, `${label} had no scene description.`)
      }
      const { scenePrompt: _dropped, ...rest } = shot
      return { production: withShot(production, index, rest), receipt }
    }
    // Stored AS TYPED: this backs a controlled textarea, and trimming every
    // keystroke would eat the space the user is typing mid-sentence. Only
    // emptiness is normalized (above); the fold trims at the seam.
    return {
      production: withShot(production, index, { ...shot, scenePrompt: op.text }),
      receipt: { op: op.op, summary: `Set the scene description on ${label}.` },
    }
  },

  set_beats: (production, op, _ctx) => {
    const { shot, index } = locateShot(production, op.shotId, op.op)
    const label = shotLabel(production, index)
    if (op.beats.length === 0) {
      const receipt: OpReceipt = { op: op.op, summary: `Cleared the beats on ${label}.` }
      if (!shot.beats) {
        return unchanged(production, receipt, `${label} had no beats.`)
      }
      const { beats: _dropped, ...rest } = shot
      return { production: withShot(production, index, rest), receipt }
    }
    // Copy every beat (and its picks) so the document never aliases caller
    // objects. Shallow, exactly like the store: a beat's references, cues and
    // lever nodes are read-only values that ride through as they came.
    const beats: ReadonlyArray<ShotBeat> = op.beats.map((b) => ({
      ...b,
      ...(b.picks ? { picks: { ...b.picks } } : {}),
    }))
    return {
      production: withShot(production, index, { ...shot, beats }),
      receipt: {
        op: op.op,
        summary: `Set ${beats.length} ${beats.length === 1 ? "beat" : "beats"} on ${label}.`,
      },
    }
  },

  set_end_transition: (production, op, _ctx) => {
    const { shot, index } = locateShot(production, op.shotId, op.op)
    const label = shotLabel(production, index)
    if (!op.transition) {
      const receipt: OpReceipt = {
        op: op.op,
        summary: `Cleared the end transition on ${label}.`,
      }
      if (!shot.endTransition) {
        return unchanged(production, receipt, `${label} had no end transition.`)
      }
      const { endTransition: _dropped, ...rest } = shot
      return { production: withShot(production, index, rest), receipt }
    }
    // COPIED — the dialog hands its own object down, and the document may
    // never alias a caller's (the `set_beats` rule right above).
    const endTransition: ShotTransition = { ...op.transition }
    return {
      production: withShot(production, index, { ...shot, endTransition }),
      receipt: { op: op.op, summary: `Set the end transition on ${label}.` },
    }
  },
}

/** Every beats op is SAFE: each rewrites one editable field of one scene and
 *  destroys no media, so none needs a confirmation gate. */
export const beatsOpClasses: SectionClasses<typeof beatsOpSchemas> = {
  set_scene_prompt: "S",
  set_beats: "S",
  set_end_transition: "S",
}
