/**
 * The private plugin toolkit's ffmpeg runners (`tk.ffmpeg.runFfmpeg`,
 * `tk.ffmpeg.runFfmpegCapture`): a run whose arguments name a link reads it
 * through the probe guard, as `runFfprobeReadingLinks` does for ffprobe.
 *
 * ffmpeg's own http client resolves a host itself and follows redirects to
 * any address. So a run that reads a link:
 *
 * - takes a link only as an input (`-i <link>`). Any other argument naming
 *   one (an output, a filter's `movie=`, a metadata value) is refused before
 *   ffmpeg starts: only an input gets the guard's options, and only http hops
 *   go through its proxy. A link a filter argument spells with ffmpeg's filter
 *   escaping (`movie=http\://…`) counts as one too (`namesALink`).
 * - passes the first-hop check (`assertSafeProbeSource`) for every link.
 * - places the guard's input options right before each link's `-i`: http(s)
 *   only, ffmpeg's own redirect limit, and only ordinary media containers
 *   (`ffmpegLinkInputArgs`). A playlist fails as its typed refusal (reason
 *   `container`).
 * - reads through one guard proxy for the whole run, which checks every
 *   connection ffmpeg opens (redirects, the range requests of a seek) with
 *   the first hop's rule. A refused hop fails the run as the first hop's
 *   `ProbeSourceBlockedError`.
 * - may not set the guard's own options itself (`PROBE_GUARD_OPTIONS`).
 *
 * The proxy has no clock of its own. A long render streams through it for as
 * long as the run's own kill budget allows (the `timeoutMs` the caller
 * passes), and Node's server timeouts apply only while a request is being
 * received, never to a long reply or tunnel (measured on Node 22).
 *
 * A run whose arguments name no link is the plain runner, exactly as called.
 *
 * The toolkit's two encoders, `transcodeToBrowserSafe` and `remuxToMp4`,
 * follow the same rule: a link input is probed through the guard
 * (`readProbeSource`) and encoded with `runFfmpegReadingLinks`, a link output
 * is refused, and local paths reach the plain function exactly as called.
 */
import {
  browserSafeTranscodeArgs,
  buildRemuxArgs,
  probeFirstAudioCodecSource,
  probeVideoStreamSource,
  remuxToMp4,
  runFfmpeg,
  runFfmpegCapture,
  transcodeToBrowserSafe,
  videoStreamNeedsTranscode,
} from "./ffmpeg-utils.js"
import {
  assertSafeProbeSource,
  ffmpegContainerRefusalOf,
  ffmpegLinkInputArgs,
  isNetworkProbeSource,
  PROBE_GUARD_OPTIONS,
  ProbeSourceBlockedError,
  withProbeEgress,
} from "./probe-guard.js"

/** `runFfmpeg` for a caller that may hand ffmpeg a link (module note). */
export async function runFfmpegReadingLinks(args: readonly string[], timeoutMs?: number): Promise<string> {
  const argv = await guardedArgv(args)
  if (!argv) return runFfmpeg(args, timeoutMs)
  // Run with the capture runner, whose failure keeps the full stderr: the refusal of a playlist is read from it.
  return (await readThroughGuard(argv, timeoutMs)).stdout
}

/** `runFfmpegCapture` for a caller that may hand ffmpeg a link (module note). */
export async function runFfmpegCaptureReadingLinks(
  args: readonly string[],
  timeoutMs?: number,
): Promise<{ stdout: string; stderr: string }> {
  const argv = await guardedArgv(args)
  if (!argv) return runFfmpegCapture(args, timeoutMs)
  return readThroughGuard(argv, timeoutMs)
}

/** `transcodeToBrowserSafe` for a caller that may hand it a link (module note). */
export async function transcodeToBrowserSafeReadingLinks(inputPath: string, outputPath: string): Promise<string> {
  if (!encodeNamesLink(inputPath, outputPath)) return transcodeToBrowserSafe(inputPath, outputPath)
  if (!videoStreamNeedsTranscode(await probeVideoStreamSource(inputPath))) return inputPath
  await runFfmpegReadingLinks(browserSafeTranscodeArgs(inputPath, outputPath))
  return outputPath
}

/** `remuxToMp4` for a caller that may hand it a link (module note). */
export async function remuxToMp4ReadingLinks(inputPath: string, outputPath: string): Promise<void> {
  if (!encodeNamesLink(inputPath, outputPath)) return remuxToMp4(inputPath, outputPath)
  await runFfmpegReadingLinks(buildRemuxArgs(inputPath, outputPath, await probeFirstAudioCodecSource(inputPath)))
}

/** Whether an encode's input or output is a link; a link output is refused before anything is read. */
function encodeNamesLink(inputPath: string, outputPath: string): boolean {
  if (isNetworkProbeSource(outputPath)) throw new ProbeSourceBlockedError("link", "ffmpeg: blocked — a link may only be read as an input (-i <link>)")
  return isNetworkProbeSource(inputPath)
}

/**
 * The arguments with the guard's options before each link's `-i`, once every
 * link passed the first-hop check; undefined when they name no link.
 */
async function guardedArgv(args: readonly string[]): Promise<string[] | undefined> {
  const named = args.flatMap((a, i) => (namesALink(a) ? [i] : []))
  if (named.length === 0) return undefined
  // A link only as an input, as written (`-i <link>`): anywhere else — an output, a filter's `movie=`
  // source, escaped or not — it would be opened with no guard.
  if (named.some((i) => args[i - 1] !== "-i" || !isNetworkProbeSource(args[i]!))) {
    throw new ProbeSourceBlockedError("link", "ffmpeg: blocked — a link may only be read as an input (-i <link>)")
  }
  const links = new Set(named)
  const own = args.find((a) => PROBE_GUARD_OPTIONS.has(a))
  if (own) throw new Error(`ffmpeg: a run that reads a link cannot set the probe guard's own options (${own})`)
  for (const i of links) await assertSafeProbeSource(args[i]!)
  return args.flatMap((a, i) => (a === "-i" && links.has(i + 1) ? [...ffmpegLinkInputArgs(), a] : [a]))
}

/**
 * Whether an argument names a link: as written, or once ffmpeg's filter
 * escaping is taken off. A filter argument reaches ffmpeg's filter parser,
 * which drops a backslash before any character and the single quotes around
 * a part (`movie=http\://…`, `movie='http'://…`), so a source filter such as
 * `movie` or `amovie` opens a link that is not written with a plain `://`.
 * Read the same way for every argument, so no option is missed; an argument
 * that is not a filter has no reason to spell a link that way.
 */
function namesALink(arg: string): boolean {
  return isNetworkProbeSource(arg) || isNetworkProbeSource(arg.replace(/[\\']/g, ""))
}

/** Run `argv` through a fresh guard proxy; a link that is not an ordinary media file fails as its typed refusal. */
function readThroughGuard(argv: readonly string[], timeoutMs: number | undefined): Promise<{ stdout: string; stderr: string }> {
  return withProbeEgress((egress) =>
    runFfmpegCapture(argv, timeoutMs, { env: egress.env }).catch((err: unknown) => {
      throw ffmpegContainerRefusalOf(err) ?? err
    }),
  )
}
