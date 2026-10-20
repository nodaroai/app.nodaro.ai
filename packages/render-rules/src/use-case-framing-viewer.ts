/**
 * The framing source a viewer's run reads (decided 2026-10-20): `auto` — the
 * new node's default — follows faces only while Speaker Frames is available to
 * the run's viewer. For a viewer it is withheld from, `auto` is the even split,
 * silently: no refusal, nothing extra charged (as a node on several recordings
 * reads its first one for a viewer without Speaker Map). A node or body that
 * names no framing source chooses its type's absent default (its spec's
 * `absentFramingSource`: `auto` for Speaker Layout, `static` for every node
 * that predates it, whose runs it keeps byte-identical). An explicit
 * `tracking` is never rewritten: a caller who asks for it while Speaker
 * Frames is withheld is refused up front (the route's inner-step check).
 *
 * ONE rule for every place a framing source is resolved: the route (before it
 * builds anything), both engines' request bodies (`usecaseRunRecordings`), the
 * estimate's expansion, the review's chain and — through the body a fresh run
 * would send — a failed attempt's resume match, so `auto` never reads as
 * `tracking` against an attempt that ran on the even split.
 *
 * It only ever turns `auto` into `static`, never anything into `tracking`, so
 * where two readings disagree the run is the cheaper one: never a refusal the
 * person did not ask for, never a run over its quote.
 *
 * Unreadable answers: a RUN that cannot read the viewer's availability reads
 * Speaker Frames as withheld (the even split — nothing charged that was not
 * asked for); an ESTIMATE given no answer reads it as available (it quotes the
 * tracking chain, never less than the run's hold). Pure.
 */

import { usecaseFramingChoice, type UseCaseFramingSource } from "./use-case-framing"

export { USE_CASE_FRAMES_TYPE } from "./use-case-framing"

/** Who an estimate is for, as a use-case node reads its recordings and framing. Absent fields: as before either existed. */
export interface UseCaseViewerFlags {
  /** May use Speaker Map: a node reads every recording and its Master audio. Absent: the first recording only. */
  readonly multicam?: boolean
  /** Speaker Frames is withheld from the viewer: `auto` reads the even split. Absent: available (`auto` follows faces). */
  readonly framesWithheld?: boolean
}

/** Who a run is for: both answers read (a run never defaults either). */
export interface UseCaseRunViewer {
  /** May use Speaker Map (`usecaseRunRecordings`). */
  readonly multicam: boolean
  /** May use Speaker Frames: `auto` follows faces; otherwise the even split. */
  readonly framesAvailable: boolean
}

/** A viewer's run with neither several recordings nor Speaker Frames: every run exactly as before both existed. */
export const USE_CASE_RUN_VIEWER_AS_BEFORE: UseCaseRunViewer = Object.freeze({ multicam: false, framesAvailable: false })

/** What a type reads a node or body with no framing source as: its spec's `absentFramingSource` (use-case-specs.ts). */
export interface UseCaseFramingDefault {
  readonly absentFramingSource: UseCaseFramingSource
}

/**
 * Whether `settings` choose `auto` for a type: their own framing source, or —
 * when they name none (or one that is not a framing source) — the type's
 * absent default. Only such settings are read differently per viewer.
 */
export function usecaseFramingIsAuto(settings: Readonly<Record<string, unknown>>, type: UseCaseFramingDefault): boolean {
  return usecaseFramingChoice(settings.framingSource, type.absentFramingSource) === "auto"
}

/**
 * `settings` as the viewer's run reads them: a framing source that chooses
 * `auto` — written, or absent on a type whose absent default is `auto`
 * (`type.absentFramingSource`, its spec's; decided 2026-10-20) — is the even
 * split (`static`) when Speaker Frames is not available to the viewer;
 * anything else — and every settings object when it is — is returned as given
 * (the same object, so a reader that keeps its key order sees no change, and
 * a type whose absent default is `static` never gains the key).
 */
export function usecaseFramingForViewer<T extends Readonly<Record<string, unknown>>>(settings: T, framesAvailable: boolean, type: UseCaseFramingDefault): T {
  if (framesAvailable || !usecaseFramingIsAuto(settings, type)) return settings
  return { ...settings, framingSource: "static" }
}

/** The estimate's flags as a run's answer: Speaker Frames available unless the flags say withheld. */
export function usecaseFramesAvailableFor(flags: UseCaseViewerFlags | undefined): boolean {
  return flags?.framesWithheld !== true
}
