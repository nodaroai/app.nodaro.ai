import {
  IMAGE_HINT_MODE_DEFAULT,
  VIDEO_HINT_MODE_DEFAULT,
  partitionStyleClauses,
  type DirectionFields,
  type SlottedPromptClause,
} from "@nodaro/prompts"

import {
  LOOK_PICKERS,
  cameraMovementPicker,
  liveLookId,
  pickerFragment,
  type LookHintMode,
  type LookPickerConfig,
  type LookSelection,
} from "./look-pickers"

/**
 * The studio's cinematic DIRECTION channel — turns the "Look" picker selections
 * (a flat `pickerKey → option id` map) into the platform's flat `direction` wire
 * object, and renders the clauses the SERVER will fold from it.
 *
 * TWO VOCABULARIES, one conversion point:
 *  - STUDIO keys (`LookSelection`, the `Shot.look` map) are what the pickers,
 *    the result echo, scene copy and recipes speak — a restore must re-arm the
 *    pickers, and the studio↔platform mapping is not reliably invertible (the
 *    category pickers collapse onto shared registry keys).
 *  - PLATFORM keys (`DirectionFields`, `@nodaro/prompts`' `DIRECTION_FIELDS`)
 *    are what the WIRE and the canvas node data speak.
 * {@link directionWireFields} is the ONLY conversion between them, anywhere.
 *
 * NO CLIENT FOLD. Every dimension the registry carries rides as ids and is
 * rendered inside the route's own assembly, so a saved production picks up a
 * catalog improvement with no re-save, and a preview cannot drift from the
 * server (six dimensions render differently there — Mood blends, Aesthetic and
 * Photographer emit ONE clause, Atmosphere/Post-Process/Action FX use their own
 * multi builders, and the whole fold is exact-clause de-duplicated).
 * {@link directionClauses} is therefore the previews' ONLY source: it calls the
 * platform renderer on the very object the submit sends, and each clause comes
 * back knowing whether the route puts it in the prompt BODY or on one of the
 * two lines of the trailing `[style]` section.
 *
 * Still client-folded, deliberately: the per-beat picks and Character FX
 * (`beats` — Character FX is excluded by the platform registry by design,
 * see `characterFxPicker`). {@link appendHints} survives for exactly those two.
 * The Subject / Person / Styling clauses used to be here too; since S6 they ride
 * their own platform `subject` ids channel (`subject`) and the route folds
 * them, so the generate submits append NOTHING at all.
 *
 * VERBOSITY is the SECOND axis, and it is never defaulted: the two stage
 * policies ({@link IMAGE_HINT_MODE}, {@link VIDEO_HINT_MODE}) are DEFINED AS the
 * platform's own defaults, so studio's preview and the server's fold cannot
 * fork.
 */

/** A user's cinematic selections — the flat `pickerKey → option id` map. */
export type Direction = LookSelection

/**
 * One settable dimension of a {@link Direction} — a STUDIO picker key
 * (`framingId`, `lighting-style`, …). Deliberately NOT named `DirectionKey`:
 * that name belongs to `@nodaro/prompts` and means the PLATFORM wire key, and
 * the two vocabularies must stay visibly distinct (see the module doc).
 */
export type LookPickerKey = string

/**
 * The IMAGE stage's verbosity policy: the FULL hint for every dimension.
 *
 * An image prompt is pure description — the diffusion model reads a lighting or
 * atmosphere paragraph AS the scene, so compacting it to "rembrandt lighting"
 * throws away the mechanism that made the picker worth having. DEFINED AS the
 * platform constant (not a copy of its value) so the policy cannot fork.
 */
export const IMAGE_HINT_MODE: LookHintMode = IMAGE_HINT_MODE_DEFAULT

/**
 * The VIDEO stage's policy: shot-level MOTION compact, everything else full.
 *
 * A clip prompt has two jobs. Its LOOK is still description (same reasoning as
 * {@link IMAGE_HINT_MODE}), but its MOTION is an INSTRUCTION to the video model
 * — and a paragraph of mechanism there competes with the scene for attention,
 * where "whip pan left" or "hard cut" lands exactly. DEFINED AS the platform
 * constant, for the same reason as above.
 */
export const VIDEO_HINT_MODE: LookHintMode = VIDEO_HINT_MODE_DEFAULT

/** Every projectable picker: the registry plus the standalone Camera Movement
 *  one (which lives outside `LOOK_PICKERS` but maps onto `cameraMotion`). */
const PROJECTABLE: ReadonlyArray<LookPickerConfig> = [
  ...LOOK_PICKERS,
  cameraMovementPicker(),
]

/**
 * A studio-key selection → the platform's `direction` wire object, filtered to
 * ONE surface.
 *
 * `undefined` when nothing projects — load-bearing, not tidiness: an empty
 * `direction: {}` is truthy for `/v1/generate-image`'s `isStructuredImageMode`
 * check (`body.direction != null && typeof === "object"`), which also relaxes
 * the prompt to `.min(0)`, so an empty object must never reach the wire.
 *
 * Retired ids follow their replacement here (`liveLookId`) — the migration has
 * to apply ON THE WIRE, not only in the menus. A no-op id (one whose fragment is
 * `""` — notably `cameraMotion: "auto"`, or an id retired to nothing) is
 * DROPPED, so a motion-auto-only selection projects to `undefined` rather than
 * a non-empty object that folds no clause.
 */
export function directionWireFields(
  d: Direction,
  surface: "image" | "video",
): DirectionFields | undefined {
  const out: Record<string, string | string[]> = {}
  for (const p of PROJECTABLE) {
    if (!p.platformField) continue
    if (p.surface !== "both" && p.surface !== surface) continue
    const v = d[p.key]
    if (v === undefined) continue
    const ids: string[] = []
    for (const raw of typeof v === "string" ? [v] : v) {
      if (!raw) continue
      const id = liveLookId(raw)
      // A no-op id contributes nothing to the fold; keeping it would make the
      // omit-when-empty guard a lie.
      if (pickerFragment(p, id, "full").length === 0) continue
      if (!ids.includes(id)) ids.push(id)
    }
    if (ids.length === 0) continue
    // Multi-pick dimensions ride as arrays (the platform slices at `maxPicks`);
    // single-pick ones ride as the bare id, which is the shape the pre-registry
    // wire used and what the canvas config panels read.
    out[p.platformField] = p.multi ? ids : ids[0]
  }
  return Object.keys(out).length > 0 ? (out as DirectionFields) : undefined
}

/**
 * The exact clauses the SERVER will fold for a projection, each carrying WHERE
 * it lands — the previews' ONLY source. Never re-implement this client-side:
 * `partitionStyleClauses` owns the order, the per-catalog doctrine, the
 * exact-clause dedupe AND the slotting rule (`styleSlotFor`), so anything else
 * would show the user a prompt they are not getting.
 *
 * THE SLOT IS THE POINT: the route no longer appends look clauses after the
 * prose. Motion clauses stay in the body, `styleGroup: "film"` rows lead a
 * trailing `[style]` section and every other look row follows it on the scene
 * line — see the studio app's `InjectedPrompt`, which assembles the same
 * bytes `composeSectionedPrompt` does.
 */
export function directionClauses(
  fields: DirectionFields | undefined,
  surface: "image" | "video",
): SlottedPromptClause[] {
  return partitionStyleClauses(fields, {
    surface,
    mode: surface === "image" ? IMAGE_HINT_MODE_DEFAULT : VIDEO_HINT_MODE_DEFAULT,
  })
}

/**
 * The clause TEXTS of {@link directionClauses}, in fold order — the platform's
 * `renderDirectionHints` output, reached through the slotted fold so the two can
 * never disagree about which clauses exist.
 *
 * NOT a preview source any more: a flat join says every clause is one `". "`
 * further along the prose, which stopped being true for a look clause. What is
 * left is the LEGACY shape — the clause set an older studio baked into stored
 * prompt text — which the production export has to recognize to avoid folding it
 * twice.
 */
export function directionHints(
  fields: DirectionFields | undefined,
  surface: "image" | "video",
): string[] {
  return directionClauses(fields, surface).map((c) => c.text)
}

/**
 * Append hint phrases to a prompt (comma-joined), skipping empties + trimming.
 *
 * The CLIENT-fold join, and since S6 its only client is `beats` — the
 * per-beat picks plus Character FX. It produces PROSE, which is why the preview
 * runs the user's text through it before anything server-side is appended.
 *
 * Look clauses ride `direction` and Subject clauses ride `subject`. The server
 * joins the BODY half of that fold with the platform's own
 * `PROMPT_HINT_SEPARATOR` (`". "`); the look half lifts out of the body
 * entirely, into the `[style]` section hung off it by a blank line.
 */
export function appendHints(
  prompt: string,
  hints: ReadonlyArray<string>,
): string {
  const base = prompt.trim()
  if (hints.length === 0) return base
  return [base, ...hints].filter(Boolean).join(", ")
}
