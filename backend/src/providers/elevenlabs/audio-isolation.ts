import { openAsBlob } from "node:fs"
import { basename } from "node:path"
import { ELEVENLABS_BASE_URL, getElevenLabsHeaders } from "./client.js"
import { providerFetch, type EgressMeta } from "../egress.js"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"

/**
 * ElevenLabs audio isolation, called DIRECTLY — the sibling of the other
 * `direct-*` / voice-changer calls here (decided 2026-11-18: the node now runs
 * on ElevenLabs' own API).
 *
 * `POST /v1/audio-isolation`, multipart: the file in `audio` (AAC, AIFF, OGG,
 * MP3, OPUS, WAV, FLAC or M4A; up to 500 MB and 1 hour — the node itself takes
 * up to 30 minutes), optionally `file_format` (`other`, the default, or
 * `pcm_s16le_16`). The response body IS the isolated audio, in the type its
 * `Content-Type` names: read, never assumed.
 *
 * The file is streamed from disk (`openAsBlob`), never held in memory twice.
 * A hard timeout, sized to the audio's length, aborts a stalled request.
 */

/** The isolated audio and the type it came in. */
export interface IsolatedAudio {
  readonly buffer: Buffer
  /** The response's media type, e.g. `audio/mpeg`. */
  readonly contentType: string
  /** The file extension that type is stored under, e.g. `mp3`. */
  readonly extension: string
}

export interface AudioIsolationOptions {
  /** The length of the audio sent, in seconds: sizes the timeout. */
  readonly audioSec: number
  /** The media type of the file sent (its multipart part's type). */
  readonly sourceContentType: string
  /** A test's own timeout; otherwise sized from `audioSec`. */
  readonly timeoutMs?: number
}

/** Two minutes, plus the audio's own length again, at most 45 minutes. */
export function audioIsolationTimeoutMs(audioSec: number): number {
  const sec = Number.isFinite(audioSec) && audioSec > 0 ? audioSec : 0
  return Math.min(45 * 60_000, 120_000 + Math.ceil(sec) * 1000)
}

/** The audio types the response can name, and the extension each is stored under. */
const EXTENSION_OF_TYPE: Readonly<Record<string, string>> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
}

/** The extension of an audio body by its first bytes, for a response whose type names none we know. */
function sniffExtension(buf: Buffer): { readonly extension: string; readonly contentType: string } | undefined {
  const ascii = (start: number, end: number) => buf.subarray(start, end).toString("latin1")
  if (ascii(0, 3) === "ID3" || (buf.length > 1 && buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return { extension: "mp3", contentType: "audio/mpeg" }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { extension: "wav", contentType: "audio/wav" }
  if (ascii(0, 4) === "fLaC") return { extension: "flac", contentType: "audio/flac" }
  if (ascii(0, 4) === "OggS") return { extension: "ogg", contentType: "audio/ogg" }
  if (ascii(4, 8) === "ftyp") return { extension: "m4a", contentType: "audio/mp4" }
  return undefined
}

/** The type and extension the isolated audio is stored under: its `Content-Type`, else its first bytes. */
export function isolatedAudioFormat(contentTypeHeader: string | null, buf: Buffer): { readonly extension: string; readonly contentType: string } {
  const type = (contentTypeHeader ?? "").split(";")[0]!.trim().toLowerCase()
  if (Object.hasOwn(EXTENSION_OF_TYPE, type)) return { extension: EXTENSION_OF_TYPE[type]!, contentType: type }
  const sniffed = sniffExtension(buf)
  if (sniffed) return sniffed
  throw Object.assign(new Error("Audio Isolation returned a file in a format that could not be recognised."), {
    internalDetails: `ElevenLabs audio isolation answered with content-type "${type || "(none)"}" and an unrecognised body`,
  })
}

/** A failure ElevenLabs answered, as the user reads it, with its own words kept for the operator. */
function isolationFailure(status: number, body: string): Error {
  const internalDetails = `ElevenLabs audio isolation failed (${status}): ${body.slice(0, 500)}`
  if (status === 429) {
    return Object.assign(new Error("Audio Isolation is busy right now. Try again in a minute."), { internalDetails })
  }
  if (status === 401 || status === 403) {
    // The deployment's key, not the user's input: refused the same way on a retry.
    return Object.assign(new DeterministicJobError("Audio Isolation could not run: the deployment's ElevenLabs key was refused."), { internalDetails })
  }
  if (status >= 400 && status < 500) {
    return Object.assign(new DeterministicJobError("Audio Isolation could not process this audio. Check that it is a playable audio file, then try again."), { internalDetails })
  }
  return Object.assign(new Error("Audio Isolation failed on the provider's side. Try again."), { internalDetails })
}

/**
 * Isolate the voice in the audio file at `filePath` (a local file this
 * server wrote: the caller's audio, or the sound taken out of a video).
 */
export async function directAudioIsolation(
  filePath: string,
  options: AudioIsolationOptions,
  meta?: EgressMeta,
): Promise<IsolatedAudio> {
  // First, before anything is read or sent: a keyless install fails here with the house refusal.
  const headers = getElevenLabsHeaders()

  const form = new FormData()
  const blob = await openAsBlob(filePath, { type: options.sourceContentType })
  form.append("audio", blob, basename(filePath))
  form.append("file_format", "other")

  const timeoutMs = options.timeoutMs ?? audioIsolationTimeoutMs(options.audioSec)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await providerFetch(
      // Single-purpose funnel → default OUR key inside (core callers pass no meta).
      { provider: "elevenlabs", operation: "audioIsolation", modelKey: meta?.modelKey ?? "elevenlabs-isolation", body: undefined, dimensions: meta?.dimensions ?? { duration: options.audioSec } },
      `${ELEVENLABS_BASE_URL}/v1/audio-isolation`,
      {
        method: "POST",
        // xi-api-key only — NO Content-Type, so fetch sets the multipart boundary.
        headers,
        body: form,
        signal: controller.signal,
      },
    )
  } catch (err) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error("Audio Isolation took too long and was stopped. Try again, or split the audio into shorter parts."), {
        internalDetails: `ElevenLabs audio isolation timed out after ${timeoutMs}ms`,
      })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw isolationFailure(response.status, errorText)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength === 0) {
    throw Object.assign(new Error("Audio Isolation returned an empty file. Try again."), {
      internalDetails: "ElevenLabs audio isolation answered 200 with an empty body",
    })
  }
  const format = isolatedAudioFormat(response.headers.get("content-type"), buffer)
  return { buffer, contentType: format.contentType, extension: format.extension }
}
