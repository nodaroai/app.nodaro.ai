/**
 * `workflow_executions.video_link_files` (migration 487, decided 2026-10-08): the
 * files a run fetched from Video URL post links, kept ON THE EXECUTION.
 *
 * A post link is not a video file, so the orchestrator downloads it before the
 * first node runs (`workers/orchestrator-video-links.ts`). The file is recorded
 * here, keyed by node, with the link it was fetched for. A Render final
 * continuation of the run (`continueFromExecutionId`) and a re-pick of the same
 * execution (a deploy drain, a crash) read it and reuse the file instead of
 * fetching again; a repeated run is a new execution with no record and still
 * fetches fresh.
 *
 * It is a record of its own and NOT part of the input overrides: the run lock
 * (`findLockedOverrides`) refuses a downloaded-file field on a Video URL node a
 * request did not name, and the audio track is admitted nowhere, so the pin
 * cannot hold these. Only the backend writes the table (474) and only this
 * module reads the column; what it reads back is treated as untrusted anyway
 * (`parseVideoLinkFiles`: a fixed field list, http(s) urls).
 *
 * Staging runs dev against the SHARED database, and migrations apply only at the
 * dev→main promotion, so for that window the column does not exist and a
 * statement naming it fails whole. Every site that names it goes through here
 * (a guard test enforces it): a missing-column error is remembered for the life
 * of the process, a read then returns no record and a write is skipped. No
 * record only ever means "fetch again" — never a failed run.
 */
import { supabase } from "./supabase.js"
import type { RecordedVideoLink } from "../services/workflow-engine/video-link-fetch.js"

export type VideoLinkFiles = Readonly<Record<string, RecordedVideoLink>>

/** 42703: undefined column (Postgres); PGRST204: unknown column in a write (PostgREST). */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"])

const COLUMN = "video_link_files"

let absent = false

/**
 * True when `error` says THIS column does not exist (and records it). An error
 * that names another column is not ours: two guarded columns share a statement
 * on the expunge write, and one missing must never read as the other missing.
 */
export function noteVideoLinkFilesColumnError(
  error: { readonly code?: string | null; readonly message?: string | null } | null | undefined,
): boolean {
  if (!error?.code || !MISSING_COLUMN_CODES.has(error.code)) return false
  if (error.message && !error.message.includes(COLUMN)) return false
  absent = true
  return true
}

/** Is the column known to be missing in this process? */
export function videoLinkFilesColumnAbsent(): boolean {
  return absent
}

/** The record cleared, for a write that erases it (the admin app expunge): `{}` once the column is known missing. */
export function videoLinkFilesCleared(): { readonly [COLUMN]?: null } {
  return absent ? {} : { [COLUMN]: null }
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

const URL_FIELDS = ["downloadedVideoUrl", "downloadedAudioUrl", "downloadedThumbnailUrl", "downloadedFromUrl"] as const
const STATUS_FIELDS = ["downloadStatus", "audioDownloadStatus"] as const

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : undefined
}

/** One entry as stored, or `null` when it is not usable. Only the fields a fetch writes survive. */
function parseEntry(raw: unknown): RecordedVideoLink | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const { link, data } = raw as { link?: unknown; data?: unknown }
  if (typeof link !== "string" || link.trim() === "") return null
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const source = data as Record<string, unknown>
  const kept: Record<string, unknown> = {}
  for (const field of URL_FIELDS) {
    const url = httpUrl(source[field])
    if (url) kept[field] = url
  }
  for (const field of STATUS_FIELDS) {
    if (typeof source[field] === "string") kept[field] = source[field]
  }
  const section = source.downloadedSection
  if (section === null) kept.downloadedSection = null
  else if (section && typeof section === "object") {
    const { startSec, endSec } = section as { startSec?: unknown; endSec?: unknown }
    if (typeof startSec === "number" && typeof endSec === "number" && Number.isFinite(startSec) && Number.isFinite(endSec)) {
      kept.downloadedSection = { startSec, endSec }
    }
  }
  // A record with no file in it is no record.
  if (kept.downloadedVideoUrl === undefined && kept.downloadedAudioUrl === undefined) return null
  return { link: link.trim(), data: kept }
}

/** A stored record as a node-keyed map of usable entries; anything else is empty. Pure. */
export function parseVideoLinkFiles(raw: unknown): VideoLinkFiles {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, RecordedVideoLink> = {}
  for (const [nodeId, entry] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = parseEntry(entry)
    if (parsed) out[nodeId] = parsed
  }
  return out
}

/**
 * `previous` grown by `additions`. A node's entry gains what was fetched for the
 * SAME link (the video, then its sound); an entry for another link is replaced,
 * so an old file never rides a new link. Pure; mutates neither argument.
 */
export function mergeVideoLinkFiles(previous: VideoLinkFiles, additions: VideoLinkFiles): VideoLinkFiles {
  const out: Record<string, RecordedVideoLink> = { ...previous }
  for (const [nodeId, added] of Object.entries(additions)) {
    const before = out[nodeId]
    out[nodeId] = before && before.link === added.link ? { link: added.link, data: { ...before.data, ...added.data } } : added
  }
  return out
}

// ---------------------------------------------------------------------------
// Reads and writes
// ---------------------------------------------------------------------------

/**
 * Keep the record on the execution the run is. Called once per run that fetched
 * (or reused) a file. An empty record writes nothing (NULL = nothing fetched).
 * Never throws: a failed save only costs a later fetch (logged here).
 */
export async function saveExecutionVideoLinkFiles(executionId: string, files: VideoLinkFiles): Promise<void> {
  if (absent || Object.keys(files).length === 0) return
  try {
    const { error } = await supabase.from("workflow_executions").update({ [COLUMN]: files }).eq("id", executionId)
    if (error && noteVideoLinkFilesColumnError(error)) return
    if (error) console.warn(`[execution-video-link-files] save failed for execution ${executionId}: ${error.message}`)
  } catch (err) {
    console.warn(`[execution-video-link-files] save failed for execution ${executionId}:`, err instanceof Error ? err.message : err)
  }
}

/**
 * The record of an execution, as the user who started it: the row is filtered
 * on `user_id`, so another person's execution reads exactly like a missing one.
 * No record, a missing column and any read error all give `{}` (a fetch, never a
 * failure). Callers hold the continuation's own ownership check as well
 * (`continuationRefusal`); this is the second lock on the same door.
 */
export async function loadExecutionVideoLinkFiles(executionId: string, userId: string): Promise<VideoLinkFiles> {
  if (absent) return {}
  try {
    const { data, error } = await supabase
      .from("workflow_executions")
      .select("video_link_files")
      .eq("id", executionId)
      .eq("user_id", userId)
      .maybeSingle()
    if (error && noteVideoLinkFilesColumnError(error)) return {}
    if (error) {
      console.warn(`[execution-video-link-files] read failed for execution ${executionId}: ${error.message}`)
      return {}
    }
    return parseVideoLinkFiles((data as Record<string, unknown> | null)?.[COLUMN])
  } catch (err) {
    console.warn(`[execution-video-link-files] read failed for execution ${executionId}:`, err instanceof Error ? err.message : err)
    return {}
  }
}

/** For tests. */
export function resetVideoLinkFilesColumnForTests(): void {
  absent = false
}
