/**
 * The source and the style of a Suno Add Vocals / Add Instrumental run
 * (decided 2026-11-23). KIE takes the song only as a link to its file
 * (`upload_url`) and requires a style on every run, so before anything is
 * held the route — and the worker, for a workflow run — resolves:
 *
 *   - the file: the request's own link when it carries one, else the saved
 *     audio of the Suno track it names by its ids (`taskId` + `audioId`, read
 *     off the job rows that carry the task, whoever made it — these tools
 *     always took any track by its ids: shared workflows and published apps
 *     run on other accounts' songs);
 *   - the style: the request's own, else the style the ORIGINAL song was made
 *     with, read only off the caller's own job (another account's prompt
 *     text is never reused). On Add Vocals an "instrumental" tag in that
 *     style is left out: it would ask the singer not to sing;
 *   - the title: the request's own, else the original song's.
 *
 * A run with no file, or with no style and no original style to take, is
 * refused with a message the person can act on.
 */
import { supabase } from "./supabase.js"
import { unusableLinkError } from "./unusable-link.js"
import { isAllowedSocialVideoUrl } from "./url-validator.js"

export type SunoAddTrackJobType = "suno-add-vocals" | "suno-add-instrumental"

export interface SunoAddTrackSourceRequest {
  readonly jobType: SunoAddTrackJobType
  /** The caller; the original style and title are read only off their own job. */
  readonly userId?: string
  readonly uploadUrl?: string
  readonly taskId?: string
  readonly audioId?: string
  readonly style?: string
  readonly title?: string
}

export interface SunoAddTrackSource {
  readonly ok: true
  readonly uploadUrl: string
  readonly style: string
  readonly title?: string
}

export interface SunoAddTrackRefusal {
  readonly ok: false
  readonly status: 400
  readonly code: string
  readonly message: string
}

export const SUNO_ADD_TRACK_SOURCE_CODE = "suno_add_track_source"
export const SUNO_ADD_TRACK_NO_SOURCE_MESSAGE =
  "Pass the song as uploadUrl (a link to its audio file), or a Suno track made here as taskId and audioId."
export const SUNO_ADD_TRACK_NO_FILE_MESSAGE =
  "This Suno track has no saved audio here to send. Connect the audio itself."
export const SUNO_ADD_TRACK_SOCIAL_LINK_MESSAGE =
  "Pass a direct link to the song's audio file: a page on a social site cannot be sent as the song."

/**
 * Why a link the person passed as the song cannot be sent, or null: a link
 * two parsers would read differently, or a page on a social site (the
 * provider fetches a FILE). The same answer on the route (a 400, before
 * anything is held) and in the worker for a workflow run (refunded). The
 * deployment's link-import switch is asked beside it (lib/link-imports.ts).
 */
export function sunoAddTrackLinkProblem(url: string): string | null {
  const unusable = unusableLinkError(url)
  if (unusable) return unusable.message
  if (isAllowedSocialVideoUrl(url)) return SUNO_ADD_TRACK_SOCIAL_LINK_MESSAGE
  return null
}

export const SUNO_ADD_TRACK_STYLE_CODE = "suno_add_track_style"
export const SUNO_ADD_TRACK_STYLE_MESSAGE =
  "Write a style for the new layer (for example: soulful female pop vocal). Without one, the style of the original song is used, and it is known only for a Suno song you made here."

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined)

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

interface TaskRow {
  readonly user_id: string | null
  readonly status: string | null
  readonly input_data: Record<string, unknown> | null
  readonly output_data: Record<string, unknown> | null
}

/** A task can be carried by several rows (a retry, a re-pick): read a handful. */
const ROWS_PER_TASK = 10

async function taskRows(taskId: string): Promise<readonly TaskRow[]> {
  // trash-read: what a task made does not change when its job is moved to the Trash.
  const { data, error } = await supabase
    .from("jobs")
    .select("user_id, status, input_data, output_data")
    .eq("provider_task_id", taskId)
    .limit(ROWS_PER_TASK)
  if (error) throw new Error(`Suno task lookup failed: ${error.message}`)
  return (data ?? []) as TaskRow[]
}

/** The saved audio of one track of a task's row, by the track's Suno id. */
function trackAudioOf(row: TaskRow, audioId: string): { audioUrl: string; title?: string } | undefined {
  const out = row.output_data ?? {}
  const tracks = Array.isArray(out.sunoTracks) ? out.sunoTracks : []
  for (const entry of tracks) {
    const t = asRecord(entry)
    const audioUrl = str(t?.audioUrl)
    if (t && str(t.id) === audioId && audioUrl) return { audioUrl, title: str(t.title) }
  }
  const primary = str(out.audioUrl)
  if (str(out.sunoTrackId) === audioId && primary) return { audioUrl: primary, title: str(out.sunoTitle) }
  return undefined
}

/** Completed rows first: a finished run's tracks are the ones saved. */
function byFinishedFirst(rows: readonly TaskRow[]): TaskRow[] {
  return [...rows].sort((a, b) => Number(b.status === "completed") - Number(a.status === "completed"))
}

const INSTRUMENTAL_TAG = /^(instrumental|no vocals?|without vocals?|instrumental only)$/i

/** The original song's style, as the new layer may reuse it. */
export function inheritedSunoStyle(original: string | undefined, jobType: SunoAddTrackJobType): string | undefined {
  const style = str(original)
  if (!style || jobType !== "suno-add-vocals") return style
  const kept = style.split(",").map((t) => t.trim()).filter((t) => t !== "" && !INSTRUMENTAL_TAG.test(t))
  return kept.length > 0 ? kept.join(", ") : undefined
}

function originalStyleOf(row: TaskRow | undefined): string | undefined {
  const input = row?.input_data ?? {}
  return str(input.style) ?? str(input.tags)
}

function originalTitleOf(row: TaskRow | undefined, audioId: string | undefined): string | undefined {
  if (!row) return undefined
  return (audioId ? trackAudioOf(row, audioId)?.title : undefined) ?? str(row.output_data?.sunoTitle) ?? str(row.input_data?.title)
}

export async function resolveSunoAddTrackSource(req: SunoAddTrackSourceRequest): Promise<SunoAddTrackSource | SunoAddTrackRefusal> {
  const ownStyle = str(req.style)
  const ownTitle = str(req.title)
  const ids = req.taskId && req.audioId ? { taskId: req.taskId, audioId: req.audioId } : undefined
  // The task's rows are read only when they can still answer something: the
  // file (no link), the style (none given) or the title (none given).
  const needsRows = ids && (!req.uploadUrl || !ownStyle || !ownTitle)
  const rows = needsRows ? byFinishedFirst(await taskRows(ids.taskId)) : []
  const ownRow = req.userId ? rows.find((r) => r.user_id === req.userId) : undefined

  let uploadUrl = str(req.uploadUrl)
  if (!uploadUrl) {
    if (!ids) return { ok: false, status: 400, code: SUNO_ADD_TRACK_SOURCE_CODE, message: SUNO_ADD_TRACK_NO_SOURCE_MESSAGE }
    uploadUrl = rows.map((r) => trackAudioOf(r, ids.audioId)?.audioUrl).find((u) => u !== undefined)
    if (!uploadUrl) return { ok: false, status: 400, code: SUNO_ADD_TRACK_SOURCE_CODE, message: SUNO_ADD_TRACK_NO_FILE_MESSAGE }
  }

  const style = ownStyle ?? inheritedSunoStyle(originalStyleOf(ownRow), req.jobType)
  if (!style) return { ok: false, status: 400, code: SUNO_ADD_TRACK_STYLE_CODE, message: SUNO_ADD_TRACK_STYLE_MESSAGE }

  const title = ownTitle ?? originalTitleOf(ownRow, ids?.audioId)
  return { ok: true, uploadUrl, style, ...(title ? { title } : {}) }
}
