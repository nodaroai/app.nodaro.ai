/**
 * The creative pass: one structured model call over what was said, for the
 * choices that need the meaning of the words: where b-roll belongs and what it
 * shows, which lines deserve a zoom, how the music should sound, and, when the
 * platform cannot plan one, which moments make a trailer.
 *
 * It runs once the video was heard, beside the Cutter, and only for the steps
 * that need it.
 */
import { llmStructuredApi } from "@/lib/api"
import { z } from "zod"
import type { TimedWord } from "../edit-plan"
import { TITLE_KINDS, type TitleKind } from "../title-style"
import type { RunContext } from "./context"

export const CREATIVE_MODEL = "claude-sonnet-5.5"
/** No effort is named: on this model a named effort moves the call to a dearer lane, and its own default reasons enough. */
export const CREATIVE_EFFORT: "low" | undefined = undefined

/** A sentence of the video, in media seconds. */
export interface Sentence {
  readonly index: number
  readonly start: number
  readonly end: number
  readonly text: string
}

/** The video's words as sentences: broken at sentence ends and at long pauses. */
export function sentencesOf(words: readonly TimedWord[], maxWords = 40): Sentence[] {
  const out: Sentence[] = []
  let current: TimedWord[] = []
  const flush = () => {
    if (current.length === 0) return
    out.push({ index: out.length, start: current[0]!.start, end: current.at(-1)!.end, text: current.map((w) => w.text).join(" ") })
    current = []
  }
  for (const word of words) {
    const last = current.at(-1)
    if (last && (word.start - last.end > 0.7 || current.length >= maxWords)) flush()
    current.push(word)
    if (/[.!?。！？]$/u.test(word.text)) flush()
  }
  flush()
  return out
}

const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")

/**
 * Where a few quoted words are said inside a sentence, in media seconds: the
 * words in a row that match the quote, else the first word the quote names,
 * else the whole sentence. A sentence can run fifteen seconds; a picture
 * belongs on its own words, not on the sentence's first.
 */
export function wordsSpan(words: readonly TimedWord[], sentence: Sentence, quote: string): { readonly start: number; readonly end: number } {
  const inside = words.filter((w) => w.start >= sentence.start - 0.001 && w.end <= sentence.end + 0.001)
  const said = inside.map((w) => plain(w.text))
  const asked = quote.split(/\s+/).map(plain).filter(Boolean)
  if (asked.length === 0 || inside.length === 0) return { start: sentence.start, end: sentence.end }
  for (let i = 0; i + asked.length <= said.length; i += 1) {
    if (asked.every((token, k) => said[i + k] === token)) return { start: inside[i]!.start, end: inside[i + asked.length - 1]!.end }
  }
  // Not word for word (the model tidied the quote): the first of its longer words that is said here.
  for (const token of asked.filter((a) => a.length >= 4)) {
    const at = said.indexOf(token)
    if (at >= 0) return { start: inside[at]!.start, end: inside[Math.min(inside.length - 1, at + asked.length - 1)]!.end }
  }
  return { start: sentence.start, end: sentence.end }
}

/** The least time between two pictures' first words: a picture is seen before the next one comes. */
export const PICTURE_GAP_SECONDS = 2

/**
 * The pictures in the order they are said, none sooner than two seconds after
 * the one before (a sentence may hold several, on different words), each
 * allowed to stay until its sentence ends or the next picture comes.
 */
export function spaced<T extends { readonly sentence: Sentence; readonly start: number }>(list: readonly T[], gap = PICTURE_GAP_SECONDS): Array<T & { readonly until: number }> {
  const kept: T[] = []
  for (const item of [...list].sort((a, b) => a.start - b.start)) {
    const last = kept[kept.length - 1]
    if (!last || item.start - last.start >= gap) kept.push(item)
  }
  return kept.map((item, i) => ({ ...item, until: Math.min(item.sentence.end, kept[i + 1]?.start ?? Infinity) }))
}

/** The least time between two texts on the screen. */
export const TITLE_GAP_SECONDS = 4

/** One text for the screen, as the creative pass chose it. */
export interface TitleChoice {
  readonly sentence: Sentence
  readonly kind: TitleKind
  /** What it says; a list's lines are separated by a line break. */
  readonly text: string
  /** The words of the text to color. */
  readonly key: string
  /** Under a number: what it counts. */
  readonly sub: string
  /** The seconds of the words it comes in on. */
  readonly start: number
  readonly end: number
  /** It may stay until here: its sentence's end, or the next text. */
  readonly until: number
}

const tokens = (text: string) => text.trim().split(/\s+/).filter(Boolean)

/** The model's text made fit for the screen: short, no end punctuation, a list as two to four short lines. Null when nothing is left. */
export function tidyTitle(kind: TitleKind, text: string, key: string, sub: string): { readonly text: string; readonly key: string; readonly sub: string } | null {
  const clean = (s: string, most: number) => tokens(s.replace(/[.。!?！？,،、;:]+$/u, "")).slice(0, most).join(" ")
  if (kind === "list") {
    const lines = text.split(/[|\n]/).map((l) => clean(l, 3)).filter(Boolean).slice(0, 4)
    return lines.length >= 2 ? { text: lines.join("\n"), key: "", sub: "" } : null
  }
  if (kind === "number") {
    const figure = tokens(text).slice(0, 2).join(" ")
    return /\p{N}/u.test(figure) ? { text: figure, key: "", sub: clean(sub, 4) } : null
  }
  const line = clean(text, 6)
  return line ? { text: line, key: clean(key, 2), sub: "" } : null
}

interface RawTitle {
  readonly sentence: number
  readonly words?: string
  readonly kind?: string
  readonly text: string
  readonly key?: string
  readonly sub?: string
}

/** The model's texts as the run lays them: each on a real sentence, made fit for the screen, on its words, four seconds apart. */
export function titlesOf(raw: readonly RawTitle[], at: (index: number) => Sentence | undefined, words: readonly TimedWord[], count: number): TitleChoice[] {
  const kindOf = (kind: string | undefined): TitleKind => ((TITLE_KINDS as readonly string[]).includes(kind ?? "") ? (kind as TitleKind) : "words")
  return spaced(
    raw.flatMap((t) => {
      const sentence = at(t.sentence)
      const kind = kindOf(t.kind)
      const tidy = sentence ? tidyTitle(kind, t.text, t.key ?? "", t.sub ?? "") : null
      return sentence && tidy ? [{ sentence, kind, ...tidy, ...wordsSpan(words, sentence, t.words ?? "") }] : []
    }),
    TITLE_GAP_SECONDS,
  ).slice(0, count)
}

export interface CreativeNeeds {
  readonly broll: boolean
  /** How many cutaways: by the video's length, or the person's own number. */
  readonly brollCount?: number
  /** Texts that come onto the screen on the words, and how many. */
  readonly titles?: boolean
  readonly titleCount?: number
  readonly zoom: boolean
  readonly musicStyle: boolean
  readonly trailer: boolean
  /** The person's request, so the choices follow it. */
  readonly request: string
}

export interface CreativeChoices {
  readonly musicStyle: string | null
  /** Each cutaway: its sentence, what it shows, and the seconds of the words it belongs on. */
  readonly broll: ReadonlyArray<{ readonly sentence: Sentence; readonly prompt: string; readonly label: string; readonly start: number; readonly end: number; /** It may stay until here: its sentence's end, or the next picture. */ readonly until: number }>
  readonly titles: readonly TitleChoice[]
  readonly zoom: readonly Sentence[]
  readonly trailer: ReadonlyArray<{ readonly start: number; readonly end: number }>
}

const answer = z.object({
  musicStyle: z.string().optional(),
  broll: z.array(z.object({ sentence: z.number(), words: z.string().optional(), prompt: z.string(), label: z.string().optional() })).optional(),
  titles: z.array(z.object({ sentence: z.number(), words: z.string().optional(), kind: z.string().optional(), text: z.string(), key: z.string().optional(), sub: z.string().optional() })).optional(),
  zoom: z.array(z.object({ sentence: z.number() })).optional(),
  trailer: z.array(z.object({ from: z.number(), to: z.number() })).optional(),
})

const SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    musicStyle: { type: "string" },
    broll: { type: "array", items: { type: "object", properties: { sentence: { type: "integer" }, words: { type: "string" }, prompt: { type: "string" }, label: { type: "string" } }, required: ["sentence", "words", "prompt", "label"] } },
    titles: { type: "array", items: { type: "object", properties: { sentence: { type: "integer" }, words: { type: "string" }, kind: { type: "string", enum: [...TITLE_KINDS] }, text: { type: "string" }, key: { type: "string" }, sub: { type: "string" } }, required: ["sentence", "words", "kind", "text", "key", "sub"] } },
    zoom: { type: "array", items: { type: "object", properties: { sentence: { type: "integer" } }, required: ["sentence"] } },
    trailer: { type: "array", items: { type: "object", properties: { from: { type: "integer" }, to: { type: "integer" } }, required: ["from", "to"] } },
  },
  required: ["musicStyle", "broll", "titles", "zoom", "trailer"],
}

function systemPrompt(needs: CreativeNeeds, sentences: number): string {
  const lines = [
    "You make editing choices for a talking video from its transcript, given as numbered sentences with their times.",
    `There are ${sentences} sentences. Refer to sentences only by their numbers.`,
  ]
  lines.push(
    needs.broll
      ? `"broll": ${needs.brollCount ?? 4} moments that a short cutaway shot would make stronger, spread over the video and never the first sentence. A long sentence may hold more than one, on different words, at least two seconds apart.` + ' For each: "sentence", "words" (the two to five words of that sentence the picture belongs on, copied exactly as written there: the picture appears as they are said), "prompt" (an English image prompt for a photorealistic cutaway that shows what is being said: a concrete scene. When the words are about a named public figure, company, product or place, name it in the prompt and show it, as a news photo would. No written text in the image), and "label" (2 to 4 words, in the language of the transcript).'
      : '"broll": an empty list.',
  )
  lines.push(
    needs.titles
      ? `"titles": ${needs.titleCount ?? 2} short texts to put on the screen as they are said, spread over the video, at least four seconds apart, written in the language of the transcript.` +
          ' For each: "sentence"; "words" (the two to five words of that sentence the text comes in on, copied exactly as written there); "kind": "headline" (what the video is about: at most one, and only from the first sentences), "words" (a strong line), "number" (a figure that is said) or "list" (the speaker counts off items); "text": for a headline or words, the line itself, at most five words and no end punctuation; for a number, only the figure with its sign or unit, like 37% or $2M; for a list, its two to four items, each one to three words, separated by |; "key": the one or two words of "text" to show in color, copied from it (empty for a number and a list); "sub": for a number, what the figure counts, at most four words (else empty).'
      : '"titles": an empty list.',
  )
  lines.push(needs.zoom ? '"zoom": the 3 to 6 key lines worth a punch-in zoom (strong statements, punchlines, the main point), spread over the video.' : '"zoom": an empty list.')
  lines.push(needs.musicStyle ? '"musicStyle": background music for this video in English for a music generator (genre, mood, instruments, energy), always instrumental, at most 20 words, following the request.' : '"musicStyle": an empty string.')
  lines.push(
    needs.trailer
      ? '"trailer": 3 to 6 ranges of consecutive sentences ("from", "to", inclusive) that together make a 20 to 40 second teaser: a hook first, the strongest moments, no spoilers of the ending. In the order they should play.'
      : '"trailer": an empty list.',
  )
  return lines.join("\n")
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

export async function creativePass(ctx: RunContext, words: readonly TimedWord[], needs: CreativeNeeds): Promise<CreativeChoices> {
  const sentences = sentencesOf(words)
  const empty: CreativeChoices = { musicStyle: null, broll: [], titles: [], zoom: [], trailer: [] }
  if (sentences.length === 0) return empty
  const input = [`Request: ${needs.request}`, "", ...sentences.map((s) => `${s.index}. [${clock(s.start)}] ${s.text}`)].join("\n").slice(0, 60_000)
  const { output } = await llmStructuredApi({
    system: systemPrompt(needs, sentences.length),
    input,
    jsonSchema: SCHEMA,
    schemaName: "edit_choices",
    llmModel: CREATIVE_MODEL,
    reasoningEffort: CREATIVE_EFFORT,
    signal: ctx.signal,
  })
  const parsed = answer.safeParse(output)
  if (!parsed.success) return empty
  const at = (i: number) => sentences[Math.round(i)]
  const seen = new Set<number>()
  const unique = <T extends { readonly sentence: Sentence }>(list: T[]) => list.filter((x) => !seen.has(x.sentence.index) && seen.add(x.sentence.index))
  const broll = spaced(
    (parsed.data.broll ?? [])
      .map((b) => ({ sentence: at(b.sentence), words: b.words ?? "", prompt: b.prompt.trim().slice(0, 600), label: (b.label ?? "").trim().slice(0, 40) }))
      .filter((b): b is { sentence: Sentence; words: string; prompt: string; label: string } => !!b.sentence && b.prompt.length > 0)
      .map((b) => ({ sentence: b.sentence, prompt: b.prompt, label: b.label, ...wordsSpan(words, b.sentence, b.words) })),
  ).slice(0, needs.brollCount ?? 4)
  const titles = needs.titles ? titlesOf(parsed.data.titles ?? [], at, words, needs.titleCount ?? 2) : []
  const zoom = unique((parsed.data.zoom ?? []).map((z) => ({ sentence: at(z.sentence) })).filter((z): z is { sentence: Sentence } => !!z.sentence)).map((z) => z.sentence).slice(0, 6)
  const trailer = needs.trailer
    ? (parsed.data.trailer ?? [])
        .map((r) => ({ from: at(Math.min(r.from, r.to)), to: at(Math.max(r.from, r.to)) }))
        .filter((r): r is { from: Sentence; to: Sentence } => !!r.from && !!r.to)
        .map((r) => ({ start: r.from.start, end: r.to.end }))
        .slice(0, 6)
    : []
  const style = parsed.data.musicStyle?.trim()
  return { musicStyle: needs.musicStyle && style ? style.slice(0, 300) : null, broll, titles, zoom, trailer }
}
