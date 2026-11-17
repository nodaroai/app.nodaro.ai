// @reads-none reads only a remote file's header, through the probe guard
import { readProbeSource, ProbeSourceBlockedError } from "../providers/video/ffmpeg-utils.js"
import {
  MEDIA_IMPORT_MAX_BYTES,
  MEDIA_TOO_LARGE_MESSAGE,
  MEDIA_TOO_LONG_MESSAGE,
  MEDIA_BITRATE_IMPLAUSIBLE_MESSAGE,
  MediaImportLengthError,
  isBitrateImplausible,
  isOverImportLength,
} from "./media-import-length.js"

/**
 * The direct-file link's check BEFORE anything is downloaded
 * (`POST /v1/download-video`): ffprobe reads the remote file's header —
 * through the probe guard (`readProbeSource`: the first hop's public-address
 * check, then a proxy that checks every later hop, a redirect included, and
 * reads only an ordinary media file) — for its declared duration and its size
 * (the server's Content-Length). A file over 30 minutes or 10 GiB, or one
 * whose size its length cannot explain, is refused before a byte of it is
 * downloaded.
 *
 * Only a refusal is trusted from here. Anything the probe cannot read — a
 * timeout, a server that sends no length, a header ffprobe does not
 * understand — falls through to the download, whose own probe of the file on
 * disk is the authority (`assertLocalVideoImportable`).
 */

/** How long the pre-check may hold the request before it falls through. */
export const PRECHECK_TIMEOUT_MS = 20_000

export type PrecheckOutcome =
  | { readonly kind: "ok"; readonly durationSec?: number; readonly sizeBytes?: number }
  /** The guard refused the link's address (a private or reserved one, at any hop). */
  | { readonly kind: "blocked" }

/** Pre-check one direct-file link; throws {@link MediaImportLengthError} on a refusal. */
export async function precheckRemoteVideo(url: string): Promise<PrecheckOutcome> {
  let json: string
  try {
    json = await readProbeSource(url, (input, probe) =>
      probe.run(["-v", "error", ...probe.inputArgs, "-show_entries", "format=duration,size", "-of", "json", input], {
        timeoutMs: PRECHECK_TIMEOUT_MS,
      }),
    { downloadTimeoutMs: PRECHECK_TIMEOUT_MS })
  } catch (err) {
    if (err instanceof ProbeSourceBlockedError && err.reason === "address") return { kind: "blocked" }
    return { kind: "ok" }
  }
  let durationSec: number | undefined
  let sizeBytes: number | undefined
  try {
    const parsed = JSON.parse(json) as { format?: { duration?: string; size?: string } }
    const d = parseFloat(parsed.format?.duration ?? "")
    const s = Number(parsed.format?.size ?? "")
    if (Number.isFinite(d) && d > 0) durationSec = d
    if (Number.isFinite(s) && s > 0) sizeBytes = s
  } catch {
    return { kind: "ok" }
  }
  if (sizeBytes !== undefined && sizeBytes > MEDIA_IMPORT_MAX_BYTES) {
    throw new MediaImportLengthError("media_too_large", MEDIA_TOO_LARGE_MESSAGE)
  }
  if (durationSec !== undefined && isOverImportLength(durationSec)) {
    throw new MediaImportLengthError("media_too_long", MEDIA_TOO_LONG_MESSAGE)
  }
  if (durationSec !== undefined && sizeBytes !== undefined && isBitrateImplausible(sizeBytes, durationSec, "video")) {
    throw new MediaImportLengthError("media_bitrate_implausible", MEDIA_BITRATE_IMPLAUSIBLE_MESSAGE)
  }
  return {
    kind: "ok",
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
  }
}
