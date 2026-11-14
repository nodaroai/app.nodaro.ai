import type { DubbingCaptionFormat } from "@nodaro/shared/media"

/**
 * The caption files of a dub, as text. Pure: nothing is fetched here.
 *
 * A caption file (SRT or WebVTT) is written from cues. Cues are read from a
 * dub's timed lines, or from a WebVTT file a dub keeps: a kept file is read
 * and written again, so both formats say the same cues in one shape.
 *
 * A cue's text is always plain text: markup a WebVTT file carries (voice and
 * style tags) is dropped when it is read and a character it names by
 * reference is read as that character, and the characters WebVTT reserves are
 * escaped when one is written.
 */

/** One caption: when it shows, and what it says. */
export interface CaptionCue {
  /** Whole milliseconds from the start of the media. */
  readonly startMs: number
  /** Never before `startMs`. */
  readonly endMs: number
  /** Plain text, one or more lines, none of them empty. */
  readonly text: string
}

/** A line of speech with its times in seconds, as a dub tells them. */
export interface TimedLine {
  readonly start: number
  readonly end: number
  readonly text: string
}

/** What a captions response is served as. */
export const CAPTION_CONTENT_TYPES: Readonly<Record<DubbingCaptionFormat, string>> = {
  srt: "application/x-subrip; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
}

/** A line's time in milliseconds. A time that is not finite counts as the start of the media. */
const toMs = (seconds: number): number => (Number.isFinite(seconds) ? seconds * 1000 : 0)

/** One line-break style and no empty lines: an empty line ends a cue in both formats. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n")
}

/**
 * A cue that can be written, or none. A text that says nothing makes no cue,
 * and neither does a time that is no whole number of milliseconds a stamp
 * tells exactly: no file may show a time like `NaN` or `1e+21`.
 */
function cueOf(startMs: number, endMs: number, text: string): CaptionCue | null {
  const tidied = tidy(text)
  if (tidied === "") return null
  const start = Math.max(0, Math.round(startMs))
  const end = Math.max(start, Math.round(endMs))
  // The end is never before the start, so the end alone tells of both.
  if (!Number.isSafeInteger(end)) return null
  return { startMs: start, endMs: end, text: tidied }
}

/** The cues of a dub's lines, in the order given. A line that says nothing makes no cue. */
export function linesToCues(lines: readonly TimedLine[]): CaptionCue[] {
  return lines.flatMap((line) => cueOf(toMs(line.start), toMs(line.end), line.text) ?? [])
}

function stamp(ms: number, fraction: "," | "."): string {
  const two = (value: number): string => String(value).padStart(2, "0")
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${two(hours)}:${two(minutes)}:${two(seconds)}${fraction}${String(ms % 1000).padStart(3, "0")}`
}

/** Cues that are safe to write whoever built them. */
const writable = (cues: readonly CaptionCue[]): CaptionCue[] =>
  cues.flatMap((cue) => cueOf(cue.startMs, cue.endMs, cue.text) ?? [])

/** An SRT file. Empty when there is nothing to show. */
export function cuesToSrt(cues: readonly CaptionCue[]): string {
  return writable(cues)
    .map((cue, index) => `${index + 1}\n${stamp(cue.startMs, ",")} --> ${stamp(cue.endMs, ",")}\n${cue.text}\n`)
    .join("\n")
}

const escapeVtt = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** A WebVTT file. A file with no cues is still a valid one. */
export function cuesToVtt(cues: readonly CaptionCue[]): string {
  const blocks = writable(cues).map(
    (cue) => `${stamp(cue.startMs, ".")} --> ${stamp(cue.endMs, ".")}\n${escapeVtt(cue.text)}\n`,
  )
  return ["WEBVTT\n", ...blocks].join("\n")
}

export function cuesToCaptions(cues: readonly CaptionCue[], format: DubbingCaptionFormat): string {
  return format === "vtt" ? cuesToVtt(cues) : cuesToSrt(cues)
}

const TIME = String.raw`(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})`
const TIMING = new RegExp(String.raw`^\s*${TIME}\s+-->\s+${TIME}`)

function stampMs(hours: string | undefined, minutes: string | undefined, seconds: string | undefined, millis: string | undefined): number {
  return ((Number(hours ?? 0) * 60 + Number(minutes ?? 0)) * 60 + Number(seconds ?? 0)) * 1000 + Number(millis ?? 0)
}

const BYTE_ORDER_MARK = 0xfeff

/**
 * The characters a cue's text names by a word. The three that cannot be seen
 * are told by number: typed into a source file they are easy to lose.
 */
const NAMED: ReadonlyMap<string, string> = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", String.fromCharCode(0x00a0)],
  ["lrm", String.fromCharCode(0x200e)],
  ["rlm", String.fromCharCode(0x200f)],
])

/** A character told by a name, or by its number in decimal or in hexadecimal. */
const REFERENCE = /&(?:([A-Za-z][A-Za-z0-9]*)|#(\d+)|#[xX]([0-9a-fA-F]+));/g

const LAST_CODE_POINT = 0x10ffff

/** Zero, half of a surrogate pair and a number past the last code point name no character. */
const isCharacter = (codePoint: number): boolean =>
  codePoint > 0 && codePoint <= LAST_CODE_POINT && (codePoint < 0xd800 || codePoint > 0xdfff)

/**
 * The character a reference names. A name not listed above and a number that
 * names no character stay as they were written.
 */
function characterOf(written: string, name?: string, decimal?: string, hex?: string): string {
  if (name !== undefined) return NAMED.get(name) ?? written
  const codePoint = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? "", 16)
  return isCharacter(codePoint) ? String.fromCodePoint(codePoint) : written
}

/** One pass, so `&amp;lt;` reads as the text `&lt;` and not as `<`. */
const unescapeVtt = (text: string): string => text.replace(REFERENCE, characterOf)

const TAG_OR_REFERENCE = new RegExp(`<[^>]*>|${REFERENCE.source}`, "g")

/**
 * A cue's text as plain text: its tags dropped and its references read, each
 * where it was written and in one pass. So a `<` a file names never opens a
 * tag, and the two parts a tag leaves are never read as one reference. A tag
 * runs from a `<` to the first `>` after it; a `<` nothing closes is text.
 * Only the part up to the last `>` can hold a tag, and looking for tags no
 * further keeps this one pass over the text however many `<` it holds.
 */
function plainText(text: string): string {
  const end = text.lastIndexOf(">") + 1
  const head = text
    .slice(0, end)
    .replace(TAG_OR_REFERENCE, (match: string, name?: string, decimal?: string, hex?: string) =>
      match.startsWith("<") ? "" : characterOf(match, name, decimal, hex),
    )
  return head + unescapeVtt(text.slice(end))
}

/**
 * What parts two blocks: a line break, then one or more lines that are empty
 * or hold only spaces. It is matched as one run of characters, not line by
 * line, so a long stretch of blank lines costs no more memory than a short one.
 */
const BLOCK_BREAK = /\n[ \t\n]*\n/

const ARROW = "-->"

/**
 * The lines of each cue a block holds. A line that holds the time arrow starts
 * a cue wherever it stands, and the cue runs up to the next such line. The
 * lines before the first such line (the header, a note, a style, a cue's name)
 * belong to no cue.
 */
function cueLines(lines: readonly string[]): string[][] {
  const starts = lines.flatMap((line, at) => (line.includes(ARROW) ? [at] : []))
  return starts.map((from, index) => lines.slice(from, starts[index + 1]))
}

/** The cue its lines tell: the first holds the times, the rest is what it says. */
function cueOfLines(lines: readonly string[]): CaptionCue | null {
  const timing = TIMING.exec(lines[0] ?? "")
  if (!timing) return null
  const text = plainText(lines.slice(1).join("\n"))
  const startMs = stampMs(timing[1], timing[2], timing[3], timing[4])
  return cueOf(startMs, stampMs(timing[5], timing[6], timing[7], timing[8]), text)
}

/**
 * The cues of a WebVTT file. Everything that is not a cue (the header, notes,
 * styles, regions, a cue's name) is skipped. A cue starts at a line that holds
 * the time arrow and ends at the next such line or at a blank one, so two cues
 * are read as two with or without an empty line between them.
 */
export function vttToCues(vtt: string): CaptionCue[] {
  return (vtt.charCodeAt(0) === BYTE_ORDER_MARK ? vtt.slice(1) : vtt)
    .replace(/\r\n?/g, "\n")
    .split(BLOCK_BREAK)
    .flatMap((block) => cueLines(block.split("\n")))
    .flatMap((lines) => cueOfLines(lines) ?? [])
}
