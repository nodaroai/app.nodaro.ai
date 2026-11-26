/**
 * The operator's detail for a failed ffmpeg run: how the process ended and the
 * lines in ffmpeg's WHOLE output that name an error.
 *
 * WHY. A failure's message keeps only the last lines of stderr
 * (`ffmpegFailureMessage`, sized to survive `jobs.error_message`'s 500-char
 * cut). Those last lines are often generic: "Terminating thread with return
 * code -22 (Invalid argument)", "Nothing was written into output file",
 * "Conversion failed!" are printed for ANY failure to open the encoder or
 * deliver a first frame. The line that names the cause (`[libx264 @ …] malloc
 * of size … failed`, `width not divisible by 2`, a missing stream) is earlier,
 * and was thrown away. And a run the kernel's out-of-memory killer ended read
 * like any other failure.
 *
 * WHERE IT GOES. Two forms ride on the thrown error:
 *
 * - `internalDetails`, the field `providerDetailOf` (lib/provider-error-detail.ts)
 *   reads into `jobs.error_detail` (capped at 500 there). The job's OWNER can
 *   read that column by default (lib/provider-words.ts), so this form keeps
 *   only a local path's basename and drops filter-graph argument text (a
 *   caption's or a prompt's words reach ffmpeg inside `drawtext=text=…`).
 * - `ffmpegFailureLog`, the whole detail (up to
 *   {@link FFMPEG_FAILURE_DETAIL_MAX_CHARS}) for the worker's own log line
 *   (`ffmpegFailureLogOf`): paths kept, filter-graph text still dropped.
 *
 * Both are redacted like every error detail (links cut to their host, bearer
 * tokens and secret query values). The message — what `jobs.error_message`
 * stores and the person sees — is not changed by this module.
 *
 * Dependency-free on purpose apart from the redaction it reuses: every ffmpeg
 * runner imports it.
 */
import type { Readable } from "node:stream"
import { redactDetailText } from "../../lib/provider-error-detail.js"

/** A line that carries an error, whatever its source. */
const DIAGNOSTIC_LINE =
  /error|invalid|failed|cannot|could not|unable|not (?:supported|divisible|found)|malloc|no such|too (?:large|small)|killed/i
/** A line at ffmpeg's error or fatal level (printed with `-loglevel level+…`, and by codec libraries). */
const ERROR_LEVEL_LINE = /\[(?:error|fatal|panic)\]/i
/** ffmpeg's opening banner: its configure flags would otherwise match the vocabulary above. */
const BANNER_LINE = /^\s*(?:ffmpeg version |ffprobe version |built with |configuration: |lib[a-z]+\s+\d)/

/** At most this many diagnostic lines, each at most this long, the whole detail at most this long. */
export const FFMPEG_DIAGNOSTIC_MAX_LINES = 15
export const FFMPEG_DIAGNOSTIC_LINE_CHARS = 300
export const FFMPEG_FAILURE_DETAIL_MAX_CHARS = 4096

/** ffmpeg rewrites its progress line with `\r`, so a line ends at either. */
const LINE_BREAK = /\r\n|\r|\n/

/**
 * The same line from another instance of a component (`@ 0x56…`), or with
 * other numbers (a decoder's `error while decoding MB 3 12` for every block),
 * is the same line: kept once, so repeated noise cannot crowd out the cause.
 */
function dedupeKey(line: string): string {
  return line.replace(/@ 0x[0-9a-f]+/gi, "@").replace(/-?\d+(?:\.\d+)?/g, "#").replace(/\s+/g, " ").trim()
}

function isDiagnostic(line: string): boolean {
  if (BANNER_LINE.test(line)) return false
  return ERROR_LEVEL_LINE.test(line) || DIAGNOSTIC_LINE.test(line)
}

/** A split graph or URL cannot be sanitized without its beginning. Drop an
 * overlong line through its delimiter instead of joining surviving fragments. */
const RAW_LINE_LIMIT = 8192
const TAIL_LINES = 8

export class FfmpegDiagnostics {
  private readonly kept: string[] = []
  private readonly recent: string[] = []
  private readonly seen = new Set<string>()
  private partial = ""
  private droppingLine = false
  private graphLine = false
  private graphQuote = ""
  private escaped = false
  private continuation = false
  messageTail = ""

  /** Preserve the runner's existing user-message window independently. */
  static capture(stream: Readable, messageChars = 0): FfmpegDiagnostics {
    const diagnostics = new FfmpegDiagnostics()
    stream.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      if (messageChars > 0) diagnostics.messageTail = (diagnostics.messageTail + text).slice(-messageChars)
      diagnostics.push(text)
    })
    return diagnostics
  }

  push(chunk: string): void {
    const parts = chunk.split(LINE_BREAK)
    for (const [i, part] of parts.entries()) {
      if (!this.graphLine && !this.droppingLine && FILTER_CONTEXT.test(this.partial + part.slice(0, RAW_LINE_LIMIT))) {
        this.graphLine = true
        this.trackGraphQuotes(this.partial)
      }
      if (this.graphLine) this.trackGraphQuotes(part)
      if (this.partial.length + part.length > RAW_LINE_LIMIT) this.droppingLine = true
      if (!this.droppingLine) this.partial += part
      if (i < parts.length - 1) this.finishLine()
    }
  }

  // A caption may contain newlines. Continue tracking quotes even while
  // discarding an oversized graph, so its next line cannot enter the tail.
  private trackGraphQuotes(text: string): void {
    for (const char of text) {
      if (this.escaped) this.escaped = false
      else if (char === "\\") this.escaped = true
      else if (this.graphQuote) {
        if (char === this.graphQuote) this.graphQuote = ""
      } else if (char === "'" || char === '"') this.graphQuote = char
    }
  }

  private finishLine(): void {
    const line = this.partial.trim()
    if (!this.droppingLine && !this.continuation && line && !BANNER_LINE.test(line)) {
      // Keep bounded, complete lines. Format only on failure, when each
      // output can redact its own paths before clipping any text.
      this.recent.push(line)
      if (this.recent.length > TAIL_LINES) this.recent.shift()
      if (this.kept.length < FFMPEG_DIAGNOSTIC_MAX_LINES && isDiagnostic(line)) {
        const key = dedupeKey(line)
        if (!this.seen.has(key)) {
          this.seen.add(key)
          this.kept.push(line)
        }
      }
    }
    this.partial = ""
    this.droppingLine = false
    this.continuation = this.graphQuote !== ""
    this.graphLine = this.continuation
    this.escaped = false
  }

  lines(): string[] {
    this.finishLine()
    return this.kept.map(line => capLine(redactDetailText(withoutFilterText(line))))
  }

  fields(exit: FfmpegExit): { internalDetails: string; ffmpegFailureLog: string } {
    this.finishLine()
    const input = { exit, diagnostics: this.kept, tail: this.recent.join("\n") }
    return {
      internalDetails: ffmpegFailureDetail(input),
      ffmpegFailureLog: ffmpegFailureDetail({ ...input, keepPaths: true }),
    }
  }
}

function capLine(line: string): string {
  return line.length > FFMPEG_DIAGNOSTIC_LINE_CHARS ? `${line.slice(0, FFMPEG_DIAGNOSTIC_LINE_CHARS)}…` : line
}

/** The bounded diagnostic lines of a whole stderr. */
export function ffmpegDiagnosticLines(stderr: string | undefined): string[] {
  const diagnostics = new FfmpegDiagnostics()
  if (stderr) diagnostics.push(stderr)
  return diagnostics.lines()
}

/** How the process ended, as far as the runner knows. */
export interface FfmpegExit {
  /** The process's exit code. */
  readonly code?: number | null
  /** The signal that ended it. */
  readonly signal?: string | null
  /** This process sent the signal (its time limit, a stall, its caller's abort); false when it did not;
   *  omitted when the runner cannot tell (the signal is then named without an origin). */
  readonly signalledByUs?: boolean
  /** Why this process stopped it, when it did. */
  readonly stoppedBecause?: string
  /** The launch's own error code when it is not an exit (`ENOENT`, `EAGAIN`: it never ran). */
  readonly processError?: string
}

/** A spawned runner with one watchdog knows whether it sent the signal. */
export function spawnExit(code: number | null, signal: string | null, timedOut: boolean): FfmpegExit {
  return { code, signal, signalledByUs: timedOut, stoppedBecause: timedOut ? "its time limit" : undefined }
}

/** `exit code 234`, `ended by SIGKILL, not sent by this process (…)`, … */
export function describeFfmpegExit(exit: FfmpegExit): string {
  const parts: string[] = []
  if (typeof exit.signal === "string" && exit.signal.length > 0) {
    parts.push(
      exit.signalledByUs === true
        ? `ended by ${exit.signal}, sent by this process${exit.stoppedBecause ? ` (${exit.stoppedBecause})` : ""}`
        : exit.signalledByUs === false
          ? `ended by ${exit.signal}, not sent by this process${exit.signal === "SIGKILL" ? " (the out-of-memory killer or an operator)" : ""}`
          : `ended by ${exit.signal}`,
    )
  } else if (exit.stoppedBecause) {
    parts.push(`stopped by this process (${exit.stoppedBecause})`)
  }
  if (typeof exit.code === "number") parts.push(`exit code ${exit.code}`)
  if (exit.processError) parts.push(`process error ${exit.processError}`)
  return parts.length > 0 ? parts.join(", ") : "exit unknown"
}

/** A line about a filter graph or its options: its quoted parts are graph text. */
const FILTER_CONTEXT = /filter|graph|parsed_|drawtext|subtitles|\bass\b|\bargs\b|option|expr/i
const QUOTED = /'(?:\\.|[^'\\])*(?:'|$)|"(?:\\.|[^"\\])*(?:"|$)/g
/** A filter option whose value is words (a caption, a prompt) or names a file of them. */
const GRAPH_ARGUMENTS = /(\b(?:with args|filterchain|filtergraph|filter description around)[ :]+)(['"]?).*$/i
const TEXT_OPTION = /\b(text|textfile|subtitles|ass)=(?:\\.|[^:\\'"|\]])+/gi

/** `line` without filter-graph argument text. */
export function withoutFilterText(line: string): string {
  // ffmpeg echoes whole filter descriptions, which can already contain
  // nested quotes. Once it introduces the graph, none of the suffix is safe.
  let s = line.replace(GRAPH_ARGUMENTS, (_m, intro: string, quote: string) => `${intro}${quote}<filter graph>${quote}`)
  s = s.replace(TEXT_OPTION, (_m, name: string) => `${name}=<text>`)
  if (FILTER_CONTEXT.test(s)) s = s.replace(QUOTED, (q) => `${q[0]}<filter graph>${q[0]}`)
  return s
}

/** An absolute local path of two or more parts (not a link: links are cut to their host first). */
const LOCAL_PATH = /(^|[\s'"(=,\[])\/(?:[^\r\n'"():,|\]/]+\/)+([^\s'"():,|\]/]+)/g

/** `text` with each absolute local path reduced to `…/<basename>`. */
export function withPathBasenames(text: string): string {
  const quotedPaths = text.replace(/(["'])(\/[^\r\n]*?)\1/g, (_m, quote: string, path: string) =>
    `${quote}…/${path.slice(path.lastIndexOf("/") + 1)}${quote}`)
  return quotedPaths.replace(LOCAL_PATH, (_m, lead: string, base: string) => `${lead}…/${base}`)
}

/**
 * The detail: `ffmpeg <how it ended> | errors: <line> | <line> … | tail: <line> | …`
 * — one line (the column stores one), redacted like every `error_detail`
 * (link paths and queries, bearer tokens, secret query values) and without
 * filter-graph text, at most {@link FFMPEG_FAILURE_DETAIL_MAX_CHARS}. How it
 * ended and the diagnostic lines come first: `error_detail` keeps the first
 * 500 characters. Tail lines already among the diagnostics are not repeated.
 * `keepPaths` (the log form only) keeps local paths whole; else only their
 * basenames are kept (the stored form).
 */
export function ffmpegFailureDetail(input: {
  readonly exit: FfmpegExit
  readonly diagnostics: readonly string[]
  /** Complete recent stderr lines, before the separate user message is shortened. */
  readonly tail: string
  readonly keepPaths?: boolean
}): string {
  const shown = new Set(input.diagnostics.map(dedupeKey))
  const tail = input.tail.split(LINE_BREAK).map((l) => l.trim()).filter((l) => l && !shown.has(dedupeKey(l)))
  const clean = (line: string) => {
    const safe = redactDetailText(withoutFilterText(line))
    return capLine(input.keepPaths ? safe : withPathBasenames(safe))
  }
  const sections = [
    `ffmpeg ${describeFfmpegExit(input.exit)}`,
    ...(input.diagnostics.length > 0 ? [`errors: ${input.diagnostics.map(clean).join(" | ")}`] : []),
    ...(tail.length > 0 ? [`tail: ${tail.map(clean).join(" | ")}`] : []),
  ]
  const text = sections.join(" | ")
  return text.length > FFMPEG_FAILURE_DETAIL_MAX_CHARS ? `${text.slice(0, FFMPEG_FAILURE_DETAIL_MAX_CHARS - 1)}…` : text
}

/** The log form of an ffmpeg failure anywhere on `err`'s cause chain, or undefined. */
export function ffmpegFailureLogOf(err: unknown): string | undefined {
  let cur: unknown = err
  for (let depth = 0; cur && typeof cur === "object" && depth < 8; depth++) {
    const log = (cur as { ffmpegFailureLog?: unknown }).ffmpegFailureLog
    if (typeof log === "string" && log.length > 0) return log
    cur = (cur as { cause?: unknown }).cause
  }
  return undefined
}
