/**
 * A use-case node's run result (Tighten Episode, decided 2026-10-13) on the
 * node — ONE mapping for every lane that lands it: the canvas run and its
 * failure keeper (`use-case-executor.ts`), the live server run, both reopen
 * lanes, the job restores and the reconcile of a job that finished while the
 * editor was closed (each through `applyEdlRunCutFields` /
 * `applyEdlTakeTranscriptField`, lib/apply-edl-cut.ts).
 *
 * What a run reports (the wrapper job's `output_data`, or the server node
 * output — the same keys): the episode as video OR audio, the plan on `json`
 * (`plan` is the same value), the transcript, and the take's quality.
 *
 *  - The episode is ONE medium: landing one clears the other, so an earlier
 *    video never sits beside an audio episode (both engines read the video
 *    first).
 *  - The plan lands on `generatedJson` under the Edit Plan's review rule
 *    (`editPlanResultPatch`): the person's edit survives only when it was made
 *    on this very plan, so a new plan never hands on an edit of an older one.
 *  - The transcript lands on `generatedTranscript` — cleared when the run
 *    carries none, never an earlier run's.
 *  - The run's wrapper job lands on `useCaseJobId` (a lane passes the job its
 *    node state or job row names), so Continue and Render final can address a
 *    server run as they address the canvas's own.
 */
import { editPlanResultPatch } from "@nodaro/shared/edl"
import { TIGHTEN_EPISODE, isUseCaseNodeType } from "@nodaro/render-rules"
import { runResultIdentity } from "@/lib/run-result-identity"
import { isAudioUrl, isVideoUrl } from "@/lib/media-type"

type Output = Readonly<Record<string, unknown>>

const url = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
const present = (v: unknown): boolean => v !== undefined && v !== null

/** The episode a run reports: its one medium and URL, or undefined when it reports none. */
export function usecaseEpisodeOf(output: Output | null | undefined): { medium: "video" | "audio"; url: string } | undefined {
  const video = url(output?.videoUrl)
  if (video) return { medium: "video", url: video }
  const audio = url(output?.audioUrl)
  return audio ? { medium: "audio", url: audio } : undefined
}

/** The plan a run reports (`json`, or `plan` — the same value). */
function planOf(output: Output | null | undefined): unknown {
  return present(output?.json) ? output!.json : present(output?.plan) ? output!.plan : undefined
}

/**
 * The json outputs of a run: the plan (under the review rule, read against the
 * node's `editedEdl`) and the transcript, each `undefined` when the run carries
 * none so landing it clears what an earlier run left. Empty when the run
 * carries neither (a run that reports nothing writes nothing).
 */
export function usecaseJsonFields(output: Output | null | undefined, data: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  const plan = planOf(output)
  const transcript = present(output?.transcript) ? output!.transcript : undefined
  if (plan === undefined && transcript === undefined && !usecaseEpisodeOf(output)) return {}
  return {
    ...(plan === undefined ? { generatedJson: undefined } : editPlanResultPatch(plan, data?.editedEdl)),
    generatedTranscript: transcript,
  }
}

/**
 * Everything a finished run writes on the node: the episode (one medium set,
 * the other cleared) and its json outputs. `undefined` for any other node type.
 * Spread it AFTER a lane's own media writes.
 */
export function usecaseRunResultFields(
  nodeType: string | null | undefined,
  output: Output | null | undefined,
  data: Readonly<Record<string, unknown>> | undefined,
  /** The run's wrapper job (a server run's node state names it), kept so Continue / Render final can address it. */
  jobId?: string | null,
): Record<string, unknown> | undefined {
  if (!isUseCaseNodeType(nodeType)) return undefined
  const episode = usecaseEpisodeOf(output)
  return {
    ...(episode?.medium === "video" ? { generatedVideoUrl: episode.url, generatedAudioUrl: undefined } : {}),
    ...(episode?.medium === "audio" ? { generatedAudioUrl: episode.url, generatedVideoUrl: undefined } : {}),
    ...usecaseJsonFields(output, data),
    ...wrapperOf(jobId),
  }
}

/** The run's wrapper job on the node, as the canvas's own run keeps it (`useCaseJobId`). */
function wrapperOf(jobId: string | null | undefined): { useCaseJobId?: string } {
  return typeof jobId === "string" && jobId !== "" ? { useCaseJobId: jobId } : {}
}

/**
 * What a FAILED run keeps on the node, from a lane that lands a server run's
 * failure and from the canvas's own run: what it finished — the episode its
 * render made, when it got that far (one medium set, the other cleared), its
 * plan and transcript (under the review rule) — and its wrapper job, so
 * Continue can pick it up. A failure that names no wrapper (a refusal before
 * the run started) clears the node's job: there is nothing to continue, and
 * an earlier run's job must not be resumed in its place. `undefined` for any
 * other node type.
 *
 * The failure's code rides along (`errorCode`, cleared when it has none), so
 * the node shows a refusal in the reader's language. A refused Render final
 * (a final of the same preview under way, or already made with this edit)
 * names that final (`useCaseFinalJobId`): when the node holds its take, that
 * take is put on show — the final the person asked for.
 */
export function usecaseFailedRunFields(
  nodeType: string | null | undefined,
  output: Output | null | undefined,
  data: Readonly<Record<string, unknown>> | undefined,
  jobId: string | null | undefined,
  errorCode?: string | null,
): Record<string, unknown> | undefined {
  if (!isUseCaseNodeType(nodeType)) return undefined
  const named = typeof output?.useCaseFinalJobId === "string" ? output.useCaseFinalJobId : undefined
  const takes = Array.isArray(data?.generatedResults) ? (data!.generatedResults as Array<{ url?: unknown; jobId?: unknown }>) : []
  const at = named ? takes.findIndex((t) => t?.jobId === named && typeof t.url === "string" && t.url !== "") : -1
  const shown = at >= 0 ? showTake(at, takes[at]!.url as string, data!) : {}
  return {
    ...(output ? usecaseRunResultFields(nodeType, output, data) : {}),
    useCaseJobId: typeof jobId === "string" && jobId !== "" ? jobId : undefined,
    ...shown,
    errorCode: typeof errorCode === "string" && errorCode !== "" ? errorCode : undefined,
  }
}

/** Take `index` (file `url`) on show as the node's one episode. */
function showTake(index: number, url: string, data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const medium = usecaseTakeMedium(url, data)
  return { activeResultIndex: index, [medium === "video" ? "generatedVideoUrl" : "generatedAudioUrl"]: url, [medium === "video" ? "generatedAudioUrl" : "generatedVideoUrl"]: undefined }
}

/**
 * What the take whose file is `url` keeps of the run (its plan and transcript),
 * so a later pick restores them with no job read, and the settings the run was
 * built from (`useCaseSettings`): a Render final of that take renders with
 * them, and its review reads them (decided 2026-10-13). Only on the take that
 * IS the episode the output reports; `undefined` for any other node type or take.
 */
export function usecaseTakeFields(
  nodeType: string | null | undefined,
  output: Output | null | undefined,
  takeUrl: string | null | undefined,
): Record<string, unknown> | undefined {
  if (!isUseCaseNodeType(nodeType)) return undefined
  const episode = usecaseEpisodeOf(output)
  if (!episode || episode.url !== takeUrl) return undefined
  const plan = planOf(output)
  const settings = runSettingsOf(output?.useCaseSettings)
  return {
    generatedJson: plan,
    generatedTranscript: present(output?.transcript) ? output!.transcript : undefined,
    ...(settings ? { useCaseSettings: settings } : {}),
  }
}

/**
 * Everything the canvas's own run puts on the take it lands: the take's stamps
 * (`runResultIdentity`: quality and its render's bases) and what it keeps of
 * the run (`usecaseTakeFields`) — the same fields the server lanes put on theirs.
 */
export function usecaseTakeResultFields(output: Output): Record<string, unknown> {
  return { ...runResultIdentity(TIGHTEN_EPISODE, output), ...usecaseTakeFields(TIGHTEN_EPISODE, output, usecaseEpisodeOf(output)?.url) }
}

const runSettingsOf = (v: unknown): Readonly<Record<string, unknown>> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Readonly<Record<string, unknown>>) : undefined

/** One take of a use-case node, as its result entry holds it. */
export interface UseCaseTake {
  readonly url?: unknown
  readonly jobId?: unknown
  readonly quality?: unknown
  readonly useCaseSettings?: unknown
}

/** The take on show: the picked result (the newest when none is picked). */
export function usecaseTakeOnShow(data: Readonly<Record<string, unknown>>): UseCaseTake | undefined {
  const results = Array.isArray(data.generatedResults) ? (data.generatedResults as UseCaseTake[]) : []
  const index = typeof data.activeResultIndex === "number" ? data.activeResultIndex : 0
  return results[index] ?? undefined
}

/** The settings the run of the take on show was built from; undefined for a take that kept none. */
export function usecaseRunSettings(data: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  return runSettingsOf(usecaseTakeOnShow(data)?.useCaseSettings)
}

/**
 * The medium of the take whose file is `url`: the file's own, else the episode
 * field that holds it, else the node's Output. One rule for what the node face
 * plays and for what a pick in the results gallery writes.
 */
export function usecaseTakeMedium(url: string, data: Readonly<Record<string, unknown>>): "video" | "audio" {
  if (isAudioUrl(url)) return "audio"
  if (isVideoUrl(url)) return "video"
  if (data.generatedAudioUrl === url) return "audio"
  if (data.generatedVideoUrl === url) return "video"
  return data.output === "audio" ? "audio" : "video"
}
