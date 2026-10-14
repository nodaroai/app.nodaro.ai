/**
 * The editor's reads behind Speaker View's face tracks (P3.9), for the funnel
 * both engines share (`resolveSpeakerViewTracksForRun`, `@nodaro/render-rules`):
 *
 *  - the stored box body a descriptor names, fetched once per file and checked
 *    against its `bytes` and `sha256` before it is parsed (P3-22 (a): a
 *    consumer verifies the body) — the region match on a run and the region
 *    editor's track overlay read it;
 *  - the Speaker Frames job the file was made by (`GET /v1/jobs/:id`, which
 *    answers only this account's jobs), for P3-20's file-and-offset check.
 */
import { SPEAKER_TRACKS_MAX_BYTES, normalizeSpeakerTracks, type SpeakerTrackSet, type SpeakerTrackSetDescriptor } from "@nodaro/shared/edl"
import type { SpeakerViewTracksRunDeps } from "@nodaro/render-rules"
import { getJobStatus } from "@/lib/api"
import { isNotFound } from "@/lib/api-errors"

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")

/**
 * Why a track file could not be used: `fetch` (it could not be downloaded),
 * `mismatch` (its size or hash is not the descriptor's), `unreadable` (not a
 * track set). The message is the run's (English, as the rule's are); the
 * region editor shows the reason in the interface language instead.
 */
export type SpeakerTrackBodyFailure = "fetch" | "mismatch" | "unreadable"

export class SpeakerTrackBodyError extends Error {
  constructor(readonly reason: SpeakerTrackBodyFailure, message: string) {
    super(`speaker-view: ${message}`)
    this.name = "SpeakerTrackBodyError"
  }
}

/** The reason behind an error a body read threw; undefined for any other error. */
export function speakerTrackBodyFailureOf(err: unknown): SpeakerTrackBodyFailure | undefined {
  return err instanceof SpeakerTrackBodyError ? err.reason : undefined
}

/** Bodies already read and checked, by hash (a file never changes under its hash). */
const cache = new Map<string, Promise<SpeakerTrackSet>>()

async function fetchChecked(descriptor: Pick<SpeakerTrackSetDescriptor, "url" | "sha256" | "bytes">): Promise<SpeakerTrackSet> {
  if (!(descriptor.bytes > 0 && descriptor.bytes <= SPEAKER_TRACKS_MAX_BYTES)) throw new SpeakerTrackBodyError("mismatch", "the face tracks file has no usable size.")
  let res: Response
  try {
    res = await fetch(descriptor.url)
  } catch {
    throw new SpeakerTrackBodyError("fetch", "the face tracks file could not be downloaded.")
  }
  if (!res.ok) throw new SpeakerTrackBodyError("fetch", `the face tracks file could not be read (HTTP ${res.status}).`)
  const declared = Number(res.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > descriptor.bytes) throw new SpeakerTrackBodyError("mismatch", "the face tracks file is larger than its descriptor says.")
  const buf = await res.arrayBuffer()
  const sha256 = hex(await crypto.subtle.digest("SHA-256", buf))
  if (buf.byteLength !== descriptor.bytes || sha256 !== descriptor.sha256) {
    throw new SpeakerTrackBodyError("mismatch", "the face tracks file does not match its descriptor — re-run Speaker Frames.")
  }
  try {
    return normalizeSpeakerTracks(JSON.parse(new TextDecoder().decode(buf)) as unknown)
  } catch {
    throw new SpeakerTrackBodyError("unreadable", "the face tracks file is not a track set — re-run Speaker Frames.")
  }
}

/** The checked body of a descriptor's file (cached per hash; a failed read is retried next time). */
export function readSpeakerTrackBody(descriptor: Pick<SpeakerTrackSetDescriptor, "url" | "sha256" | "bytes">): Promise<SpeakerTrackSet> {
  const hit = cache.get(descriptor.sha256)
  if (hit) return hit
  const read = fetchChecked(descriptor)
  cache.set(descriptor.sha256, read)
  read.catch(() => cache.delete(descriptor.sha256))
  return read
}

/** The funnel's reads for a canvas run. */
export const speakerViewTracksBrowserDeps: SpeakerViewTracksRunDeps = {
  loadFramesJob: async (jobId) => {
    try {
      const job = (await getJobStatus(jobId)) as { input_data?: unknown; output_data?: unknown } | null
      return job ?? null
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  },
  readTrackBody: (descriptor) => readSpeakerTrackBody(descriptor),
}
