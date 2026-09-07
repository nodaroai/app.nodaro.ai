/**
 * The `looks` section — a scene's own LOOK layer and the per-role pins over it.
 *
 * Three operations, the server-side twins of the studio store's `setShotLook`,
 * `setShotCastLook` and `setShotCastLookMap` (`production-store-cast-look.ts`):
 * replace one scene's look, pin or clear ONE role's view of its actor, and
 * replace a scene's whole pin map (the "copy settings" apply).
 *
 * Two properties carry over from the store unchanged, because both are
 * load-bearing on the persisted document rather than on the editor:
 *
 *  - **Omit when empty.** An empty map DELETES the field rather than storing
 *    `{}`. A scene that was never looked at and a scene whose look was cleared
 *    must serialize byte-identically, or the golden fixture's round-trip and
 *    every "is this production dirty" comparison drift apart.
 *  - **A true no-op returns the SAME arrays.** Clearing what is already clear
 *    hands back the identical `shots` array and the identical shot, so the
 *    editor does not re-render and a save is not marked dirty for a write that
 *    changed nothing.
 *
 * A look is CATALOG IDS — `pickerKey → id(s)` — never baked hint text. The
 * platform folds the ids once, server-side, at the model call; prose written
 * here would fold the same clause twice.
 *
 * The one deliberate generalisation over the store: the reducers are silent
 * when the shot id names nothing (the editor can only address a shot it is
 * showing), and an operation must not be — a caller that addressed a scene
 * which has since left needs to hear `op_target_missing`, not a receipt for a
 * write that never happened.
 *
 * Not operations: the browse-session look STASH (`applyResultLook`,
 * `restoreLookStash`, `clearLookStash`) and the undo stack. Those are editor
 * session state, not document state.
 */
import { z } from "zod"

import { copyCastLook, removeCastLook, type CastLookMap } from "../../cast"
import type { LookSelectionMap, Shot } from "../../shot"
import { copyLookMap } from "../../shot-graph-wire"
import { opError } from "../errors"
import type { Production } from "../production"
import type { OpResult, SectionClasses, SectionHandlers } from "../types"

// ── the argument shapes (§6, verbatim) ──────────────────────────────────────

/**
 * `pickerKey → catalog id`, or a multi-pick list of them.
 *
 * The multi-pick arm is `.readonly()` so the parsed args ARE
 * {@link LookSelectionMap} rather than a mutable look-alike — the op vocabulary
 * and the document speak one type, and the shared type-only union the integrator
 * pins over these schemas can `satisfies` the domain shape without a cast.
 */
const lookSelectionMap = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string()).readonly()]),
)

/** One role's pinned view of its actor: the image, plus how it is named. */
const castLook = z.object({
  url: z.string(),
  variantSlug: z.string().optional(),
  label: z.string().optional(),
})

export const looksOpSchemas = {
  set_look: z.object({
    op: z.literal("set_look"),
    shotId: z.string(),
    look: lookSelectionMap,
  }),
  set_cast_look: z.object({
    op: z.literal("set_cast_look"),
    shotId: z.string(),
    key: z.string(),
    /** `null` CLEARS that role's pin. */
    look: castLook.nullable(),
  }),
  set_cast_look_map: z.object({
    op: z.literal("set_cast_look_map"),
    shotId: z.string(),
    map: z.record(z.string(), castLook),
  }),
} as const

export const looksOpClasses: SectionClasses<typeof looksOpSchemas> = {
  set_look: "S",
  set_cast_look: "S",
  set_cast_look_map: "S",
}

// ── the shared reads: address a scene, and name it the way the user sees it ─

/** The shot `shotId` names, or `op_target_missing`. */
function requireShot(production: Production, shotId: string): Shot {
  const shot = production.shots.find((s) => s.id === shotId)
  if (!shot) {
    throw opError("op_target_missing", `No shot ${shotId} in this production.`)
  }
  return shot
}

/** A scene by its NAME when it has one, else `Shot <n>` by timeline position. */
function shotLabel(production: Production, shotId: string): string {
  const index = production.shots.findIndex((s) => s.id === shotId)
  const name = production.shots[index]?.name
  return name ? `“${name}”` : `Shot ${index + 1}`
}

/** A role by its display name and kind, else the role key it was addressed by. */
function roleLabel(production: Production, key: string): string {
  const member = production.cast?.[key]
  return member ? `${member.displayName} (${member.kind})` : key
}

/** Swap ONE shot for its rewrite, copy-on-write. */
function withShot(
  production: Production,
  shotId: string,
  next: Shot,
): Production {
  return {
    ...production,
    shots: production.shots.map((shot) => (shot.id === shotId ? next : shot)),
  }
}

// ── the writers (the store's `withShotLook` / `setShotCastLook*`, as rules) ──

/**
 * Copy `shot` with its own LOOK layer set, or DROPPED when `look` is empty.
 *
 * Returns the SAME shot when nothing changed — an empty write onto an
 * already-look-less scene — so the caller can hand the whole production back
 * untouched. Mirrors `withShotLook` in the studio store's helpers.
 */
function withShotLook(shot: Shot, look: LookSelectionMap): Shot {
  if (Object.keys(look).length === 0) {
    if (!shot.look) return shot
    const copy = { ...shot }
    delete (copy as { look?: LookSelectionMap }).look
    return copy
  }
  return { ...shot, look: copyLookMap(look) }
}

/**
 * Copy `shot` with ONE role's pin set or cleared.
 *
 * The last pin removed drops `castLook` entirely (omit-when-empty), and
 * clearing a role that was never pinned returns the SAME shot.
 */
function withCastPin(
  shot: Shot,
  key: string,
  look: CastLookMap[string] | null,
): Shot {
  const current = shot.castLook ?? {}
  if (!look) {
    if (!(key in current)) return shot
    const remaining = removeCastLook(current, key)
    if (Object.keys(remaining).length > 0) {
      return { ...shot, castLook: remaining }
    }
    const copy = { ...shot }
    delete (copy as { castLook?: CastLookMap }).castLook
    return copy
  }
  return { ...shot, castLook: { ...copyCastLook(current), [key]: { ...look } } }
}

/**
 * Copy `shot` with its WHOLE pin map replaced, or DROPPED when `map` is empty.
 *
 * Returns the SAME shot for an empty write onto an un-pinned scene.
 */
function withCastPinMap(shot: Shot, map: CastLookMap): Shot {
  if (Object.keys(map).length === 0) {
    if (!shot.castLook) return shot
    const copy = { ...shot }
    delete (copy as { castLook?: CastLookMap }).castLook
    return copy
  }
  return { ...shot, castLook: copyCastLook(map) }
}

/** The one exit both arms share: a changed shot is written, a same one is not. */
function settled(
  production: Production,
  shot: Shot,
  next: Shot,
  op: string,
  summary: string,
  noopWarning: string,
): OpResult {
  if (next === shot) {
    return { production, receipt: { op, summary }, warnings: [noopWarning] }
  }
  return { production: withShot(production, shot.id, next), receipt: { op, summary } }
}

// ── the handlers ────────────────────────────────────────────────────────────

export const looksHandlers: SectionHandlers<typeof looksOpSchemas> = {
  set_look: (production, op) => {
    const shot = requireShot(production, op.shotId)
    const label = shotLabel(production, op.shotId)
    const cleared = Object.keys(op.look).length === 0
    return settled(
      production,
      shot,
      withShotLook(shot, op.look),
      "set_look",
      cleared ? `Cleared the look on ${label}.` : `Set the look on ${label}.`,
      `${label} had no look already.`,
    )
  },

  set_cast_look: (production, op) => {
    const shot = requireShot(production, op.shotId)
    const label = shotLabel(production, op.shotId)
    const role = roleLabel(production, op.key)
    return settled(
      production,
      shot,
      withCastPin(shot, op.key, op.look),
      "set_cast_look",
      op.look
        ? `Pinned a look for ${role} on ${label}.`
        : `Cleared the pinned look for ${role} on ${label}.`,
      `${label} had no pinned look for ${role} already.`,
    )
  },

  set_cast_look_map: (production, op) => {
    const shot = requireShot(production, op.shotId)
    const label = shotLabel(production, op.shotId)
    const count = Object.keys(op.map).length
    return settled(
      production,
      shot,
      withCastPinMap(shot, op.map),
      "set_cast_look_map",
      count === 0
        ? `Cleared the pinned looks on ${label}.`
        : `Pinned ${count} look${count === 1 ? "" : "s"} on ${label}.`,
      `${label} had no pinned looks already.`,
    )
  },
}
