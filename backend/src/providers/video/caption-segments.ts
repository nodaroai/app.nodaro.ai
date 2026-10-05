import type { Caption } from "@remotion/captions"
import { isKineticCaptionStyle, resolveCaptionLevers, type CaptionLookId, type CaptionLookLevers, type SupportedFontName } from "@nodaro/shared"
import { syntheticCaptionsFromText } from "../audio/captions-mappers.js"
import { BURN_CAPTIONS_FPS_FALLBACK, BURN_CAPTIONS_FPS_MAX, BURN_CAPTIONS_FPS_MIN, BURN_CAPTIONS_MAX_FRAMES } from "../../lib/plan-schemas.js"

/**
 * Per-segment captions: a single add-captions render can apply DIFFERENT caption
 * treatments to different time ranges (e.g. a large uppercase phrase at the top
 * for the intro, then one word at a time at the bottom for the body). This
 * resolves each caller-supplied segment into a self-contained render segment —
 * its words and its fully-merged (look → explicit) levers — so the Remotion
 * composition just renders what it is given.
 */

/** Non-look, non-lever placement fields a segment inherits from the top level. */
export interface CaptionStyleDefaults {
  style: string
  position: "top" | "center" | "bottom"
  positionY?: number
  fontSize: number
  /** Top-level look; a segment without its own look inherits it. */
  look?: CaptionLookId
  /** Top-level per-word motion switch; a segment without its own inherits it. */
  animate?: boolean
  /** Top-level words-per-line cap; a segment without its own inherits it. */
  maxWordsPerLine?: number
  /** Top-level EXPLICIT levers (what the caller passed, before look resolution);
   *  a segment without its own look inherits these too. */
  explicit: CaptionLookLevers
}

/** One caller-supplied segment (post-Zod). Style/placement + optional look +
 *  explicit lever overrides + optional own words (`text` or `captions[]`). */
export interface CaptionSegmentInput {
  startMs: number
  endMs: number
  style?: string
  position?: "top" | "center" | "bottom"
  positionY?: number
  fontSize?: number
  look?: CaptionLookId
  // Explicit look levers (each overrides the resolved look):
  fontFamily?: SupportedFontName
  fontWeight?: number
  color?: string
  backgroundColor?: string
  strokeColor?: string
  strokeWidth?: number
  highlightColor?: string
  uppercase?: boolean
  animate?: boolean
  maxWordsPerLine?: number
  // Own words:
  text?: string
  captions?: Caption[]
}

/** A fully-resolved segment the render plan carries — concrete levers only, no
 *  `look` left to resolve. */
export interface ResolvedCaptionSegment extends CaptionLookLevers {
  startMs: number
  endMs: number
  style: string
  position: "top" | "center" | "bottom"
  positionY?: number
  fontSize: number
  animate?: boolean
  maxWordsPerLine?: number
  captions: Caption[]
}

/** Pull just the explicit lever fields off an input — only the SET ones, so the
 *  result can be spread over another lever set without clobbering it.
 *  `null` counts as UNSET, exactly like `undefined` (the whole-system rule —
 *  `captionRoutesToRemotion` / `normalizeCaptionNumericLevers`): stored workflow
 *  JSON carries nulls, and a forwarded null both overwrites the look's own value
 *  and fails the render plan's `.optional()` (not `.nullable()`) schema mid-run,
 *  after credits are reserved. */
export function explicitLevers(o: {
  fontFamily?: SupportedFontName | null; fontWeight?: number | null; color?: string | null; backgroundColor?: string | null
  strokeColor?: string | null; strokeWidth?: number | null; highlightColor?: string | null; uppercase?: boolean | null
}): CaptionLookLevers {
  return {
    ...(o.fontFamily != null ? { fontFamily: o.fontFamily } : {}),
    ...(o.fontWeight != null ? { fontWeight: o.fontWeight } : {}),
    ...(o.color != null ? { color: o.color } : {}),
    ...(o.backgroundColor != null ? { backgroundColor: o.backgroundColor } : {}),
    ...(o.strokeColor != null ? { strokeColor: o.strokeColor } : {}),
    ...(o.strokeWidth != null ? { strokeWidth: o.strokeWidth } : {}),
    ...(o.highlightColor != null ? { highlightColor: o.highlightColor } : {}),
    ...(o.uppercase != null ? { uppercase: o.uppercase } : {}),
  }
}

/**
 * The NON-numeric caption levers a null can reach the render plan through.
 * `normalizeCaptionNumericLevers` (@nodaro/shared) already drops a null numeric
 * lever; these are the rest, and the plan's schemas are `.optional()`, never
 * `.nullable()`, so a forwarded null fails validation mid-run — after credits
 * are reserved and after any paid transcription.
 */
const NULLABLE_CAPTION_LEVER_KEYS = [
  "look",
  "fontFamily",
  "strokeColor",
  "highlightColor",
  "uppercase",
  "animate",
  "color",
  "backgroundColor",
] as const

/**
 * Drop the non-numeric caption levers whose value is `null` — "null is UNSET".
 * Pure: returns a copy, leaves every other field (and the input) untouched.
 * Applied by the payload-builder to the node's top level and to each
 * `segments[]` entry, right after `normalizeCaptionNumericLevers`.
 */
export function dropNullCaptionLevers<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = { ...input }
  for (const key of NULLABLE_CAPTION_LEVER_KEYS) {
    if (out[key] === null) delete out[key]
  }
  return out as T
}

/**
 * Is this render's caption source a STATIC TEXT BLOCK — the caller's `text`,
 * burned once for the whole clip — rather than timed words?
 *
 * On `subtitle`, `text` IS the caption: one block, `\n` a forced line break,
 * never transcribed over, whichever renderer draws it (the cheap FFmpeg drawtext
 * burn with no styling lever, the Remotion SubtitleOverlay with one). On a
 * KINETIC style the same `text` stays what it always was — a FALLBACK, spread
 * evenly across the clip as synthetic word timings when transcription returns
 * nothing.
 *
 * Source precedence is unchanged: `captions[]` > wired transcript > (`text` on
 * subtitle) > auto-transcription. `auto_transcribe` is deliberately NOT read: on
 * a subtitle the caller's text wins either way.
 *
 * Shared by the WORKER (which must not pay for a transcription it then discards)
 * and the ROUTE/DAG ingress, so the two cannot disagree about where the words
 * come from.
 */
export function isStaticTextCaptionSource(input: {
  style?: string | null
  text?: string | null
  captions?: readonly unknown[] | null
  transcript?: unknown
  segments?: readonly unknown[] | null
}): boolean {
  if (input.segments && input.segments.length > 0) return false
  if (isKineticCaptionStyle(input.style)) return false
  if (input.captions && input.captions.length > 0) return false
  if (input.transcript !== undefined && input.transcript !== null) return false
  return typeof input.text === "string" && /\S/.test(input.text)
}

/** Shown for this long when the source clip's duration could not be probed. */
const STATIC_TEXT_FALLBACK_MS = 5000

/**
 * Re-wrap text to at most `maxWordsPerLine` words per line, treating each
 * existing `\n` as a paragraph the cap never merges across — the caller's own
 * breaks are forced breaks. A paragraph takes the fewest lines the cap allows,
 * its words spread evenly with earlier lines never shorter. No cap → the text
 * is returned as given.
 */
function wrapToWordCap(text: string, maxWordsPerLine?: number): string {
  if (!maxWordsPerLine || maxWordsPerLine < 1) return text
  return text
    .split("\n")
    .flatMap((para) => {
      const words = para.split(/\s+/).filter(Boolean)
      if (words.length === 0) return [""] // a blank line the caller wrote survives
      const lineCount = Math.ceil(words.length / maxWordsPerLine)
      const base = Math.floor(words.length / lineCount)
      const longer = words.length % lineCount
      const lines: string[] = []
      let start = 0
      for (let line = 0; line < lineCount; line++) {
        const size = line < longer ? base + 1 : base
        lines.push(words.slice(start, start + size).join(" "))
        start += size
      }
      return lines
    })
    .join("\n")
}

/**
 * The ONE caption a static text block renders as: the caller's text, spanning
 * the whole video. `\n` is preserved as a forced line break; `maxWordsPerLine`
 * re-wraps each paragraph here (the block stays ONE caption — the render must
 * never receive the cap for it, or the overlay would time-split the block into
 * pages).
 */
export function staticTextCaptionBlock(
  text: string,
  opts: { videoDurationSeconds?: number; maxWordsPerLine?: number },
): Caption {
  const endMs =
    opts.videoDurationSeconds !== undefined && opts.videoDurationSeconds > 0
      ? Math.round(opts.videoDurationSeconds * 1000)
      : STATIC_TEXT_FALLBACK_MS
  return {
    text: wrapToWordCap(text.trim(), opts.maxWordsPerLine),
    startMs: 0,
    endMs,
    timestampMs: 0,
    confidence: null,
  }
}

/** A clipped phrase part shorter than this is a flash nobody can read, so it is
 *  dropped — unless dropping it would lose the phrase entirely. */
export const MIN_CLIPPED_PHRASE_MS = 250

/** PHRASE-level = the entry's text holds more than one word. A word-level entry
 *  (one word, the kinetic input) keeps the start-only membership rule. */
function isPhraseCaption(c: Caption): boolean {
  return c.endMs > c.startMs && c.text.trim().split(/\s+/).length > 1
}

/**
 * Assign captions to segment windows.
 *
 * WORD-level entries belong to the ONE window containing their START, timings
 * untouched (no mid-word style jump; the line-holding overlays must not be
 * handed a word from a neighbouring range). At most one boundary word shifts.
 *
 * A PHRASE-level entry is different: a whisper phrase runs for SECONDS, so
 * start-only membership dropped a phrase that straddled a boundary and left the
 * window with NO captions at all — 10 s of continuous speech rendered silent, at
 * the full price. Such a phrase is SPLIT at the boundary instead: every window it
 * overlaps gets the same text with `startMs`/`endMs` clipped to that window, so
 * it renders once per window in that window's own style and never twice at the
 * same instant. A clipped part shorter than MIN_CLIPPED_PHRASE_MS is dropped,
 * unless that would lose the phrase entirely (then the longest part is kept). A
 * phrase that falls wholly inside one window is passed through untouched.
 *
 * Returns one caption list per window, in the windows' own order.
 */
export function splitCaptionsAcrossWindows(
  captions: readonly Caption[],
  windows: ReadonlyArray<{ startMs: number; endMs: number }>,
): Caption[][] {
  const out: Caption[][] = windows.map(() => [])
  for (const c of captions) {
    if (!isPhraseCaption(c)) {
      const i = windows.findIndex((w) => c.startMs >= w.startMs && c.startMs < w.endMs)
      if (i >= 0) out[i]!.push(c)
      continue
    }
    // Every window this phrase overlaps, clipped to it.
    const parts: Array<{ index: number; caption: Caption }> = []
    windows.forEach((w, i) => {
      const startMs = Math.max(c.startMs, w.startMs)
      const endMs = Math.min(c.endMs, w.endMs)
      if (endMs <= startMs) return
      const whole = startMs === c.startMs && endMs === c.endMs
      parts.push({
        index: i,
        caption: whole ? c : { ...c, startMs, endMs, timestampMs: startMs },
      })
    })
    if (parts.length === 0) continue
    const readable = parts.filter((p) => p.caption.endMs - p.caption.startMs >= MIN_CLIPPED_PHRASE_MS)
    // Every part a sliver → keep the longest one rather than lose the phrase.
    const kept = readable.length > 0
      ? readable
      : [parts.reduce((best, p) =>
          p.caption.endMs - p.caption.startMs > best.caption.endMs - best.caption.startMs ? p : best,
        )]
    for (const p of kept) out[p.index]!.push(p.caption)
  }
  return out
}

/**
 * Resolve each segment's words and merged levers.
 *
 * Words, in priority order:
 *   1. the segment's own `captions[]` — ABSOLUTE video-timeline ms, like the
 *      top-level captions; assigned by the same membership rule as the shared
 *      transcript (`splitCaptionsAcrossWindows`);
 *   2. else its own `text` — for a `subtitle` segment ONE phrase block spanning
 *      the segment's range (use `\n` to force line breaks); for a kinetic style,
 *      synthesised one word at a time;
 *   3. else the shared transcript — each WORD assigned to the ONE segment whose
 *      range contains its START (no straddling / mid-word style jump); a PHRASE
 *      that straddles a boundary split and clipped to each segment it overlaps
 *      (see `splitCaptionsAcrossWindows`). For a `subtitle` segment the range's
 *      entries are joined into one phrase block.
 *
 * Levers: the segment's `look` (or the top-level look it inherits) resolved
 * under its explicit overrides. `color` / `backgroundColor` are BASE caption
 * fields (not look levers) and ALWAYS inherit the top-level value when the
 * segment doesn't set its own. The LOOK-specific levers (font / weight / outline
 * / spoken-word / casing) reset when a segment names its OWN look — it does NOT
 * inherit the top-level ones — but a segment without a look inherits all of them.
 */
export function resolveCaptionSegments(
  sharedCaptions: readonly Caption[],
  segments: readonly CaptionSegmentInput[],
  defaults: CaptionStyleDefaults,
): ResolvedCaptionSegment[] {
  // ONE membership rule for every word source, resolved for all segments at once
  // because the "keep the longest sliver rather than lose the phrase" rule spans
  // them (see splitCaptionsAcrossWindows).
  const sharedPerSegment = splitCaptionsAcrossWindows(sharedCaptions, segments)
  return segments.map((seg, segIndex): ResolvedCaptionSegment => {
    const style = seg.style ?? defaults.style
    const fontSize = seg.fontSize ?? defaults.fontSize

    const block = (text: string): Caption => ({
      text: text.trim(),
      startMs: seg.startMs,
      endMs: seg.endMs,
      timestampMs: seg.startMs,
      confidence: null,
    })
    // The render used to enforce "a word outside the segment's range is not
    // shown" per word, because each word was visible only inside its own window;
    // the line-based overlays HOLD a line through gaps, so an out-of-range word
    // left in the list would be shown as part of a held/straddling line. Enforce
    // the contract here, where the words are chosen — a WORD by the segment its
    // start falls in, a PHRASE clipped to every segment it overlaps.
    const maxWordsPerLine = seg.maxWordsPerLine ?? defaults.maxWordsPerLine
    // The segment's own text on a subtitle is a static block, as at the top level
    // (staticTextCaptionBlock): the cap wraps the text and is not passed on.
    const textBlock = !(seg.captions && seg.captions.length > 0) && !!seg.text && style === "subtitle"
    let captions: Caption[]
    if (seg.captions && seg.captions.length > 0) {
      captions = splitCaptionsAcrossWindows(seg.captions, [seg])[0]!
    } else if (seg.text) {
      captions = textBlock
        ? [block(wrapToWordCap(seg.text.trim(), maxWordsPerLine))]
        : syntheticCaptionsFromText(seg.text, { startMs: seg.startMs, endMs: seg.endMs })
    } else {
      const shared = sharedPerSegment[segIndex]!
      captions = style === "subtitle" && shared.length > 0
        ? [block(shared.map((c) => c.text.trim()).join(" "))]
        : shared
    }

    const segExplicit = explicitLevers(seg)
    const look = seg.look ?? defaults.look
    // `color` / `backgroundColor` are BASE caption fields, not kinetic-only look
    // levers (they apply to subtitle too, and are absent from
    // KINETIC_ONLY_CAPTION_LEVER_KEYS) — so they ALWAYS inherit the top-level value
    // when the segment doesn't set its own, regardless of the segment's look.
    const inheritedBase: CaptionLookLevers = {
      ...(defaults.explicit.color !== undefined ? { color: defaults.explicit.color } : {}),
      ...(defaults.explicit.backgroundColor !== undefined ? { backgroundColor: defaults.explicit.backgroundColor } : {}),
    }
    // A segment that names its OWN look starts fresh from that preset's LOOK levers
    // (font / weight / outline / spoken-word / casing) — it does NOT inherit the
    // top-level LOOK levers — but keeps the inherited base above; a segment without
    // a look inherits the whole top-level explicit set. Both sides are only-defined,
    // so the spread never clobbers with undefined.
    const explicit = seg.look
      ? { ...inheritedBase, ...segExplicit }
      : { ...defaults.explicit, ...segExplicit }
    // Bare `subtitle` segment (no own or inherited look) stays PLAIN, same as the
    // top-level rule — shared helper so the two can't drift.
    const levers = resolveCaptionLevers(style, look, explicit, fontSize)

    return {
      startMs: seg.startMs,
      endMs: seg.endMs,
      style,
      position: seg.position ?? defaults.position,
      // `positionY` OVERRIDES `position` at render, so an INHERITED positionY must
      // not beat a placement the segment asked for itself: an intro segment with
      // `position: "top"` under a top-level `positionY: 85` rendered at 85 % (the
      // explicit choice lost to a default). Inherit the top-level positionY only
      // when the segment names no placement of its own.
      positionY: seg.positionY ?? (seg.position !== undefined ? undefined : defaults.positionY),
      fontSize,
      // Per-word motion: the segment's own, else the top-level default (inert on
      // a subtitle segment, which has no motion to switch off).
      animate: seg.animate ?? defaults.animate,
      // Words per line: the segment's own, else the top-level cap.
      maxWordsPerLine: textBlock ? undefined : maxWordsPerLine,
      ...levers,
      captions,
    }
  })
}

/**
 * Does this render actually need per-WORD timings, or will phrase lines do?
 *
 * Only the kinetic styles move word by word. A `subtitle` — top level or
 * per segment — draws whole lines and the Remotion SubtitleOverlay groups and
 * holds them itself, so phrase-level segments from the transcription lane are
 * enough. That difference decides whether a word-incapable lane (whisper) can
 * serve the render at all, so the ROUTE (which refuses an impossible request at
 * ingress) and the WORKER (which asks the lane for word timings, or doesn't)
 * must answer it identically — hence one function, called by both.
 *
 * With segments, only the segments that fall back to the SHARED transcript
 * count: a segment carrying its own `text` / `captions[]` is self-sourced and
 * says nothing about what the transcription has to deliver.
 */
export function captionsNeedWordTimings(input: {
  style?: string
  segments?: ReadonlyArray<{ style?: string; text?: string; captions?: readonly unknown[] }>
}): boolean {
  const topStyle = input.style ?? "subtitle"
  if (input.segments && input.segments.length > 0) {
    return input.segments.some(
      (s) => !(s.text || (s.captions && s.captions.length > 0)) && isKineticCaptionStyle(s.style ?? topStyle),
    )
  }
  return isKineticCaptionStyle(topStyle)
}

/**
 * The render's fps = the SOURCE clip's fps. Burning captions re-encodes the
 * video through Remotion, so rendering a 24 fps clip at a hardcoded 30 re-times
 * every frame (judder, and a duration that no longer matches the source). Round
 * a probed rate to a whole number and clamp it into the plan's accepted band;
 * an unknown rate (probe failed, or the container reports "0/0") keeps the
 * historical 30.
 */
export function captionRenderFps(probedFps: number | undefined): number {
  if (probedFps === undefined || !Number.isFinite(probedFps) || probedFps <= 0) return BURN_CAPTIONS_FPS_FALLBACK
  return Math.min(BURN_CAPTIONS_FPS_MAX, Math.max(BURN_CAPTIONS_FPS_MIN, Math.round(probedFps)))
}

/**
 * Second fallback to the historical 30: the plan's frame budget is finite, and
 * it is only checked when the render plan VALIDATES — after credits are reserved
 * and after any paid transcription. A long clip at a high source rate would blow
 * `BURN_CAPTIONS_MAX_FRAMES` (a 31-minute 60 fps source is 111,600 frames, past
 * the cap; the same clip at 30 is 55,800 and renders), so it renders at the rate
 * this node used before it followed the source instead of failing paid.
 */
export function captionRenderFpsWithinFrameCap(fps: number, durationSeconds: number): number {
  if (fps <= BURN_CAPTIONS_FPS_FALLBACK) return fps
  return Math.ceil(durationSeconds * fps) > BURN_CAPTIONS_MAX_FRAMES ? BURN_CAPTIONS_FPS_FALLBACK : fps
}

/**
 * Segments must be sorted and non-overlapping. Returns an error string naming
 * the first offending pair, or null when the set is valid. `startMs < endMs`
 * per segment is enforced by the route Zod; this is the cross-segment rule.
 */
export function findSegmentOverlap(
  segments: readonly { startMs: number; endMs: number }[],
): string | null {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.startMs < sorted[i - 1]!.endMs) {
      return `segments overlap: [${sorted[i - 1]!.startMs}, ${sorted[i - 1]!.endMs}) and [${sorted[i]!.startMs}, ${sorted[i]!.endMs})`
    }
  }
  return null
}
