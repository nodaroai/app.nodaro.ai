/**
 * The server's reads behind Speaker View's face tracks (P3.9), for the one
 * funnel both engines share (`resolveSpeakerViewTracksForRun`,
 * `@nodaro/render-rules`):
 *
 *  - the Speaker Frames job the track file was made by, OWNER-SCOPED: a file
 *    is keyed `speaker-tracks/<jobId>.json` (on nodaro.ai and in a connected
 *    self-host's own copy alike), and only that user's job is read — its
 *    stored edit is what P3-20's file-and-offset check compares against;
 *  - the stored box body, read from this install's own storage and checked
 *    against the descriptor's `bytes` and `sha256` before it is parsed — only
 *    the read-time region match needs it (P3-21 (a)).
 */
import { createHash } from "node:crypto"
import { SPEAKER_TRACKS_MAX_BYTES, type SpeakerTrackSetDescriptor } from "@nodaro/shared/edl"
import { resolveSpeakerViewTracksForRun, type SpeakerViewTracksResolved, type SpeakerViewTracksRunDeps } from "@nodaro/render-rules"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Why the stored track file could not be used: a plain error, so the node fails with it. */
export class SpeakerTrackBodyError extends Error {
  constructor(message: string) {
    super(`speaker-view: ${message}`)
    this.name = "SpeakerTrackBodyError"
  }
}

export interface SpeakerViewTracksIo {
  readonly loadJob: (jobId: string, userId: string) => Promise<{ input_data?: unknown; output_data?: unknown } | null>
  /** The bytes of one of THIS install's stored objects by its public URL, or
   *  null when the URL is not ours. Bounded by `maxBytes`. */
  readonly readOwn: (url: string, maxBytes: number) => Promise<Buffer | null>
}

const defaultIo: SpeakerViewTracksIo = {
  loadJob: async (jobId, userId) => {
    const { supabase } = await import("./supabase.js")
    const { data, error } = await supabase.from("jobs").select("input_data, output_data").eq("id", jobId).eq("user_id", userId).maybeSingle()
    if (error) throw new Error(`speaker-view: could not read the Speaker Frames job behind the face tracks (${error.message})`)
    return (data as { input_data?: unknown; output_data?: unknown } | null) ?? null
  },
  readOwn: async (url, maxBytes) => {
    const { r2KeyFromOurUrl, readR2Object } = await import("./storage.js")
    const key = r2KeyFromOurUrl(url)
    if (!key) return null
    const obj = await readR2Object(key, { maxBytes })
    if (!obj) return null
    if (obj.size !== null && obj.size > maxBytes) throw new SpeakerTrackBodyError(`the face tracks file is ${obj.size} bytes, over the ${maxBytes}-byte limit.`)
    return obj.body
  },
}

/** The body the descriptor names, checked: its size, then its hash, then JSON. */
export async function readSpeakerTrackBody(descriptor: SpeakerTrackSetDescriptor, io: Pick<SpeakerViewTracksIo, "readOwn"> = defaultIo): Promise<unknown> {
  const limit = Math.min(SPEAKER_TRACKS_MAX_BYTES, Math.max(0, descriptor.bytes))
  const body = await io.readOwn(descriptor.url, limit)
  if (!body) throw new SpeakerTrackBodyError("the face tracks file is not in this install's storage — re-run Speaker Frames here.")
  const sha256 = createHash("sha256").update(body).digest("hex")
  if (body.length !== descriptor.bytes || sha256 !== descriptor.sha256) {
    throw new SpeakerTrackBodyError(`the face tracks file does not match its descriptor (${body.length} bytes; expected ${descriptor.bytes}) — re-run Speaker Frames.`)
  }
  try {
    return JSON.parse(body.toString("utf8")) as unknown
  } catch {
    throw new SpeakerTrackBodyError("the face tracks file is not JSON — re-run Speaker Frames.")
  }
}

/** The funnel's reads for one user's run. */
export function speakerViewTracksServerDeps(userId: string, io: SpeakerViewTracksIo = defaultIo): SpeakerViewTracksRunDeps {
  return {
    loadFramesJob: async (jobId) => (UUID.test(jobId) ? io.loadJob(jobId, userId) : null),
    readTrackBody: (descriptor) => readSpeakerTrackBody(descriptor, io),
  }
}

/**
 * Speaker View's face tracks as a workflow run sends them (P3.9), through the
 * one funnel the editor's run shares. Tracks come from the `tracks` wire only
 * (§5): the resolver records a wire whose Speaker Frames has no output as
 * `null`, which the rule refuses; an inline `data.tracks` is never read (the
 * editor's run does not read one either). Undefined with no wire.
 */
export async function resolveSpeakerViewTracksOfNode(
  node: { readonly data?: unknown },
  resolvedInputs: { readonly tracks?: string | null; readonly trackAssignments?: unknown; readonly transcript?: unknown },
  deps: SpeakerViewTracksRunDeps,
): Promise<SpeakerViewTracksResolved | undefined> {
  const data = (node.data ?? {}) as Record<string, unknown>
  return resolveSpeakerViewTracksForRun(
    {
      tracks: resolvedInputs.tracks ?? undefined,
      wired: resolvedInputs.tracks !== undefined,
      trackAssignments: resolvedInputs.trackAssignments,
      transcript: resolvedInputs.transcript ?? data.transcript,
      data,
    },
    deps,
  )
}
