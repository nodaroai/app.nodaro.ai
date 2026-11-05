/**
 * YouTube-audio extraction as one shared flow: submit the job, poll to a
 * terminal state, return the audio URL and its measured length.
 *
 * Two callers, on purpose: the reference-audio CONFIG PANEL (the manual
 * Extract button) and the reference-audio NODE itself (auto-extraction for a
 * node whose `youtubeUrl` arrived without the panel ever mounting — written by
 * the copilot, an import, or a template). A panel-only flow is the classic
 * fail-safe trap: effects in a panel run only while that panel is open.
 *
 * The extraction fetches the link: an import of it, so both callers go through
 * `extractReferenceAudio`, which asks for the node's content rights box ticked
 * for that link and confirms it for this one fetch (`node-link-rights.ts`). It
 * also keeps which nodes are extracting on THIS page: the node's saved
 * `extractionStatus` outlives the page (a copy of the node, a reload, a closed
 * tab keep "extracting" with nothing running), so "running now" is read here,
 * never from the node.
 */
import { useSyncExternalStore } from "react"
import { extractYouTubeAudioApi, getJobStatusLean, type DownloadAudioOptions } from "@/lib/api"
import { DeclarationChangedError } from "@/lib/content-rights"
import { confirmNodeLink, isNodeLinkRightsTicked } from "@/lib/node-link-rights"

const POLL_INTERVAL_MS = 2000

export interface ExtractedAudio {
  readonly audioUrl: string
  /** Seconds, measured by the worker from the extracted file. Absent when the
   *  probe failed or the job predates it — never a guess. */
  readonly durationSeconds?: number
}

const positiveSeconds = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined

/** Thrown by `extractReferenceAudio` when the node's box is not ticked for the link: nothing was confirmed or fetched. */
export class ReferenceAudioNotConfirmedError extends Error {
  constructor() {
    super("Tick the content rights box for this link first.")
    this.name = "ReferenceAudioNotConfirmedError"
  }
}

/** What an extraction writes onto its node: "extracting", then the media, or how it ended without it. */
export type ReferenceAudioWrite = (
  patch: ReturnType<typeof referenceAudioMediaPatch> | { readonly extractionStatus: "extracting" | "failed" | "idle" },
) => void

/** The extractions running on this page, by node: one fetch per node at a time. */
const running = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribeExtractions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Whether this page is extracting the node's sound now (not what the node saved). */
export function isReferenceAudioExtracting(nodeId: string): boolean {
  return running.has(nodeId)
}

export function useReferenceAudioExtracting(nodeId: string): boolean {
  return useSyncExternalStore(subscribeExtractions, () => running.has(nodeId), () => false)
}

/**
 * The reference-audio node's import of its link: refused before anything is
 * asked or written while the node's box is not ticked for exactly that link.
 * Otherwise the node is marked extracting, the declaration is confirmed now,
 * for this one fetch, and the extraction runs under it; its end is written
 * before the node stops counting as extracting here: the media, "idle" when the
 * declaration changed (the box is unticked: the node waits for a new tick), or
 * "failed". A node already extracting here gets that extraction, never a
 * second fetch.
 */
export function extractReferenceAudio(nodeId: string, youtubeUrl: string, write: ReferenceAudioWrite): Promise<void> {
  if (!isNodeLinkRightsTicked(nodeId, youtubeUrl)) return Promise.reject(new ReferenceAudioNotConfirmedError())
  const current = running.get(nodeId)
  if (current) return current
  write({ extractionStatus: "extracting" })
  const extraction = (async () => {
    try {
      const confirmationId = await confirmNodeLink(nodeId, youtubeUrl)
      const { audioUrl, durationSeconds } = await runYouTubeAudioExtraction(youtubeUrl, { confirmationId })
      write(referenceAudioMediaPatch(audioUrl, durationSeconds))
    } catch (err) {
      write({ extractionStatus: err instanceof DeclarationChangedError ? "idle" : "failed" })
    } finally {
      running.delete(nodeId)
      notify()
    }
  })()
  running.set(nodeId, extraction)
  notify()
  return extraction
}

/** Resolves with the extracted audio (+ its length); rejects on a failed job. */
export async function runYouTubeAudioExtraction(youtubeUrl: string, options: DownloadAudioOptions = {}): Promise<ExtractedAudio> {
  const { jobId } = await extractYouTubeAudioApi(youtubeUrl, options)
  for (;;) {
    const status = await getJobStatusLean(jobId)
    if (status.status === "completed" && status.output_data?.audioUrl) {
      // `Job["output_data"]` is narrowly typed with no index signature; read the
      // length through a local cast rather than widening that shared type.
      const durationSeconds = positiveSeconds(
        (status.output_data as { durationSeconds?: unknown }).durationSeconds,
      )
      return durationSeconds !== undefined
        ? { audioUrl: status.output_data.audioUrl, durationSeconds }
        : { audioUrl: status.output_data.audioUrl }
    }
    if (status.status === "failed") {
      throw new Error(status.error_message ?? "Extraction failed")
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

/**
 * The node-data patch for a reference-audio node whose MEDIA just changed —
 * the one way any writer sets `extractedAudioUrl`.
 *
 * It ALWAYS writes `metadata`: the measured length when there is one,
 * `undefined` when there is not. That is the point. The length lives on the
 * node so every duration-bucketed consumer can price this source honestly (Edit
 * Plan quotes its 180-minute CEILING for a master with no readable length), and
 * a length is only honest while it describes the media beside it. Two bindings,
 * on purpose: every in-editor writer goes through this one patch (so new media
 * always gets its own length or an explicit "unknown"), AND the length carries a
 * `mediaUrl` stamp the shared reader checks (so a writer that never heard of
 * this builder still cannot leave last week's length under-quoting a longer
 * episode — a mismatch simply reads as unknown).
 *
 * `metadata.durationSeconds` is the same field `upload-audio` writes and the
 * shared `editPlanSourceDurationSec` reads — frontend estimate and server
 * reserve fallback alike.
 */
export function referenceAudioMediaPatch(
  audioUrl: string,
  durationSeconds?: number,
): {
  extractedAudioUrl: string
  extractionStatus: "ready" | "idle"
  metadata: { durationSeconds: number; mediaUrl: string } | undefined
} {
  const seconds = positiveSeconds(durationSeconds)
  return {
    extractedAudioUrl: audioUrl,
    extractionStatus: audioUrl ? "ready" : "idle",
    // `mediaUrl` stamps WHICH media the length was measured from. The shared
    // reader (`editPlanSourceDurationSec`) trusts the length only while that is
    // still the node's media — so a writer that bypasses this builder (a copilot
    // patch, an MCP workflow-JSON write, an import) cannot make it lie.
    metadata: seconds !== undefined && audioUrl ? { durationSeconds: seconds, mediaUrl: audioUrl } : undefined,
  }
}
