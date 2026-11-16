/**
 * Edit with AI: the editing decisions, as pure functions.
 *
 * What the person asked for, the pauses and filler words in a transcript, the
 * caption cues, and where a moment of the media sits on the editor's timeline
 * now. The run (`run-ai-edit.ts`) feeds these to the editor; nothing here
 * talks to the editor or the server.
 */
import { z } from "zod"

/** A spoken word, in seconds of the media, with who said it when the transcript tells the voices apart. */
export interface TimedWord {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly speaker?: string
}

export interface SecondsRange {
  readonly start: number
  readonly end: number
}

export interface CaptionCue {
  readonly text: string
  readonly start: number
  readonly end: number
  /** The cue's words with their own times: the spoken word can be highlighted as it is said. */
  readonly words?: readonly TimedWord[]
}

/** Everything Edit with AI can do to a video, in the order the cards show them. */
export const EDIT_STEPS = [
  "pauses",
  "fillers",
  "mistakes",
  "captions",
  "music",
  "broll",
  "titles",
  "picture",
  "color",
  "zoom",
  "phone",
  "layout",
  "cameras",
  "clips",
  "trailer",
  "chapters",
] as const
export type EditStep = (typeof EDIT_STEPS)[number]

/** The color looks the Color agent knows. */
export const LOOKS = ["warm", "cool", "vivid", "bw"] as const
export type Look = (typeof LOOKS)[number]

/** A change inside the picture: what to do, for the video model (in English), and what it touches, in the person's words. */
export interface PictureChange {
  readonly instruction: string
  readonly what: string | null
}

/** What the plan's steps need beyond their names. */
export interface PlanParams {
  /** What the music should sound like (English, for the music model). */
  readonly musicStyle: string | null
  readonly picture: PictureChange | null
  readonly look: Look
  /** How many short clips to make. */
  readonly clips: number
  /** How the speakers are laid out, for the speaker layout. */
  readonly layout: SpeakerLayoutKind
}

/** The speaker layouts: stacked, side by side, a grid, or one large with the others small. */
export const SPEAKER_LAYOUT_KINDS = ["stacked", "side", "grid", "pip"] as const
export type SpeakerLayoutKind = (typeof SPEAKER_LAYOUT_KINDS)[number]

export interface EditPlan {
  readonly steps: readonly EditStep[]
  readonly params: PlanParams
  /** A short answer to the person, in the language they wrote in. Null when none. */
  readonly reply: string | null
  /** What the request asked for that this edit cannot do, in the person's words. Empty when nothing. */
  readonly cannot: readonly string[]
}

export const DEFAULT_MUSIC_STYLE = "upbeat modern background music, light percussion, positive, instrumental"

// ── the transcript ───────────────────────────────────────────────────────────

const transcriptJson = z.object({
  words: z.array(z.object({ text: z.string(), startMs: z.number(), endMs: z.number(), speaker: z.string().optional() }).passthrough()),
}).passthrough()

/**
 * The timed words of a transcription job's `json` output (milliseconds, see
 * `Transcript` in `@nodaro/shared`), in seconds, in order, without blanks.
 */
export function wordsFromTranscript(json: unknown): TimedWord[] {
  const parsed = transcriptJson.safeParse(json)
  if (!parsed.success) return []
  return parsed.data.words
    .map((w) => ({ text: w.text.trim(), start: w.startMs / 1000, end: w.endMs / 1000, ...(w.speaker ? { speaker: w.speaker } : {}) }))
    // A word can be timed with no length ("I" said fast); it is still a word to caption.
    .filter((w) => w.text.length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start)
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
 * Hesitation sounds, by the language the video is spoken in. Only sounds that
 * are never a word of their own in that language: "ah", "あの" or "그" can be
 * speech, and "um" is a word in Portuguese ("um carro") and German ("um 8 Uhr"),
 * so each language cuts only its own sounds.
 */
const FILLERS_BY_LANGUAGE: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "hmm", "mmm"]),
  he: new Set(["אממ", "אמממ", "אמ", "אהה", "אההה", "ממ", "מממ", "הממ"]),
  ja: new Set(["えー", "えーと", "えっと", "あのー", "うーん"]),
  ko: new Set(["음", "으음"]),
  pt: new Set(["hã", "ãh", "ahn", "hum", "humm"]),
}

/** Sounds that are a word in none of the languages served: cut whatever the language, or when it is not known. */
const UNIVERSAL_FILLERS: ReadonlySet<string> = new Set(["umm", "uhh", "uhm", "erm", "hmm", "mmm"])

// The transcriber answers ISO 639-3 ("eng"); other engines answer "en" or "pt-BR".
const LANGUAGE_3_TO_2: Readonly<Record<string, string>> = { eng: "en", heb: "he", jpn: "ja", kor: "ko", por: "pt" }

/** The language a transcript says it is in, as a two-letter code; null when it does not say. */
export function transcriptLanguage(json: unknown): string | null {
  const raw = (json as { language?: unknown } | null)?.language
  if (typeof raw !== "string") return null
  const code = raw.trim().toLowerCase().split(/[-_]/)[0] ?? ""
  return LANGUAGE_3_TO_2[code] ?? (/^[a-z]{2}$/.test(code) ? code : null)
}

const normalizeWord = (text: string) => text.toLowerCase().replace(/[\p{P}\p{S}]+/gu, "").trim()

/** A hesitation sound in `language` (a two-letter code), or one that is a word in no language. */
export function isFillerWord(word: TimedWord, language: string | null): boolean {
  const text = normalizeWord(word.text)
  return UNIVERSAL_FILLERS.has(text) || (language ? FILLERS_BY_LANGUAGE[language]?.has(text) === true : false)
}

/** The filler words, each as a range of its own sound. */
export function fillerRanges(words: readonly TimedWord[], language: string | null): Array<SecondsRange & { readonly word: string }> {
  return words.filter((w) => isFillerWord(w, language)).map((w) => ({ start: Math.max(0, w.start - 0.03), end: w.end + 0.03, word: w.text }))
}

// ── captions ─────────────────────────────────────────────────────────────────

/** The shortest a caption is: the editor refuses one that ends where it starts. */
const MIN_CUE_SECONDS = 0.1

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
    // Hold the caption a little past the last word, never into the next one, and
    // never shorter than a moment: a word timed with no length still gets one.
    const held = next ? Math.min(end + 0.25, next.start) : end + 0.25
    return { text: joinWords(group), start: group[0]!.start, end: Math.max(held, end, group[0]!.start + MIN_CUE_SECONDS), words: group }
  })
}

/** The words spoken inside a range of the media, in order. */
export const wordsIn = (words: readonly TimedWord[], range: SecondsRange) => words.filter((w) => w.start >= range.start - 0.01 && w.end <= range.end + 0.01)

/** The ranges left after cutting `cuts` out of `whole`: what will still play. */
export function keptRanges(whole: SecondsRange, cuts: readonly SecondsRange[]): SecondsRange[] {
  const kept: SecondsRange[] = []
  let at = whole.start
  for (const cut of mergeRanges(cuts, 0)) {
    if (cut.end <= at || cut.start >= whole.end) continue
    if (cut.start > at) kept.push({ start: at, end: Math.min(cut.start, whole.end) })
    at = Math.max(at, cut.end)
  }
  if (at < whole.end) kept.push({ start: at, end: whole.end })
  return kept.filter((r) => r.end - r.start > 0.01)
}

// ── the timeline ─────────────────────────────────────────────────────────────

/** A visual item's place on the canvas, in pixels: x and y from the canvas center. */
export interface ItemTransform {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** An item as the editor reports it (NODARO_GET_TIMELINE). */
export interface TimelineItemView {
  readonly id: string
  readonly type: string
  readonly trackId: string
  readonly from: number
  readonly durationInFrames: number
  readonly label?: string
  /** What a text item says. */
  readonly text?: string
  readonly mediaId?: string
  readonly sourceStart?: number
  readonly sourceEnd?: number
  readonly sourceFps?: number
  readonly speed?: number
  readonly transform?: ItemTransform
}

export interface TrackView {
  readonly id: string
  readonly kind?: string
  readonly order?: number
  readonly syncLock?: boolean
}

export interface MediaView {
  readonly id: string
  readonly fileName?: string
  readonly mimeType?: string
  readonly duration?: number
  readonly width?: number
  readonly height?: number
}

export interface MarkerView {
  readonly id: string
  readonly frame: number
  readonly label?: string
  readonly color?: string
}

/** A timeline tab beside the main edit; none `active` means the main edit is open. */
export interface SequenceView {
  readonly id: string
  readonly name?: string
  readonly durationInFrames?: number
  readonly active?: boolean
}

export interface TimelineView {
  readonly fps: number
  readonly durationInFrames: number
  readonly items: readonly TimelineItemView[]
  /** The canvas, when the editor says it. */
  readonly width?: number
  readonly height?: number
  readonly tracks?: readonly TrackView[]
  readonly media?: readonly MediaView[]
  /** Where the playhead is. */
  readonly currentFrame?: number
  readonly markers?: readonly MarkerView[]
  readonly sequences?: readonly SequenceView[]
}

const transformView = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).passthrough()

const timelineView = z.object({
  fps: z.number().positive(),
  durationInFrames: z.number().nonnegative(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  tracks: z.array(z.object({ id: z.string(), kind: z.string().optional(), order: z.number().optional(), syncLock: z.boolean().optional() }).passthrough()).optional(),
  media: z.array(z.object({ id: z.string(), fileName: z.string().optional(), mimeType: z.string().optional(), duration: z.number().optional(), width: z.number().optional(), height: z.number().optional() }).passthrough()).optional(),
  currentFrame: z.number().optional(),
  markers: z.array(z.object({ id: z.string(), frame: z.number(), label: z.string().optional(), color: z.string().optional() }).passthrough()).optional(),
  sequences: z.array(z.object({ id: z.string(), name: z.string().optional(), durationInFrames: z.number().optional(), active: z.boolean().optional() }).passthrough()).optional(),
  items: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      trackId: z.string(),
      from: z.number(),
      durationInFrames: z.number(),
      label: z.string().optional(),
      text: z.string().optional(),
      mediaId: z.string().optional(),
      sourceStart: z.number().optional(),
      sourceEnd: z.number().optional(),
      sourceFps: z.number().optional(),
      speed: z.number().optional(),
      transform: transformView.optional(),
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
