/**
 * The cinematic channel as it rides on a CANVAS NODE — copy + omit-when-empty
 * writers and the untrusted read-back.
 *
 * A still's / clip's `direction` (platform-keyed cinematic ids) and `subject`
 * (platform-keyed Person / Styling / prop ids) are emitted into the
 * `generate-image` /
 * `generate-video` node's own `data`, so a canvas re-run folds the SAME ids the
 * studio run folded instead of re-reading a baked prompt. `structured` (the
 * platform's Path-1 free-text fields) rides beside them as a pure PASSTHROUGH:
 * studio never authors it, the canvas does, and studio must hand it back
 * untouched. This module owns the moves that make all three safe; `shot-graph.ts`
 * (already far past the file-size cap) only calls them.
 *
 * WHY THE PLATFORM READERS AND NOTHING ELSE. The persisted graph is
 * canvas-editable and UNTRUSTED — a user, an MCP write, an import or a node
 * preset can hand-edit `node.data.direction`.
 *  - Drift-proof by construction: `readDirectionFields` / `readSubjectFields`
 *    are derived from `DIRECTION_FIELDS` / `SUBJECT_FIELDS`, so a dimension
 *    added to either platform registry is honored in studio with no studio edit
 *    — the same guarantee the platform's own call sites get, and exactly
 *    CLAUDE.md's "capability/data-driven over hardcoded lists" standard.
 *  - Their bounds are the ones the canvas will actually apply — registry keys
 *    only, ids ≤ `DIRECTION_ID_MAX_CHARS` / `SUBJECT_ID_MAX_CHARS` (100, one
 *    literal shared by both channels and both doors) and arrays truncated at
 *    the shared ceiling (8) — so what studio reads back IS what a canvas run
 *    folds. Cardinality only: the SEMANTIC per-dimension cap is the renderer's
 *    (`normalizeSubjectFields` / `maxPicks`), which is why studio's own
 *    projection never truncates either. A studio-local reader would be a second
 *    source of truth that could accept ids the canvas silently drops.
 *  - `undefined`-never-`{}` is the readers' own contract, and it lines up with
 *    shot-graph's omit-when-empty idiom.
 *
 * VOCABULARY. Everything here speaks PLATFORM keys (`DIRECTION_KEYS` /
 * `SUBJECT_KEYS`), never studio picker keys: both readers iterate their registry
 * and silently DROP every non-registry key, so a studio key on a node would look
 * right in studio and fold nothing on the canvas. `direction`'s
 * `directionWireFields` is the one and only conversion for the LOOK; subject
 * needs none, because studio's Subject pickers are keyed by the platform's own
 * field names already (`subject`).
 */
import {
  readDirectionFields,
  readStructuredFields,
  readSubjectFields,
  type DirectionFields,
  type StructuredPromptFields,
  type SubjectFields,
} from "@nodaro/prompts"

import { directionWireFields } from "./direction"

/**
 * Deep-copy a direction projection — multi-pick dimensions carry arrays and the
 * store is copy-on-write, so an emitted node must never alias store state
 * (mirrors shot-graph's `copyLookMap`).
 */
export function copyDirection(d: DirectionFields): DirectionFields {
  const out: Record<string, string | ReadonlyArray<string>> = {}
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue
    out[k] = Array.isArray(v) ? [...v] : (v as string)
  }
  return out as DirectionFields
}

/**
 * Copy a subject projection. The shape is FLAT — the platform's own field names
 * onto one id, a LIST of ids, or (for `customAge`) a number — so this is
 * {@link copyDirection}'s twin and the array arm is the whole point: a
 * multi-pick dimension's array must not alias store state.
 */
export function copySubject(s: SubjectFields): SubjectFields {
  const out: Record<string, string | number | ReadonlyArray<string>> = {}
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) continue
    out[k] = Array.isArray(v) ? [...v] : (v as string | number)
  }
  return out as SubjectFields
}

/**
 * `{ direction }` or `{}` — the omit-when-empty spread EVERY writer goes
 * through.
 *
 * An empty object must never be emitted, twice over: `undefined`-never-`{}` is
 * the platform readers' own contract, and a `direction: {}` / `direction:
 * undefined` key on a direction-less node breaks the single-still byte-identical
 * round-trip `shot-graph.ts` is built around. (On the WIRE the same empty object
 * would additionally flip `/v1/generate-image` into structured mode — see
 * `directionWireFields`.)
 */
export function directionSpread(
  d: DirectionFields | undefined,
): { direction?: DirectionFields } {
  return d && Object.keys(d).length > 0 ? { direction: d } : {}
}

/** The {@link directionSpread} mirror for the subject projection. */
export function subjectSpread(
  s: SubjectFields | undefined,
): { subject?: SubjectFields } {
  return s && Object.keys(s).length > 0 ? { subject: s } : {}
}

/**
 * Read an UNTRUSTED persisted `node.data.direction` blob back. Delegates to the
 * PLATFORM reader — never a hand-rolled key list (see the module doc). Returns a
 * fresh object; `undefined` when nothing survives.
 */
export function readNodeDirection(value: unknown): DirectionFields | undefined {
  return readDirectionFields(value)
}

/** The {@link readNodeDirection} mirror for `node.data.subject`. */
export function readNodeSubject(
  value: unknown,
): SubjectFields | undefined {
  return readSubjectFields(value)
}

/**
 * The PASSTHROUGH channel — `node.data.structured`, the platform's Path-1 FREE
 * TEXT fields (`StructuredPromptFields`), a THIRD lever `assembleImageInput`
 * folds alongside `direction` and `subject`. Studio never writes it and has no
 * UI for it; the CANVAS does, and `shot-graph.ts` rebuilds a node's `data` from
 * a fixed field list — so a field studio does not read here is erased from a
 * canvas-authored production on studio's next debounced save (the readVoice
 * lesson, stated in `shot-graph.ts` itself). Read it, carry it, write it back.
 *
 * Deliberately NOT on the RESULT records: those are written by studio's own
 * generate path, which sends no structured fields, so there is nothing to carry.
 */
export function readNodeStructured(
  value: unknown,
): StructuredPromptFields | undefined {
  return readStructuredFields(value)
}

/**
 * Copy Path-1 structured fields. The shape is GROUPED (`person`, `styling`,
 * `setting`, `camera`, `lens` + a flat `mood`), so a top-level spread would
 * alias the group objects — copy one level deeper.
 */
export function copyStructured(s: StructuredPromptFields): StructuredPromptFields {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) continue
    out[k] = typeof v === "object" && v !== null ? { ...v } : v
  }
  return out as StructuredPromptFields
}

/** The {@link directionSpread} mirror for the structured passthrough. */
export function structuredSpread(
  s: StructuredPromptFields | undefined,
): { structured?: StructuredPromptFields } {
  return s && Object.keys(s).length > 0 ? { structured: s } : {}
}

/**
 * The cinematic channel a landing RESULT stamps onto its still/clip base — the
 * one conversion from the result's STUDIO look ids (which re-arm the pickers) to
 * the PLATFORM wire keys the canvas node speaks, gated on the result's own
 * format marker.
 *
 * INV-D: ONLY a `promptFormat: 2` result carries direction, so a legacy
 * (unmarked) result CLEARS whatever the base inherited. Without the clear, a
 * legacy re-generate would leave a stale look beside a newly-BAKED prompt and
 * the canvas would fold the same clause twice — the exact failure D4 exists to
 * kill. Key presence is the marker on the graph, so nothing else is needed.
 *
 * Omit-when-empty at the stamp too: `direction: {}` would take the wrong spread
 * branch downstream and break the byte-identical single-result round-trip. Both
 * values are COPIED — the store is copy-on-write and must never alias the
 * incoming result's objects.
 *
 * Lives HERE, not in the store, because it is not a store move: every writer
 * that rebuilds a still/clip base FROM a result needs the same gate (the store's
 * two reducers, and the frame/motion bundle bodies, which project the ACTIVE
 * result into a one-result export). A second copy of the gate is a second D4.
 *
 * The `look` shape is structural on purpose (`Shot.look`'s `LookSelectionMap`)
 * so this module stays free of `lib/shot`, which imports it.
 */
export function resultDirection(
  result: {
    readonly promptFormat?: 2
    readonly look?: Readonly<Record<string, string | ReadonlyArray<string>>>
    readonly subject?: SubjectFields
  },
  surface: "image" | "video",
): { direction?: DirectionFields; subject?: SubjectFields } {
  if (result.promptFormat !== 2) return {}
  const direction = result.look
    ? directionWireFields(result.look, surface)
    : undefined
  return {
    ...directionSpread(direction ? copyDirection(direction) : undefined),
    ...subjectSpread(
      result.subject ? copySubject(result.subject) : undefined,
    ),
  }
}

/**
 * The channel a rebuild INHERITS unchanged from the base it is rebasing off —
 * the INV-D partner of {@link resultDirection}, for the writers whose `prompt`
 * ALSO falls back to the base (an appended library import, a promptless
 * re-voice take). Direction is rebased by exactly the expression that rebases
 * `prompt`: when the prompt is inherited, so is its direction, and when the
 * prompt rebases, {@link resultDirection}'s gate decides.
 *
 * Safe against a stale look precisely BECAUSE of that gate: a base whose prompt
 * is legacy-baked has no `direction` (the landing legacy result cleared it), so
 * there is nothing here to carry.
 *
 * Copies on the way out — the result lands in live store state.
 */
export function carryDirection(base: {
  readonly direction?: DirectionFields
  readonly subject?: SubjectFields
}): { direction?: DirectionFields; subject?: SubjectFields } {
  return {
    ...directionSpread(base.direction ? copyDirection(base.direction) : undefined),
    ...subjectSpread(
      base.subject ? copySubject(base.subject) : undefined,
    ),
  }
}

/**
 * The canvas PASSTHROUGH a rebuild inherits — {@link carryDirection}'s twin for
 * `structured`, deliberately its OWN move rather than a third key inside it.
 *
 * INV-D does not apply here and must not be allowed to: the gate exists so a
 * legacy BAKED prompt is never re-projected beside live studio ids, and
 * `structured` is neither studio's nor a result's — it is the canvas's own
 * field, sitting on the still/clip base with no bearing on which result is
 * active. So every writer that rebuilds a base carries it UNCONDITIONALLY,
 * exactly as `imageNode`/`videoNode` do on the save path. Anything less is
 * another way to erase a field studio does not own.
 */
export function carryStructured(base: {
  readonly structured?: StructuredPromptFields
}): { structured?: StructuredPromptFields } {
  return structuredSpread(
    base.structured ? copyStructured(base.structured) : undefined,
  )
}
