/**
 * The Speaker View job a workflow run enqueues (C3.2): the edit, the wired
 * transcript, the node's settings and the render's stamps, in the shape the
 * cloud plugin's `SpeakerViewJobPayload` takes (the plugin's own route builds
 * the same one, and the relay forwards this as the route's body).
 *
 * Refuses HERE, before a paid render and before any credit is reserved — the
 * REST route's 400s, from the same rule (`@nodaro/render-rules`), so the
 * editor's badge, this check and the plugin agree:
 *   - an edit the plugin would refuse (`findSpeakerViewIssues`);
 *   - a run at all, should Speaker View's price be withdrawn
 *     (`SPEAKER_VIEW_PRICED`): "Speaker View is not priced yet", the plugin's
 *     own words.
 *
 * The run reserves on the row of its quality AND its price tier (C4, decided
 * 2026-10-10: `speakerViewPriceTier`, the rule the plugin's route prices
 * with), per minute of output (`speakerViewCreditOverride`).
 *
 * Face tracks (P3.9): the caller resolves them first (`tracked`, from
 * `resolveSpeakerViewTracksForRun`: the app's labels, the Speaker Frames job's
 * sources), and they travel as the stored file's descriptor with `motion` —
 * refused here, before a render, by the plugin's tracked rules mirrored and by
 * the app's own file-and-offset check (P3-20).
 */
import {
  SPEAKER_VIEW_NOT_PRICED_MESSAGE,
  SPEAKER_VIEW_PRICED,
  findSpeakerViewIssues,
  speakerViewContext,
  speakerViewPriceTier,
  speakerViewRenderBasis,
  speakerViewTrackedRuleInput,
  speakerViewWireSettings,
  type SpeakerViewTracksResolved,
} from "@nodaro/render-rules"
import { renderRunQuality, speakerViewCreditId } from "@nodaro/shared"

export interface SpeakerViewPayloadInput {
  readonly nodeId: string
  readonly jobId: string
  readonly usageLogId?: string
  /** The node's data (its settings). */
  readonly data: Readonly<Record<string, unknown>>
  /** The wired EDL / transcript, an object or its JSON string. */
  readonly edl: unknown
  readonly transcript?: unknown
  /** The plan clip this iteration cuts, and the plan value it cuts (A1b, A3-1). */
  readonly clipKey?: string
  readonly planBasis?: string
  /** The face tracks as the run sends them (absent: none wired). */
  readonly tracked?: SpeakerViewTracksResolved
}

const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v
  try { return JSON.parse(v) } catch { return undefined }
}

/** The payload and the credit id the run reserves on. Throws with the rule's
 *  words when the run cannot go ahead. */
export function buildSpeakerViewPayload(input: SpeakerViewPayloadInput): { payload: Record<string, unknown>; creditId: string } {
  const edl = parse(input.edl)
  const transcript = input.transcript === undefined || input.transcript === null || input.transcript === "" ? undefined : parse(input.transcript)
  if (!edl || typeof edl !== "object") throw new Error("speaker-view: connect an edit (Edit Plan's or Camera Switch's EDL) to the EDL input")

  const ctx = speakerViewContext(edl, transcript)
  // Normalized against the REAL edit: a layout the aspect or its speaker count
  // rules out snaps here, the same way the panel says it will.
  const wire = speakerViewWireSettings(input.data, ctx)
  // The tracks join the body, not the settings basis: their own part of the
  // basis (`tracked.basis`) is what the editor's review computes too.
  const tracked = speakerViewTrackedRuleInput(input.tracked)
  const settings = { ...wire, ...tracked.wire }
  const verdict = findSpeakerViewIssues({ edl, transcript, settings, ...tracked.rule })
  if (!verdict.ok) {
    const shown = verdict.issues.slice(0, 3).map((i) => i.message)
    const more = verdict.issues.length - shown.length
    throw new Error(`speaker-view: invalid EDL — ${shown.join("; ")}${more > 0 ? ` (+${more} more)` : ""}`)
  }
  if (!SPEAKER_VIEW_PRICED) throw new Error(SPEAKER_VIEW_NOT_PRICED_MESSAGE)

  const quality = renderRunQuality(input.data)
  const creditId = speakerViewCreditId(quality, speakerViewPriceTier({ edl: verdict.edl, transcript, settings }))
  return {
    creditId,
    payload: {
      jobId: input.jobId,
      edl,
      ...(transcript !== undefined ? { transcript } : {}),
      quality,
      ...settings,
      ...(input.clipKey ? { clipKey: input.clipKey } : {}),
      ...(input.planBasis ? { planBasis: input.planBasis } : {}),
      renderBasis: speakerViewRenderBasis(wire, verdict.edl!, input.tracked?.basis),
      reservedCreditId: creditId,
      nodeId: input.nodeId,
      usageLogId: input.usageLogId,
    },
  }
}
