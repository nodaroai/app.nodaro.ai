/**
 * The canvas's own run of a Speaker View node (C3.2): the checks the server's
 * payload builder makes, in the interface language, and then the job. The
 * editor and the orchestrator build the same body from the same rule
 * (`@nodaro/render-rules`), so a node renders the same wherever it runs.
 *
 * Refused HERE, before anything is sent or reserved:
 *   - no edit wired: "connect an edit";
 *   - an edit the plugin would refuse (`findSpeakerViewIssues`), the rule's own
 *     words;
 *   - any run at all while Speaker View has no price: "Speaker View is not
 *     priced yet" (C4 sets the price and flips `SPEAKER_VIEW_PRICED`).
 */
import { toast } from "sonner"
import {
  SPEAKER_VIEW_NOT_PRICED_MESSAGE,
  SPEAKER_VIEW_PRICED,
  findSpeakerViewIssues,
  speakerViewContext,
  speakerViewRenderBasis,
  speakerViewWireSettings,
  type SpeakerViewNodeSettings,
} from "@nodaro/render-rules"
import { renderPlanClipKey, renderRunQuality } from "@nodaro/shared"
import { speakerView } from "@/lib/api"
import { runResultIdentity } from "@/lib/run-result-identity"
import { renderJsonOutputFields } from "@/lib/apply-edl-cut"
import type { SpeakerViewData, WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { browserRenderPlanBasis } from "./apply-edl-stamps"
import { extractNodeOutputAsList } from "./node-input-resolver"
import { nodeRunError, nodeRunText } from "./node-run-message"
import { pollJobWithNodeUpdate } from "./poll-job"
import type { ExecutionContext } from "./types"

const parseMaybe = (v: unknown): unknown => {
  if (typeof v !== "string") return v
  try { return JSON.parse(v) } catch { return undefined }
}

const blank = (v: unknown) => v === undefined || v === null || v === ""

/** The job of one Speaker View render: the video onto `generatedVideoUrl`, the
 *  EDL as drawn onto `generatedJson` and the remapped transcript onto
 *  `generatedTranscript` (so the `json` and `transcript` handles resolve on a
 *  single Run as they do on a server run; one the render carries none of is
 *  cleared), the take's identity on the RESULT only
 *  (`quality` there is the node's own setting, which a one-shot Render final
 *  must not flip). */
export function runSpeakerView(
  nodeId: string,
  params: Parameters<typeof speakerView>[0],
  ctx: ExecutionContext,
): Promise<string> {
  return pollJobWithNodeUpdate(
    nodeId,
    () => speakerView({ ...params, userId: ctx.userId }),
    "generatedVideoUrl",
    "Speaker View",
    ctx,
    (od) => renderJsonOutputFields("speaker-view", od),
    undefined,
    { resultFields: (od) => runResultIdentity("speaker-view", od) },
  )
}

/** Runs a Speaker View node on the canvas. `inputs` are the values its `edl` and
 *  `transcript` wires resolved to (JSON strings), `listRowIndex` the row of the
 *  list that drives this iteration, if one does. */
export function executeSpeakerView(
  node: WorkflowNode,
  inputs: { readonly edl?: unknown; readonly transcript?: unknown },
  ctx: ExecutionContext,
  listRowIndex: number | undefined,
): Promise<string> {
  const data = node.data as SpeakerViewData
  const fail = (message: string, error: string): Promise<never> => {
    toast.error(message)
    return Promise.reject(new Error(error))
  }

  const edlRaw = inputs.edl ?? data.edl
  if (blank(edlRaw)) return fail(nodeRunError(data.label, "nodeRun.speakerViewConnectEdl"), "speaker-view requires an EDL")
  const edl = parseMaybe(edlRaw)
  const transcriptRaw = inputs.transcript ?? data.transcript
  const transcript = blank(transcriptRaw) ? undefined : parseMaybe(transcriptRaw)

  const settings = speakerViewWireSettings(data as SpeakerViewNodeSettings, speakerViewContext(edl, transcript))
  const verdict = findSpeakerViewIssues({ edl, transcript, settings })
  if (!verdict.ok) {
    const shown = verdict.issues.slice(0, 3).map((i) => i.message)
    return fail(nodeRunText(data.label, shown.join("; ")), `speaker-view: invalid EDL — ${shown.join("; ")}`)
  }
  if (!SPEAKER_VIEW_PRICED) {
    return fail(nodeRunError(data.label, "nodeRun.speakerViewNotPriced"), SPEAKER_VIEW_NOT_PRICED_MESSAGE)
  }

  // The plan clip this iteration cuts (A1b), and the plan value it cuts (A3-1):
  // the same stamps Apply EDL's run writes, read from the plan as the canvas holds it.
  const { nodes, edges } = useWorkflowStore.getState()
  const clipKey = renderPlanClipKey(node.id, nodes, edges, (planNode) => extractNodeOutputAsList(planNode as WorkflowNode, "edl"), listRowIndex)
  const planBasis = browserRenderPlanBasis(node.id, nodes, edges, listRowIndex)
  return runSpeakerView(
    node.id,
    {
      edl,
      ...(transcript !== undefined ? { transcript } : {}),
      quality: renderRunQuality(data),
      settings,
      renderBasis: speakerViewRenderBasis(settings, verdict.edl!),
      ...(clipKey ? { clipKey } : {}),
      ...(planBasis ? { planBasis } : {}),
    },
    ctx,
  )
}
