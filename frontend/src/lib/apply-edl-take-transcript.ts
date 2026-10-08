/**
 * Apply EDL: a picked take's Transcript output (decided 2026-10-04).
 *
 * Each Apply EDL render carries the wired transcript remapped through ITS cut
 * (the job's `output_data.json`). The node's Transcript output
 * (`generatedJson`) is what a captions step downstream times its words by, so
 * after a pick it must be the picked take's own: another take's transcript is
 * timed to a different cut, and captions burned from it drift off the speech.
 *
 * Every lane that lands a take keeps that render's transcript on its result —
 * or, as an own `undefined`, that it was cut with none (lib/apply-edl-cut.ts) —
 * and the pick restores it (results-gallery-media.ts). A take that kept none —
 * a list run's renders after its first (the run's output carries only its first
 * render's transcript; the browser list lane keeps none at all), or one saved
 * before landed takes kept theirs — has the pick CLEAR the Transcript output,
 * and this module then reads the take's own transcript back from the job that
 * rendered it — once per pick, never per render — but only from a job that is
 * provably that take's:
 *   - The take's `jobId` must be a real job id (lib/uuid.ts). The browser
 *     fan-out lane stamps synthetic `iter-…` ids, and the server-run and load
 *     lanes fall back to `exec-…` ids.
 *   - The job's output must be the take's own file. The server-run lane pairs a
 *     fan-out's URLs with `jobIds` by position after dropping holes and URLs it
 *     already holds, so a real id can belong to a sibling clip's job.
 * Otherwise the Transcript output stays cleared: a consumer then gets no
 * transcript rather than another cut's timing (Add Captions transcribes the cut
 * it receives, or refuses for want of a caption source when auto-transcribe is
 * off).
 *
 * The same holds for EVERY json output a render lands (`renderSavedJsonOutputs`):
 * Speaker View's EDL as drawn (`generatedJson`) and its remapped transcript
 * (`generatedTranscript`, decided 2026-10-08) are each restored from what the
 * take kept, and each one it kept none of is read back from its job — one read
 * for all of them.
 */
import { renderSavedJsonOutputs, RENDER_JSON_HANDLE, type RenderSavedJsonOutput } from "@nodaro/shared"
import { getJobStatusLean } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isValidUuid } from "@/lib/uuid"

/** One entry of an Apply EDL node's `generatedResults`. */
export interface ApplyEdlTake {
  readonly url: string
  readonly jobId?: string
  /** The Transcript this take was cut with, kept by the lane that landed it
   *  (an own `undefined`: it was cut with none). Speaker View: its EDL as drawn. */
  readonly generatedJson?: unknown
  /** Speaker View: the transcript remapped through this take's cut, kept the
   *  same way. */
  readonly generatedTranscript?: unknown
}

type Data = Readonly<Record<string, unknown>>

/** Apply EDL's one json output: the Transcript on `json` / `generatedJson`. */
const JSON_OUTPUT: RenderSavedJsonOutput = { outputKey: RENDER_JSON_HANDLE, dataField: "generatedJson" }

/** Whether the take kept the output it was cut with on its own result (the
 *  Transcript on `generatedJson` unless another field is named). */
export function takeKeptTranscript(take: ApplyEdlTake, dataField: string = JSON_OUTPUT.dataField): boolean {
  return Object.prototype.hasOwnProperty.call(take, dataField)
}

/** The job a pick may read the take's Transcript from: a real job id only. */
export function readableTakeJobId(take: ApplyEdlTake): string | undefined {
  return typeof take.jobId === "string" && isValidUuid(take.jobId) ? take.jobId : undefined
}

/**
 * The Transcript in a job's output when that output is the take's own file,
 * else `undefined`. A job whose render had no transcript wired carries none.
 */
export function takeTranscriptFromJob(take: ApplyEdlTake, outputData: Data | null | undefined, outputKey: string = JSON_OUTPUT.outputKey): unknown {
  if (!outputData) return undefined
  if (outputData.videoUrl !== take.url && outputData.audioUrl !== take.url) return undefined
  return outputData[outputKey] ?? undefined
}

export interface TakeTranscriptDeps {
  /** The job's `output_data`. Rejects when the job cannot be read. */
  readonly fetchJobOutput: (jobId: string) => Promise<Data | null | undefined>
  /** The node's current data, or `undefined` once it is gone. */
  readonly nodeData: (nodeId: string) => Data | undefined
  readonly updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void
}

const STORE_DEPS: TakeTranscriptDeps = {
  // GET /v1/jobs/:id/status: authenticated, readable by the job's owner only,
  // and it returns output_data WITHOUT input_data — which for Apply EDL holds
  // the whole wired source transcript, never needed here. One read per pick of a
  // finished job: no poll loop, so no hold flag to keep in sync.
  fetchJobOutput: async (jobId) => (await getJobStatusLean(jobId)).output_data as Data | null | undefined,
  nodeData: (nodeId) => useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as Data | undefined,
  updateNodeData: (nodeId, patch) => useWorkflowStore.getState().updateNodeData(nodeId, patch),
}

/**
 * After a pick of `take` on Apply EDL node `nodeId`: when the take kept no
 * Transcript, read its own from the job that rendered it and make it the
 * node's Transcript output. The pick has already cleared that output, so a
 * take whose job is synthetic, unreadable or another take's leaves it cleared.
 *
 * Writes only while the node still selects this take and its Transcript output
 * is still cleared: the person may pick again, or a run may land a new take,
 * before the job answers. Resolves `true` when it wrote, and never rejects.
 */
export async function restorePickedTakeTranscript(
  nodeId: string,
  take: ApplyEdlTake,
  deps: TakeTranscriptDeps = STORE_DEPS,
  /** The render's node type: which json outputs it lands (Apply EDL's
   *  Transcript on `generatedJson` when not given). */
  nodeType?: string,
): Promise<boolean> {
  const outputs = nodeType === undefined ? [JSON_OUTPUT] : renderSavedJsonOutputs(nodeType)
  const missing = outputs.filter((o) => !takeKeptTranscript(take, o.dataField))
  if (missing.length === 0) return false
  const jobId = readableTakeJobId(take)
  if (!jobId) return false
  let outputData: Data | null | undefined
  try {
    outputData = await deps.fetchJobOutput(jobId)
  } catch {
    return false
  }
  const found = missing
    .map((o) => [o.dataField, takeTranscriptFromJob(take, outputData, o.outputKey)] as const)
    .filter(([, value]) => value !== undefined)
  if (found.length === 0) return false
  const data = deps.nodeData(nodeId)
  if (!data) return false
  const results = data.generatedResults as ReadonlyArray<{ readonly url?: string }> | undefined
  const selected = results?.[(data.activeResultIndex as number | undefined) ?? 0]
  if (selected?.url !== take.url) return false
  // Never over a value something wrote since the pick cleared it.
  const patch = Object.fromEntries(found.filter(([field]) => data[field] === undefined))
  if (Object.keys(patch).length === 0) return false
  deps.updateNodeData(nodeId, patch)
  return true
}
