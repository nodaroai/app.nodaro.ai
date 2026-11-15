/**
 * Every MP3 the backend encodes is built here: the audio filter chain that
 * ends the encode and the libmp3lame options. Every ffmpeg launch is checked
 * against it (`assertFramedMp3Encode`, called from `ffmpeg-process.ts`), and
 * `mp3-encode-guard.test.ts` fails the build on the encoder named anywhere
 * else.
 *
 * Why it exists. libmp3lame reads each float plane in whole groups of 8
 * samples and refuses a frame whose plane is not padded to the next group
 * ("inadequate AVFrame plane padding … Error submitting audio frame"). ffmpeg's
 * encoder queue cuts the frames it is handed into the encoder's frames by
 * moving a frame's start inside its buffer, and passes a cut frame on whenever
 * it is aligned to the CPU's widest SIMD register. At 16 bytes (arm64, or an
 * x86 without AVX) the last frame of a stream can then end short of an
 * 8-sample group at the very end of its buffer, and the encode fails. (At the
 * 32 or 64 bytes of AVX2 or AVX-512 the cut cannot land there.)
 *
 * The rule: the LAST filter before the encoder re-cuts the stream into
 * 1152-sample frames (`asetnsamples`, the last frame left short and unpadded),
 * which the queue then never cuts. "Last" means after everything ffmpeg itself
 * adds behind an `-af` chain: its conversion to a format the encoder takes,
 * and an output-side `-ss`/`-to`/`-t`, which ffmpeg turns into a trim placed
 * AFTER the chain — a trim there would re-cut the 1152-sample frames, so a cut
 * is never left on the output: the chain ends with ffmpeg's own output steps,
 * in ffmpeg's own order (`aformat` as ffmpeg builds it for libmp3lame, then the
 * trim, at the same microseconds), then the frame-size filter.
 *
 * Every MP3 that encoded before is byte-identical: the encoder gets the same
 * samples in the same frames. 1152 is LAME's frame at 32–48 kHz; at 24 kHz and
 * below its 576-sample frame divides 1152, so the queue cuts a 1152-sample
 * frame only in whole halves.
 */
import { readFfmpegArgv, type FfmpegArgv, type FfmpegArgvOption } from "./ffmpeg-threads.js"

/** The samples in one frame the encoder is handed (LAME's MPEG-1 frame). */
export const MP3_FRAME_SAMPLES = 1152

/** The frame-size filter: 1152-sample frames, the last one short and unpadded (`p=0`), so the length is unchanged. */
export const MP3_FRAME_FILTER = `asetnsamples=n=${MP3_FRAME_SAMPLES}:p=0`

/**
 * What ffmpeg's own output chain holds libmp3lame to (the `aformat` it places
 * behind every `-af` chain), in its order: the encoder's sample formats, its
 * sample rates (or the one `-ar` names) and its channel layouts.
 * `mp3-encode-output.test.ts` holds these to the pinned ffmpeg's own.
 */
export const LIBMP3LAME_SAMPLE_FORMATS = ["s32p", "fltp", "s16p"] as const
export const LIBMP3LAME_SAMPLE_RATES = [44100, 48000, 32000, 22050, 24000, 16000, 11025, 12000, 8000] as const
export const LIBMP3LAME_CHANNEL_LAYOUTS = ["mono", "stereo"] as const

/**
 * The muxers whose default audio codec is MP3 on the pinned build (`ffmpeg -h
 * muxer=<m>`, "Default audio codec: mp3"): an output written in one with no
 * audio codec named is an MP3 encode, libmp3lame at its defaults. It depends on
 * the build (`nut` defaults to MP3 only on one without libvorbis), so
 * `mp3-encode-output.test.ts` holds this list to the pinned ffmpeg.
 */
export const MP3_DEFAULT_MUXERS = ["avi", "avm2", "flv", "mp3", "swf"] as const

/** The file extensions ffmpeg picks those muxers by (their "Common extensions"; `avm2` has none). */
export const MP3_DEFAULT_EXTENSIONS = ["avi", "flv", "mp3", "swf"] as const

const extensionOf = (path: string): string => /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? ""

/**
 * Whether writing `outputPath` with no audio codec named encodes its audio as
 * MP3: its extension picks a muxer whose default audio is MP3 (`.mp3`, and the
 * `.avi`, `.flv` and `.swf` video containers). Such an output is built with
 * `mp3EncodeArgs`.
 */
export function writesMp3ByDefault(outputPath: string): boolean {
  return (MP3_DEFAULT_EXTENSIONS as readonly string[]).includes(extensionOf(outputPath))
}

/**
 * An output-side cut, as the encode's `-ss` (`start`), and `-t` (`duration`)
 * or `-to` (`end`) would have made it: seconds, read the way ffmpeg reads
 * them (`ffmpegTimeMicros`).
 */
export interface Mp3Cut {
  readonly start?: number
  readonly end?: number
  readonly duration?: number
}

export interface Mp3EncodeOptions {
  /** The audio filters the encode applies (an `-af` chain), in order. */
  readonly filters?: readonly string[]
  /** A cut of the encoded output; never an `-ss`/`-to`/`-t` on the output itself. */
  readonly cut?: Mp3Cut
  /** The output sample rate (`-ar`); without it ffmpeg keeps the source's when the encoder takes it. */
  readonly sampleRate?: number
  /** A constant bitrate (`-b:a`, "192k"). */
  readonly bitrate?: string
  /** A VBR quality (`-q:a`, 0 best … 9). */
  readonly quality?: number
}

/**
 * A time in whole microseconds, read from `String(seconds)` exactly as ffmpeg
 * reads an `-ss`/`-t`/`-to` value (`av_parse_time`): whole seconds, then at
 * most six fractional digits, the rest ignored. A value ffmpeg would refuse
 * (not finite, or written with an exponent) is refused here.
 */
export function ffmpegTimeMicros(seconds: number): number {
  const text = String(seconds)
  const m = /^(-)?(\d+)(?:\.(\d*))?$/.exec(text)
  if (!m) throw new RangeError(`mp3 encode: ${text} is not a time ffmpeg reads`)
  const micros = Number(m[2]) * 1_000_000 + Number(((m[3] ?? "") + "000000").slice(0, 6))
  if (!Number.isSafeInteger(micros)) throw new RangeError(`mp3 encode: ${text} is out of range`)
  return m[1] ? -micros : micros
}

/** Whole microseconds as the seconds ffmpeg reads back to the same microseconds ("1.370000"). */
function microsText(micros: number): string {
  const abs = Math.abs(micros)
  return `${micros < 0 ? "-" : ""}${Math.trunc(abs / 1_000_000)}.${String(abs % 1_000_000).padStart(6, "0")}`
}

/**
 * The `atrim` ffmpeg itself places for an output `-ss`/`-t`/`-to`: `start` the
 * `-ss`, `duration` the `-t`, or the `-to` less the `-ss` (ffmpeg's own
 * arithmetic, in whole microseconds). ffmpeg refuses a `-to` not after the
 * `-ss`; so does this.
 */
function cutFilter(cut: Mp3Cut): string | undefined {
  if (cut.duration !== undefined && cut.end !== undefined) throw new Error("mp3 encode: a cut takes a duration or an end, not both")
  const start = cut.start === undefined ? undefined : ffmpegTimeMicros(cut.start)
  let duration: number | undefined
  if (cut.duration !== undefined) duration = ffmpegTimeMicros(cut.duration)
  else if (cut.end !== undefined) {
    const end = ffmpegTimeMicros(cut.end)
    if (end <= (start ?? 0)) throw new Error(`mp3 encode: the cut's end (${cut.end}) is not after its start (${cut.start ?? 0})`)
    duration = end - (start ?? 0)
  }
  if (duration !== undefined && duration < 0) throw new Error(`mp3 encode: a negative duration (${cut.duration})`)
  const parts = [
    ...(start !== undefined ? [`start=${microsText(start)}`] : []),
    ...(duration !== undefined ? [`duration=${microsText(duration)}`] : []),
  ]
  return parts.length > 0 ? `atrim=${parts.join(":")}` : undefined
}

/**
 * The end of every MP3 encode's audio chain: ffmpeg's own `aformat` for the
 * encoder, the cut, then the frame-size filter.
 */
export function mp3ChainTail(opts: { readonly cut?: Mp3Cut; readonly sampleRate?: number } = {}): string {
  if (opts.sampleRate !== undefined && !(Number.isSafeInteger(opts.sampleRate) && opts.sampleRate > 0)) {
    throw new RangeError(`mp3 encode: sample rate ${opts.sampleRate}`)
  }
  const rates = opts.sampleRate !== undefined ? String(opts.sampleRate) : LIBMP3LAME_SAMPLE_RATES.join("|")
  const format = `aformat=sample_fmts=${LIBMP3LAME_SAMPLE_FORMATS.join("|")}:sample_rates=${rates}:channel_layouts=${LIBMP3LAME_CHANNEL_LAYOUTS.join("|")}`
  const cut = opts.cut ? cutFilter(opts.cut) : undefined
  return [format, ...(cut ? [cut] : []), MP3_FRAME_FILTER].join(",")
}

function encoderArgs(opts: Mp3EncodeOptions): string[] {
  if (opts.bitrate !== undefined && opts.quality !== undefined) throw new Error("mp3 encode: a bitrate or a quality, not both")
  return [
    ...(opts.sampleRate !== undefined ? ["-ar", String(opts.sampleRate)] : []),
    "-c:a", "libmp3lame",
    ...(opts.bitrate !== undefined ? ["-b:a", opts.bitrate] : []),
    ...(opts.quality !== undefined ? ["-q:a", String(opts.quality)] : []),
  ]
}

/**
 * The output arguments of an MP3 encode with an `-af` chain: the chain (the
 * caller's `filters`, then `mp3ChainTail`), and the encoder. The caller places
 * them after its inputs, before the output path.
 */
export function mp3EncodeArgs(opts: Mp3EncodeOptions = {}): string[] {
  const tail = mp3ChainTail(opts)
  const chain = [...(opts.filters ?? []), tail].join(",")
  return ["-af", chain, ...encoderArgs(opts)]
}

/**
 * The output arguments of an MP3 encode of a `-filter_complex` graph's
 * `output` label (`"[aout]"`): the graph with `mp3ChainTail` appended to the
 * chain that ends in that label (the graph must end with it), the map, and the
 * encoder.
 */
export function mp3GraphEncodeArgs(graph: string, output: string, opts: Omit<Mp3EncodeOptions, "filters"> = {}): string[] {
  if (!/^\[[^\]]+\]$/.test(output) || !graph.endsWith(output)) {
    throw new Error(`mp3 encode: the graph must end with its output label ${output}`)
  }
  const framed = `${graph.slice(0, -output.length)},${mp3ChainTail(opts)}${output}`
  return ["-filter_complex", framed, "-map", output, ...encoderArgs(opts)]
}

/* ── The check every ffmpeg launch passes (ffmpeg-process.ts) ─────────────── */

/** Output options that would cut or pad the encoded stream after its chain. */
const OUTPUT_CUTS = new Set(["ss", "to", "t", "sseof", "apad", "shortest"])
const TAIL = new RegExp(
  `(?:^|,)aformat=sample_fmts=${LIBMP3LAME_SAMPLE_FORMATS.join("\\|")}:sample_rates=[0-9|]+:channel_layouts=${LIBMP3LAME_CHANNEL_LAYOUTS.join("\\|")}` +
    `(?:,atrim=[^,;\\[\\]]+)?,${MP3_FRAME_FILTER}$`,
)
const GRAPH_LABEL = /^\[[^\]]+\]$/

/** Whether an option names the codec of an output's audio: `-acodec`, or `-c`/`-codec` for every stream, the audio ones (`a`, `a:0`) or a stream by index (`0`). */
function namesAudioCodec(o: FfmpegArgvOption): boolean {
  if (o.name === "acodec") return true
  if (o.name !== "c" && o.name !== "codec") return false
  const first = o.spec?.split(":")[0]
  return first === undefined || first === "a" || /^\d+$/.test(first)
}

/** How one output of a launch writes its audio. */
interface AudioOutput {
  /** Encodes MP3: libmp3lame (or `mp3`) named as its audio codec, or none named in a container whose default audio is MP3. */
  readonly mp3: boolean
  /** The audio codec as the shape of the encode reads it: the name given, or `implicit:<container>`. */
  readonly codec: string
  /** Its audio chain ends with `mp3ChainTail`. */
  readonly tailed: boolean
  /** That, and nothing on it cuts or pads the stream after the chain. */
  readonly framed: boolean
  /** Where its chain is: `-af`, a mapped graph label, `-filter:a` (judged unframed: the helper writes `-af`), or none. */
  readonly chain: "af" | "graph" | "filter:a" | "none"
  /** The output-side cut and pad options it carries (`-t`, `-ss`, …). */
  readonly cuts: readonly string[]
}

/** The container an output is written in, and whether its default audio is MP3: its `-f` muxer, else the one ffmpeg picks by the path's extension. */
function containerOf(path: string, options: readonly FfmpegArgvOption[]): { readonly name: string; readonly defaultsToMp3: boolean } {
  const f = options.filter((o) => o.name === "f").pop()?.value
  if (f) return { name: f, defaultsToMp3: (MP3_DEFAULT_MUXERS as readonly string[]).includes(f) }
  return { name: extensionOf(path), defaultsToMp3: writesMp3ByDefault(path) }
}

/** The graph a launch's outputs map from (`-filter_complex`, or its alias `-lavfi`); undefined for none, or one read from a file. */
function graphOf(args: FfmpegArgv): string | undefined {
  for (const f of args.files) {
    for (const o of f.options) if ((o.name === "filter_complex" || o.name === "lavfi") && o.value !== undefined) return o.value
  }
  return undefined
}

/** The chain of `graph` that ends in `label`, without the label. */
function chainEndingIn(graph: string, label: string): string | undefined {
  const chain = graph.split(";").map((c) => c.trim()).find((c) => c.endsWith(label))
  return chain === undefined ? undefined : chain.slice(0, -label.length)
}

/**
 * Every output of `args`, as its audio is written; undefined when ffmpeg's
 * reading of the argv is uncertain (`--`, a dangling option). A value is taken
 * as ffmpeg takes it, even one that starts with a dash: a global
 * `-cpuflags -avx512…` ahead of the inputs is read past like any other option.
 */
function audioOutputs(args: readonly string[]): AudioOutput[] | undefined {
  const read = readFfmpegArgv(args, { optionLikeValue: "take" })
  if (!read) return undefined
  if (read.informational) return []
  const graph = graphOf(read)
  return read.files.filter((f) => f.kind === "output").map((f) => {
    const named = f.options.filter(namesAudioCodec).map((o) => o.value ?? "")
    const muted = f.options.some((o) => o.name === "an")
    const container = containerOf(f.path, f.options)
    const mp3 = named.some((c) => c === "mp3" || c === "libmp3lame") || (named.length === 0 && !muted && container.defaultsToMp3)
    const cuts = f.options.filter((o) => OUTPUT_CUTS.has(o.name)).map((o) => `-${o.name}`)
    const af = f.options.filter((o) => o.name === "af").pop()?.value
    const filterA = f.options.some((o) => o.name === "filter" && o.spec?.split(":")[0] === "a")
    const labels = f.options.filter((o) => o.name === "map" && o.value !== undefined && GRAPH_LABEL.test(o.value)).map((o) => o.value!)
    const chain: AudioOutput["chain"] = filterA ? "filter:a" : af !== undefined ? "af" : labels.length > 0 && graph !== undefined ? "graph" : "none"
    const tailed =
      chain === "af" ? TAIL.test(af!)
        : chain === "graph" ? labels.every((label) => TAIL.test(chainEndingIn(graph!, label) ?? ""))
          : false
    const codec = named.find((c) => c === "mp3" || c === "libmp3lame") ?? (named[0] ?? `implicit:${container.name || "unknown"}`)
    return { mp3, codec, tailed, framed: tailed && cuts.length === 0, chain, cuts }
  })
}

/** The argv's MP3 outputs, read conservatively when the argv cannot be read for certain: then any MP3 named, or an `.mp3` last, is one unframed output. */
function mp3Outputs(args: readonly string[]): AudioOutput[] {
  const outputs = audioOutputs(args)
  if (outputs) return outputs.filter((o) => o.mp3)
  const named = args.includes("libmp3lame") || args.some((a, i) => (a === "-c:a" || a === "-acodec") && args[i + 1] === "mp3")
  return named || /\.mp3$/i.test(args[args.length - 1] ?? "")
    ? [{ mp3: true, codec: "unread", tailed: false, framed: false, chain: "none", cuts: [] }]
    : []
}

/**
 * Whether `args` encode MP3 on any output: libmp3lame (or `mp3`) named as
 * that output's audio codec, or no audio codec named in a container whose
 * default audio is MP3 (`MP3_DEFAULT_MUXERS`: an `.mp3`, `.avi`, `.flv` or
 * `.swf` name, or `-f` one of them), which ffmpeg encodes with libmp3lame.
 * Each output is judged by its own options (`readFfmpegArgv`): an option
 * before an `-i` is that input's (a decoder), never an output's.
 */
export function isMp3Encode(args: readonly string[]): boolean {
  return mp3Outputs(args).length > 0
}

/**
 * Whether every MP3 output of `args` was built by this module: its audio
 * chain (its `-af`, or the graph chain each of its `-map` labels names) ends
 * with `mp3ChainTail`, and nothing on that output cuts or pads the stream after
 * it. False for an argv with no MP3 output. `-filter:a`, the long spelling of
 * `-af`, is judged unframed (the helper writes `-af`): the safe side.
 */
export function isFramedMp3Encode(args: readonly string[]): boolean {
  const outputs = mp3Outputs(args)
  return outputs.length > 0 && outputs.every((o) => o.framed)
}

/**
 * What an unframed MP3 encode looks like, without its argv (paths, URLs, cut
 * times): per unframed MP3 output, its audio codec, where its chain is,
 * whether that chain ends with the MP3 chain's end, and its output cuts.
 */
function shapeOf(unframed: readonly AudioOutput[], outputs: number): string {
  const each = unframed.map((o) => `codec=${o.codec} chain=${o.chain} tail=${o.tailed ? "yes" : "no"} cut=${o.cuts.join(",") || "none"}`)
  return `${each.join("; ")}${outputs > 1 ? ` (of ${outputs} outputs)` : ""}`
}

/** Frames of the launch machinery itself, never the place that built the argv. */
const LAUNCH_FRAMES = /[\\/](?:mp3-encode|ffmpeg-process|ffmpeg-utils|ffmpeg-admission[\w-]*|ffmpeg-memory[\w-]*|toolkit-lanes|toolkit)\.[cm]?[jt]s\b|[\\/]concurrency-lanes[\\/]|node:internal|\(native\)/

/** The file and line that launched this ffmpeg, as short as it reads: from the package (`@nodaroai/…`) or from `src/`. */
function launchSite(): string {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 60
  const stack = new Error().stack ?? ""
  Error.stackTraceLimit = limit
  for (const line of stack.split("\n").slice(1)) {
    if (LAUNCH_FRAMES.test(line)) continue
    const m = /((?:file:\/\/)?[^\s()]+):(\d+):\d+\)?\s*$/.exec(line.trim())
    if (!m) continue
    const path = m[1]!.replace(/^file:\/\//, "")
    const nm = path.lastIndexOf("/node_modules/")
    const src = path.lastIndexOf("/src/")
    const short = nm >= 0 ? path.slice(nm + "/node_modules/".length) : src >= 0 ? path.slice(src + "/src/".length) : path.split("/").pop()!
    return `${short}:${m[2]}`
  }
  return "unknown"
}

/** The shapes (at their call sites) this process has logged; a bounded set. */
const loggedShapes = new Set<string>()
const MAX_LOGGED_SHAPES = 256

/**
 * Called on every ffmpeg launch: an MP3 encode not built here fails a test run
 * (where every encode a test reaches is checked), naming its shape and argv.
 * In production the launch goes ahead as before and is logged by its SHAPE
 * and the file and line that launched it — never its argv, which can hold
 * signed URLs and job paths — once per process for each shape at each site.
 */
export function assertFramedMp3Encode(args: readonly string[]): void {
  const outputs = mp3Outputs(args)
  const unframed = outputs.filter((o) => !o.framed)
  if (outputs.length === 0 || unframed.length === 0) return
  const total = audioOutputs(args)?.length ?? outputs.length
  const shape = shapeOf(unframed, total)
  const site = launchSite()
  const message =
    "An MP3 encode must be built by mp3EncodeArgs / mp3GraphEncodeArgs (providers/video/mp3-encode.ts), " +
    `so the encoder is handed whole ${MP3_FRAME_SAMPLES}-sample frames: ${shape}, at ${site}`
  if (process.env.VITEST) throw new Error(`${message}: ffmpeg ${args.join(" ")}`)
  const key = `${shape} @ ${site}`
  if (loggedShapes.has(key) || loggedShapes.size >= MAX_LOGGED_SHAPES) return
  loggedShapes.add(key)
  console.warn(`[mp3-encode] ${message} (logged once per process for this shape and site)`)
}
