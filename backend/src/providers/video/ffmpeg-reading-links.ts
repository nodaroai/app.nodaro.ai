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
 *   escaping (`movie=http\://…`) counts as one too (`namesALink`), and so does
 *   one in a file an option reads its value from (`-/filter_complex <file>`,
 *   `-/vf`, `-/af`, `-filter_complex_script`): such a file is read first and
 *   held to the same rule, and one that cannot be read as a plain local file is
 *   refused too (reason `link`), on every run (`plugin-run-guard.ts`).
 * - passes the first-hop check (`assertSafeProbeSource`) for every link.
 * - places the guard's input options right before each link's `-i`: http(s)
 *   only, ffmpeg's own redirect limit, and only ordinary media containers
 *   (`ffmpegLinkInputArgs`). A playlist fails as its typed refusal (reason
 *   `container`).
 * - reads through one guard proxy for the whole run, which checks every
 *   connection ffmpeg opens (redirects, the range requests of a seek) with
 *   the first hop's rule. A refused hop fails the run as the first hop's
 *   `ProbeSourceBlockedError`.
 * - may not set the guard's own options itself (`PROBE_GUARD_OPTIONS`), as
 *   written or read from a file (`-/protocol_whitelist <file>`).
 *
 * The proxy has no clock of its own. A long render streams through it for as
 * long as the run's own kill budget allows (the `timeoutMs` the caller
 * passes), and Node's server timeouts apply only while a request is being
 * received, never to a long reply or tunnel (measured on Node 22).
 *
 * A run whose arguments name no link is the plain runner, exactly as called.
 *
 * Every run, with a link or without, is first held to the rest of a plugin
 * run's rules (`plugin-run-guard.ts`): an option's file is read once, checked
 * and handed to ffmpeg as that exact copy; no caller whitelist widens what a
 * local input opens; no argument is read through a protocol other than a
 * plain file or the run's pipes; a local list, and the files the run's
 * filters read, are held to the link rule.
 *
 * The toolkit's two encoders, `transcodeToBrowserSafe` and `remuxToMp4`,
 * follow the same rule: a link input is probed through the guard
 * (`readProbeSource`) and encoded with `runFfmpegReadingLinks`, a link output
 * is refused, and a local input, held to a run's local-input rule
 * (`pluginLocalInputRefusal`), reaches the plain function exactly as called.
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
  isProbeGuardOption,
  namesALink,
  ProbeSourceBlockedError,
  withProbeEgress,
} from "./probe-guard.js"
import { pluginLocalInputRefusal, preparePluginRun } from "./plugin-run-guard.js"
import { knownProtocolRefused } from "./plugin-inputs.js"

/** `runFfmpeg` for a caller that may hand ffmpeg a link (module note). */
export async function runFfmpegReadingLinks(args: readonly string[], timeoutMs?: number): Promise<string> {
  return withPreparedRun(args, async (run, argv) => {
    if (!argv) return runFfmpeg(run, timeoutMs)
    // Run with the capture runner, whose failure keeps the full stderr: the refusal of a playlist is read from it.
    return (await readThroughGuard(argv, timeoutMs)).stdout
  })
}

/** `runFfmpegCapture` for a caller that may hand ffmpeg a link (module note). */
export async function runFfmpegCaptureReadingLinks(
  args: readonly string[],
  timeoutMs?: number,
): Promise<{ stdout: string; stderr: string }> {
  return withPreparedRun(args, (run, argv) => (argv ? readThroughGuard(argv, timeoutMs) : runFfmpegCapture(run, timeoutMs)))
}

/**
 * `work` on a plugin run's checked arguments (`preparePluginRun`): `run`, the
 * arguments with each option file's private copy, and `argv`, those with the
 * guard's options before each link (`guardedArgv`; undefined when the run
 * reads no link). The copies are removed once `work` settles.
 */
async function withPreparedRun<T>(args: readonly string[], work: (run: string[], argv: string[] | undefined) => Promise<T>): Promise<T> {
  const readsLink = args.some((a) => namesALink(a))
  // ffmpeg keeps an option's last value wherever it sits, so a run that reads a link cannot set the guard's own.
  const own = readsLink ? args.find((a) => isProbeGuardOption(a)) : undefined
  if (own) throw new Error(`ffmpeg: a run that reads a link cannot set the probe guard's own options (${own})`)
  const prepared = await preparePluginRun(args, "ffmpeg", { readsLink })
  try {
    return await work(prepared.argv, await guardedArgv(prepared.argv))
  } finally {
    await prepared.cleanup()
  }
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

/**
 * Whether an encode's input or output is a link; a link output, an output
 * through a protocol other than a file (`unix:`…), and a local input the
 * local-input rule refuses are refused before anything is read.
 */
function encodeNamesLink(inputPath: string, outputPath: string): boolean {
  if (isNetworkProbeSource(outputPath) || knownProtocolRefused(outputPath)) {
    throw new ProbeSourceBlockedError("link", "ffmpeg: blocked — a link may only be read as an input (-i <link>)")
  }
  const local = pluginLocalInputRefusal(inputPath, "ffmpeg")
  if (local) throw local
  return isNetworkProbeSource(inputPath)
}

/**
 * A toolkit member that probes a plugin's local path with the plain probe
 * (`getVideoDuration`, `needsTranscode`), with the path first held to a run's
 * local-input rule (`pluginLocalInputRefusal`). A link is left to the plain
 * probe, which refuses one outside the guard.
 */
export function withPluginLocalInput<T>(probe: (path: string) => Promise<T>): (path: string) => Promise<T> {
  return async (path) => {
    const refused = pluginLocalInputRefusal(path, "ffprobe")
    if (refused) throw refused
    return probe(path)
  }
}

/**
 * The arguments with the guard's options before each link's `-i`, once every
 * link passed the first-hop check; undefined when they name no link. Called on
 * a run's checked arguments (`withPreparedRun`).
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
  for (const i of links) await assertSafeProbeSource(args[i]!)
  return args.flatMap((a, i) => (a === "-i" && links.has(i + 1) ? [...ffmpegLinkInputArgs(), a] : [a]))
}

/** Run `argv` through a fresh guard proxy; a link that is not an ordinary media file fails as its typed refusal. */
function readThroughGuard(argv: readonly string[], timeoutMs: number | undefined): Promise<{ stdout: string; stderr: string }> {
  return withProbeEgress((egress) =>
    runFfmpegCapture(argv, timeoutMs, { env: egress.env }).catch((err: unknown) => {
      throw ffmpegContainerRefusalOf(err) ?? err
    }),
  )
}
