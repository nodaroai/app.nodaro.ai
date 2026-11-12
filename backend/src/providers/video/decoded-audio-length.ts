/**
 * The audio a per-second-rate lip-sync model is priced on and sent, decoded
 * ONCE into one fixed shape (decided 2026-11-12): 16-bit stereo PCM at
 * 44.1 kHz. The price is the number of sample frames that PCM holds — never
 * what the container declares, never what its timestamps say — and the MP3 the
 * model is sent is encoded from that same PCM, so the price check (the route,
 * a workflow run) and the worker count the same samples by construction: both
 * run this one decode on the same bytes.
 *
 * Why one fixed shape, and not "count the source, then encode the source":
 * a file can change its sample rate or channel layout mid-stream (joined
 * clips, a chained Ogg, an ADTS concat). At every change ffmpeg rebuilds its
 * filter graph, and what a resampler held is dropped with the old graph, so
 * two ffmpeg runs over the same file that resample to DIFFERENT targets keep
 * different numbers of samples — a measure at one rate and an MP3 encode at
 * another disagreed by ~2 ms a change, and an encode could even keep a few ms
 * MORE than the decoder produced (its last resampler's flush). Decoded once
 * into the shape we send, the count IS what is sent: the MP3 of that PCM
 * decodes back to exactly its sample count (measured on every format tried),
 * and padding a short clip is done on the PCM, where it cannot restart.
 *
 * Only local files, only these containers: a caller's file is read through
 * `-protocol_whitelist file` and `-format_whitelist` (`CALLER_AUDIO_FORMATS`),
 * so a playlist (HLS), a manifest (DASH) or a concat script cannot make ffmpeg
 * read another file or fetch a URL. Our own files are read the same way, held
 * to the one container we wrote.
 *
 * Bounded: decoding stops once the PCM passes `capSec` (ffmpeg's `-fs`, a byte
 * cap on that output — exact, every sample frame is 4 bytes), so a file that
 * plays for hours costs no more than the cap. The answer is then `overCap`,
 * with no length: `-fs` stops a little past the cap, not at it.
 *
 * Gaps play as silence (decided 2026-11-12): where the audio's timestamps jump
 * forward (a recording that dropped packets or muted its microphone, clips
 * joined without re-encoding), the decode fills the jump with silence the way
 * a player does, and the price and the MP3 follow that length
 * (`gapFillFilter`). Timestamps that step back or start over never drop audio,
 * a start later than zero is not padded, and one gap fills at most the cap
 * and a second. ffmpeg itself may collapse a very large jump before the
 * filter sees it — its 10 s `dts_delta_threshold` for formats that allow
 * timestamp breaks (MPEG-TS/PS), its 30-hour `dts_error_threshold` elsewhere —
 * and that audio is then priced without the jump. Either way the price is the
 * samples sent.
 *
 * Read to its end, or refused (decided 2026-11-12) — checked in this order:
 *  1. Past the cap: `overCap`, whatever else happened (a file too long is
 *     refused as too long, not as damaged).
 *  2. Clearly shorter than the length the file states: refused
 *     (`AudioReadStoppedError`). Only formats whose stated length is exact,
 *     read where it can be relied on (`declared-audio-length.ts`), more than
 *     `DECLARED_LENGTH_TOLERANCE_SEC` short: a file cut off part-way (FLAC,
 *     M4A, WebM, TTA, AIFF…), a header stating more than the file holds. The
 *     stated length never prices: a file that states LESS than it plays is
 *     priced on what it plays.
 *  3. Damage the demuxer reports as it reads (`DAMAGE_REPORTED`: a Matroska
 *     block whose structure is broken, an Ogg page whose checksum fails):
 *     refused. Such damage drops audio, and the jump it leaves would otherwise
 *     be filled with silence and pass as a gap. Zero padding after the audio
 *     (a Matroska file recovered after a crash) is not damage.
 *  4. "Error during demuxing" on ffmpeg's stderr: the demuxer stopped on an
 *     error, which ffmpeg treats as the end and still exits 0 — refused, unless
 *     the decode already reached the length the whole file states (a complete
 *     WavPack file with an ID3v1 tag after its audio), or only an ADTS file's
 *     few stray bytes after its last frame were left (`adts-frames.ts`). It is
 *     the demuxer's line only: one bad packet (a damaged MP3 frame, a dropped
 *     MPEG-TS packet) is skipped and the read goes on, so it is not refused —
 *     `-xerror` would refuse those (and the crafted MP3 fixtures, after 2 s).
 *
 * What is NOT caught, and is priced and sent as what decodes (the price still
 * equals what is sent): a file whose format states no exact length and whose
 * decoder, not demuxer, stops — an MP3 followed by ADTS AAC, an MPEG-TS whose
 * audio changes codec on one PID — and a file cut off part-way in such a format
 * (MP3, ADTS, AC-3, DTS, MPEG-TS/PS, AVI, FLV), or a WAV, Wave64, CAF or Ogg
 * cut off part-way, or a WMA cut well before its end (ffmpeg then estimates
 * their length from the file's size, or the Ogg's stated length follows the
 * cut); damage that only leaves a jump in the timeline and is not reported (a
 * damaged TTA or FLAC frame), which plays as silence; two files of one format
 * joined byte for byte where the first states its own length (WavPack, TTA:
 * only the first is read); a gap where the audio also changes format (the
 * filter graph restarts there); and a decode short by less than the
 * tolerance.
 *
 * An audio-only launch, admitted like every other (`audioPeakMemoryMiB`): a
 * gap is filled after the conversion to the 44.1 kHz stereo s16 PCM, so even a
 * gap the size of the cap holds about 140 MiB (measured), under that estimate.
 */
import { rm, stat } from "node:fs/promises"
import { runFfmpegCapture } from "./ffmpeg-utils.js"
import { audioPeakMemoryMiB } from "./ffmpeg-memory-model.js"
import { adtsStrayTailBytes } from "./adts-frames.js"
import { onlyZeroBytesFrom } from "./matroska-index.js"
import {
  DECLARED_LENGTH_FORMATS,
  DECLARED_LENGTH_TOLERANCE_SEC,
  WHOLE_FILE_LENGTH_FORMATS,
  probeDeclaredAudioLength,
  type DeclaredAudioLength,
} from "./declared-audio-length.js"

/** The rate of the decoded PCM — and of the MP3 encoded from it. */
export const DECODED_AUDIO_RATE_HZ = 44_100

/** The channels of the decoded PCM: stereo (a mono source is copied to both). */
export const DECODED_AUDIO_CHANNELS = 2

/** The decoded PCM's raw format: signed 16-bit little-endian, interleaved. */
export const DECODED_AUDIO_PCM_FORMAT = "s16le"

/** Bytes in one sample frame of the decoded PCM (2 bytes × 2 channels). */
const BYTES_PER_FRAME = 2 * DECODED_AUDIO_CHANNELS

/**
 * The containers a caller's audio may come in (ffmpeg demuxer names): MP3 (and
 * MP2), WAV (and RF64), Wave64, AIFF, CAF, Sun AU, MP4/M4A/MOV, ADTS AAC,
 * AC-3 / E-AC-3, AMR, Ogg (Vorbis, Opus, FLAC), FLAC, Matroska/WebM, WMA (ASF),
 * MPEG-TS, AVI, MPEG-PS (MPG, VOB), FLV, raw DTS, WavPack, Monkey's Audio, TTA,
 * Musepack (SV7, SV8) and LOAS/LATM AAC. A playlist, a stream manifest or a
 * concat script (HLS, DASH, ffconcat) is refused before it is read.
 *
 * Every one but `mov` keeps its audio in the file itself. A MOV CAN name
 * another file to read its samples from (a data-reference alias), and the only
 * thing that stops ffmpeg following it is the mov demuxer's `enable_drefs`
 * option, which defaults to 0 — such a file decodes nothing here and is
 * refused as unreadable (`decoded-audio-length.test.ts` holds it).
 * `-enable_drefs 0` cannot be passed to say so: it is the mov demuxer's own
 * option, and every input another demuxer opens fails with "Option
 * enable_drefs not found". None of the others opens a second file (their
 * n8.1.2 sources read; `vobsub`, which opens a .sub beside its .idx, is a
 * demuxer of its own and not listed). Before adding a name here, read its
 * demuxer for a second open (`io_open`, `avformat_open_input`).
 */
export const CALLER_AUDIO_FORMATS: readonly string[] = [
  "mp3", "wav", "w64", "aiff", "caf", "au", "mov", "aac", "ac3", "eac3", "amr", "ogg", "flac", "matroska", "asf", "mpegts", "avi",
  "mpeg", "flv", "dts", "wv", "ape", "tta", "mpc", "mpc8", "loas",
]

/**
 * What ffmpeg's command-line tool logs when the demuxer stops on an error
 * before the end of the file (`fftools/ffmpeg_demux.c`: the same words in the
 * pinned n8.1.2 build and in 9.0); it then exits 0. A build that words it
 * differently fails the real-ffmpeg test that a chained Ogg is refused.
 */
const DEMUX_STOPPED = /Error during demuxing/

/**
 * Damage a demuxer reports as it reads, and that drops audio (decided
 * 2026-11-12): an Ogg page whose checksum fails (the Ogg demuxer drops the
 * page), and a Matroska element whose structure is broken once the file is
 * open (the demuxer skips to the next cluster). Never seen on an honest file
 * of the corpus. Both are the DEMUXER's lines, told by ffmpeg's name for the
 * input: "in#N" while the file is opened, "in#N/<format>" from right after
 * `avformat_open_input`, before `avformat_find_stream_info`
 * (`fftools/ffmpeg_demux.c`, the same in the pinned n8.1.2 and in 9.0). So a
 * decoder's own "CRC mismatch!" (Monkey's Audio) is not one, and the Matroska
 * words while the header is read — a stale SeekHead entry, which loses no
 * audio — are not either. A Matroska line whose position is followed only by
 * zero bytes is zero padding after the audio (`onlyZeroBytesFrom`): not damage.
 */
const DAMAGE_REPORTED: readonly RegExp[] = [
  /^\[in#\d+(?:\/ogg)? @ [^\]]*\] CRC mismatch!/,
  /^\[in#\d+\/matroska,webm @ [^\]]*\] .*(?:exceeds containing master element|invalid as first byte of an EBML number|indicated by an EBML number's first byte)/,
]

/** Is this stderr line damage a demuxer reported (`DAMAGE_REPORTED`)? */
export function reportsDamage(line: string): boolean {
  return DAMAGE_REPORTED.some((re) => re.test(line))
}

/** The byte position a Matroska damage line names ("at pos N", or "Element at 0xN"), when it names one. */
export function damagePosition(line: string): number | undefined {
  const decimal = /\bat pos (\d+)\b/.exec(line)
  if (decimal) return Number(decimal[1])
  const hex = /\bElement at 0x([0-9a-f]+)\b/i.exec(line)
  return hex ? Number.parseInt(hex[1]!, 16) : undefined
}

/** The first damage line that is not zero padding after the audio, or undefined. */
async function damageLost(inputPath: string, lines: readonly string[]): Promise<string | undefined> {
  for (const line of lines) {
    if (!reportsDamage(line)) continue
    const at = damagePosition(line)
    if (at !== undefined && (await onlyZeroBytesFrom(inputPath, at))) continue
    return line
  }
  return undefined
}

/**
 * How far the audio's timestamps may run ahead of the samples before the
 * difference is filled with silence: ffmpeg's own default threshold. It is
 * measured against the whole timeline, so small gaps add up — 40 ms every
 * second is filled once the missing time passes 0.1 s, never more than 0.1 s
 * left unfilled. Measured on the corpus: at 0.1 s no file without a gap
 * changes by a sample; at 0.02 s, files whose timestamps wander (MP3s that
 * change rate mid-stream, MPEG-PS) gain a few frames.
 */
const GAP_FILL_MIN_SEC = 0.1

/**
 * The filter that turns gaps in the audio's timeline into silence (see the
 * module doc), after the conversion to the decoded PCM shape — so the silence
 * a gap holds while it is written is the decoded rate's, at most the cap and a
 * second of it. In order: convert; never let a timestamp step back (it would
 * make the filler DROP audio), nor jump ahead by more than the cap and a
 * second; fill the time the timestamps run ahead with silence once it passes
 * `GAP_FILL_MIN_SEC` (`aresample` `async=1`: fill and trim, no stretching —
 * and with nothing earlier than expected, only fill). No `first_pts`: a start
 * later than zero is not padded.
 */
export function gapFillFilter(capSec: number): string {
  const maxGapSamples = capSamplesOf(capSec) + DECODED_AUDIO_RATE_HZ
  // ld(0): where the next frame is expected; ld(2): a frame has been seen. Timestamps in the link's time base.
  const monotonic =
    `st(1,if(ld(2),min(max(PTS,ld(0)),ld(0)+${maxGapSamples}/(SR*TB)),PTS));` +
    "st(0,ld(1)+NB_SAMPLES/(SR*TB));st(2,1);ld(1)"
  return [
    `aresample=${DECODED_AUDIO_RATE_HZ}`,
    "aformat=sample_fmts=s16:channel_layouts=stereo",
    `asetpts='${monotonic}'`,
    `aresample=async=1:min_hard_comp=${GAP_FILL_MIN_SEC}`,
  ].join(",")
}

/**
 * The decoder could not read the file to its end: it decoded clearly less
 * than the length the file states, the demuxer reported damage, or it stopped
 * on an error part-way (see the module doc). Refused, never counted — what
 * decoded is not the whole file. The PCM written so far is left for the
 * caller to remove, like any other.
 */
export class AudioReadStoppedError extends Error {
  constructor(readonly detail: string) {
    super(`the audio did not decode to its end: ${detail}`)
    this.name = "AudioReadStoppedError"
  }
}

/** Did the decode stop part-way through the file (`AudioReadStoppedError`)? */
export function isAudioReadStopped(err: unknown): err is AudioReadStoppedError {
  return err instanceof AudioReadStoppedError
}

/** The most a decode may take: decoding at most `capSec` of audio is seconds of work. */
export const DECODED_AUDIO_MEASURE_TIMEOUT_MS = 60_000

export type DecodedAudioLength =
  /** The whole track was decoded: `samples` sample frames at {@link DECODED_AUDIO_RATE_HZ}, `seconds` = samples ÷ that rate. */
  | { readonly overCap: false; readonly samples: number; readonly seconds: number }
  /** It plays longer than the cap; decoding stopped there. */
  | { readonly overCap: true }

/** The sample frames `capSec` holds at the decoded rate. */
function capSamplesOf(capSec: number): number {
  return Math.round(capSec * DECODED_AUDIO_RATE_HZ)
}

/** ffmpeg input options for a local file in one of `formats`: no other protocol, no other container. */
export function localInputArgs(formats: readonly string[]): string[] {
  return ["-protocol_whitelist", "file", "-format_whitelist", formats.join(",")]
}

/** ffmpeg input options that read a PCM file this module wrote (the input path follows). */
export function decodedPcmInputArgs(): string[] {
  return [
    ...localInputArgs([DECODED_AUDIO_PCM_FORMAT]),
    "-f", DECODED_AUDIO_PCM_FORMAT,
    "-ar", String(DECODED_AUDIO_RATE_HZ),
    "-ac", String(DECODED_AUDIO_CHANNELS),
  ]
}

/**
 * The ffmpeg arguments that decode `inputPath`'s first audio track into the
 * PCM at `pcmPath`, gaps filled with silence (`gapFillFilter`), stopped one
 * sample frame past the cap.
 */
export function decodedAudioArgs(inputPath: string, pcmPath: string, capSec: number, formats: readonly string[] = CALLER_AUDIO_FORMATS): string[] {
  return [
    "-nostdin",
    "-v", "error",
    ...localInputArgs(formats),
    "-i", inputPath,
    "-map", "0:a:0",
    "-vn",
    "-af", gapFillFilter(capSec),
    "-ac", String(DECODED_AUDIO_CHANNELS),
    "-ar", String(DECODED_AUDIO_RATE_HZ),
    "-c:a", "pcm_s16le",
    "-f", DECODED_AUDIO_PCM_FORMAT,
    // One sample frame past the cap: a count over the cap is a file that plays longer.
    "-fs", String((capSamplesOf(capSec) + 1) * BYTES_PER_FRAME),
    "-y", pcmPath,
  ]
}

/**
 * A demuxer that stopped with an error is forgiven when nothing was lost: the
 * decode reached the length the WHOLE file states (step 2 already held it to
 * that), or the file is ADTS and only its stray tail bytes were left.
 */
async function demuxStopLostNothing(inputPath: string, declared: DeclaredAudioLength | undefined): Promise<boolean> {
  if (!declared) return false
  if (declared.seconds !== undefined && WHOLE_FILE_LENGTH_FORMATS.has(declared.format)) return true
  return declared.format === "aac" && (await adtsStrayTailBytes(inputPath)) !== undefined
}

/**
 * Decode `inputPath` into the PCM at `pcmPath` (see the module doc) and count
 * it. The PCM is left where it is — the caller encodes it, or removes it.
 * Undefined when ffmpeg ran but decoded nothing. Rejects with
 * `AudioReadStoppedError` when the decode did not reach the file's end (the
 * module doc's steps 2 to 4), with ffmpeg's error when it cannot read the
 * file (no audio track, not media, a container not in `formats`) — callers
 * decide what each means — and with the launch's own error when it (or the
 * probe of the file's stated length) was stopped (`killed`).
 */
export async function decodeAudioToPcm(
  inputPath: string,
  pcmPath: string,
  opts: { readonly capSec: number; readonly formats?: readonly string[] },
): Promise<DecodedAudioLength | undefined> {
  const formats = opts.formats ?? CALLER_AUDIO_FORMATS
  const { stderr } = await runFfmpegCapture(decodedAudioArgs(inputPath, pcmPath, opts.capSec, formats), DECODED_AUDIO_MEASURE_TIMEOUT_MS, {
    peakMemoryMiB: audioPeakMemoryMiB(),
  })
  const samples = Math.floor((await stat(pcmPath)).size / BYTES_PER_FRAME)
  // 1. Past the cap: too long, whatever else happened.
  if (samples > capSamplesOf(opts.capSec)) return { overCap: true }
  if (samples <= 0) return undefined
  const seconds = samples / DECODED_AUDIO_RATE_HZ
  // Our own MP3 is read as MP3 only, which states no exact length: no probe.
  const declared = formats.some((f) => DECLARED_LENGTH_FORMATS.has(f))
    ? await probeDeclaredAudioLength(inputPath, localInputArgs(formats))
    : undefined
  // 2. Clearly shorter than the length the file states.
  if (declared?.seconds !== undefined && declared.seconds - seconds > DECLARED_LENGTH_TOLERANCE_SEC) {
    throw new AudioReadStoppedError(`decoded ${seconds.toFixed(3)} s of the ${declared.seconds.toFixed(3)} s the ${declared.format} file states`)
  }
  const lines = stderr.split("\n")
  // 3. Damage the demuxer reported: audio was dropped, and its jump filled (zero padding after the audio aside).
  const damage = await damageLost(inputPath, lines)
  if (damage !== undefined) throw new AudioReadStoppedError(`the file reports damage: ${damage.trim()}`)
  // 4. The demuxer stopped on an error, and something may be lost.
  const stopped = lines.find((line) => DEMUX_STOPPED.test(line))
  if (stopped !== undefined && !(await demuxStopLostNothing(inputPath, declared))) throw new AudioReadStoppedError(stopped.trim())
  return { overCap: false, samples, seconds }
}

/**
 * How long `inputPath` plays, decoded into the PCM shape it would be sent in
 * (`decodeAudioToPcm`), without keeping the PCM. Same answers and refusals.
 */
export async function measureDecodedAudio(
  inputPath: string,
  opts: { readonly capSec: number; readonly formats?: readonly string[] },
): Promise<DecodedAudioLength | undefined> {
  const pcmPath = `${inputPath}.decoded.pcm`
  try {
    return await decodeAudioToPcm(inputPath, pcmPath, opts)
  } finally {
    await rm(pcmPath, { force: true })
  }
}

/** Was this launch stopped (its time limit, an abort) rather than refused by ffmpeg? */
export function isStoppedLaunch(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { killed?: unknown }).killed === true
}
