import {
  NEMOTRON_TRANSCRIBE_ID,
  addCaptionsNemotronCreditId,
  addCaptionsNemotronQuoteCreditId,
  parseAddCaptionsNemotronCreditId,
} from "@nodaro/shared/credits"
import { captionsNeedTranscription } from "@nodaro/shared/captions"
import { measureNemotronTranscribeInput } from "./nemotron-transcribe-input.js"
import { transcribeLaneKey } from "./transcribe-lane-key.js"

/**
 * Add Captions transcribing on Nemotron 3.5 Transcribe (decided 2026-11-13):
 * ONE charge, the Remotion render plus Nemotron's per-minute price for the
 * video, held as `add-captions:kinetic:nemotron:<N>m` and settled at the
 * minutes KIE decoded.
 *
 *  - HOLD: measured before anything is held, on every path a run starts — the
 *    route's preHandler (`POST /v1/add-captions`, and so MCP `add_captions`)
 *    and the workflow run (node-executor) — by the Transcribe node's own rule
 *    (`measureNemotronTranscribeInput`: an https link to a public host, the
 *    SSRF guard first, over 60 minutes refused, an unreadable length held at
 *    60 minutes) but never on the video's SIZE: the worker sends KIE the audio
 *    track, not the video. Only when a transcription will run
 *    (`captionsNeedTranscription`) and runs HERE: an install that relays the
 *    transcription to the cloud (keyless, connected) holds the plain render,
 *    since the cloud bills Nemotron per minute itself.
 *  - RUN and SETTLE (the video worker's transcription of the audio track, the
 *    render worker's one commit): `./add-captions-nemotron-run.ts`.
 */

/** The caption-source fields that decide whether a render transcribes, and on what. */
export interface AddCaptionsTranscriptionInput {
  readonly style?: string | null
  readonly text?: string | null
  readonly captions?: readonly unknown[] | null
  readonly transcript?: unknown
  readonly segments?: ReadonlyArray<{ readonly text?: unknown; readonly captions?: readonly unknown[] | null }> | null
  readonly auto_transcribe?: boolean | null
  readonly transcribe_provider?: string | null
}

/** Whether this render transcribes, and on Nemotron 3.5 Transcribe. */
export function addCaptionsTranscribesOnNemotron(input: AddCaptionsTranscriptionInput): boolean {
  return input.transcribe_provider === NEMOTRON_TRANSCRIBE_ID && captionsNeedTranscription(input)
}

/**
 * Whether this install relays a Nemotron transcription to the cloud (no KIE key
 * here, connected): the cloud's `/v1/transcribe` bills it per minute itself, so
 * the local job holds only the render. The worker asks the same question.
 */
export async function nemotronTranscriptionRelays(): Promise<boolean> {
  const { shouldRunOnCloud } = await import("../providers/nodaro/run-on-cloud.js")
  return shouldRunOnCloud(transcribeLaneKey(NEMOTRON_TRANSCRIBE_ID))
}

/** The per-minute hold a Nemotron caption run takes: its id, and the video's length when it was read. */
export interface AddCaptionsNemotronHold {
  readonly creditId: string
  readonly durationSec?: number
}

export type AddCaptionsNemotronMeasure =
  /** `hold` absent: the render's own price (no Nemotron transcription runs here). */
  | { readonly ok: true; readonly hold?: AddCaptionsNemotronHold }
  | { readonly ok: false; readonly code: string; readonly message: string }

/**
 * The hold a caption request takes before anything is held: the per-minute
 * one for a Nemotron transcription that runs here, the refusal for a video it
 * would refuse, or none (the render's own price) for anything else.
 */
export async function measureAddCaptionsNemotronHold(
  input: AddCaptionsTranscriptionInput & { readonly videoUrl?: unknown },
  onProbeFailure: (err: unknown) => void = () => {},
): Promise<AddCaptionsNemotronMeasure> {
  if (!addCaptionsTranscribesOnNemotron(input)) return { ok: true }
  if (await nemotronTranscriptionRelays()) return { ok: true }
  const videoUrl = typeof input.videoUrl === "string" ? input.videoUrl : ""
  const measured = await measureNemotronTranscribeInput(videoUrl, onProbeFailure, { checkSize: false })
  if (!measured.ok) return { ok: false, code: measured.code, message: measured.message }
  return {
    ok: true,
    hold: {
      // An unread length holds the 60-minute id: the most any run can be charged.
      creditId:
        measured.durationSec !== undefined
          ? addCaptionsNemotronCreditId(measured.durationSec)
          : addCaptionsNemotronQuoteCreditId(undefined),
      ...(measured.durationSec !== undefined ? { durationSec: measured.durationSec } : {}),
    },
  }
}

/**
 * The workflow run's twin of the route's preHandler: measures a Nemotron
 * caption payload's video and stamps `bucketKey` (the id the run holds) and,
 * when the length was read, `duration_seconds`. Run BEFORE input_data is
 * written. The route's refusal for a video it would refuse; undefined
 * otherwise, and for any other job, whose payload is left untouched.
 */
export async function stampAddCaptionsNemotronInput(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "add-captions") return undefined
  const measured = await measureAddCaptionsNemotronHold(payload as AddCaptionsTranscriptionInput & { videoUrl?: unknown }, (err) => {
    console.warn("[node-executor] add-captions (nemotron): ffprobe could not read the length; holding 60 minutes:", err)
  })
  if (!measured.ok) return { code: measured.code, message: measured.message }
  if (measured.hold) {
    payload.bucketKey = measured.hold.creditId
    if (measured.hold.durationSec !== undefined) payload.duration_seconds = measured.hold.durationSec
  }
  return undefined
}

/** The per-minute id a stamped Nemotron caption payload holds; undefined for any other job or hold. */
export function addCaptionsNemotronReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  if (jobName !== "add-captions" || typeof payload.bucketKey !== "string") return undefined
  return parseAddCaptionsNemotronCreditId(payload.bucketKey) ? payload.bucketKey : undefined
}

/** The per-minute id a caption job's payload says it holds (the worker's `bucketKey`), or undefined. */
export function heldAddCaptionsNemotronId(bucketKey: unknown): string | undefined {
  return typeof bucketKey === "string" && parseAddCaptionsNemotronCreditId(bucketKey) ? bucketKey : undefined
}
