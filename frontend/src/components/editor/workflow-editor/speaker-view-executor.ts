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
 *
 * Face tracks (P3.9) go through the funnel the server's run uses
 * (`resolveSpeakerViewTracksForRun`): the app's labels — the rename map, the
 * corrections on the Speaker Frames node and, from the stored body, the region
 * match — and the Speaker Frames job's sources for P3-20's file-and-offset
 * check, which on nodaro.ai only the app makes (the plugin's route cannot).
 * Tracks come from the wire only; a wire whose Speaker Frames has no output is
 * refused, never rendered as v1 (§5).
 */
import { toast } from "sonner"
import {
  SPEAKER_VIEW_NOT_PRICED_MESSAGE,
  SPEAKER_VIEW_PRICED,
  findSpeakerViewIssues,
  resolveSpeakerViewTracksForRun,
  speakerViewContext,
  speakerViewRenderBasis,
  speakerViewTrackedRuleInput,
  speakerViewWireSettings,
  type SpeakerViewNodeSettings,
  type SpeakerViewTracksResolved,
} from "@nodaro/render-rules"
import { speakerViewTracksBrowserDeps } from "@/lib/speaker-track-body"
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
export async function executeSpeakerView(
  node: WorkflowNode,
  inputs: { readonly edl?: unknown; readonly transcript?: unknown; readonly tracks?: unknown; readonly trackAssignments?: unknown },
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

  let tracked: SpeakerViewTracksResolved | undefined
  try {
    // The wire only (§5): "" is a wire whose Speaker Frames has no output.
    tracked = await resolveSpeakerViewTracksForRun(
      { tracks: inputs.tracks, wired: inputs.tracks !== undefined, trackAssignments: inputs.trackAssignments, transcript, data: data as Record<string, unknown> },
      speakerViewTracksBrowserDeps,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return fail(nodeRunText(data.label, message), message)
  }

  const settings = speakerViewWireSettings(data as SpeakerViewNodeSettings, speakerViewContext(edl, transcript))
  const trackedRule = speakerViewTrackedRuleInput(tracked)
  const verdict = findSpeakerViewIssues({ edl, transcript, settings: { ...settings, ...trackedRule.wire }, ...trackedRule.rule })
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
      settings: { ...settings, ...trackedRule.wire },
      renderBasis: speakerViewRenderBasis(settings, verdict.edl!, tracked?.basis),
      ...(clipKey ? { clipKey } : {}),
      ...(planBasis ? { planBasis } : {}),
    },
    ctx,
  )
}
