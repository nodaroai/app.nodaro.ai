import {
  SUBJECT_IMAGE_HINT_MODE_DEFAULT,
  SUBJECT_VIDEO_HINT_MODE_DEFAULT,
  getRegisteredSubjectKeys,
  renderSubjectHints,
  subjectFieldsForSurface,
  type PickerHintMode,
  type SubjectFields,
} from "@nodaro/prompts"

import {
  PROP_PICKERS,
  SUBJECT_MULTIDIM,
  type SubjectSelection,
} from "./subject-pickers"

/**
 * The studio's SUBJECT channel — turns the Subject picker selections (a flat
 * `field → chosen id(s)` map) into the platform's flat `subject` wire object,
 * and renders the clauses the SERVER will fold from it.
 *
 * THE DIRECTION TWIN, with one simplification worth stating up front: subject
 * has ONE vocabulary. Studio derives its picker fields straight from
 * `PERSON_FIELD_BY_DIMENSION` / `STYLING_FIELD_BY_DIMENSION` and keys the props
 * `heldProp` / `material` / `animal`, so {@link SubjectSelection} ALREADY IS a
 * flat bag in platform vocabulary. There is no studio↔platform conversion table
 * here the way `directionWireFields` has one — {@link subjectWireFields} is a
 * WHITELIST, not a rename. Do not build a mapping table by analogy.
 *
 * THE WIRE IS FLAT, AND THE FLATNESS IS THE PLATFORM'S DECISION, not a shortcut:
 * `buildStylingHints` reads `lipState` — a PERSON field — to skip
 * `makeup-bold-lips` when `lip-state-bold-red` is already picked, and that
 * dedupe only fires for a consumer folding both pickers off ONE shared value
 * map. Studio is exactly such a consumer; a nested `{ person, styling }` wire
 * would silently double the lipstick clause.
 *
 * NO CLIENT FOLD (S6). Every dimension rides as ids and is rendered inside the
 * route's own assembly, so a saved production picks up a catalog improvement
 * with no re-save and a preview cannot drift from the server. {@link
 * subjectHints} is therefore the previews' ONLY source: it calls the platform
 * renderer on the very object the submit sends. The one thing that stayed
 * client-folded is the ENTITY-CREATION path (`subjectCreationHints`), which
 * targets the entity generate routes rather than `/v1/generate-image`.
 *
 * VERBOSITY is the second axis and is never defaulted: the two stage policies
 * are DEFINED AS the platform's own subject defaults (image full, video
 * compact — the start frame already carries the subject's identity into a
 * clip), exactly as `direction.ts` defines its two.
 */

/** The IMAGE stage's subject verbosity — the full mechanism clause. */
export const SUBJECT_IMAGE_HINT_MODE: PickerHintMode =
  SUBJECT_IMAGE_HINT_MODE_DEFAULT

/** The VIDEO stage's subject verbosity — the compact professional term. */
export const SUBJECT_VIDEO_HINT_MODE: PickerHintMode =
  SUBJECT_VIDEO_HINT_MODE_DEFAULT

/**
 * Which FOLD ROW consumes a given wire key — derived from studio's own picker
 * specs, never hand-listed. Person and styling fields answer their picker's key
 * (`person` / `styling`, the platform's own group-row ids); each prop picker is
 * one key and one row, so it answers itself.
 *
 * It exists for exactly one job: surface filtering. The wire keys are FIELDS but
 * the platform's surfaces are declared per ROW, so "is this field on this
 * surface" has to go through the row that reads it.
 */
const FOLD_ROW_BY_FIELD: ReadonlyMap<string, string> = new Map<string, string>([
  ...SUBJECT_MULTIDIM.flatMap((spec) =>
    spec.sections.flatMap((s) =>
      s.dimensions.map((d) => [d.field, spec.key] as [string, string]),
    ),
  ),
  ...PROP_PICKERS.map((p) => [p.pill.key, p.pill.key] as [string, string]),
])

/**
 * A Subject selection → the platform's `subject` wire object, filtered to ONE
 * surface.
 *
 * `undefined` when nothing projects — load-bearing, not tidiness: an empty
 * `subject: {}` is truthy for the routes' structured-mode check (which also
 * relaxes the prompt to `.min(0)`), so an empty object must never reach the
 * wire. Same rule, same reason, as {@link import("./direction").directionWireFields}.
 *
 * A key the platform does not know is DROPPED (a stale field from an older
 * restore keeps `jobs.input_data` in the platform's vocabulary); an unknown ID
 * is left alone, because every getter resolves a miss to `""` and the platform
 * would rather ignore it than 400. Per-dimension caps are the server's job
 * (`normalizeSubjectFields` slices), so this never truncates a selection the
 * pickers allowed.
 *
 * Copy-on-write throughout: the caller's selection and its arrays are never
 * mutated.
 */
export function subjectWireFields(
  selection: SubjectSelection,
  surface: "image" | "video",
): SubjectFields | undefined {
  // Pack-aware: with no deployment pack registered this is `SUBJECT_KEYS`
  // exactly, and with one it grows — asking the platform beats mirroring it.
  const known = new Set(getRegisteredSubjectKeys())
  const onSurface = new Set(subjectFieldsForSurface(surface).map((r) => r.key))
  const out: Record<string, string | string[]> = {}
  for (const [field, raw] of Object.entries(selection)) {
    if (!known.has(field)) continue
    const row = FOLD_ROW_BY_FIELD.get(field)
    if (!row || !onSurface.has(row)) continue
    if (typeof raw === "string") {
      if (raw) out[field] = raw
      continue
    }
    const ids: string[] = []
    for (const id of raw) {
      if (id && !ids.includes(id)) ids.push(id)
    }
    if (ids.length > 0) out[field] = ids
  }
  return Object.keys(out).length > 0 ? (out as SubjectFields) : undefined
}

/**
 * A subject selection copied a level DEEPER than a spread — a multi-pick
 * dimension's value is an ARRAY, and `{ ...subject }` hands the same array to
 * the copy (the R25 class). Used wherever a selection crosses an ownership
 * boundary: the persistence copy, the settings seed, the plan rung.
 */
export function copySubjectSelection(
  subject: SubjectSelection,
): SubjectSelection {
  const out: Record<string, string | ReadonlyArray<string>> = {}
  for (const [field, value] of Object.entries(subject)) {
    out[field] = typeof value === "string" ? value : [...value]
  }
  return out
}

/**
 * The wire bag back to a picker selection — the RESTORE direction, and the
 * reason the subject has to be echoed onto results at all.
 *
 * Trivially invertible, unlike the look: {@link subjectWireFields} is a
 * whitelist, so every wire key IS the picker field that wrote it. The only
 * thing dropped is `customAge` — the platform's one NUMBER field, which studio
 * has no picker for, so it could not re-arm anything.
 *
 * Copy-on-write: fresh arrays out, so an echoed result and the live editor
 * state never alias.
 */
export function subjectSelection(
  fields: SubjectFields | undefined,
): SubjectSelection {
  const out: Record<string, string | string[]> = {}
  for (const [field, raw] of Object.entries(fields ?? {})) {
    if (typeof raw === "string") {
      if (raw) out[field] = raw
    } else if (Array.isArray(raw) && raw.length > 0) {
      out[field] = [...raw]
    }
  }
  return out
}

/**
 * The exact clauses the SERVER will fold for a projection — the previews' ONLY
 * source. Never re-implement this client-side: `renderSubjectHints` owns the
 * table order, the shared normalized bag both group rows read (that is what
 * keeps the cross-catalog dedupe alive), the per-dimension caps and the
 * exact-clause dedupe, so anything else would show the user a prompt they are
 * not getting.
 *
 * Person and styling each come back as ONE comma-joined clause, because their
 * builders emit FRAGMENTS: thirty of them through the platform's `". "` hint
 * join would read "a beautiful woman. in her 30s. East Asian."
 */
export function subjectHints(
  fields: SubjectFields | undefined,
  surface: "image" | "video",
): string[] {
  return renderSubjectHints(fields, {
    surface,
    mode: surface === "image" ? SUBJECT_IMAGE_HINT_MODE : SUBJECT_VIDEO_HINT_MODE,
  })
}
