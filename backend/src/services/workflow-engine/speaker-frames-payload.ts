/**
 * The Speaker Frames job a workflow run enqueues (P3.6): the plugin's
 * `SpeakerFramesJobPayload` — the edit (one, or a clip pack folded onto the
 * `edl` wire, P3-24 (a)) or a bare video, the wired transcript AS GIVEN (Camera
 * Switch's renamed transcript carries its `speakerNames` map, which
 * transcript-led identity reads), and the node's untick list.
 *
 * Refuses HERE, before any credit is reserved, with the plugin route's words:
 *   - the scope the plugin would refuse (`speakerFramesScope`, its rule verbatim)
 *     — an edit AND a bare video wired together included (P3.4): both reach
 *     the scope, which refuses the pair, as the route and the plugin do;
 *
 * The untick list sent is the node's, narrowed to the cameras the current edit
 * samples (`speakerFramesLiveExclusions`): an id left from an earlier wiring is
 * invisible in the panel and would otherwise refuse every run.
 *   - a run at all while Speaker Frames has no price (P3.7): "Speaker Frames is
 *     not priced yet".
 */
import {
  SPEAKER_FRAMES_CREDIT_ID,
  SPEAKER_FRAMES_NOT_PRICED_MESSAGE,
  SPEAKER_FRAMES_PRICED,
  coerceSpeakerFramesEdits,
  speakerFramesLiveExclusions,
  speakerFramesScope,
} from "@nodaro/render-rules"
import type { Edl } from "@nodaro/shared"

export interface SpeakerFramesPayloadInput {
  readonly nodeId: string
  readonly jobId: string
  readonly usageLogId?: string
  readonly data: Readonly<Record<string, unknown>>
  /** The folded `edl` wire: one JSON string per edit (a pack holds several). */
  readonly edits?: readonly string[]
  /** An edit set on the node itself (an object or its JSON string). */
  readonly edl?: unknown
  readonly videoUrl?: string
  readonly transcript?: unknown
}

const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v
  try {
    return JSON.parse(v)
  } catch {
    return undefined
  }
}

export function buildSpeakerFramesPayload(input: SpeakerFramesPayloadInput): { payload: Record<string, unknown>; creditId: string } {
  const raw: unknown = input.edits && input.edits.length > 0 ? input.edits : input.edl
  const hasEdit = raw !== undefined && raw !== null && raw !== ""
  const videoUrl = typeof input.videoUrl === "string" && input.videoUrl ? input.videoUrl : undefined
  if (!hasEdit && !videoUrl) throw new Error("speaker-frames: connect an edit (Edit Plan's or Camera Switch's EDL) to the EDL input, or a video to the Video input")

  let edits: Edl[] | undefined
  if (hasEdit) {
    const coerced = coerceSpeakerFramesEdits(raw)
    if (!coerced.ok) throw new Error(coerced.message)
    edits = coerced.edits
  }
  const excludeSourceIds = speakerFramesLiveExclusions(
    edits ?? [],
    Array.isArray(input.data.excludeSourceIds) ? (input.data.excludeSourceIds as unknown[]).filter((v): v is string => typeof v === "string") : [],
  )
  const scope = speakerFramesScope({ ...(edits ? { edits } : {}), ...(videoUrl ? { videoUrl } : {}), ...(edits ? { excludeSourceIds } : {}) })
  if (!scope.ok) throw new Error(scope.message)
  if (!SPEAKER_FRAMES_PRICED) throw new Error(SPEAKER_FRAMES_NOT_PRICED_MESSAGE)

  const transcript = input.transcript === undefined || input.transcript === null || input.transcript === "" ? undefined : parse(input.transcript)
  return {
    creditId: SPEAKER_FRAMES_CREDIT_ID,
    payload: {
      jobId: input.jobId,
      ...(edits ? { edl: edits.length === 1 ? edits[0] : edits } : {}),
      ...(videoUrl ? { videoUrl } : {}),
      ...(transcript !== undefined && typeof transcript === "object" ? { transcript } : {}),
      ...(edits ? { excludeSourceIds } : {}),
      reservedCreditId: SPEAKER_FRAMES_CREDIT_ID,
      nodeId: input.nodeId,
      usageLogId: input.usageLogId,
    },
  }
}
