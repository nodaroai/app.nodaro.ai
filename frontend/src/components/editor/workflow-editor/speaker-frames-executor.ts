/**
 * The canvas's own run of a Speaker Frames node (P3.6): the checks the server's
 * payload builder makes, in the interface language, and then the job. The
 * editor and the orchestrator read the same rule (`@nodaro/render-rules`), so a
 * node samples the same footage wherever it runs.
 *
 * Refused HERE, before anything is sent or reserved:
 *   - nothing wired: "connect an edit or a video";
 *   - the scope the plugin would refuse (`speakerFramesScope`), its own words —
 *     an edit AND a bare video wired together included (P3.4): both reach the
 *     scope, which refuses the pair, as the route and the plugin do;
 *
 * The untick list sent is the node's, narrowed to the cameras the current edit
 * samples (`speakerFramesLiveExclusions`): an id left from an earlier wiring is
 * invisible in the panel and would otherwise refuse every run.
 *   - any run at all while Speaker Frames has no price: "Speaker Frames is not
 *     priced yet" (P3.7 sets the price and flips `SPEAKER_FRAMES_PRICED`).
 *
 * The edit arrives FOLDED (`inputs.inputs`, FAN_IN_TARGETS): one JSON string
 * per edit, so a clip pack is one run over the union of its clips (P3-24 (a)).
 * The transcript is sent as given — Camera Switch's renamed transcript keeps
 * its `speakerNames` map, which transcript-led identity reads.
 */
import { toast } from "sonner"
import {
  SPEAKER_FRAMES_NOT_PRICED_MESSAGE,
  SPEAKER_FRAMES_PRICED,
  coerceSpeakerFramesEdits,
  speakerFramesLiveExclusions,
  speakerFramesScope,
} from "@nodaro/render-rules"
import type { Edl } from "@nodaro/shared"
import { speakerFrames } from "@/lib/api"
import { tx } from "@/lib/i18n"
import type { SpeakerFramesNodeData, WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { shouldAbandonNode } from "./abandon-guard"
import { nodeRunError, nodeRunText } from "./node-run-message"
import { jobGoneMessage, shouldStopPolling } from "./poll-connection"
import { RUN_START_RESET, getJobStatusLeanForNode, guardedToast } from "./poll-job"
import { WorkflowStaleError, updateProgressIfChanged, type ExecutionContext } from "./types"

const parseMaybe = (v: unknown): unknown => {
  if (typeof v !== "string") return v
  try { return JSON.parse(v) } catch { return undefined }
}

const blank = (v: unknown) => v === undefined || v === null || v === ""

export interface SpeakerFramesInputs {
  /** The folded `edl` wire: one JSON string per edit. */
  readonly inputs?: readonly string[]
  readonly edl?: unknown
  readonly videoUrl?: string
  readonly transcript?: unknown
}

/** Runs a Speaker Frames node on the canvas. */
export function executeSpeakerFrames(node: WorkflowNode, inputs: SpeakerFramesInputs, ctx: ExecutionContext): Promise<string> {
  const data = node.data as SpeakerFramesNodeData
  const fail = (message: string, error: string): Promise<never> => {
    toast.error(message)
    return Promise.reject(new Error(error))
  }

  const rawEdit: unknown = inputs.inputs && inputs.inputs.length > 0 ? inputs.inputs : (inputs.edl ?? data.edl)
  const hasEdit = !blank(rawEdit)
  const videoUrl = typeof inputs.videoUrl === "string" && inputs.videoUrl ? inputs.videoUrl : undefined
  if (!hasEdit && !videoUrl) return fail(nodeRunError(data.label, "nodeRun.speakerFramesConnectInput"), "speaker-frames requires an edit or a video")

  let edits: Edl[] | undefined
  if (hasEdit) {
    const coerced = coerceSpeakerFramesEdits(rawEdit)
    if (!coerced.ok) return fail(nodeRunText(data.label, coerced.message), coerced.message)
    edits = coerced.edits
  }
  const excludeSourceIds = speakerFramesLiveExclusions(edits ?? [], data.excludeSourceIds)
  const scope = speakerFramesScope({ ...(edits ? { edits, excludeSourceIds } : {}), ...(videoUrl ? { videoUrl } : {}) })
  if (!scope.ok) return fail(nodeRunText(data.label, scope.message), scope.message)
  if (!SPEAKER_FRAMES_PRICED) return fail(nodeRunError(data.label, "nodeRun.speakerFramesNotPriced"), SPEAKER_FRAMES_NOT_PRICED_MESSAGE)

  const transcriptRaw = inputs.transcript ?? data.transcript
  const transcript = blank(transcriptRaw) ? undefined : parseMaybe(transcriptRaw)
  const { updateNodeData } = useWorkflowStore.getState()
  updateNodeData(node.id, { ...RUN_START_RESET, generatedJson: undefined, currentJobProgress: undefined })

  return new Promise<string>((resolve, reject) => {
    const failRun = (message: string, err: unknown) => {
      updateNodeData(node.id, { executionStatus: "failed", errorMessage: message, currentJobId: undefined, currentJobProgress: undefined })
      reject(err instanceof Error ? err : new Error(message))
    }
    speakerFrames({
      ...(edits ? { edl: edits.length === 1 ? edits[0] : edits, excludeSourceIds } : {}),
      ...(videoUrl ? { videoUrl } : {}),
      ...(transcript !== undefined && typeof transcript === "object" ? { transcript } : {}),
      userId: ctx.userId,
    })
      .then(({ jobId }) => {
        guardedToast.info(tx("nodeRun.speakerFramesStarted"), { description: tx("run.jobIdLine", { id: jobId }) })
        updateNodeData(node.id, { currentJobId: jobId })
        let pollFailures = 0
        const poll = ctx.trackInterval(
          setInterval(async () => {
            if (ctx.isWorkflowStale()) {
              ctx.untrackInterval(poll)
              reject(new WorkflowStaleError())
              return
            }
            try {
              const job = await getJobStatusLeanForNode(jobId, node.id)
              pollFailures = 0
              if (job.status === "processing" && job.progress != null) updateProgressIfChanged(node.id, job.progress, updateNodeData)
              if ((job.status === "completed" || job.status === "failed") && shouldAbandonNode(node.id, jobId)) {
                ctx.untrackInterval(poll)
                resolve("")
                return
              }
              if (job.status === "completed") {
                ctx.untrackInterval(poll)
                const json = (job.output_data as Record<string, unknown> | undefined)?.json
                updateNodeData(node.id, { executionStatus: "completed", generatedJson: json, currentJobId: undefined, currentJobProgress: undefined })
                guardedToast.success(tx("nodeRun.speakerFramesComplete"))
                resolve(json === undefined ? "" : JSON.stringify(json))
              } else if (job.status === "failed") {
                ctx.untrackInterval(poll)
                const errMsg = job.error_message ?? "Speaker Frames failed"
                guardedToast.error(tx("nodeRun.speakerFramesFailed"), { description: errMsg })
                failRun(errMsg, new Error(errMsg))
              }
            } catch (err) {
              pollFailures++
              if (shouldStopPolling(err, pollFailures, { nodeId: node.id, jobId })) {
                ctx.untrackInterval(poll)
                if (shouldAbandonNode(node.id, jobId)) {
                  resolve("")
                  return
                }
                guardedToast.error(tx("nodeRun.speakerFramesFailed"))
                failRun(jobGoneMessage(), err)
              }
            }
          }, 2000),
        )
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : tx("lib.unknownError")
        guardedToast.error(tx("apiErr.startSpeakerFrames"), { description: message })
        failRun(message, err)
      })
  })
}
