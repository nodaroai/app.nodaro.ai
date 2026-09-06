import type { ShotBeat, ShotTransition } from "./shot"
import { appendHints } from "./direction"
import { endTransitionClause, transitionClause } from "./transition"
import {
  characterFxClause,
  hasEffectToken,
  resolveEffectTokens,
} from "./character-fx"
import {
  CAMERA_MOVEMENT_KEY,
  cameraMovementPicker,
  pickerByKey,
  pickerFragment,
  type LookHintMode,
} from "./look-pickers"
import { withDirectionTokens } from "./voice-direction"

/**
 * Motion-beats folding (editor-v2 "Scene → Shots", Spec §5 + behaviour 3):
 * the timed authoring windows collapse into ONE plain directing prompt at
 * animate — the model sees a normal prompt (server-side assembly untouched),
 * one window per line, every window ending a sentence:
 *
 *     0-2s — Start image: The button is clicked.
 *     2-6s — She is pulled backward, low angle.
 *
 * Per-beat picks fold INSIDE their own window via {@link pickerFragment}, so a
 * beat's Camera Movement reads as its compact professional term while its
 * framing/look picks keep their full clause — exactly the policy the caller
 * passes (the shots editor is video-only, so it passes `VIDEO_HINT_MODE`).
 */

/**
 * Fallback window lengths for a model that publishes NO duration lever. Every
 * model that has one offers every whole second up to its budget instead — see
 * {@link beatSecondsOptions}.
 */
export const BEAT_SECOND_STEPS: ReadonlyArray<number> = [2, 3, 4, 5, 6, 8, 10]

/** Fallback budget for a model that publishes no duration lever at all. */
export const BEATS_AUTHOR_CAP_SECONDS = 60

/**
 * The shortest window the ladder offers — the floor an authored shot sits on.
 * Named rather than written twice: {@link ladder} starts here, and the authoring
 * skill's analysis mapping states the same floor to the model that cuts an
 * analysis into shots ("no shot is shorter than 1 s"), reading it off
 * `FormatRegistry.shots.minSeconds`. Distinct from {@link renderFloor}, which is
 * the shortest CLIP a model can render.
 */
export const BEAT_MIN_SECONDS = 1

/**
 * Windows are TENTHS of a second. The menu offers whole seconds; a typed length
 * ("Custom…") may be 1.2s. This is the grid every stored length sits on and the
 * smallest window one may be — so sums of windows are themselves on the grid,
 * and a boundary (`1.2-3.7s`) never has to be printed from a drifting double.
 */
export const BEAT_SECONDS_STEP = 0.1

/** A length settled onto the tenths grid. */
export function roundSeconds(seconds: number): number {
  return Math.round(seconds * 10) / 10
}

/** A length for display — the grid value, printed without float noise
 *  (`0.1 + 0.2` prints as `0.3`, `3` as `3`). */
export function formatSeconds(seconds: number): string {
  return String(roundSeconds(seconds))
}

/** The rows' total, on the grid. EVERY sum of windows goes through here: two
 *  raw reduces disagreeing in the sixteenth decimal is how a room of
 *  `1.0999…` refuses the `1.1` that fits it. */
function sumSeconds(beats: ReadonlyArray<{ seconds: number }>): number {
  return roundSeconds(beats.reduce((sum, b) => sum + b.seconds, 0))
}

/**
 * The window lengths a shot may take: every whole second from
 * {@link BEAT_MIN_SECONDS} up to the model's budget. A window is a timing marker
 * that folds into ONE prompt, not a clip of its own — so it needn't sit on the
 * model's real clip lengths (those bound only the RENDER, via
 * {@link snapBeatsDuration}). Models with no duration lever fall back to the
 * coarse authoring steps.
 */
function ladder(durations: ReadonlyArray<number>): ReadonlyArray<number> {
  if (durations.length === 0) return BEAT_SECOND_STEPS
  const cap = Math.max(...durations)
  return Array.from({ length: cap - BEAT_MIN_SECONDS + 1 }, (_, i) => i + BEAT_MIN_SECONDS)
}

/**
 * The shortest clip the model can actually render — the floor a scene's authored
 * windows must reach to fill ONE complete clip. `undefined` when the model has
 * no duration lever (no real clip length to fill to). Distinct from the window
 * ladder's 1s minimum: a WINDOW may be 1s, but the CLIP that renders it cannot
 * be shorter than this.
 */
export function renderFloor(durations: ReadonlyArray<number>): number | undefined {
  return durations.length > 0 ? Math.min(...durations) : undefined
}

/**
 * The authoring budget: the LONGEST clip the chosen model can render. The shots
 * divide ONE clip between them, so their total can never usefully exceed it.
 * Across the catalog that spans 5s (minimax, wan) through 8s (veo3), 10s
 * (kling, bytedance), 15s (seedance-2, kling-3-omni) to 30s (seedance-2-5) —
 * which is exactly why it is read from the catalog and never written down here.
 */
export function beatsCapSeconds(durations: ReadonlyArray<number>): number {
  return durations.length === 0
    ? BEATS_AUTHOR_CAP_SECONDS
    : Math.max(...durations)
}

/**
 * The window lengths ONE shot may choose: every whole second the model's budget
 * still has room for, minus what its siblings already spend. Picking 10s of a
 * 30s budget for the first shot leaves the second a 20s ceiling, and so on down
 * the scene.
 *
 * Windows run every whole second (1 → budget), NOT the model's clip lengths — a
 * window is prose timing folded into one clip, so it needn't match what the
 * model can render (that only bounds the total, via {@link snapBeatsDuration}).
 *
 * A shot's OWN current length is always offered: switching to a shorter-clip
 * model can leave a shot already over the new budget, and an empty dropdown
 * would strand it with no way back down. The meter shows the overflow instead,
 * and {@link snapBeatsDuration} clamps what actually renders.
 */
export function beatSecondsOptions(
  beat: { seconds: number },
  beats: ReadonlyArray<{ seconds: number }>,
  durations: ReadonlyArray<number>,
): ReadonlyArray<number> {
  const opts = ladder(durations)
  const fits = opts.filter((s) => s <= beatRoomSeconds(beat, beats, durations))
  return fits.includes(beat.seconds)
    ? fits
    : [...fits, beat.seconds].sort((a, b) => a - b)
}

/** The room ONE shot has: the budget minus what its siblings spend. */
function beatRoomSeconds(
  beat: { seconds: number },
  beats: ReadonlyArray<{ seconds: number }>,
  durations: ReadonlyArray<number>,
): number {
  const others = roundSeconds(sumSeconds(beats) - beat.seconds)
  return roundSeconds(beatsCapSeconds(durations) - others)
}

/**
 * A TYPED window length, made legal — clamped, never rejected, so what lands
 * is always a length the scene can hold and the chip then shows it:
 *
 *   - settled onto the tenths grid (1.25 → 1.3);
 *   - no shorter than one tenth;
 *   - no longer than the room the model's budget and the sibling shots leave —
 *     15.2s on a 15s model is 15s, and 12s beside a 4s sibling is 11s. The
 *     shots are joined into ONE clip, so the total is what the model must be
 *     able to take (the same rule {@link beatSecondsOptions} offers the menu by).
 *
 * Nonsense (NaN, zero, negative) and a scene whose siblings already fill the
 * budget keep the shot's current length — there is no legal value to move to.
 */
export function clampBeatSeconds(
  raw: number,
  beat: { seconds: number },
  beats: ReadonlyArray<{ seconds: number }>,
  durations: ReadonlyArray<number>,
): number {
  if (!Number.isFinite(raw) || raw <= 0) return beat.seconds
  const room = beatRoomSeconds(beat, beats, durations)
  if (room < BEAT_SECONDS_STEP) return beat.seconds
  return Math.min(Math.max(roundSeconds(raw), BEAT_SECONDS_STEP), room)
}

/**
 * The window length a NEW shot opens at: the model's shortest real clip when it
 * fits the remaining budget (the familiar default — a fresh shot is a full short
 * clip, not a 1s sliver), shrinking to the largest window that still fits (down
 * to 1s) only when the budget is nearly spent. The dropdown still lets the user
 * take it down to 1s by hand.
 */
export function nextBeatSeconds(
  beats: ReadonlyArray<{ seconds: number }>,
  durations: ReadonlyArray<number>,
): number {
  const opts = ladder(durations)
  const room = roundSeconds(beatsCapSeconds(durations) - sumSeconds(beats))
  const floor = renderFloor(durations) ?? opts[0]
  if (floor <= room) return floor
  return [...opts].reverse().find((s) => s <= room) ?? opts[0]
}

/**
 * The rows PLUS one more shot — making room when the budget is already spent by
 * shortening the LAST shot to the largest window that still leaves the newcomer
 * a 1s window. `null` only when even that can't be found (the last shot is
 * already 1s and the budget is full).
 *
 * Refusing outright was the wrong answer to the common case: a scene opens with
 * ONE seeded shot at the scene's clip length, and on a model whose longest clip
 * IS that length the very first "Add shot" was dead on arrival — a button that
 * reads as broken. Wanting a second shot there means splitting the clip, so
 * that is what it does; every shot's length stays a whole second within budget.
 */
export function beatsWithAnother<T extends { seconds: number }>(
  rows: ReadonlyArray<T>,
  durations: ReadonlyArray<number>,
  create: (seconds: number) => T,
): ReadonlyArray<T> | null {
  const opts = ladder(durations)
  const smallest = opts[0]
  if (smallest === undefined) return null
  const cap = beatsCapSeconds(durations)
  const total = sumSeconds(rows)
  if (roundSeconds(cap - total) >= smallest) {
    return [...rows, create(nextBeatSeconds(rows, durations))]
  }
  const last = rows[rows.length - 1]
  if (!last) return null
  const room = roundSeconds(cap - (total - last.seconds) - smallest)
  const kept = [...opts].reverse().find((o) => o <= room)
  if (kept === undefined) return null
  return [...rows.slice(0, -1), { ...last, seconds: kept }, create(smallest)]
}

/** Whether another shot fits — the budget still has room for a 1s window. */
export function canAddBeat(
  beats: ReadonlyArray<{ seconds: number }>,
  durations: ReadonlyArray<number>,
): boolean {
  const opts = ladder(durations)
  return roundSeconds(beatsCapSeconds(durations) - sumSeconds(beats)) >= opts[0]
}

/**
 * Top a scene up to a complete clip. Windows can now be shorter than any clip
 * the model renders (down to 1s), so a scene's authored total can fall BELOW the
 * model's shortest real clip — leaving unauthored slack the render would have to
 * pad. When it does, append ONE shot filling exactly the remaining seconds, so
 * the scene still spans a full clip (a lone 1s shot on a 4s-floor model → a 3s
 * shot 2 appears). The filler is a normal, editable shot.
 *
 * Returns the beats UNCHANGED when they already reach the floor (so lengthening
 * a shot back up adds nothing), when the model has no duration lever (no real
 * floor to fill to), or when the gap is below a tenth — a window that isn't on
 * the grid can only come from outside the editor (the graph is canvas-editable),
 * and the sliver it leaves is not worth a shot. Meant to run after a
 * window-length edit — deleting a shot is deliberately exempt, so the filler can
 * be removed without it springing back.
 */
export function beatsFilledToFloor<T extends { seconds: number }>(
  beats: ReadonlyArray<T>,
  durations: ReadonlyArray<number>,
  create: (seconds: number) => T,
): ReadonlyArray<T> {
  const floor = renderFloor(durations)
  if (floor === undefined) return beats
  const total = sumSeconds(beats)
  if (total <= 0 || total >= floor) return beats
  const gap = roundSeconds(floor - total)
  return gap < BEAT_SECONDS_STEP ? beats : [...beats, create(gap)]
}

/** Total authored seconds across the beats, on the grid. Structural like
 *  {@link beatsFilledToFloor}: the importer sums shot DOCUMENTS (no ids yet). */
export function beatsTotalSeconds<T extends { seconds: number }>(
  beats: ReadonlyArray<T>,
): number {
  return sumSeconds(beats)
}

/** One beat's CONTENT: `Label: text, fragment, fragment` — no time window. */
function beatContent(beat: ShotBeat, mode: LookHintMode): string {
  const hints = Object.entries(beat.picks ?? {}).flatMap(([key, id]) => {
    // Movement lives in its own catalog (not LOOK_PICKERS) — resolve it too.
    const picker =
      pickerByKey(key) ??
      (key === CAMERA_MOVEMENT_KEY ? cameraMovementPicker() : undefined)
    const hint = picker ? pickerFragment(picker, id, mode) : ""
    return hint ? [hint] : []
  })
  const label = beat.label?.trim()
  // The Character FX node folds WHERE ITS CHIP SITS: the `/` command puts an
  // effect token into the prose at the moment it happens, and the platform's
  // composition lands there (see resolveEffectTokens). A node with no chip in
  // its text — authored from the pill before the / command existed — keeps
  // folding LAST inside the window: the way in (the transition, in beatBody),
  // then what happens, then what happens to the subject. Never both. An unset
  // node contributes nothing, so a shot without one folds byte-identically.
  const placed = hasEffectToken(beat.text)
  const text = placed ? resolveEffectTokens(beat.text, mode, beat.characterFx) : beat.text
  const fx = placed ? "" : characterFxClause(beat.characterFx, mode)
  const body = appendHints(text, fx ? [...hints, fx] : hints)
  // A cue with no token in the prose would be lost at render (the renderer
  // only replaces tokens it finds) — so it folds at the end of its window.
  const cued = withDirectionTokens(body, beat.directions ?? [])
  // A label-only beat must not fold to a dangling "Label: " — the label
  // becomes the window's whole content instead.
  return cued ? `${label ? `${label}: ` : ""}${cued}` : (label ?? "")
}

/** A beat's prose: how it COMES IN, then what happens inside it.
 *
 *  A transition leads rather than joining the content hints — it describes the
 *  way in, so it belongs before the way through: `Cross-Dissolve (0.4s). the
 *  diver pushes off`. Nothing chosen contributes nothing, so an untouched beat
 *  folds byte-identically to before this existed.
 *
 *  Shared by BOTH fold paths on purpose. A lone shot skips the time window but
 *  is still a shot that comes in somehow, and its transition is the likeliest
 *  one to be set — it is the scene's own entry. */
function beatBody(beat: ShotBeat, mode: LookHintMode): string {
  const content = beatContent(beat, mode)
  const enter = transitionClause(beat.transition, beat.seconds)
  if (!enter) return content
  // The clause ends a sentence of its own — it is the way IN, not part of what
  // then happens — so the prose after it starts fresh: `Cross-Dissolve (0.4s).
  // The diver pushes off`.
  return content ? `${enter}. ${content}` : `${enter}.`
}

/** Whether the prose already closes a sentence — a stop, optionally inside a
 *  closing quote or bracket (`…"now."` / `(beat).`). */
const ENDS_SENTENCE = /[.!?…]["'”’)\]]*$/

/**
 * One beat's window prose: `from-tos — <body>.` — the body TERMINATED.
 *
 * Most bodies do not end a sentence on their own: the Camera Movement pill folds
 * last as a bare term, a label-only beat is just its label, a transition-only
 * beat is just its clause. Left open, a window ran straight into the next stamp
 * — `… walking together, orbit left 6-14s — linear wipe` — which reads as one
 * phrase (an orbit with a six-second offset welded on) and leaves the two shots
 * with no boundary at all. The stop is the boundary; the newline (see
 * {@link foldBeatsPrompt}) is what lets a reader — or a model — see it.
 */
function foldBeat(body: string, beat: ShotBeat, from: number): string {
  const stopped = ENDS_SENTENCE.test(body) ? body : `${body}.`
  return `${formatSeconds(from)}-${formatSeconds(from + beat.seconds)}s — ${stopped}`
}

/**
 * PROSE, CLOSED BY THE SCENE'S WAY OUT — the one helper both fold paths use.
 *
 * The end transition belongs to the whole clip, so it lands after everything
 * else: the last window's own stop, then the way out as its own sentence
 * (`… She runs. fade to black, the transition occurs at the end of the clip.`).
 * Nothing chosen appends nothing, so a scene without one folds byte-identically
 * — and prose that says nothing at all leaves the clause standing alone, the
 * same way a transition-only shot already folds to just its clause.
 *
 * `sceneSeconds` is the WHOLE clip's length, never the last window's: the way
 * out is the clip's, so the fits-gate measures it against the clip.
 */
export function withEndTransition(
  text: string,
  endTransition: ShotTransition | undefined,
  sceneSeconds: number,
): string {
  const clause = endTransitionClause(endTransition, sceneSeconds)
  if (!clause) return text
  // TRIMMED before the sentence test: `ENDS_SENTENCE` anchors at the very end
  // and carries no `m` flag, so a plain textarea's trailing newline reads as
  // "no stop" and would fold a bare `.` onto a line of its own.
  const body = text.trim()
  if (!body) return `${clause}.`
  const stopped = ENDS_SENTENCE.test(body) ? body : `${body}.`
  return `${stopped} ${clause}.`
}

/**
 * THE INVERSE — a stored prompt minus the way-out clause it was folded with.
 *
 * A take stores the SUBMITTED string, so its prose ends with the clause
 * {@link withEndTransition} appended. Seeding that string back into the box
 * while the scene's own pill re-appends the clause folds it TWICE — and once
 * more on every generate cycle after that, because the seed always comes from
 * the active take. So the restore paths strip it, exactly as `stripScenePrompt`
 * takes back the paragraph at the other end of the prose.
 *
 * TWO CANDIDATES, because the fold's `sceneSeconds` is not recorded anywhere: a
 * duration lever the scene was too short to hold is dropped by the fits-gate,
 * so the clause exists in exactly two wordings — with the duration in effect
 * and without it. Both are the platform's own composition of THIS node; nothing
 * else is matched.
 *
 * CONSERVATIVE, like `stripScenePrompt`: only prose ending in exactly what this
 * node folds is shortened, and a body that was given its stop by the fold keeps
 * it (the stop is a sentence the model reads, not a byte to restore).
 */
export function stripEndTransition(
  text: string,
  endTransition: ShotTransition | undefined,
): string {
  if (!endTransition) return text
  const body = text.trimEnd()
  for (const clause of [
    // The levers as chosen…
    endTransitionClause(endTransition, Number.POSITIVE_INFINITY),
    // …and as the fits-gate leaves them on a scene too short for the duration.
    endTransitionClause({ ...endTransition, duration: undefined }, Number.POSITIVE_INFINITY),
  ]) {
    if (!clause) continue
    const folded = `${clause}.`
    if (!body.endsWith(folded)) continue
    return body.slice(0, body.length - folded.length).trimEnd()
  }
  return text
}

/** The beats folded into the one plain directing prompt — one window per LINE.
 *  A shot is a unit the model has to keep apart from its neighbours (which
 *  image it uses, how it comes in); a space between windows gave it nothing to
 *  hold on to, a line does. The server keeps newlines through assembly
 *  (`resolveReferenceTokens` collapses horizontal whitespace only), and so does
 *  the `/`-direction render on our side (`tidyWhitespace` trims per line).
 *  `mode` is REQUIRED — the caller states the verbosity policy its stage uses
 *  (see `direction`), so a beat's picks can never be silently verbose. */
export function foldBeatsPrompt(
  beats: ReadonlyArray<ShotBeat>,
  mode: LookHintMode,
  endTransition?: ShotTransition,
): string {
  // The SCENE's own length — what the way out is measured against.
  const sceneSeconds = beatsTotalSeconds(beats)
  // ONE shot IS the scene — no time window to describe, so it folds to its own
  // prose (plus its hints). This is what lets a scene open in the shots editor
  // without changing a single-shot generation's prompt.
  if (beats.length === 1) {
    return withEndTransition(beatBody(beats[0], mode), endTransition, sceneSeconds)
  }
  let from = 0
  const parts: string[] = []
  for (const beat of beats) {
    // A window folds IFF it has a body — an invariant, not a list of fields to
    // remember to extend. The old test named `text` and `label`, which silently
    // dropped a shot carrying only a transition, and a shot carrying only its
    // cinematic pills: in both cases the one thing the user chose, discarded,
    // with every later window's stamp shifting to cover the gap.
    const body = beatBody(beat, mode)
    if (body) parts.push(foldBeat(body, beat, from))
    from = roundSeconds(from + beat.seconds)
  }
  // Appended to the JOINED prose, which is the last window — the way out closes
  // the clip, not one of its shots.
  return withEndTransition(parts.join("\n"), endTransition, sceneSeconds)
}

/**
 * The RENDER duration for a beats total: the smallest duration the model
 * offers that COVERS the authored total (a 7s story on a 5s/10s model renders
 * 10s, never truncates at 5s), clamped to the model's max when the total
 * exceeds every option. Returns undefined when the model offers no durations.
 */
export function snapBeatsDuration(
  totalSeconds: number,
  options: ReadonlyArray<number>,
): number | undefined {
  if (options.length === 0) return undefined
  const sorted = [...options].sort((a, b) => a - b)
  return sorted.find((o) => o >= totalSeconds) ?? sorted[sorted.length - 1]
}
