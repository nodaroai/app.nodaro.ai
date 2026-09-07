import {
  composeTransitionHintFromConnections,
  getPickerCatalog,
  type PickerDimension,
  type TransitionTiming,
} from "@nodaro/prompts"

import type { ShotTransition } from "./shot"
import { VIDEO_HINT_MODE, type Direction } from "./direction"
import { modeForPicker, pickerByKey } from "./look-pickers"

/**
 * The transition node's three levers, and what a chosen node contributes.
 *
 * THE TRANSITION ITSELF IS CATALOG-DRIVEN, like every other cinematic dimension:
 * we store the id and let the catalog say the words, through the SAME
 * `pickerFragment` the scene-level picker folds through. Storing the tile's
 * label instead would diverge on the 25 of 82 rows whose prompt term differs
 * from their display name ("Iris" → "iris wipe", "Roll" → "camera roll
 * transition"), so one choice would reach the model as two different
 * instructions depending on which surface set it.
 *
 * THE LEVERS ARE CATALOG DIMENSIONS TOO — position · duration · intensity,
 * published by the platform on the `transition` catalog (@nodaro/prompts
 * 1.9.0, #1047) as rows of id + label + description + clause, each scale led
 * by the no-op `auto`. We store the row IDS (`start`, `short`, `crazy`) and
 * the platform's own composer writes the clause, so a shot's transition
 * reaches the model byte-identical to the canvas node's. (For one
 * staging-only stretch the levers were the handoff's own words — "On cut",
 * "0.4s", "Subtle" — folded in parentheses the model never learned; a value
 * stored under those words is not a row of any scale and reads as unset. The
 * pick itself is kept.)
 *
 * The ONE app-owned fact left is how long a duration step runs, which the
 * fits-gate below needs and the platform publishes only as wording; see
 * {@link TRANSITION_DURATION_SECONDS}.
 */

/** Nothing chosen — the display word. Every lever reads it until touched. */
export const TRANSITION_AUTO = "Auto"

/** The catalog's own "model decides" row — of the transition AND of each of
 *  its three scales. */
export const TRANSITION_AUTO_ID = "auto"

/**
 * Whether a transition actually says anything.
 *
 * The catalog's own first two rows are `auto` and `none` (None / Hard Cut), so
 * picking Auto is a real, reachable choice that means "model decides" — it must
 * read as UNSET everywhere (the chip's accent, its meta) exactly as an absent
 * transition does, because it contributes the same nothing to the prompt.
 * One predicate, so the chip and the fold can never disagree about it.
 */
export function transitionIsSet(t: ShotTransition | undefined): boolean {
  return !!t?.id && t.id !== TRANSITION_AUTO_ID
}

/** The chosen transition's display name, or "Auto" when nothing is chosen.
 *  Display only — never folded into a prompt (see {@link transitionClause}). */
export function transitionLabel(t: ShotTransition | undefined): string {
  const picker = pickerByKey(TRANSITION_DIMENSION)
  const label = t?.id && picker ? picker.getLabel(t.id) : ""
  return label || TRANSITION_AUTO
}

/** The three timing scales the installed catalog publishes — possibly none
 *  (feature-detected, like the Character FX node's). */
export function transitionDimensions(): ReadonlyArray<PickerDimension> {
  return getPickerCatalog("transition")?.dimensions ?? []
}

function dimension(field: string): PickerDimension | undefined {
  return transitionDimensions().find((d) => d.field === field)
}

/**
 * How long each duration step runs, in seconds, by the catalog's row id.
 *
 * A transition happens INSIDE its shot's window, so it cannot outlast it — and
 * the platform publishes the steps as wording ("Short (~1s)", "lasting
 * approximately 1 second"), not as a number the gate can compare. This table is
 * the one app-owned fact about the scale; `transition.test.ts` keeps it honest
 * against the catalog (every step present, every "~Ns" label agreeing).
 * `instant` is "no perceptible duration" — it fits any window.
 * TODO(nodaro): publish `seconds` on the duration rows, and this table goes.
 */
export const TRANSITION_DURATION_SECONDS: Readonly<Record<string, number>> = {
  instant: 0,
  short: 1,
  medium: 2,
  long: 3,
}

/** A stored lever value as one of its scale's own row ids — or undefined for
 *  the no-op `auto`, an unpublished scale, and anything that isn't a row (the
 *  handoff's old words included). */
export function transitionLeverId(field: string, raw: string | undefined): string | undefined {
  if (!raw || raw === TRANSITION_AUTO_ID) return undefined
  return dimension(field)?.options.some((o) => o.id === raw) ? raw : undefined
}

/**
 * WHETHER A DURATION FITS THE SHOT IT INTRODUCES.
 *
 * Checked rather than clamped-on-write because the shot's length moves on its
 * own — shortening a window, splitting the budget for a new shot, or copying a
 * shorter shot's settings all change `seconds` without going anywhere near the
 * transition. Deriving it means the answer cannot go stale; clamping would have
 * been one more list of places to remember.
 */
export function durationFits(durationId: string | undefined, shotSeconds: number): boolean {
  const id = transitionLeverId("duration", durationId)
  if (!id) return false
  const seconds = TRANSITION_DURATION_SECONDS[id]
  return seconds !== undefined && seconds <= shotSeconds
}

/** The scales a shot this long may choose from: every row, except the
 *  durations it cannot hold (Auto always survives). */
export function transitionDimensionsFor(shotSeconds: number): ReadonlyArray<PickerDimension> {
  return transitionDimensions().map((d) =>
    d.field === "duration"
      ? {
          ...d,
          options: d.options.filter(
            (o) => o.id === TRANSITION_AUTO_ID || durationFits(o.id, shotSeconds),
          ),
        }
      : d,
  )
}

/**
 * The levers IN EFFECT, by field: each a validated row id, minus a duration the
 * shot is too short to hold — so the picker shows Auto rather than a value it
 * would refuse to offer, and the chip never claims what the fold drops.
 *
 * `shotSeconds` is required rather than optional: a duration is only a lever
 * while the shot is long enough to hold it, and an optional parameter would
 * let a call site forget and quietly disagree with the fold.
 */
export function transitionLevers(
  t: ShotTransition | undefined,
  shotSeconds: number,
): Readonly<Record<string, string>> {
  const stored = (t ?? {}) as Readonly<Record<string, string | undefined>>
  const out: Record<string, string> = {}
  for (const d of transitionDimensions()) {
    const id = transitionLeverId(d.field, stored[d.field])
    if (!id) continue
    if (d.field === "duration" && !durationFits(id, shotSeconds)) continue
    out[d.field] = id
  }
  return out
}

/** The levers in effect as the catalog's LABELS, in the scales' order — what
 *  the connector chip's meta reads. */
export function transitionSetLevers(
  t: ShotTransition | undefined,
  shotSeconds: number,
): string[] {
  const levers = transitionLevers(t, shotSeconds)
  return transitionDimensions().flatMap((d) => {
    const id = levers[d.field]
    const row = id ? d.options.find((o) => o.id === id) : undefined
    return row ? [row.label] : []
  })
}

/**
 * The connector chip's right-hand meta: the set levers, or a word for why
 * there are none. "model picks" and "Auto" read differently on purpose —
 * the first means nothing was chosen at all, the second that a transition was
 * chosen and left on its defaults.
 */
export function transitionMeta(
  t: ShotTransition | undefined,
  shotSeconds: number,
): string {
  if (!transitionIsSet(t)) return "model picks"
  const set = transitionSetLevers(t, shotSeconds)
  return set.length > 0 ? set.join(" · ") : TRANSITION_AUTO
}

/**
 * What a shot's transition contributes to the animate prompt — the platform's
 * OWN composition of the pick and the levers in effect: the catalog's term
 * under the video policy, then the scales' clauses (`cross-dissolve, the
 * transition occurs at the opening of the clip, lasting approximately 1
 * second`). Nothing chosen contributes NOTHING rather than the word "Auto":
 * an unset dimension has to leave the model free.
 *
 * A duration the shot is too short to hold is left out — telling the model to
 * spend three seconds dissolving into a one-second window describes something
 * impossible.
 */
export function transitionClause(
  t: ShotTransition | undefined,
  shotSeconds: number,
): string {
  if (!transitionIsSet(t) || !t?.id) return ""
  const picker = pickerByKey(TRANSITION_DIMENSION)
  return composeTransitionHintFromConnections(
    t.id,
    [],
    [],
    transitionLevers(t, shotSeconds) as TransitionTiming,
    picker ? modeForPicker(picker, VIDEO_HINT_MODE) : "compact",
  )
}

/**
 * What a SCENE's END transition contributes — the same composition, with the
 * catalog's `position` lever DEFAULTED to its own `end` row ("the transition
 * occurs at the end of the clip"). The platform still writes every word: the
 * default is a lever value, not a phrase invented here.
 *
 * DEFAULTED, never forced: a position the user chose (`full`, say) is what the
 * chip's meta shows, and the chip must never claim what the fold drops. The
 * clip's OWN length is `sceneSeconds` — the way out belongs to the whole clip,
 * so a duration is measured against it, not against the last shot.
 *
 * NOT `composeTransitionHintFromConnections`' `endHints`: those render "ending
 * at <state>", collected by walking a canvas node's endState edges. Studio has
 * no such state to name, and inventing one would be composing prompt text
 * client-side — the one thing this app may not do.
 */
export function endTransitionClause(
  t: ShotTransition | undefined,
  sceneSeconds: number,
): string {
  if (!transitionIsSet(t) || !t?.id) return ""
  return transitionClause(
    { ...t, position: transitionLeverId("position", t.position) ?? "end" },
    sceneSeconds,
  )
}

/** The scene-level Transition picker's dimension key. */
export const TRANSITION_DIMENSION = "transitionId"

/**
 * The scene's direction with its Transition pick dropped from the FOLD.
 *
 * While the shots editor owns the prompt, each shot carries its own transition
 * node — so a scene-level `transitionId` chosen before the shots existed would
 * fold in beside them: saying the same thing twice, and unreachable, because
 * the pill it was set from is hidden while shots are up. That is exactly the
 * "rides the submit invisibly" problem the bound-inputs row exists to prevent.
 *
 * Dropped from the fold rather than from the stored direction, so the pick is
 * KEPT: turn the shots off and the pill comes back with it intact.
 */
export function directionWithoutTransition(d: Direction): Direction {
  if (!(TRANSITION_DIMENSION in d)) return d
  const next = { ...d }
  delete next[TRANSITION_DIMENSION]
  return next
}

/**
 * WHICH BOUNDARY a connector sits on. `"in"` is a shot's own — the way INTO the
 * shot below it, which is what every connector was until the scene gained a way
 * out. `"end"` is the scene's, after the last shot: the same node, a boundary
 * with no shot below it, so the three labels below take it as an optional last
 * argument rather than pretending shot N+1 exists.
 */
export type TransitionSlot = "in" | "end"

/** The connector's kind label — what this boundary IS. */
export function transitionKind(
  shotIndex: number,
  sceneIndex: number,
  slot: TransitionSlot = "in",
): string {
  if (slot === "end") return "END"
  if (shotIndex > 0) return "BETWEEN"
  return sceneIndex === 0 ? "OPENING" : `FROM SCENE ${sceneIndex}`
}

/** The tooltip that says it in words. */
export function transitionTitle(
  shotIndex: number,
  sceneIndex: number,
  slot: TransitionSlot = "in",
): string {
  if (slot === "end") return "How this scene goes out — its last frames"
  if (shotIndex > 0) {
    return `Transition from Shot ${shotIndex} to Shot ${shotIndex + 1}`
  }
  return sceneIndex === 0
    ? "This shot opens the film — how it comes in"
    : `How this scene links from Scene ${sceneIndex}`
}

/** The dialog header's subtitle — which boundary is being edited. */
export function transitionBetween(
  shotIndex: number,
  sceneIndex: number,
  slot: TransitionSlot = "in",
): string {
  // The scene NUMBER, not the shot's: the boundary is the clip's own end, and
  // there is no shot on the far side of it to name.
  if (slot === "end") return `Scene ${sceneIndex + 1} → out`
  if (shotIndex > 0) return `Shot ${shotIndex} → Shot ${shotIndex + 1}`
  return sceneIndex === 0 ? "Film opening → Shot 1" : `Scene ${sceneIndex} → Shot 1`
}
