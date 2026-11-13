/**
 * Edit with AI: the editing decisions, as pure functions.
 *
 * What the person asked for, the pauses and filler words in a transcript, the
 * caption cues, and where a moment of the media sits on the editor's timeline
 * now. The run (`run-ai-edit.ts`) feeds these to the editor; nothing here
 * talks to the editor or the server.
 */
import { z } from "zod"

/** A spoken word, in seconds of the media. */
export interface TimedWord {
  readonly text: string
  readonly start: number
  readonly end: number
}

export interface SecondsRange {
  readonly start: number
  readonly end: number
}

export interface CaptionCue {
  readonly text: string
  readonly start: number
  readonly end: number
}

/** The steps an edit can take, in the order they run. */
export const EDIT_STEPS = ["fillers", "pauses", "captions", "music"] as const
export type EditStep = (typeof EDIT_STEPS)[number]

export interface EditPlan {
  readonly steps: readonly EditStep[]
  /** What the music should sound like, when the plan adds music. */
  readonly musicStyle: string | null
  /** A short answer to the person, in the language they wrote in. Null when none. */
  readonly reply: string | null
  /** False when the request named nothing this edit can do, and the standard edit was chosen. */
  readonly understood: boolean
}

export const DEFAULT_MUSIC_STYLE = "upbeat modern background music, light percussion, positive, instrumental"

// ── the transcript ───────────────────────────────────────────────────────────

const transcriptJson = z.object({
  words: z.array(z.object({ text: z.string(), startMs: z.number(), endMs: z.number() }).passthrough()),
}).passthrough()

/**
 * The timed words of a transcription job's `json` output (milliseconds, see
 * `Transcript` in `@nodaro/shared`), in seconds, in order, without blanks.
 */
export function wordsFromTranscript(json: unknown): TimedWord[] {
  const parsed = transcriptJson.safeParse(json)
  if (!parsed.success) return []
  return parsed.data.words
    .map((w) => ({ text: w.text.trim(), start: w.startMs / 1000, end: w.endMs / 1000 }))
    .filter((w) => w.text.length > 0 && Number.isFinite(w.start) && w.end > w.start)
    .sort((a, b) => a.start - b.start)
}

// ── ranges ───────────────────────────────────────────────────────────────────

/** Sorted, with overlapping or touching ranges joined and slivers dropped. */
export function mergeRanges(ranges: readonly SecondsRange[], minLength = 0.08): SecondsRange[] {
  const sorted = ranges
    .map((r) => ({ start: Math.max(0, r.start), end: r.end }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start)
  const merged: SecondsRange[] = []
  for (const range of sorted) {
    const last = merged.at(-1)
    if (last && range.start <= last.end + 0.05) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) }
    } else {
      merged.push(range)
    }
  }
  return merged.filter((r) => r.end - r.start >= minLength)
}

export interface PauseOptions {
  /** The shortest silence that counts as a pause. */
  readonly minPause?: number
  /** Silence kept on each side of a cut, so speech never sounds clipped. */
  readonly breath?: number
}

/**
 * The silences worth cutting: before the first word, between words, and after
 * the last, each long enough to count and shrunk by a breath on both sides.
 */
export function pauseRanges(words: readonly TimedWord[], durationSeconds: number, opts: PauseOptions = {}): SecondsRange[] {
  const minPause = opts.minPause ?? 0.7
  const breath = opts.breath ?? 0.12
  if (words.length === 0) return []
  const ranges: SecondsRange[] = []
  const first = words[0]!
  if (first.start >= minPause) ranges.push({ start: 0, end: first.start - breath })
  for (let i = 1; i < words.length; i++) {
    const gapStart = words[i - 1]!.end
    const gapEnd = words[i]!.start
    if (gapEnd - gapStart >= minPause) ranges.push({ start: gapStart + breath, end: gapEnd - breath })
  }
  const last = words.at(-1)!
  if (durationSeconds - last.end >= minPause) ranges.push({ start: last.end + breath, end: durationSeconds })
  return mergeRanges(ranges, 0.2)
}

/**
 * Hesitation sounds in the languages Nodaro speaks: "um", "אממ", "えーと", "음",
 * "hã". Only sounds that are never a word of their own: "ah", "あの" or "그"
 * can be speech, and cutting them would cut the sentence.
 */
const FILLER_WORDS = new Set([
  "um", "umm", "uh", "uhh", "uhm", "erm", "hmm", "mm", "mmm",
  "אממ", "אמממ", "אמ", "אהה", "אההה", "ממ", "מממ", "הממ",
  "えー", "えーと", "えっと", "あのー", "うーん",
  "음", "으음",
  "hã", "ãh", "hum", "ahn",
])

const normalizeWord = (text: string) => text.toLowerCase().replace(/[\p{P}\p{S}]+/gu, "").trim()

export const isFillerWord = (word: TimedWord) => FILLER_WORDS.has(normalizeWord(word.text))

/** The filler words, each as a range of its own sound. */
export function fillerRanges(words: readonly TimedWord[]): Array<SecondsRange & { readonly word: string }> {
  return words.filter(isFillerWord).map((w) => ({ start: Math.max(0, w.start - 0.03), end: w.end + 0.03, word: w.text }))
}

// ── captions ─────────────────────────────────────────────────────────────────

// Scripts written without spaces between words.
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

function joinWords(words: readonly TimedWord[]): string {
  return words.reduce((text, word, index) => {
    if (index === 0) return word.text
    const tight = NO_SPACE_SCRIPT.test(text.slice(-1)) && NO_SPACE_SCRIPT.test(word.text[0] ?? "")
    return tight ? text + word.text : `${text} ${word.text}`
  }, "")
}

export interface CaptionOptions {
  readonly maxWords?: number
  readonly maxChars?: number
  /** A silence this long starts a new caption. */
  readonly breakGap?: number
}

/**
 * Short captions that read along with the voice: a few words each, broken at
 * the end of a sentence, at a pause, and before a line grows too long.
 */
export function captionCues(words: readonly TimedWord[], opts: CaptionOptions = {}): CaptionCue[] {
  const maxWords = opts.maxWords ?? 3
  const maxChars = opts.maxChars ?? 24
  const breakGap = opts.breakGap ?? 0.45
  const groups: TimedWord[][] = []
  let current: TimedWord[] = []
  for (const word of words) {
    const previous = current.at(-1)
    const breaks =
      previous !== undefined &&
      (current.length >= maxWords ||
        word.start - previous.end >= breakGap ||
        /[.!?。！？]$/u.test(previous.text) ||
        joinWords([...current, word]).length > maxChars)
    if (breaks) {
      groups.push(current)
      current = []
    }
    current.push(word)
  }
  if (current.length > 0) groups.push(current)

  return groups.map((group, index) => {
    const next = groups[index + 1]?.[0]
    const end = group.at(-1)!.end
    // Hold the caption a little past the last word, never into the next one.
    const held = next ? Math.min(end + 0.25, next.start) : end + 0.25
    return { text: joinWords(group), start: group[0]!.start, end: Math.max(held, end) }
  })
}

// ── the request ──────────────────────────────────────────────────────────────

// What a request asks for, in the languages Nodaro speaks. Used when the
// planner cannot answer: the model reads the request first.
const INTENT_PATTERNS: Record<EditStep, RegExp> = {
  // `\b` knows only ASCII letters, so a word with accents is bounded by lookarounds instead.
  fillers: /filler|\bums?\b|\buhs?\b|stutter|hesitat|מילות מילוי|אממ|גמגו|היסוס|フィラー|えーと|言い淀|필러|군말|더듬|vícios? de linguagem|muletas?|(?<!\p{L})hã(?!\p{L})/iu,
  pauses: /pause|silen|dead air|\bgaps?\b|tighten|שתיק|הפסק|רווח|שקט|מתים|間を|無音|沈黙|詰め|침묵|공백|쉼|pausa|silênc|silenc|respiro/iu,
  captions: /caption|subtit|text on screen|כתובי|תמליל על|字幕|テロップ|자막|legend/iu,
  music: /music|\bsong\b|soundtrack|\bbeat\b|\bbgm\b|מוזיק|שיר|מנגינ|פסקול|音楽|ＢＧＭ|음악|배경음|브금|música|trilha/iu,
}

/** The plan a request asks for, read from its words alone. */
export function planFromRequest(request: string): EditPlan {
  const steps = EDIT_STEPS.filter((step) => INTENT_PATTERNS[step].test(request))
  if (steps.length === 0) {
    return { steps: ["pauses", "captions", "music"], musicStyle: DEFAULT_MUSIC_STYLE, reply: null, understood: false }
  }
  return { steps, musicStyle: steps.includes("music") ? DEFAULT_MUSIC_STYLE : null, reply: null, understood: true }
}

const modelPlan = z.object({
  steps: z.array(z.string()),
  musicStyle: z.string().max(300).nullable().optional(),
  reply: z.string().max(400).nullable().optional(),
})

/**
 * The planner model's answer (one JSON object, possibly in a code fence), as a
 * plan; null when it is not one. Steps it invents are dropped, and the order is
 * always the run order.
 */
export function parseModelPlan(text: string): EditPlan | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  const parsed = modelPlan.safeParse(raw)
  if (!parsed.success) return null
  const asked = new Set(parsed.data.steps.map((s) => s.trim().toLowerCase()))
  const steps = EDIT_STEPS.filter((step) => asked.has(step))
  if (steps.length === 0) return null
  const style = parsed.data.musicStyle?.trim()
  return {
    steps,
    musicStyle: steps.includes("music") ? style || DEFAULT_MUSIC_STYLE : null,
    reply: parsed.data.reply?.trim() || null,
    understood: true,
  }
}

// ── the timeline ─────────────────────────────────────────────────────────────

/** An item as the editor reports it (NODARO_GET_TIMELINE). */
export interface TimelineItemView {
  readonly id: string
  readonly type: string
  readonly trackId: string
  readonly from: number
  readonly durationInFrames: number
  readonly mediaId?: string
  readonly sourceStart?: number
  readonly sourceEnd?: number
  readonly sourceFps?: number
  readonly speed?: number
}

export interface TimelineView {
  readonly fps: number
  readonly durationInFrames: number
  readonly items: readonly TimelineItemView[]
}

const timelineView = z.object({
  fps: z.number().positive(),
  durationInFrames: z.number().nonnegative(),
  items: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      trackId: z.string(),
      from: z.number(),
      durationInFrames: z.number(),
      mediaId: z.string().optional(),
      sourceStart: z.number().optional(),
      sourceEnd: z.number().optional(),
      sourceFps: z.number().optional(),
      speed: z.number().optional(),
    }).passthrough(),
  ),
}).passthrough()

/** The editor's timeline report, or null when it is not one. */
export function readTimelineView(value: unknown): TimelineView | null {
  const parsed = timelineView.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** The video the person opened: the first video clip that names its media. */
export function primaryVideo(timeline: TimelineView): TimelineItemView | null {
  return timeline.items.filter((i) => i.type === "video" && i.mediaId).sort((a, b) => a.from - b.from)[0] ?? null
}

/**
 * Where a moment of the media is on the timeline now, after any cuts: the frame,
 * and the clip and track it is on. Null when no clip shows that moment.
 */
export function timelineFrameOf(
  timeline: TimelineView,
  mediaId: string,
  seconds: number,
  type = "video",
): { frame: number; itemId: string; trackId: string } | null {
  for (const item of timeline.items) {
    if (item.mediaId !== mediaId || item.type !== type) continue
    const sourceFps = item.sourceFps ?? timeline.fps
    const sourceStart = item.sourceStart ?? 0
    const sourceEnd = item.sourceEnd ?? sourceStart + item.durationInFrames
    const sourceFrame = seconds * sourceFps
    if (sourceFrame < sourceStart || sourceFrame >= sourceEnd) continue
    const speed = item.speed && item.speed > 0 ? item.speed : 1
    const offset = ((sourceFrame - sourceStart) / speed) * (timeline.fps / sourceFps)
    return { frame: Math.round(item.from + offset), itemId: item.id, trackId: item.trackId }
  }
  return null
}

/** How long the timeline runs, in seconds. */
export const timelineSeconds = (timeline: TimelineView) => timeline.durationInFrames / timeline.fps
