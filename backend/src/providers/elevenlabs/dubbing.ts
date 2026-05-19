import type { ReconcileOpts } from "../provider.interface.js"
import { ELEVENLABS_BASE_URL, getElevenLabsHeaders, fetchAudioFromUrl } from "./client.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"

export interface DubbingOptions {
  sourceLang?: string
  numSpeakers?: number
  watermark?: boolean
}

export interface DubbingStartResult {
  dubbingId: string
  expectedDurationSec: number
}

export interface DubbingStatus {
  dubbing_id: string
  status: string
  target_languages?: string[]
  error?: string
}

export async function startDubbing(
  audioUrl: string,
  targetLang: string,
  options?: DubbingOptions,
  reconcileOpts?: ReconcileOpts,
): Promise<DubbingStartResult> {
  const headers = getElevenLabsHeaders()
  const audioBuffer = await fetchAudioFromUrl(audioUrl)

  const formData = new FormData()
  const blob = new Blob([audioBuffer as BlobPart], { type: "audio/mpeg" })
  formData.append("file", blob, "audio.mp3")
  formData.append("target_lang", targetLang)

  if (options?.sourceLang) {
    formData.append("source_lang", options.sourceLang)
  }
  if (options?.numSpeakers != null) {
    formData.append("num_speakers", String(options.numSpeakers))
  }
  if (options?.watermark != null) {
    formData.append("watermark", String(options.watermark))
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/dubbing`, {
    method: "POST",
    headers,
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Dubbing start failed (${response.status}): ${errorText}`)
  }

  const result = (await response.json()) as { dubbing_id: string; expected_duration_sec: number }
  await fireOnTaskCreated(reconcileOpts, result.dubbing_id, "[elevenlabs/dubbing]")
  return {
    dubbingId: result.dubbing_id,
    expectedDurationSec: result.expected_duration_sec,
  }
}

export async function pollDubbingStatus(dubbingId: string): Promise<DubbingStatus> {
  const headers = getElevenLabsHeaders()

  const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/dubbing/${dubbingId}`, {
    method: "GET",
    headers,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Dubbing status check failed (${response.status}): ${errorText}`)
  }

  return (await response.json()) as DubbingStatus
}

export async function downloadDubbedAudio(dubbingId: string, langCode: string): Promise<Buffer> {
  const headers = getElevenLabsHeaders()

  const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/dubbing/${dubbingId}/audio/${langCode}`, {
    method: "GET",
    headers: {
      ...headers,
      Accept: "audio/mpeg",
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Dubbing download failed (${response.status}): ${errorText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Poll dubbing status until complete or timeout.
 * Returns the final status.
 */
export async function waitForDubbing(
  dubbingId: string,
  onProgress?: (status: string) => void,
  maxWaitMs = 600_000,
  intervalMs = 10_000,
): Promise<DubbingStatus> {
  const start = Date.now()

  while (Date.now() - start < maxWaitMs) {
    const status = await pollDubbingStatus(dubbingId)
    onProgress?.(status.status)

    if (status.status === "dubbed") return status
    if (status.status === "failed") {
      throw new Error(`Dubbing failed: ${status.error ?? "Unknown error"}`)
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  throw new Error(`Dubbing timed out after ${maxWaitMs / 1000}s`)
}
