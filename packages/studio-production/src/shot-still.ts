/**
 * The FRAMED STILL half of a shot — the {@link ShotStill} shape (one
 * generate-image node holding the shot's result history) plus the pure readers
 * over it: the normalized results list, the production-wide still/image-ref
 * walks, the display-name derivations and {@link buildStill}'s shape invariant.
 *
 * Extracted from `shot.ts` (which re-exports every name here) — same frozen
 * contract. The clip mirror lives in `shot-clip.ts`.
 */
import type {
  DirectionFields,
  StructuredPromptFields,
  SubjectFields,
} from "@nodaro/prompts"

import {
  directionSpread,
  structuredSpread,
  subjectSpread,
} from "./shot-direction"

import type { ShotStillResult } from "./shot-results"
import type { Shot } from "./shot"

/**
 * A framed still — ONE generate-image node holding the shot's results list (the
 * Nodaro-native "X images per shot": every framing candidate + edit appends a
 * {@link ShotStillResult}; `activeIndex` picks the current frame, which the
 * generate-video `startFrame` edge animates). `url` mirrors the ACTIVE result so
 * every existing reader (timeline card, export, clip first-frame) keeps working.
 */
export interface ShotStill {
  /** Persisted generate-image node id — STABLE per shot; results accumulate under it. */
  readonly nodeId: string
  /** The ACTIVE result's URL (= `results[activeIndex].url`). The shot's current frame. */
  readonly url: string
  /** Catalog image model id that produced it (for the canvas node + relabel). */
  readonly provider: string
  /** The RAW user prompt persisted on the node (the route folds hints server-side). */
  readonly prompt: string
  /**
   * All generations for this shot → the canvas node's `generatedResults`. One
   * per framing candidate + edit. Optional for back-compat: absent ⇒ a single
   * legacy result (`[{ url }]`); use {@link stillResults} to read it normalized.
   */
  readonly results?: ReadonlyArray<ShotStillResult>
  /** Index into {@link results} of the active frame; absent ⇒ 0. */
  readonly activeIndex?: number
  /**
   * The cinematic direction this still's `prompt` was generated with, as
   * PLATFORM catalog ids (`DIRECTION_KEYS`, never studio picker keys) — emitted
   * into the `generate-image` node's own `data.direction` so a canvas re-run
   * folds the same ids server-side instead of re-reading a baked prompt.
   *
   * INV-D: this is rebased by EXACTLY the expression that rebases {@link
   * prompt}, and only survives when its source result was marked
   * `promptFormat: 2` — node `data.prompt` and node `data.direction` always
   * describe the SAME generation. A legacy (unmarked) result therefore CLEARS
   * it: a baked prompt beside live ids is the double-fold this channel exists
   * to kill (D4).
   *
   * KEY PRESENCE IS THE MARKER on the graph — a node carrying `direction`
   * implies its prompt is unbaked prose, so no `promptFormat` is written into
   * node data at all and the canvas double-fold is structurally unreachable.
   */
  readonly direction?: DirectionFields
  /**
   * The SUBJECT ids the same generation was sent with — the platform-keyed
   * Person / Styling / prop bag, carried symmetrically with {@link direction}
   * (same INV-D rebase, same omit-when-empty) so a canvas re-run folds the
   * ids studio folded rather than re-reading a baked prompt.
   *
   * The symmetry is not total in ONE direction (R62): `direction`'s presence
   * still implies unbaked prose, `subject`'s no longer does — a suppressed-look
   * submit rides with a subject over prose the plan says is baked. Harmless
   * here (that prose never carried a subject fold, so the canvas folds it
   * once), but do not infer baked-ness from this key.
   */
  readonly subject?: SubjectFields
  /**
   * The platform's Path-1 free-text structured fields, as they were found on the
   * node. A PASSTHROUGH, not a studio channel: studio has no UI that authors it
   * and never writes one — but the CANVAS does, and `shot-graph.ts` rebuilds a
   * node's `data` from a fixed field list, so carrying it is the only thing that
   * keeps studio's debounced save from erasing a canvas-authored value. Opaque
   * here by design; nothing reads it but the writer that hands it back.
   */
  readonly structured?: StructuredPromptFields
}

/** A shot still's results list, normalized over the legacy single-`url` shape. */
export function stillResults(still: ShotStill): ReadonlyArray<ShotStillResult> {
  return still.results && still.results.length > 0
    ? still.results
    : [{ url: still.url }]
}

/**
 * EVERY still URL the production has generated, in shot → result order, DE-DUPED by
 * URL — the source for the Start/End-frame picker's "This production" tab (and the
 * Composer reference gallery). Each shot contributes its WHOLE result history (via
 * {@link stillResults}), not just its active still, so any image you made while
 * experimenting is pickable. `jobId` keys a generation; an upload (no jobId) falls
 * back to a per-shot index. Pure; returns fresh `{ id, url }` rows — never exposes
 * the store shots.
 */
export function productionStills(
  shots: ReadonlyArray<Shot>,
): ReadonlyArray<{ readonly id: string; readonly url: string }> {
  const seen = new Set<string>()
  return shots.flatMap((s) =>
    s.still
      ? stillResults(s.still).flatMap((r, i) => {
          if (seen.has(r.url)) return []
          seen.add(r.url)
          return [{ id: r.jobId ?? `${s.id}:${i}`, url: r.url }]
        })
      : [],
  )
}

/**
 * The resolved display NAME for a still result — the user's custom {@link
 * ShotStillResult.name} when set, else a positional `Ref N` (1-based `index`).
 * The SINGLE place the default is computed, so the image-reference picker, the
 * rename UI, the copy-settings list and the inserted chip's label can't drift.
 *
 * `Ref`, not `Image`: the chip's name rides the prompt as prose, and `Image N`
 * is the video models' OWN grammar for "the N-th attached picture" — numbered
 * by attachment order, which is not this list's order. A chip called "Image 6"
 * that reached the model as its fifth attachment told it to look at a sixth
 * that wasn't there. Stored chips keep whatever name they were bound with.
 */
export function stillDisplayName(
  result: { readonly name?: string },
  index: number,
): string {
  return result.name?.trim() || `Ref ${index + 1}`
}

/**
 * The resolved display NAME for a SHOT — the user's custom {@link Shot.name}
 * when set, else the positional `Shot N` (1-based strip order; renumbers on
 * reorder/delete, timeline-style). The SINGLE place the "Shot N" default is
 * computed, so the timeline card and the FreeCut hand-off (clip file names in
 * the editor's media bin) can't drift. Model ids deliberately never surface
 * as a shot's name (dev metadata — it lives in the editor's result history).
 */
export function shotDisplayName(
  shot: { readonly name?: string },
  index: number,
): string {
  return shot.name?.trim() || `Scene ${index}`
}

/**
 * The FILE name for a shot's clip wherever it lands as a file — FreeCut's
 * media bin (the primary's `videoName` AND every `additionalFiles` entry),
 * the raw-shots zip, the Export menu's selected-shot download. ONE derivation
 * ({@link shotDisplayName} → path-hostile chars stripped → `.mp4`) so the
 * surfaces can't drift (the primary once shipped extension-less — "Shot 1"
 * beside "Shot 2.mp4").
 */
export function shotFileName(
  shot: { readonly name?: string },
  index: number,
): string {
  const safe = safeFileName(shotDisplayName(shot, index))
  return `${safe || `Scene ${index}`}.mp4`
}

/**
 * Strip path-hostile characters from a display name so it can be a file's base
 * name. Extracted from {@link shotFileName} (byte-identical behavior) so the
 * bundle exports (`<name>.<kind>.json` — see lib/production-bundle) share the
 * ONE sanitizer. Returns `""` for an all-hostile input ("///") — the CALLER
 * supplies its own fallback (shotFileName's `Scene ${index}`), never this.
 */
export function safeFileName(base: string): string {
  return base
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/^[-\s]+|[-\s]+$/g, "") // no edge dashes
}

/**
 * EVERY still the production has generated, in shot → result order, DE-DUPED by
 * URL, each with its RESOLVED display name ({@link stillDisplayName}) — the feed
 * for the image-reference picker's "This project" source and the basis for an
 * `@`-inserted image CHIP's name + url. The positional `Image N` default is
 * numbered across the WHOLE production (a global, stable index over the distinct
 * images), matching the competitor's cross-shot "Image 1/2/3". A custom-named
 * result keeps its own name but still occupies its global slot. Pure; returns
 * fresh rows, never the store shots.
 */
export function productionImageRefs(
  shots: ReadonlyArray<Shot>,
): ReadonlyArray<{
  readonly id: string
  readonly url: string
  readonly name: string
  readonly shotId: string
}> {
  const seen = new Set<string>()
  const out: Array<{ id: string; url: string; name: string; shotId: string }> = []
  let index = 0
  for (const s of shots) {
    if (!s.still) continue
    stillResults(s.still).forEach((r, i) => {
      if (seen.has(r.url)) return
      seen.add(r.url)
      out.push({
        id: r.jobId ?? `${s.id}:${i}`,
        url: r.url,
        name: stillDisplayName(r, index),
        shotId: s.id,
      })
      index += 1
    })
  }
  return out
}

/**
 * Build a {@link ShotStill} enforcing the SHAPE invariant in one place: a lone
 * result collapses to the minimal legacy shape (no `results`/`activeIndex`) so
 * single-still productions round-trip byte-identical; >1 carries the list and
 * its `activeIndex`. `url` always mirrors the ACTIVE result so every reader
 * (timeline card, export, clip first-frame) keeps working. Callers pass the
 * already-built results array + the chosen active index.
 */
export function buildStill(
  base: {
    nodeId: string
    provider?: string
    prompt?: string
    direction?: DirectionFields
    subject?: SubjectFields
    structured?: StructuredPromptFields
  },
  results: ReadonlyArray<ShotStillResult>,
  activeIndex: number,
): ShotStill {
  const core = {
    nodeId: base.nodeId,
    url: results[activeIndex].url,
    provider: base.provider ?? "",
    prompt: base.prompt ?? "",
    // The cinematic channel travels WITH `prompt` (INV-D) — omit-when-empty, so
    // a direction-less still stays byte-identical to what it serialized to
    // before this channel existed.
    ...directionSpread(base.direction),
    ...subjectSpread(base.subject),
    // The canvas's own Path-1 fields, handed straight back (see ShotStill).
    ...structuredSpread(base.structured),
  }
  // Keep the results list for >1 generation OR when the lone result carries bound
  // `@`-entity chips, manual reference images, a Filerobot design-state url, the
  // levers it was made at, OR a custom name — collapsing to the bare shape would
  // DROP them (they live per-result), so a single still would lose them on
  // reload/shot-select (e.g. a continuity still whose reference IS its frame, a
  // single Filerobot-edited still, or a still the user renamed to reference it as
  // an image chip). Mirrors buildClip's freecutProjectUrl keep-predicate. A truly
  // bare lone result (legacy, no chips/refs/design-state/levers/name) still
  // collapses byte-identical.
  const keepList =
    results.length > 1 ||
    results.some(
      (r) =>
        r.references?.length ||
        r.referenceImageUrls?.length ||
        r.filerobotDesignStateUrl ||
        r.negativePrompt ||
        r.aspectRatio ||
        r.resolution ||
        r.count !== undefined ||
        r.name ||
        // The prompt-format marker, its merged look ids and the layer split
        // (D-A1). Without these the COMMON case — a shot with exactly one still
        // — would drop the marker at the first store write, read back as legacy,
        // and D4 would then suppress the pickers on a brand-new result. The
        // layers get their OWN clauses: `r.look` does not imply them (a layer
        // can be present with no merged echo), exactly as `subject` earns its
        // own clause.
        r.promptFormat !== undefined ||
        r.look ||
        r.filmLook ||
        r.sceneLook ||
        r.subject,
    )
  return keepList ? { ...core, results, activeIndex } : core
}
