import { GEMINI_OMNI_12_MAX_SOURCE_SEC, isGeminiOmniPerSecondProvider } from "@nodaro/shared/models"

/** A request's trim of its source clip, as the routes and the DAG carry it. */
export interface VideoSourceTrim {
  start?: unknown
  end?: unknown
}

/** The stretch of a source clip a per-second Gemini Omni edit sends and bills. */
export interface GeminiOmni12SourceWindow {
  startSec: number
  endSec: number
  /** `endSec - startSec`; not above 0 when the trim starts past the clip's end. */
  spanSec: number
  /** Whether the clip has to be cut to send this stretch. */
  cut: boolean
}

const wholeSeconds = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : undefined

/**
 * The window a source clip is sent in. KIE's 1.2 schema takes a plain URL of at
 * most {@link GEMINI_OMNI_12_MAX_SOURCE_SEC} seconds and has no trim fields, so
 * the node's trim, and the cut to that limit, happen on our side.
 *
 * `clipSec` is the probed length. Unknown (no probe, an unreadable clip), the
 * window runs to the limit, which is the most the run can bill, and a clip with
 * no trim is sent as it is, so KIE gives its own answer.
 */
export function geminiOmni12SourceWindow(args: { clipSec?: unknown; trim?: VideoSourceTrim }): GeminiOmni12SourceWindow {
  const startSec = Math.max(0, wholeSeconds(args.trim?.start) ?? 0)
  const rawEnd = wholeSeconds(args.trim?.end)
  const wantedEnd = rawEnd === undefined ? undefined : Math.max(rawEnd, startSec + 1)
  const known = typeof args.clipSec === "number" && Number.isFinite(args.clipSec) && args.clipSec > 0
  const clipSec = known ? (args.clipSec as number) : undefined
  const endSec = Math.min(wantedEnd ?? Number.POSITIVE_INFINITY, startSec + GEMINI_OMNI_12_MAX_SOURCE_SEC, clipSec ?? Number.POSITIVE_INFINITY)
  // Over KIE's limit is always a cut. Inside it, a container that reads a hair
  // past the requested end is not worth one.
  const cut = clipSec !== undefined
    ? startSec > 0 || clipSec > GEMINI_OMNI_12_MAX_SOURCE_SEC || endSec < clipSec - 0.05
    : startSec > 0 || wantedEnd !== undefined
  return { startSec, endSec, spanSec: endSec - startSec, cut }
}

/** Held off the limit: a 15 s cut measures 15.015 s at 29.97 fps. */
const LIMIT_CUT_MARGIN_SEC = 0.1

/** Where to end the cut, so a window at KIE's limit stays inside it. */
export function geminiOmni12CutEndSec(window: GeminiOmni12SourceWindow): number {
  return window.spanSec >= GEMINI_OMNI_12_MAX_SOURCE_SEC
    ? window.startSec + GEMINI_OMNI_12_MAX_SOURCE_SEC - LIMIT_CUT_MARGIN_SEC
    : window.endSec
}

/**
 * The seconds each probed clip bills on a per-second Gemini Omni edit, after the
 * trim and the limit: NaN for a clip that could not be read and has no trim end
 * to size it, which the billing counts as the worst case. Every other provider's
 * durations pass through unchanged.
 */
export function videoRefBilledDurations(
  provider: string,
  durationsSec: readonly number[],
  trim: VideoSourceTrim | undefined,
): readonly number[] {
  if (!isGeminiOmniPerSecondProvider(provider)) return durationsSec
  return durationsSec.map((clipSec) =>
    Number.isFinite(clipSec) && clipSec > 0 || wholeSeconds(trim?.end) !== undefined
      ? geminiOmni12SourceWindow({ clipSec, trim }).spanSec
      : Number.NaN)
}

/** The rung of the 3–15 s ladder a length bills at. A delivered clip reads a hair over its nominal length. */
export function geminiOmni12LadderSec(sec: number): number {
  return Math.min(GEMINI_OMNI_12_MAX_SOURCE_SEC, Math.max(3, Math.ceil(sec - 0.25)))
}
