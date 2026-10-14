import type { Caption } from "@remotion/captions"
import { isBareDashToken, trimEdgeDashTokens, type SupportedFontName } from "@nodaro/shared/captions"

/**
 * Grouping word-timed captions into LINES, and picking the line that is on
 * screen at a given ms.
 *
 * Why this exists: a word-level overlay that keys visibility off each word's
 * own [startMs, endMs] goes BLANK in every inter-word pause — on a real 25 s
 * clip with 580-720 ms pauses, 37 of 125 sampled frames rendered nothing. A
 * line is the unit a viewer reads, so the line stays up through the gaps and
 * only the HIGHLIGHT moves word to word (the CapCut read).
 *
 * Deliberately PURE — no React, no DOM, no measurement. `@remotion/layout-utils`
 * is not installed here, and a deterministic estimate has the second virtue of
 * producing the identical grouping in the render worker and in the canvas
 * preview (a DOM measurement would not, and the two would drift apart).
 */

/** Anything with a spoken window: a word `Caption`, a `CaptionLine`, a page. */
export interface CaptionSpan {
  readonly startMs: number
  readonly endMs: number
}

/** A run of adjacent words that share one on-screen line. */
export interface CaptionLine extends CaptionSpan {
  readonly words: readonly Caption[]
  /** First word's startMs — when the line takes over the screen. */
  readonly startMs: number
  /** Last word's endMs — when the line stops being *spoken* (not when it hides). */
  readonly endMs: number
}

/**
 * Target line width as a fraction of the frame. The overlay's row container
 * spans 90 % (left/right 5 %), so 85 % leaves a margin for the estimate being
 * off on an unusually wide string rather than wrapping to a second line.
 */
export const CAPTION_LINE_WIDTH_FRACTION = 0.85

/** A pause at least this long between two words closes the line — a breath is
 *  where a reader expects the text to turn over. */
export const CAPTION_LINE_BREAK_GAP_MS = 500

/**
 * How long a line stays on screen after its last word — the cap applies to
 * EVERY line, not just the last one. The next line takes over the instant it
 * starts, so any pause shorter than this is bridged seamlessly; a silence
 * longer than this clears the caption until the next line starts, instead of
 * burning a stale line in over several seconds of nothing.
 */
export const CAPTION_LINE_MAX_HOLD_MS = 1500

/** Average advance per character, in em, for the faces that differ materially
 *  from the default. Keyed by the `SUPPORTED_FONT_NAMES` display names — the
 *  `satisfies` pins that a typo here can never become a silent miss. */
const CHAR_WIDTH_EM_BY_FACE: Record<string, number | undefined> = {
  // Condensed display faces — far narrower than a text sans.
  "Bebas Neue": 0.42,
  "Anton": 0.46,
  "Oswald": 0.48,
  // Geometric sans — wider than the humanist default.
  "Montserrat": 0.59,
  "Poppins": 0.59,
  "Raleway": 0.57,
  // Monospace — every glyph pays the widest advance.
  "Roboto Mono": 0.62,
  "Fira Code": 0.62,
} satisfies Partial<Record<SupportedFontName, number>>

/** Faces with no entry above (Inter, Roboto, Lato, the serifs, the RTL faces). */
const DEFAULT_CHAR_WIDTH_EM = 0.56

/** Caps have no descender-narrow lowercase, so a line of them is ~15 % wider. */
const UPPERCASE_WIDTH_FACTOR = 1.15

/** 800/900 cuts carry visibly more ink per glyph than the 400-700 range. */
const HEAVY_WEIGHT_WIDTH_FACTOR = 1.06
const HEAVY_WEIGHT_THRESHOLD = 800

export interface CaptionFaceMetrics {
  /** A display name from `SUPPORTED_FONT_NAMES`; unknown names take the default. */
  readonly fontFamily?: string
  readonly fontWeight?: number
  readonly uppercase?: boolean
}

/**
 * A deliberately CONSERVATIVE average advance per character (spaces included)
 * for a face/weight/casing combination, in em.
 *
 * Conservative on purpose: the estimate must be at least the real measurement,
 * because overshooting only packs one word fewer onto a line while undershooting
 * wraps to two lines — the bug this module exists to kill. The calibration
 * point is the default `outline` look (Montserrat 900 UPPERCASE), which a real
 * production render measured at ~0.67 em/char and this returns as ~0.72.
 */
export function captionCharWidthEm(metrics: CaptionFaceMetrics): number {
  const { fontFamily, fontWeight, uppercase } = metrics
  let em = (fontFamily ? CHAR_WIDTH_EM_BY_FACE[fontFamily] : undefined) ?? DEFAULT_CHAR_WIDTH_EM
  if (uppercase) em *= UPPERCASE_WIDTH_FACTOR
  if (fontWeight !== undefined && fontWeight >= HEAVY_WEIGHT_THRESHOLD) em *= HEAVY_WEIGHT_WIDTH_FACTOR
  return em
}

export interface CaptionLineBudgetInput extends CaptionFaceMetrics {
  /** Composition width in px (from `useVideoConfig`). */
  readonly frameWidth: number
  readonly fontSize: number
}

/** How many characters fit on one line at this frame width, size and face.
 *  Floored at 6 so a pathological size still groups something readable. */
export function captionLineCharBudget(input: CaptionLineBudgetInput): number {
  const { frameWidth, fontSize } = input
  return Math.max(6, Math.floor((frameWidth * CAPTION_LINE_WIDTH_FRACTION) / (fontSize * captionCharWidthEm(input))))
}

/** A word that ends a sentence, allowing one trailing quote/bracket
 *  (`end."`, `end.)`, `end.]`). A comma does NOT close a line. */
const SENTENCE_END = /[.!?…]["')\]]?$/

/**
 * Captions in TIME order with the blank ones dropped — the canonical order every
 * helper here works in. Nothing upstream guarantees a caller's `captions[]` is
 * start-sorted (the route validates no ordering), and both the grouping and the
 * reverse scans below assume monotonic starts — an unsorted list produced
 * inverted lines that vanished mid-word. Sorts a COPY (stable, so equal starts
 * keep their given order); never mutates the input. Captions whose trimmed text
 * is empty are dropped entirely (they would render as a phantom word and, worse,
 * as a phantom line break).
 */
const orderedWords = (captions: readonly Caption[]): Caption[] =>
  captions.filter((c) => c.text.trim().length > 0).sort((a, b) => a.startMs - b.startMs)

/** The SPEAKER's own phrasing ending between two adjacent words: a sentence-ending
 *  word, or a pause of at least `CAPTION_LINE_BREAK_GAP_MS`. Breaks of this kind
 *  are never moved or crossed by layout (widow control, word caps, paging). */
const captionPhraseEnds = (previous: Caption, next: Caption): boolean =>
  SENTENCE_END.test(previous.text.trim()) || next.startMs - previous.endMs >= CAPTION_LINE_BREAK_GAP_MS

export interface CaptionLineOptions {
  /** Hard cap on WORDS per line, applied ON TOP of the width budget and the
   *  speaker's phrasing. Words are whitespace-separated INSIDE each entry, so a
   *  phrase-level entry counts for every word it holds and one that alone holds
   *  more than the cap is split into sub-phrases first (`splitOversizeEntry`) —
   *  the cap is a promise about words for ANY input, not only for word-level
   *  captions. Unset (or a nonsense value) = width and phrasing decide alone,
   *  which is exactly the pre-lever behaviour. */
  readonly maxWords?: number
  /**
   * Whether an entry whose OWN text is wider than `maxChars` may be split into
   * sub-phrases that fit. Off by default, and only `groupCaptionLines` has a
   * budget to apply (it is inert on `splitCaptionRuns`, which takes none).
   *
   * Why it is a lever and not the rule: the width budget closes a line BETWEEN
   * entries, so on an overlay that paints each entry as one atomic inline-block
   * — word-highlight, karaoke, bouncy — a six-word phrase entry is one box
   * wider than the frame and is simply CUT OFF at both edges (seen on a staging
   * frame: "No re-prompti", "Same wor"). Those three pass `true`.
   *
   * `SubtitleOverlay` must NOT: it joins the line's words into one string in a
   * `white-space: pre-line` block, so the browser wraps it for real, and for a
   * subtitle SEGMENT showing the joined words as one block is the deliberate
   * render. A caller-authored block (text containing "\n") is never split by
   * this rule wherever it is passed — those breaks are the caller's.
   */
  readonly splitToWidth?: boolean
}

/** A usable word cap, or undefined. A 0 / negative / NaN cap would close every
 *  line at once, so it is treated as "no cap" rather than trusted. */
const wordCap = (maxWords: number | undefined): number | undefined =>
  maxWords !== undefined && Number.isFinite(maxWords) && maxWords >= 1 ? Math.floor(maxWords) : undefined

/** The whitespace-separated words inside ONE entry's text. A word-level caption
 *  yields exactly one — which is why counting words is byte-identical to counting
 *  entries on word input. A phrase entry (a caller's multi-word `captions[]`
 *  block, or a phrase chunk from an engine that returns no word timings) yields
 *  all of them, which is what makes the cap mean anything there. */
const entryWords = (text: string): string[] => text.trim().split(/\s+/).filter((word) => word.length > 0)

/** Words on a line / in a run — the unit `maxWords` counts. */
const lineWordCount = (words: readonly Caption[]): number =>
  words.reduce((sum, caption) => sum + entryWords(caption.text).length, 0)

/**
 * One entry's words greedily packed into consecutive chunks that hold at most
 * `maxWords` words AND at most `maxChars` characters (words joined by one space).
 * Either cap may be absent; with only `maxWords` this is exactly
 * `words.slice(i, i + maxWords)`, which is what keeps the word cap's behaviour
 * byte-identical now that the two caps share one chunker.
 *
 * A word longer than `maxChars` gets a chunk of its own rather than being
 * hyphenated or dropped: the first clause never fires on an empty chunk, so the
 * pass always consumes a word and the one allowed overflow is a single word —
 * the same concession `groupCaptionLines` makes for a line.
 */
const chunkEntryWords = (
  words: readonly string[],
  maxWords: number | undefined,
  maxChars: number | undefined,
): string[] => {
  const chunks: string[] = []
  let current: string[] = []
  let length = 0
  for (const word of words) {
    const overWords = maxWords !== undefined && current.length + 1 > maxWords
    const overChars = maxChars !== undefined && length + 1 + word.length > maxChars
    if (current.length > 0 && (overWords || overChars)) {
      chunks.push(current.join(" "))
      current = []
      length = 0
    }
    length = current.length === 0 ? word.length : length + 1 + word.length
    current.push(word)
  }
  if (current.length > 0) chunks.push(current.join(" "))
  return chunks
}

/**
 * One entry re-cut into the given sub-phrases, its time span divided between them
 * in proportion to their CHARACTER length — integer ms, contiguous, the first
 * starting at the entry's `startMs` and the last ending at its `endMs`. A
 * proportional guess is the best available: an entry with no word timings carries
 * none to recover.
 *
 * Sub-phrase text keeps the @remotion/captions delimiter convention the overlays
 * normalise through `captionWord`: every sub-phrase after the first continues
 * mid-phrase and so carries the leading space, and the first keeps whatever the
 * entry itself had.
 *
 * An entry that stays in one piece is returned AS IS (the same object), so
 * per-word input — one word per entry, within any cap of 1 or more, and a single
 * over-wide word being the allowed overflow — is untouched.
 *
 * SINGLE-SOURCED on purpose: both the word cap and the width rule re-cut an entry
 * through here, so a line and a run can never disagree about how a phrase was
 * divided or when each piece is spoken.
 */
const splitEntry = (caption: Caption, chunks: readonly string[]): Caption[] => {
  if (chunks.length <= 1) return [caption]
  const chars = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  // A zero-length or inverted window has nothing to divide: every sub-phrase
  // keeps the entry's own (degenerate) window rather than inventing timings from
  // it — the overlays already render such a window without animating it.
  const span = Math.max(0, caption.endMs - caption.startMs)
  const leading = /^\s/.test(caption.text) ? " " : ""
  let consumed = 0
  return chunks.map((chunk, i) => {
    const startMs = caption.startMs + Math.round((span * consumed) / chars)
    consumed += chunk.length
    return {
      ...caption,
      text: i === 0 ? `${leading}${chunk}` : ` ${chunk}`,
      startMs,
      endMs: i === chunks.length - 1 ? caption.endMs : caption.startMs + Math.round((span * consumed) / chars),
      timestampMs: caption.timestampMs === null ? null : startMs,
    }
  })
}

/**
 * An entry that alone busts a cap, split into sub-phrases that hold.
 *
 * `maxWords`: without this the cap would be a silent no-op on phrase-level
 * captions (the entry is one unit, so nothing can break it) while still being
 * accepted, carried into the plan and charged for.
 *
 * `maxChars`: the width budget closes a line BETWEEN entries, so an entry wider
 * than the budget was never split at all — on the overlays that paint each entry
 * as one atomic `white-space: pre` inline-block it rendered as a single box wider
 * than the frame, cut off at both edges.
 *
 * A caller-authored BLOCK — an entry whose text contains "\n" — is exempt from
 * the WIDTH rule: those breaks are the caller's and the block is rendered as one
 * unit for its whole window (the static `subtitle` `text` of the S1 rule). The
 * word cap's treatment of such an entry is unchanged: a caller who asks for N
 * words per line has asked for a reflow.
 */
const splitOversizeEntry = (
  caption: Caption,
  maxWords: number | undefined,
  maxChars: number | undefined,
): Caption[] => {
  const width = maxChars !== undefined && !caption.text.includes("\n") ? maxChars : undefined
  if (maxWords === undefined && width === undefined) return [caption]
  return splitEntry(caption, chunkEntryWords(entryWords(caption.text), maxWords, width))
}

/** The canonical order (`orderedWords`) with every entry that alone busts a cap
 *  split to fit — what BOTH grouping functions iterate, so a line and a run can
 *  never disagree about how many words they hold. No caps = no split. */
const orderedCappedWords = (
  captions: readonly Caption[],
  maxWords: number | undefined,
  maxChars: number | undefined,
): Caption[] => {
  const ordered = orderedWords(captions)
  return maxWords === undefined && maxChars === undefined
    ? ordered
    : ordered.flatMap((caption) => splitOversizeEntry(caption, maxWords, maxChars))
}

/**
 * Greedy, in-order grouping of word captions into lines. A new line starts
 * before a word when the current line is non-empty AND any of:
 *   - the previous word ended a sentence,
 *   - the pause before this word is at least `CAPTION_LINE_BREAK_GAP_MS`,
 *   - adding this entry's WORDS would push the line past `opts.maxWords` (an
 *     entry holding more than the cap on its own was split into sub-phrases
 *     before the pass, so one always fits a line of its own),
 *   - adding the word (plus its separating space) would exceed `maxChars`.
 *
 * A word longer than `maxChars` therefore gets a line to itself — the first
 * clause never fires on an empty line, and the next word breaks again.
 *
 * With `opts.splitToWidth`, an entry whose OWN text is wider than `maxChars` is
 * likewise split into sub-phrases that fit before the pass, so "every line fits
 * the budget" holds for phrase-level input too and not only for word-level.
 *
 * After the greedy pass, lines split ONLY by layout (width or the word cap) are
 * rebalanced so a phrase never leaves a one-word widow behind, and the rebalance
 * can never push a line past either cap (see `rebalanceBudgetBreaks`).
 */
export function groupCaptionLines(
  captions: readonly Caption[],
  maxChars: number,
  opts: CaptionLineOptions = {},
): CaptionLine[] {
  const maxWords = wordCap(opts.maxWords)
  // `budgetBreak[i]` = line i was closed by LAYOUT (the next word did not fit, or
  // the word cap was reached) rather than by a sentence end or a pause — i.e.
  // line i and i+1 are one phrase that layout split, which is the only kind of
  // break widow control may move.
  const groups: Caption[][] = []
  const budgetBreak: boolean[] = []
  let words: Caption[] = []
  let length = 0
  let wordsOnLine = 0

  const flush = (byBudget: boolean): void => {
    if (words.length === 0) return
    groups.push(words)
    budgetBreak.push(byBudget)
    words = []
    length = 0
    wordsOnLine = 0
  }

  for (const caption of orderedCappedWords(captions, maxWords, opts.splitToWidth === true ? maxChars : undefined)) {
    const text = caption.text.trim()
    const count = entryWords(caption.text).length
    const previous = words[words.length - 1]
    if (previous !== undefined) {
      if (captionPhraseEnds(previous, caption)) flush(false)
      else if ((maxWords !== undefined && wordsOnLine + count > maxWords) || length + 1 + text.length > maxChars) flush(true)
    }
    // A line's length is the sum of its words plus one space between them.
    length = words.length === 0 ? text.length : length + 1 + text.length
    wordsOnLine += count
    words.push(caption)
  }
  flush(false)

  rebalanceBudgetBreaks(groups, budgetBreak, maxChars, maxWords)
  // A line never starts or ends on a lone dash (a spaced "—" the voice timed as a
  // token of its own): it is dropped from the line's edge AFTER the breaks are
  // decided, so the pauses and widths that placed every other word stand. The
  // line is its shown words — the previous line holds through a dropped leading
  // dash — and a line of dashes alone is not shown at all.
  return groups.flatMap((g) => {
    const shown = trimEdgeDashTokens(g, (w) => w.text)
    return shown.length === 0 ? [] : [{ words: shown, startMs: shown[0]!.startMs, endMs: lineEndMs(shown) }]
  })
}

/**
 * The captions split into RUNS at the speaker's own breaks — a sentence end or a
 * pause of at least `CAPTION_LINE_BREAK_GAP_MS` — and at `opts.maxWords` WORDS
 * (an oversize entry is split into sub-phrases first, exactly as in
 * `groupCaptionLines`). A run is the largest stretch a layout unit may span
 * without swallowing a breath:
 * paging a whole transcript in one `createTikTokStyleCaptions` call put a full
 * stop and a 700 ms pause in the MIDDLE of a page, and blanked the caption
 * across the gap. Paging each run separately cannot. Same ordering and
 * blank-skipping as `groupCaptionLines`, so the two never disagree about where a
 * phrase ends.
 *
 * `opts.splitToWidth` is inert here: a run carries no character budget of its own
 * (the tiktok overlay measures nothing), and its pages are cut afterwards by
 * `createTikTokStyleCaptions`, which re-merges tokens that start within
 * `combineTokensWithinMilliseconds` of the page's first — so width sub-phrases
 * would only partly survive it. The width rule stays where a budget exists.
 */
export function splitCaptionRuns(captions: readonly Caption[], opts: CaptionLineOptions = {}): Caption[][] {
  const maxWords = wordCap(opts.maxWords)
  const runs: Caption[][] = []
  let run: Caption[] = []
  let wordsInRun = 0
  for (const caption of orderedCappedWords(captions, maxWords, undefined)) {
    const count = entryWords(caption.text).length
    const previous = run[run.length - 1]
    if (previous !== undefined && (captionPhraseEnds(previous, caption) || (maxWords !== undefined && wordsInRun + count > maxWords))) {
      runs.push(run)
      run = []
      wordsInRun = 0
    }
    run.push(caption)
    wordsInRun += count
  }
  if (run.length > 0) runs.push(run)
  // Same edge rule as `groupCaptionLines`, applied to each run after it is cut.
  return runs.map((r) => trimEdgeDashTokens(r, (c) => c.text)).filter((r) => r.length > 0)
}

/**
 * When a line stops being spoken: the LATEST end among its words — never simply
 * the last word's `endMs`. One bad value there (a caller's `endMs: 0`, or
 * insanely-fast-whisper's `timestamp: [start, null]` on a final chunk cut
 * mid-word, which maps to 0) would otherwise put the whole line's hold window in
 * the past and blank every word in it. A word's end is also floored at its own
 * start, so an inverted window cannot shorten the line.
 */
const lineEndMs = (words: readonly Caption[]): number =>
  words.reduce((end, w) => Math.max(end, w.startMs, w.endMs), 0)

const lineLength = (words: readonly Caption[]): number =>
  words.reduce((sum, w, i) => sum + w.text.trim().length + (i === 0 ? 0 : 1), 0)

/**
 * Widow control. Greedy filling strands the tail of a phrase on its own line
 * ("OK SO I BUILT A WORLD IN NODARO" / "STUDIO."), which reads as a stutter.
 * For each pair of lines split ONLY by layout, move trailing words of the upper
 * line down while the lower line still fits AND the pair gets more balanced.
 * Walks bottom-up so a three-line phrase settles in one pass. Never crosses a
 * sentence end or a pause — those breaks are the speaker's, not the layout's —
 * and never pushes the lower line past `maxChars` or `maxWords`: the caps are
 * promises to the caller, so a rebalance that would break one stops instead.
 */
function rebalanceBudgetBreaks(
  groups: Caption[][],
  budgetBreak: readonly boolean[],
  maxChars: number,
  maxWords: number | undefined,
): void {
  for (let i = groups.length - 2; i >= 0; i--) {
    if (!budgetBreak[i]) continue
    const upper = groups[i]!
    const lower = groups[i + 1]!
    while (upper.length > 1) {
      const moved = upper[upper.length - 1]!
      const before = Math.abs(lineLength(upper) - lineLength(lower))
      const nextUpper = upper.slice(0, -1)
      const nextLower = [moved, ...lower]
      if (lineLength(nextLower) > maxChars) break
      if (maxWords !== undefined && lineWordCount(nextLower) > maxWords) break
      if (Math.abs(lineLength(nextUpper) - lineLength(nextLower)) >= before) break
      upper.pop()
      lower.unshift(moved)
    }
  }
}

/** The line on screen at `ms`, and which of its words is highlighted. */
export interface ActiveCaptionLine {
  readonly line: CaptionLine
  /** Index WITHIN `line.words` of the last word whose startMs has passed.
   *  Never -1 while the line is visible, so a gap keeps the last-spoken word
   *  lit instead of dropping the highlight. */
  readonly activeIndex: number
}

/**
 * Index of the LAST span that has started by `ms` — so the next span takes over
 * the instant it starts, and until then the current one is HELD through the
 * pause after it. Returns -1 before the first span starts, and -1 once `ms` is
 * past that span's `endMs + CAPTION_LINE_MAX_HOLD_MS` (a silence too long to
 * hold through, wherever it falls) — the caption clears instead of burning a
 * stale unit in over several seconds of nothing. `endMs` is floored at `startMs`
 * so one bad upstream value (an `endMs: 0`) cannot put the hold window in the
 * past. `spans` is assumed to be in start order.
 *
 * This is the single hold rule every caption overlay reads: a line
 * (`activeCaptionLine`), a single word (`activeHeldCaption`), a tiktok page.
 */
export function activeHeldIndex(spans: readonly CaptionSpan[], ms: number): number {
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]!
    if (span.startMs > ms) continue
    return ms > Math.max(span.endMs, span.startMs) + CAPTION_LINE_MAX_HOLD_MS ? -1 : i
  }
  return -1
}

/**
 * The line on screen at `ms` (the last one started, held through pauses) and the
 * index of its last-started word.
 */
export function activeCaptionLine(lines: readonly CaptionLine[], ms: number): ActiveCaptionLine | null {
  const index = activeHeldIndex(lines, ms)
  if (index < 0) return null
  const line = lines[index]!
  let activeIndex = 0
  for (let w = line.words.length - 1; w >= 0; w--) {
    if (line.words[w]!.startMs <= ms) {
      activeIndex = w
      break
    }
  }
  return { line, activeIndex }
}

/**
 * The single word on screen at `ms` for a ONE-WORD-AT-A-TIME overlay: the last
 * word that has STARTED, held until the next one starts (capped at
 * `CAPTION_LINE_MAX_HOLD_MS` past its own end).
 *
 * Why not `captions.find(ms in [startMs, endMs])`: word windows do not abut. On
 * a real clip the gaps between one word's end and the next word's start are
 * 40-700 ms, and a membership test renders NOTHING in every one of them — the
 * word-pop overlay strobed. Holding the last-started word is the same rule the
 * line overlays already use, one word wide.
 */
export function activeHeldCaption(captions: readonly Caption[], ms: number): Caption | null {
  // One word at a time, a lone dash would be a "line" that starts and ends on
  // itself: it is never shown, and the word before it holds through its window.
  const ordered = orderedWords(captions).filter((c) => !isBareDashToken(c.text))
  const index = activeHeldIndex(ordered, ms)
  return index < 0 ? null : ordered[index]!
}

/**
 * Whether a unit's own window can drive a CONTINUOUS animation: a strictly
 * increasing, finite `[startMs, endMs]`.
 *
 * Remotion's `interpolate` THROWS on anything else ("inputRange must be strictly
 * monotonically increasing", with non-finite values rejected before that check),
 * and a caption render has no error boundary — one malformed word would fail the
 * whole job. A zero-length word is NORMAL output, not an error: a final
 * transcription chunk cut mid-word maps to `endMs` 0, and `apply-edl` emits
 * zero-width words on purpose. An inverted window is malformed input that must
 * degrade. Neither can sweep, so the caller falls back to the discrete
 * `animate: false` fill.
 */
export const captionWindowSweeps = (span: CaptionSpan): boolean =>
  Number.isFinite(span.startMs) && Number.isFinite(span.endMs) && span.endMs > span.startMs

/**
 * The frame a unit's enter animation springs from, or `null` when its `startMs`
 * is not a usable number — Remotion's `spring` throws `Frame NaN is not finite`,
 * which would take the render down for one bad timing. A caller treats `null` as
 * "already settled" and draws the unit at rest.
 */
export const captionEnterFrame = (startMs: number, frame: number, fps: number): number | null =>
  Number.isFinite(startMs) ? frame - (startMs / 1000) * fps : null

/** The pop a SHORT active word gets. */
export const ACTIVE_WORD_MAX_SCALE = 1.15

/**
 * Horizontal padding every word span carries (each side, in em) — layout room
 * for the active word's pop. A CSS `scale()` grows a word around its centre
 * WITHOUT reserving space, and the only thing between two words is a space glyph
 * of ~0.25 em: on a long word even a 4.6 % pop (~9 px per side at 50 px) ate the
 * whole gap and the row read "Nore-prompting." (verified on a rendered frame —
 * with the scale off the same row had a normal space).
 */
export const CAPTION_WORD_PAD_EM = 0.1

/** A space glyph's advance, in em (Inter/Montserrat are ~0.25-0.28). */
const SPACE_GLYPH_EM = 0.25

/**
 * How far the active word may grow PER SIDE, in em. The resting gap between two
 * words is space + both paddings (~0.45 em); capping the growth at 0.16 em keeps
 * the gap at ~0.29 em while a word is popped — never less than a normal space.
 */
export const ACTIVE_WORD_GROWTH_EM = 0.16

/**
 * The highlight scale for the active word — bounded so the pop can never close
 * the gap to a neighbour, whatever the word's length or face. The word's box is
 * estimated in em (chars x the face's average advance + its space + paddings) and
 * the scale is whatever grows that box by at most `ACTIVE_WORD_GROWTH_EM` per
 * side: short words keep the full pop ("No" → 1.15), long ones taper
 * ("re-prompting." → ~1.04) — they already carry their own weight.
 */
export function activeWordScale(text: string, metrics: CaptionFaceMetrics = {}): number {
  const length = text.trim().length
  if (length === 0) return 1
  const boxEm = length * captionCharWidthEm(metrics) + SPACE_GLYPH_EM + 2 * CAPTION_WORD_PAD_EM
  return Math.min(ACTIVE_WORD_MAX_SCALE, 1 + (2 * ACTIVE_WORD_GROWTH_EM) / boxEm)
}
