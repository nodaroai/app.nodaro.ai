/**
 * The two recordings of a one-off voice clone (`replica`, Gemini 3.8 Flash on
 * KIE; decided 2026-11-13): a reference recording of natural speech and a
 * consent recording of the voice's owner reading the consent sentence. ONE
 * reader for every seam that judges them — the routes before any hold, the
 * workflow run's gate before its reservation, the worker before it sends —
 * so a recording is refused the same way wherever it arrives.
 *
 * A recording is fetched only from an https link, through the platform's
 * SSRF-safe download with its byte cap (`safeFetchBytes`): nothing private,
 * nothing past {@link REPLICA_MAX_BYTES}. A link to outside content is refused
 * where the deployment turned link imports off (`assertLinkImportAllowed`);
 * one on this install's own storage never is. It must be a WAV by its bytes
 * (KIE reads the format from the content, WAV only), and its length is
 * measured by ffprobe on a private temp copy: the reference 10–30 s, the
 * consent recording at most {@link REPLICA_CONSENT_MAX_SEC} (one sentence; KIE
 * sets no range for it). Judging stores nothing. The worker keeps the bytes it
 * judged only in the job's scratch folder ({@link stageReplica}), which the
 * video worker empties when the job ends, and sends KIE those copies — never
 * the caller's links, which could change in between. A recording's address is
 * never logged and never written on the job row.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  REPLICA_CONSENT_MAX_SEC,
  REPLICA_MAX_BYTES,
  REPLICA_SOURCE_MAX_SEC,
  REPLICA_SOURCE_MIN_SEC,
  type TtsReplica,
} from "@nodaro/shared/models"
import { replicaOf } from "@nodaro/shared/model-catalog"
import { safeFetchBytes, PublicDownloadTooLargeError } from "./safe-fetch-bytes.js"
import { assertLinkImportAllowed, LinkImportsDisabledError } from "./link-imports.js"
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"
import { uploadJobScratchBuffer } from "./job-scratch.js"

/** Which of the two recordings. */
export type ReplicaRole = "source" | "consent"

/** Why a recording was refused; `message` is the sentence a caller is answered with (it names no address). */
export class ReplicaRecordingError extends Error {
  readonly deterministic = true
  constructor(
    readonly code: "replica_unreachable" | "replica_too_large" | "replica_not_wav" | "replica_length" | "replica_link_refused",
    readonly role: ReplicaRole,
    message: string,
  ) {
    super(message)
    this.name = "ReplicaRecordingError"
  }
}

const NAME: Record<ReplicaRole, string> = { source: "The reference recording", consent: "The consent recording" }

/** A WAV by its first bytes (`RIFF` … `WAVE`). */
export function isWavBytes(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE"
}

/** The length rule for each recording, in seconds. */
export function replicaLengthProblem(role: ReplicaRole, seconds: number): string | undefined {
  if (role === "source") {
    if (seconds < REPLICA_SOURCE_MIN_SEC || seconds > REPLICA_SOURCE_MAX_SEC + 0.5) {
      return `${NAME.source} must be ${REPLICA_SOURCE_MIN_SEC}–${REPLICA_SOURCE_MAX_SEC} seconds of natural speech; this one is ${seconds.toFixed(1)} seconds`
    }
    return undefined
  }
  return seconds > REPLICA_CONSENT_MAX_SEC + 0.5
    ? `${NAME.consent} must be at most ${REPLICA_CONSENT_MAX_SEC} seconds (the consent sentence alone); this one is ${seconds.toFixed(1)} seconds`
    : undefined
}

/** A recording that passed: its bytes (to send) and its measured length. */
export interface ReplicaRecording {
  readonly bytes: Buffer
  readonly seconds: number
}

/** The seam the tests replace: the measured length of a local file. */
export const replicaProbe = { durationSec: (path: string): Promise<number> => probeMediaDuration(path) }

/**
 * Fetch one recording and judge it: an https link, allowed on this deployment,
 * downloaded safely within the cap, a WAV, of the right length. Throws
 * {@link ReplicaRecordingError} (or the deployment's link refusal, which
 * already carries its own sentence).
 */
export async function readReplicaRecording(url: string, role: ReplicaRole, signal?: AbortSignal): Promise<ReplicaRecording> {
  let parsed: URL | undefined
  try {
    parsed = new URL(url)
  } catch {
    parsed = undefined
  }
  if (parsed?.protocol !== "https:") {
    throw new ReplicaRecordingError("replica_unreachable", role, `${NAME[role]} must be an https link to a WAV file`)
  }
  try {
    assertLinkImportAllowed(url)
  } catch (err) {
    if (err instanceof LinkImportsDisabledError) throw new ReplicaRecordingError("replica_link_refused", role, `${NAME[role]}: ${err.message}`)
    throw err
  }
  let bytes: Buffer
  try {
    bytes = await safeFetchBytes(url, REPLICA_MAX_BYTES, signal)
  } catch (err) {
    if (err instanceof PublicDownloadTooLargeError) {
      throw new ReplicaRecordingError("replica_too_large", role, `${NAME[role]} must be at most ${REPLICA_MAX_BYTES / (1024 * 1024)} MB`)
    }
    if (signal?.aborted) throw err
    throw new ReplicaRecordingError("replica_unreachable", role, `${NAME[role]} could not be downloaded; use a direct https link to the WAV file`)
  }
  if (!isWavBytes(bytes)) {
    throw new ReplicaRecordingError("replica_not_wav", role, `${NAME[role]} must be a WAV file (24 kHz, mono, 16-bit is best)`)
  }
  const dir = await mkdtemp(join(tmpdir(), "replica-"))
  try {
    const path = join(dir, `${role}.wav`)
    await writeFile(path, bytes, { mode: 0o400 })
    let seconds: number
    try {
      seconds = await replicaProbe.durationSec(path)
    } catch {
      throw new ReplicaRecordingError("replica_not_wav", role, `${NAME[role]} could not be read as audio`)
    }
    const problem = replicaLengthProblem(role, seconds)
    if (problem) throw new ReplicaRecordingError("replica_length", role, problem)
    return { bytes, seconds }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Both recordings of a clone, judged; the reference first. */
export async function readReplica(replica: TtsReplica, signal?: AbortSignal): Promise<{ source: ReplicaRecording; consent: ReplicaRecording }> {
  const source = await readReplicaRecording(replica.sourceAudioUrl, "source", signal)
  const consent = await readReplicaRecording(replica.consentAudioUrl, "consent", signal)
  return { source, consent }
}

/**
 * Judge a clone's recordings and keep them in the running job's scratch folder
 * (emptied when the job ends): the links KIE is sent. Inside a video-worker
 * job only.
 */
export async function stageReplica(replica: TtsReplica, signal?: AbortSignal): Promise<{ sourceAudioUrl: string; consentAudioUrl: string }> {
  const { source, consent } = await readReplica(replica, signal)
  const sourceAudioUrl = await uploadJobScratchBuffer(source.bytes, "replica-source", "wav", "audio/wav")
  const consentAudioUrl = await uploadJobScratchBuffer(consent.bytes, "replica-consent", "wav", "audio/wav")
  return { sourceAudioUrl, consentAudioUrl }
}

/**
 * The sentence for a clone KIE refused, from its failure text — never that
 * text itself. Probed 2026-11-13: an AI-made consent recording fails with
 * "Invalid consent audio."; 3.8 Flash-Lite with "Inline voice sample
 * replication is not supported" (it is not offered there). A refused clone is
 * charged nothing by KIE.
 */
export function replicaRefusalMessage(providerText: string): string {
  if (/consent/i.test(providerText)) {
    return "The consent recording was not accepted. It must be the voice's owner, recorded (not AI-generated), reading the consent sentence in the same room and on the same microphone as the reference recording."
  }
  return "The voice recordings were not accepted. Both must be real recordings of the same adult (not AI-generated), each a WAV file, the reference 10–30 seconds of natural speech."
}

/**
 * A request as its job row records it: a one-off clone's recording links taken
 * out (they are the caller's media, and recovery never needs them), a mark
 * left in their place (`oneOffClone: true`) — on the request itself and on
 * each cloned speaker of a dialogue.
 */
export function withoutReplicaLinks<T extends Record<string, unknown>>(body: T): Record<string, unknown> {
  const { replica, ...rest } = body as T & { replica?: unknown }
  const out: Record<string, unknown> = { ...rest, ...(replica !== undefined ? { oneOffClone: true } : {}) }
  if (Array.isArray(out.speakers)) {
    out.speakers = (out.speakers as unknown[]).map((s) => {
      if (!s || typeof s !== "object" || !("replica" in s)) return s
      const { replica: _links, ...speaker } = s as Record<string, unknown>
      return { ...speaker, oneOffClone: true }
    })
  }
  return out
}

/** Every one-off clone a built speech payload carries (one speaker's `replica`, a dialogue's cloned speakers), well formed. */
export function payloadReplicas(payload: Record<string, unknown>): TtsReplica[] {
  const out: TtsReplica[] = []
  const own = replicaOf(payload.replica)
  if (own) out.push(own)
  if (Array.isArray(payload.speakers)) {
    for (const s of payload.speakers) {
      const r = replicaOf((s as { replica?: unknown } | null)?.replica)
      if (r) out.push(r)
    }
  }
  return out
}

