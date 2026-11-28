/**
 * What a landed take carries on its RESULT besides its URL (A1b): its
 * thumbnail and, for a render, what the render stamped — `quality` ("proxy" is
 * a Preview), `clipKey` (the plan clip it cut), `planBasis` (the plan value it
 * cut), `renderBasis` (its own settings) and `duration` (the cut's length, what
 * a length-priced step after it is charged by; a generated video's real length
 * when its run recorded one); and, for a generation, the provider task that
 * made it (`kieTaskId` — which take the node's own task names, the clip a
 * task-chained node continues) with the resolution its job recorded
 * (`recordedResolution`). Every lane that lands a take
 * writes it — the single-node run, the browser fan-out, a server run (live and
 * at reopen) and the job restores — so the Preview label and the latest-batch
 * reader (@nodaro/shared savedRenderBatch) see the same take whichever lane
 * landed it. `__tests__/run-result-identity-sites.test.ts` holds every lane to it.
 *
 * Result fields only: a render's `quality` must never be written onto the node,
 * where `quality` is the node's own setting.
 */
import { isRenderNodeType, renderResultStamp, type RenderQuality, type RunResultRowStamp } from "@nodaro/shared/nodes"
import { deliveredVideoClips, type DeliveredVideoClip, isUseCaseNodeType, RECORDED_OUTPUT_LENGTH_NODE_TYPES, REPLACE_AUDIO_NODE_TYPE, runResultTaskFields, usecaseListsItsResult } from "@nodaro/render-rules"

export { deliveredVideoClips, type DeliveredVideoClip }

export interface RunResultIdentity {
  readonly unassembledClips?: readonly DeliveredVideoClip[]
  readonly thumbnailUrl?: string
  readonly quality?: RenderQuality
  readonly clipKey?: string
  readonly planBasis?: string
  readonly renderBasis?: string
  /** A render's cut length (a use-case node's episode length; a generated video's real length, when its run recorded one), in seconds — what the step after it is charged by (`runForwardedVideoLengthSec`). */
  readonly duration?: number
  /** A generation's provider task that made this take (`runResultTaskFields`): never on an Extend or Upscale Video node's take. */
  readonly kieTaskId?: string
  /** Beside that task, the resolution its job recorded (`input_data.resolution`, as stored), when it recorded one. */
  readonly recordedResolution?: string
  /** Replace Audio's tracks beside its video (`replaceAudioTakeTracks`): the speech it kept, the music it laid under it, and the mix of the two. */
  readonly speechUrl?: string
  readonly musicUrl?: string
  readonly mixUrl?: string
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/**
 * Replace Audio's tracks, from its run's output (`speechUrl` — absent when it
 * replaced all the sound — `musicUrl` and the final mix, `audioUrl`), as its
 * take's `speechUrl` / `musicUrl` / `mixUrl`: what the node plays under the
 * video. On the RESULT only: the node's own `musicUrl` is its setting (the
 * music it takes when none is wired).
 */
export function replaceAudioTakeTracks(output: unknown): Pick<RunResultIdentity, "speechUrl" | "musicUrl" | "mixUrl"> {
  const o = (output && typeof output === "object" ? output : {}) as Record<string, unknown>
  const speechUrl = str(o.speechUrl)
  const musicUrl = str(o.musicUrl)
  const mixUrl = str(o.audioUrl)
  return { ...(speechUrl ? { speechUrl } : {}), ...(musicUrl ? { musicUrl } : {}), ...(mixUrl ? { mixUrl } : {}) }
}

/**
 * The length a job recorded (`durationSec`, in seconds) as a result row's
 * `duration` — the length a Trim / Loop / Combine Videos after the take is
 * charged by. Nothing when it recorded none (a fixed-length generation, an
 * older job). On the RESULT only: a node's own `duration` is its setting.
 */
export function recordedVideoLengthField(output: unknown): { readonly duration?: number } {
  const sec = output && typeof output === "object" ? (output as { durationSec?: unknown }).durationSec : undefined
  return typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? { duration: sec } : {}
}

/** The identity of a take landed from a job's `output_data` or a run's node output. */
export function runResultIdentity(nodeType: string | null | undefined, output: unknown): RunResultIdentity {
  const o = (output && typeof output === "object" ? output : {}) as Record<string, unknown>
  const clips = nodeType === "generate-video-pro" || nodeType === "edit-video-pro" ? deliveredVideoClips(o) : []
  const thumbnailUrl = str(o.thumbnailUrl)
  return {
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(clips.length ? { unassembledClips: clips } : {}),
    // Only a render's stamps are a render's — and a use-case node's (Tighten
    // Episode): its take is its render's, "proxy" while it waits on review,
    // stamped with that render's plan and settings bases.
    ...(isRenderNodeType(nodeType) || isUseCaseNodeType(nodeType) ? renderResultStamp(o) : {}),
    // A render records the length of its cut, a use-case node its episode's,
    // a video generation node the length its video really is when its run
    // followed its own length (an automatic length, a Seedance Edit / Extend),
    // and a Trim the length of the file it cut; on the result row it is the
    // length the step after it is handed.
    ...(isRenderNodeType(nodeType) || isUseCaseNodeType(nodeType) || RECORDED_OUTPUT_LENGTH_NODE_TYPES.has(nodeType ?? "") ? recordedVideoLengthField(o) : {}),
    // The task that made the take, and the resolution its job recorded, on a
    // node whose own task it is: a reader of the node's task (a Grok Extend's
    // quote) finds the very take it names, and the fact its charge reads.
    ...runResultTaskFields(nodeType, o),
    // Replace Audio: the speech, music and mix it made, beside its video.
    ...(nodeType === REPLACE_AUDIO_NODE_TYPE ? replaceAudioTakeTracks(o) : {}),
  }
}

/**
 * The identity of ROW `url` of a server run's fan-out, from the run's
 * row-aligned `listResultStamps` — its own job id with it. Pairing URLs with
 * `jobIds` by position mis-paired once a row failed, finished out of order or
 * was already held; a run that published no stamps (an older execution) gives
 * no job id, and the lane then keeps its synthetic one.
 */
export function runResultRowIdentity(
  nodeType: string | null | undefined,
  output: { readonly listResults?: readonly string[]; readonly listResultStamps?: readonly RunResultRowStamp[] } | null | undefined,
  row: number,
): RunResultIdentity & { readonly jobId?: string } {
  const stamp = output?.listResultStamps?.[row]
  if (!stamp) return {}
  const jobId = str(stamp.jobId)
  return { ...(jobId ? { jobId } : {}), ...runResultIdentity(nodeType, stamp) }
}

/**
 * Whether a node's batch rows carry stamps (its rows' quality, clip and
 * bases, and each row's own job): a render, or a use-case node whose result
 * is a list (Trailer's formats, each naming the run's wrapper).
 */
export function carriesRowStamps(nodeType: string | null | undefined): boolean {
  return nodeType === "generate-video-pro" || nodeType === "edit-video-pro" || isRenderNodeType(nodeType) || usecaseListsItsResult(nodeType)
}

/** Keep the physical fan-out row through holes, filtering and duplicate URLs.
 * A Pro video's completed job is the identity that a later repair will name. */
export function runMediaRows(nodeType: string | undefined, output: {
  listResults?: readonly string[]; listResultStamps?: readonly RunResultRowStamp[]
}, previous: readonly { url: string; jobId: string }[]) {
  const pro = nodeType === "generate-video-pro" || nodeType === "edit-video-pro"
  const urls = new Set(previous.map(take => take.url))
  const jobs = new Set(previous.map(take => take.jobId))
  const all = output.listResults ?? []
  const media = all.flatMap((url, i) => url?.startsWith("http") ? [{ url, i }] : [])
  return {
    multiple: media.length > 1 || (pro && all.length > 1 && media.length === 1),
    newRows: media.filter(({ url, i }) => {
      const job = pro && output.listResultStamps?.[i]?.jobId
      return job ? !jobs.has(job) : !urls.has(url)
    }),
  }
}
