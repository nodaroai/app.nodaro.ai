// @reads-none reads only the local files a plugin's filter graph names (its work-dir paths), never a repo file
/**
 * The files a filter graph makes ffmpeg read by itself, held to the link rule
 * (`plugin-run-guard.ts`, a private plugin's runs). The graph is parsed as
 * ffmpeg parses it (`av_get_token`'s quoting and escaping, at the graph level
 * and again at the filter's option level), and each instance of a filter that
 * reads a file is checked:
 *
 * - `movie` / `amovie`, `subtitles`, and the filters that load an image
 *   (`cover_rect`, `find_rect`, `removelogo`, `showcqt`'s axis): ffmpeg opens
 *   these through its demuxers, so the source is a plugin's local input — a
 *   plain path or `file:` only (`movie=cache\:list.m3u8` opens every link the
 *   list names, measured on the pinned 8.1.2), and a list it names is held to
 *   the link rule (`localListProblem`). `movie`'s `format_opts` may not set the
 *   probe guard's own options: `format_opts='protocol_whitelist=file\,http\,tcp'`
 *   opens a local playlist's links (measured).
 * - `sendcmd` / `asendcmd`, `lut1d`, `lut3d`, `drawtext`'s `textfile`,
 *   `fieldhint`, `fsync`, `cellauto`, `life` and `arnndn`: text files, read
 *   whole and held to `namesALink`.
 *
 * Not read: files ffmpeg only loads as data and never opens anything from
 * (fonts, `curves`/`selectivecolor` Photoshop files, `nnedi` weights, `ass`
 * scripts read by libass), and files a filter only writes.
 */
import { linkRuleText, namesALink, OPTION_FILE_MAX_BYTES, plainFileBytes } from "./link-arguments.js"
import { inputProtocolRefused, localListProblem } from "./plugin-inputs.js"
import { statSync } from "node:fs"

/** One filter instance of a graph: its name (without an `@id`) and its options as ffmpeg reads them. */
export interface GraphFilter {
  readonly name: string
  readonly options: ReadonlyArray<{ readonly key?: string; readonly value: string }>
}

const WHITESPACE = " \n\t\r"

/**
 * `av_get_token`: the token of `s` from `at` up to the first character of
 * `terms` that is neither escaped (`\x` is `x`) nor quoted (`'…'` is taken as
 * it is); leading whitespace is skipped and trailing unquoted whitespace
 * dropped. `end` is where it stopped.
 */
export function avGetToken(s: string, at: number, terms: string): { readonly token: string; readonly end: number } {
  let i = at
  while (i < s.length && WHITESPACE.includes(s[i]!)) i++
  let out = ""
  let kept = 0
  while (i < s.length && !terms.includes(s[i]!)) {
    const c = s[i++]!
    if (c === "\\" && i < s.length) {
      out += s[i++]
      kept = out.length
    } else if (c === "'") {
      while (i < s.length && s[i] !== "'") out += s[i++]
      if (i < s.length) {
        i++
        kept = out.length
      }
    } else {
      out += c
    }
  }
  let end = out.length
  while (end > kept && WHITESPACE.includes(out[end - 1]!)) end--
  return { token: out.slice(0, end), end: i }
}

/** A filter's options string, split as ffmpeg's option parser does (`key=value` or a positional value, `:` between). */
function optionsOf(args: string): GraphFilter["options"] {
  const out: Array<{ key?: string; value: string }> = []
  let i = 0
  while (i < args.length) {
    const key = /^[A-Za-z0-9_\-./+*]+=/.exec(args.slice(i))
    const start = key ? i + key[0].length : i
    const { token, end } = avGetToken(args, start, ":")
    out.push(key ? { key: key[0].slice(0, -1), value: token } : { value: token })
    if (end === i) break
    i = end + 1
  }
  return out
}

/** Past a run of link labels (`[a][b]`) and whitespace from `at`. */
function pastLabels(s: string, at: number): number {
  let i = at
  for (;;) {
    while (i < s.length && WHITESPACE.includes(s[i]!)) i++
    if (s[i] !== "[") return i
    const close = s.indexOf("]", i)
    if (close < 0) return s.length
    i = close + 1
  }
}

/** The filter instances of a graph, in order (labels, chains and `sws_flags=…;` skipped). */
export function filtersOf(graph: string): GraphFilter[] {
  const out: GraphFilter[] = []
  let i = 0
  while (i < graph.length && WHITESPACE.includes(graph[i]!)) i++
  if (graph.startsWith("sws_flags=", i)) i = avGetToken(graph, i, ";").end + 1
  while (i < graph.length) {
    const from = i
    i = pastLabels(graph, i)
    const name = avGetToken(graph, i, "=,;[")
    i = name.end
    let args = ""
    if (graph[i] === "=") {
      const a = avGetToken(graph, i + 1, "[],;")
      args = a.token
      i = a.end
    }
    i = pastLabels(graph, i)
    if (graph[i] === "," || graph[i] === ";") i++
    if (name.token) out.push({ name: name.token.split("@")[0]!, options: optionsOf(args) })
    if (i <= from) i = from + 1
  }
  return out
}

/** How a filter's file is read: opened through ffmpeg's demuxers (`media`), or read as text (`text`). */
interface FileReading {
  readonly kind: "media" | "text"
  /** The options that name the file. */
  readonly keys: readonly string[]
  /** Whether a positional value may be the file (its first option); false when that is a binary one (drawtext's font). */
  readonly positional: boolean
}

const FILE_READING_FILTERS: Readonly<Record<string, FileReading>> = {
  movie: { kind: "media", keys: ["filename"], positional: true },
  amovie: { kind: "media", keys: ["filename"], positional: true },
  subtitles: { kind: "media", keys: ["filename", "f"], positional: true },
  cover_rect: { kind: "media", keys: ["cover"], positional: true },
  find_rect: { kind: "media", keys: ["object"], positional: true },
  removelogo: { kind: "media", keys: ["filename", "f"], positional: true },
  showcqt: { kind: "media", keys: ["axisfile"], positional: false },
  sendcmd: { kind: "text", keys: ["filename", "f"], positional: true },
  asendcmd: { kind: "text", keys: ["filename", "f"], positional: true },
  lut1d: { kind: "text", keys: ["file"], positional: true },
  lut3d: { kind: "text", keys: ["file"], positional: true },
  drawtext: { kind: "text", keys: ["textfile"], positional: false },
  fieldhint: { kind: "text", keys: ["hint"], positional: true },
  fsync: { kind: "text", keys: ["file", "f"], positional: true },
  cellauto: { kind: "text", keys: ["filename", "f"], positional: true },
  life: { kind: "text", keys: ["filename", "f"], positional: true },
  arnndn: { kind: "text", keys: ["model", "m"], positional: true },
}

/** The filter names this check reads the files of (`FILE_READING_FILTERS`). */
export const FILE_READING_FILTER_NAMES: readonly string[] = Object.keys(FILE_READING_FILTERS)

/** Every `<filter>.<option>` this check reads as a file (`FILE_READING_FILTERS`). */
export const FILTER_FILE_OPTIONS_READ: ReadonlySet<string> = new Set(
  Object.entries(FILE_READING_FILTERS).flatMap(([name, { keys }]) => keys.map((key) => `${name}.${key}`)),
)

const WRITTEN = "a file the filter only writes"
const NOT_A_FILE = "a value, not a file"
const DATA_ONLY = "data ffmpeg loads and never opens anything from"

/**
 * Every filter option that names a file or a path (as a census of the pinned
 * ffmpeg's filters finds them, `plugin-run-guard.test.ts`) that this check
 * does not read as a file, and why. A new ffmpeg whose filter gains such an
 * option fails that census until the option is read (`FILE_READING_FILTERS`)
 * or listed here.
 */
export const FILTER_FILE_OPTIONS_NOT_READ: Readonly<Record<string, string>> = {
  "movie.f": "the format the source is forced to, read as such (a list demuxer makes the source a list)",
  "amovie.f": "the format the source is forced to, read as such (a list demuxer makes the source a list)",
  "movie.format_opts": "checked: it may not set the probe guard's own options",
  "amovie.format_opts": "checked: it may not set the probe guard's own options",
  "ametadata.file": WRITTEN,
  "metadata.file": WRITTEN,
  "curves.plot": WRITTEN,
  "deshake.filename": WRITTEN,
  "firequalizer.dumpfile": WRITTEN,
  "loudnorm.stats_file": WRITTEN,
  "paletteuse.debug_kdtree": WRITTEN,
  "psnr.f": WRITTEN,
  "psnr.stats_file": WRITTEN,
  "ssim.f": WRITTEN,
  "ssim.stats_file": WRITTEN,
  "ssim360.f": WRITTEN,
  "ssim360.stats_file": WRITTEN,
  "vmafmotion.stats_file": WRITTEN,
  "xpsnr.f": WRITTEN,
  "xpsnr.stats_file": WRITTEN,
  "signature.filename": WRITTEN,
  "libvmaf.log_path": WRITTEN,
  "afirsrc.f": NOT_A_FILE,
  "afirsrc.m": NOT_A_FILE,
  "amix.weights": NOT_A_FILE,
  "mix.weights": NOT_A_FILE,
  "tmix.weights": NOT_A_FILE,
  "curves.m": NOT_A_FILE,
  "ssim360.heatmap_str": NOT_A_FILE,
  "curves.psfile": DATA_ONLY,
  "selectivecolor.psfile": DATA_ONLY,
  "nnedi.weights": DATA_ONLY,
  "libvmaf.model": DATA_ONLY,
  "drawtext.fontfile": `${DATA_ONLY} (a font)`,
  "showcqt.fontfile": `${DATA_ONLY} (a font)`,
  "ass.fontsdir": `${DATA_ONLY} (a fonts folder)`,
  "subtitles.fontsdir": `${DATA_ONLY} (a fonts folder)`,
  "ass.filename": `${DATA_ONLY} (an .ass script libass reads)`,
  "ass.f": `${DATA_ONLY} (an .ass script libass reads)`,
}

/** The options `movie`'s `format_opts` may not set: the probe guard's own (`PROBE_GUARD_OPTIONS`, without the dash). */
const GUARD_KEYS = ["protocol_whitelist", "protocol_blacklist", "format_whitelist", "enable_drefs", "max_redirects", "http_proxy"]

/** Whether `value` names an existing path at all (a regular file or anything else). */
function exists(value: string): boolean {
  try {
    statSync(value)
    return true
  } catch {
    return false
  }
}

export type GraphFileProblem = { readonly filter: string; readonly problem: "names a link" | "unreadable" | "protocol" | "guard option" }

/**
 * What is wrong with the files a graph's filters read, the first one found
 * (module note), or undefined.
 */
export function graphFileProblem(graph: string): GraphFileProblem | undefined {
  for (const { name, options } of filtersOf(graph)) {
    const reading = FILE_READING_FILTERS[name]
    if (!reading) continue
    if ((name === "movie" || name === "amovie") && options.some((o) => o.key === "format_opts" && GUARD_KEYS.some((k) => o.value.toLowerCase().includes(k)))) {
      return { filter: name, problem: "guard option" }
    }
    const forced = options.find((o) => o.key === "f" || o.key === "format_name")?.value
    const files = options.filter((o) => (o.key === undefined ? reading.positional : reading.keys.includes(o.key))).map((o) => o.value)
    for (const value of files) {
      // A link is the link rule's: a run's link may only be an input (`guardedArgv`).
      if (namesALink(value)) continue
      if (reading.kind === "media") {
        if (inputProtocolRefused(value)) return { filter: name, problem: "protocol" }
        const list = localListProblem(value, name === "movie" || name === "amovie" ? forced : undefined)
        if (list) return { filter: name, problem: list }
        continue
      }
      // A text file: read whole (a value that names nothing on disk is no file; ffmpeg fails on it itself).
      if (!exists(value)) continue
      const bytes = plainFileBytes(value, OPTION_FILE_MAX_BYTES)
      if (!bytes) return { filter: name, problem: "unreadable" }
      if (namesALink(linkRuleText(bytes))) return { filter: name, problem: "names a link" }
    }
  }
  return undefined
}
