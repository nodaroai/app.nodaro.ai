/**
 * Suno tracks named by their ids (decided 2026-11-17): which Suno task a
 * caller may name, and what a run does with it — for Suno Cover (cover a
 * track made here by its ids, no re-upload) and Suno Convert to WAV (a track,
 * or one stem of a Suno separation). One rule for the routes and the workflow
 * run (`stampSunoIdSource`, node-executor), both before anything is reserved.
 *
 * The task is looked up by the job rows that carry it (`jobs.provider_task_id`).
 *
 * Suno Cover goes by id ONLY for a task that is provably the caller's own
 * song: a job of theirs carries it and made music. Anything else — another
 * account's task, one no job here carries, a task that is not a song, a song
 * older than Suno keeps its files, a prompt a cover by id cannot say — is
 * covered from its file exactly as before, and is refused only when the
 * request carries no file. A cover that worked before still works.
 *
 * Suno Convert to WAV and the other tools that take a track by its ids keep
 * accepting any task, whoever made it (shared workflows and published apps run
 * on other accounts' tracks). They refuse only what can never work: a Suno
 * Speech take, a separation Demucs made, an id that is not one of a
 * separation's stems.
 */
import { supabase } from "./supabase.js"
import { sunoCoverByIdInput, type SunoCoverByIdParams } from "../providers/kie/suno-cover-by-id.js"

/**
 * The jobs whose task Suno Cover can cover by id: music generations (KIE's
 * Upload & Cover schema: `task_id` is "a music generation task", the track's
 * id from its result). Every Suno job that delivers music tracks. Not a WAV
 * conversion, a separation (stems), lyrics, a music video or a speech run.
 */
export const SUNO_COVERABLE_BY_ID_JOB_TYPES: ReadonlySet<string> = new Set([
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "suno-upload-extend",
  "suno-mashup",
  "suno-replace-section",
  "suno-add-instrumental",
  "suno-add-vocals",
])

/** The job type of a Suno separation, whose stems Convert to WAV takes by their ids. */
const SEPARATION_JOB_TYPE = "suno-separate"

export const SUNO_TASK_NOT_YOURS_CODE = "suno_task_not_yours"
export const SUNO_TASK_NOT_YOURS_MESSAGE = "This Suno track belongs to another account. Use a track you made, or connect the audio itself."
export const SUNO_COVER_SOURCE_CODE = "suno_cover_source"
export const SUNO_COVER_SOURCE_MESSAGE =
  "Suno can cover by id only a song made with Suno (Create Music, Extend, Cover, Upload Extend, Mashup, Replace Section, Add Vocals or Add Instrumental). Connect the audio itself to cover anything else."
export const SUNO_COVER_PROMPT_MESSAGE =
  "This cover cannot go by the song's ids alone: a prompt beside a style, or a prompt longer than a style may be, needs the song's audio. Connect the audio itself, or send only a short prompt or only a style."
export const SUNO_NOT_A_TRACK_CODE = "suno_not_a_track"
export const SUNO_NOT_A_TRACK_MESSAGE =
  "This is a Suno Speech take, not a Suno song: it cannot be converted to WAV, extended or separated by its Suno ids. Use its audio where the node takes any audio."
export const SUNO_WAV_STEM_CODE = "suno_wav_stem"
export const SUNO_WAV_DEMUCS_MESSAGE =
  "This separation was made by Demucs, not Suno, so its stems have no Suno ids to convert. Convert a stem from a Suno separation, or use the stem's audio elsewhere."
export const SUNO_WAV_NO_STEM_IDS_MESSAGE =
  "This separation kept no Suno stem ids to convert by. Run the separation again, then convert its stem."
export const SUNO_WAV_NOT_A_STEM_MESSAGE = "This audio id is not one of that separation's stems."

export interface SunoIdRefusal {
  readonly ok: false
  readonly status: 400 | 403
  readonly code: string
  readonly message: string
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined)

interface TaskRow {
  user_id: string | null
  job_type: string | null
  status: string | null
  created_at: string | null
  output_data: Record<string, unknown> | null
}

/** A task can be carried by several rows (a retry, a re-pick): read a handful. */
const ROWS_PER_TASK = 10

/** Every job row that carries a task, whoever owns it. */
async function taskRows(taskId: string): Promise<TaskRow[]> {
  // trash-read: what a task made, and whose it is, does not change when its
  // job is moved to the Trash.
  const { data, error } = await supabase
    .from("jobs")
    .select("user_id, job_type, status, created_at, output_data")
    .eq("provider_task_id", taskId)
    .limit(ROWS_PER_TASK)
  if (error) throw new Error(`Suno task lookup failed: ${error.message}`)
  return (data ?? []) as TaskRow[]
}

/**
 * A task's rows for a tool that ran with no lookup before these checks existed
 * (Convert to WAV, Separate, Extend): a lookup that fails answers no rows, so
 * the run goes on exactly as it did then, rather than failing on a read it
 * never needed.
 */
async function taskRowsOrNone(taskId: string): Promise<TaskRow[]> {
  try {
    return await taskRows(taskId)
  } catch (err) {
    console.warn(`[suno-id-source] ${err instanceof Error ? err.message : String(err)}; running as before`)
    return []
  }
}

/** The caller's own row among a task's rows, a finished one first. */
function ownRowOf(rows: readonly TaskRow[], userId: string): TaskRow | undefined {
  const own = rows.filter((r) => r.user_id === userId)
  return own.find((r) => r.status === "completed") ?? own[0]
}

/**
 * The output mark of a Suno Speech run (`output_data.sunoTrackKind`, written
 * with its takes): spoken takes carry Suno ids like a song's tracks do, and
 * are not songs — no Suno tool takes one by its ids.
 */
export const SUNO_TRACK_KIND_FIELD = "sunoTrackKind"
export const SUNO_TRACK_KIND_SPEECH = "speech"

/** Whether a job's output is a Suno Speech run's. */
export function isSunoSpeechOutput(output: Readonly<Record<string, unknown>> | null | undefined): boolean {
  return output?.[SUNO_TRACK_KIND_FIELD] === SUNO_TRACK_KIND_SPEECH
}

const NOT_YOURS: SunoIdRefusal = { ok: false, status: 403, code: SUNO_TASK_NOT_YOURS_CODE, message: SUNO_TASK_NOT_YOURS_MESSAGE }
const NOT_A_TRACK: SunoIdRefusal = { ok: false, status: 400, code: SUNO_NOT_A_TRACK_CODE, message: SUNO_NOT_A_TRACK_MESSAGE }
const COVER_SOURCE: SunoIdRefusal = { ok: false, status: 400, code: SUNO_COVER_SOURCE_CODE, message: SUNO_COVER_SOURCE_MESSAGE }
const COVER_PROMPT: SunoIdRefusal = { ok: false, status: 400, code: SUNO_COVER_SOURCE_CODE, message: SUNO_COVER_PROMPT_MESSAGE }

/**
 * Suno keeps a generated file for 14 days. A song older than this is covered
 * from its file when the request carries one, without asking Suno for a track
 * it has likely dropped.
 */
export const SUNO_COVER_BY_ID_MAX_AGE_MS = 13 * 24 * 60 * 60 * 1000

/**
 * THE GATE (decided 2026-11-17): a cover goes by id only when the request
 * carries NO file. While this is false, every request with a file — each wired
 * Suno → Cover chain, each upload — covers the file exactly as it always did,
 * with no lookup at all, and only a request of ids alone (the API / MCP
 * `taskId` + `audioId` form) uses the by-id lane. Nothing has run against that
 * lane yet, and its completion signal is undocumented, so existing chains must
 * not move onto it unseen.
 *
 * Lift after a production or staging run proves the lane: set it true, and a
 * request carrying both then goes by id with its file as the fallback (the
 * 13-day rule, the same-audio check and the run's fallback below are already
 * in place for that day, and tested with the gate open).
 */
export const SUNO_COVER_BY_ID_WHEN_FILE_PRESENT = false

/** The tracks a finished Suno job saved (`output_data.sunoTracks`, else its first track alone). */
function savedTracksOf(output: Readonly<Record<string, unknown>> | null | undefined): Array<{ id: string; audioUrl?: string }> {
  const list = Array.isArray(output?.sunoTracks) ? (output.sunoTracks as unknown[]) : []
  const tracks = list.flatMap((t) => {
    const id = t && typeof t === "object" ? str((t as Record<string, unknown>).id) : undefined
    return id ? [{ id, audioUrl: str((t as Record<string, unknown>).audioUrl) }] : []
  })
  if (tracks.length > 0) return tracks
  const first = str(output?.sunoTrackId)
  return first ? [{ id: first, audioUrl: str(output?.audioUrl) }] : []
}

/** The cover's own fields a by-id body is built from: what decides whether a cover by id can say everything the file lane would. */
export type SunoCoverFields = Omit<SunoCoverByIdParams, "taskId" | "audioId">

/**
 * What a Suno Cover run covers: a song of the caller's own, by its ids (with
 * its file kept beside them when the request carries one — the run falls back
 * to it if Suno refuses the ids), or any audio by its URL.
 */
export type SunoCoverSource =
  | { readonly ok: true; readonly byId: true; readonly taskId: string; readonly audioId: string; readonly uploadUrl?: string }
  | { readonly ok: true; readonly byId: false; readonly uploadUrl: string }
  | SunoIdRefusal

/**
 * The source a cover runs on. A request with a file covers the file, with no
 * lookup, while `SUNO_COVER_BY_ID_WHEN_FILE_PRESENT` is false. Otherwise by id
 * only when the task is the caller's own finished song, the audio id is one of
 * the tracks that job saved, the cover's fields fit a by-id body — and, when a
 * file is beside the ids, that track IS the file (ids and a URL that reached
 * the node from different sources never cover a different audio than the file
 * lane would) and the song is recent enough for Suno to still keep. In every
 * other case the file, as before. With no file to fall back on: another
 * account's task is refused as not the caller's, anything else that cannot go
 * by id as not coverable by id. With neither ids nor a file, the route's own
 * validation answers first (`undefined`).
 */
export async function resolveSunoCoverSource(args: {
  taskId?: unknown
  audioId?: unknown
  uploadUrl?: unknown
  userId: string
  /** The cover's fields as the run will send them. Absent: only the task decides. */
  fields?: SunoCoverFields
  /** The clock, for tests. */
  now?: number
  /** The gate, for tests of the day it is lifted. Default: `SUNO_COVER_BY_ID_WHEN_FILE_PRESENT`. */
  byIdWhenFilePresent?: boolean
}): Promise<SunoCoverSource | undefined> {
  const taskId = str(args.taskId)
  const audioId = str(args.audioId)
  const uploadUrl = str(args.uploadUrl)
  const byUpload = uploadUrl ? ({ ok: true, byId: false, uploadUrl } as const) : undefined
  if (!taskId || !audioId) return byUpload
  if (byUpload && !(args.byIdWhenFilePresent ?? SUNO_COVER_BY_ID_WHEN_FILE_PRESENT)) return byUpload
  let rows: TaskRow[]
  try {
    rows = await taskRows(taskId)
  } catch (err) {
    // The lookup failed: a cover with its file runs on the file, as it always did.
    if (!byUpload) throw err
    console.warn(`[suno-id-source] ${err instanceof Error ? err.message : String(err)}; covering the file`)
    return byUpload
  }
  const own = ownRowOf(rows, args.userId)
  if (!own) {
    // Another account's song (a public one, read by its asset id) or a task no
    // job here carries: its audio, as before; ids alone are refused.
    if (byUpload) return byUpload
    return rows.length > 0 ? NOT_YOURS : COVER_SOURCE
  }
  if (!SUNO_COVERABLE_BY_ID_JOB_TYPES.has(own.job_type ?? "")) return byUpload ?? COVER_SOURCE
  // The song must be finished, and the audio id one of the tracks it saved.
  const track = own.status === "completed" ? savedTracksOf(own.output_data).find((t) => t.id === audioId) : undefined
  if (!track) return byUpload ?? COVER_SOURCE
  // Ids beside a file must name that file's own audio, or they are dropped.
  if (byUpload && track.audioUrl !== uploadUrl) return byUpload
  const expressible = !args.fields || sunoCoverByIdInput({ ...args.fields, taskId, audioId }) !== undefined
  if (!expressible) return byUpload ?? COVER_PROMPT
  const madeAt = own.created_at ? Date.parse(own.created_at) : Number.NaN
  const tooOld = Number.isFinite(madeAt) && (args.now ?? Date.now()) - madeAt > SUNO_COVER_BY_ID_MAX_AGE_MS
  if (tooOld && byUpload) return byUpload
  return { ok: true, byId: true, taskId, audioId, ...(uploadUrl ? { uploadUrl } : {}) }
}

/** What a Suno Convert to WAV run converts: a track (the WAV endpoint) or one stem of a Suno separation. */
export type SunoWavSource = { readonly ok: true; readonly stem: boolean } | SunoIdRefusal

/**
 * The lane a WAV conversion runs on, whoever made the task (no ownership
 * check: a shared workflow or a published app converts another account's
 * track, as it always could). A separation's task takes the stem lane, refused
 * when Demucs made it (no Suno stems), when it kept no stem ids, or when the
 * audio id is not one of the stems it kept; a Suno Speech take is refused (it is not a
 * song, whoever made it); any other task, or one no job carries, is a track, as before.
 */
export async function resolveSunoWavSource(args: { taskId: string; audioId: string; userId: string }): Promise<SunoWavSource> {
  const rows = await taskRowsOrNone(args.taskId)
  if (rows.some((r) => isSunoSpeechOutput(r.output_data))) return NOT_A_TRACK
  const separations = rows.filter((r) => r.job_type === SEPARATION_JOB_TYPE)
  const separation = ownRowOf(separations, args.userId) ?? separations.find((r) => r.status === "completed") ?? separations[0]
  if (!separation) return { ok: true, stem: false }
  const out = separation.output_data ?? {}
  if (out.engineUsed === "demucs") return { ok: false, status: 400, code: SUNO_WAV_STEM_CODE, message: SUNO_WAV_DEMUCS_MESSAGE }
  const ids = out.sunoStemIds
  // A separation that kept no stem ids (made before they were kept, or delivered by a connected cloud) has none to convert by.
  if (!ids || typeof ids !== "object" || Array.isArray(ids) || Object.keys(ids).length === 0) {
    return { ok: false, status: 400, code: SUNO_WAV_STEM_CODE, message: SUNO_WAV_NO_STEM_IDS_MESSAGE }
  }
  const known = Object.values(ids as Record<string, unknown>).some((id) => id === args.audioId)
  if (!known) return { ok: false, status: 400, code: SUNO_WAV_STEM_CODE, message: SUNO_WAV_NOT_A_STEM_MESSAGE }
  return { ok: true, stem: true }
}

/** How far back a track id is looked for among the caller's own Suno Speech runs: a little past what Suno keeps a file. */
const SPEECH_TRACK_LOOKBACK_MS = 15 * 24 * 60 * 60 * 1000

/**
 * Whether the ids a Suno track tool was handed (Extend, Separate, Convert to
 * WAV — anything that takes a song by its Suno ids) name a Suno Speech take of
 * the caller's own: by its task when one is given, else by the take's own id
 * among their recent speech runs. A refusal to return before anything is held;
 * `undefined` for every other source, which runs as before.
 */
export async function sunoSpeechTakeRefusal(args: { taskId?: unknown; audioId?: unknown; userId: string; now?: number }): Promise<SunoIdRefusal | undefined> {
  const taskId = str(args.taskId)
  if (taskId) {
    return (await taskRowsOrNone(taskId)).some((r) => isSunoSpeechOutput(r.output_data)) ? NOT_A_TRACK : undefined
  }
  const audioId = str(args.audioId)
  if (!audioId) return undefined
  const since = new Date((args.now ?? Date.now()) - SPEECH_TRACK_LOOKBACK_MS).toISOString()
  try {
    // trash-read: a take is not a song whether or not its job sits in the Trash.
    const { data, error } = await supabase
      .from("jobs")
      .select("id")
      .eq("user_id", args.userId)
      .gte("created_at", since)
      .contains("output_data", { [SUNO_TRACK_KIND_FIELD]: SUNO_TRACK_KIND_SPEECH, sunoTracks: [{ id: audioId }] })
      .limit(1)
    if (error) throw new Error(error.message)
    return (data ?? []).length > 0 ? NOT_A_TRACK : undefined
  } catch (err) {
    // The tool ran with no lookup before this check existed: it runs as it did.
    console.warn(`[suno-id-source] Suno track lookup failed: ${err instanceof Error ? err.message : String(err)}; running as before`)
    return undefined
  }
}

/** The fields a stamp merges into a workflow payload, or the refusal it fails the node with. */
export type SunoIdStamp =
  | { readonly ok: true; readonly patch: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly refusal: { readonly code: string; readonly message: string } }

const NO_PATCH: SunoIdStamp = { ok: true, patch: {} }

/** A payload's cover fields, as the worker will read them. */
function coverFieldsOf(payload: Readonly<Record<string, unknown>>): SunoCoverFields {
  const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
  return {
    model: text(payload.model) as SunoCoverFields["model"],
    prompt: text(payload.prompt),
    lyrics: text(payload.lyrics),
    style: text(payload.style),
    title: text(payload.title),
    negativeStyle: text(payload.negativeStyle),
    vocalGender: text(payload.vocalGender),
    customMode: payload.customMode === true,
    instrumental: payload.instrumental === true,
    personaId: text(payload.personaId),
    personaModel: text(payload.personaModel) as SunoCoverFields["personaModel"],
  }
}

/**
 * The workflow run's twin of the routes' checks (node-executor, before the
 * row and the reservation): a Suno Cover payload keeps its wired track's ids
 * only for a song the run may cover by id (its URL stays beside them, the
 * run's fallback); a Suno Convert to WAV payload names its lane (`stem`); and
 * a Suno Speech take handed to a track tool by its ids is refused. Every other
 * job: an empty patch.
 */
export async function stampSunoIdSource(
  jobName: string,
  payload: Readonly<Record<string, unknown>>,
  userId: string,
): Promise<SunoIdStamp> {
  if (jobName === "suno-cover") {
    const source = await resolveSunoCoverSource({ taskId: payload.taskId, audioId: payload.audioId, uploadUrl: payload.uploadUrl, userId, fields: coverFieldsOf(payload) })
    if (!source) return NO_PATCH
    if (!source.ok) return { ok: false, refusal: { code: source.code, message: source.message } }
    return {
      ok: true,
      patch: source.byId
        ? { taskId: source.taskId, audioId: source.audioId, uploadUrl: source.uploadUrl }
        : { taskId: undefined, audioId: undefined, uploadUrl: source.uploadUrl },
    }
  }
  if (jobName === "suno-convert-wav") {
    const taskId = str(payload.taskId)
    const audioId = str(payload.audioId)
    if (!taskId || !audioId) return NO_PATCH
    const source = await resolveSunoWavSource({ taskId, audioId, userId })
    if (!source.ok) return { ok: false, refusal: { code: source.code, message: source.message } }
    return { ok: true, patch: source.stem ? { stem: true } : {} }
  }
  if (jobName === "suno-separate" || jobName === "suno-extend") {
    const refusal = await sunoSpeechTakeRefusal({ taskId: jobName === "suno-separate" ? payload.taskId : undefined, audioId: payload.audioId, userId })
    return refusal ? { ok: false, refusal: { code: refusal.code, message: refusal.message } } : NO_PATCH
  }
  return NO_PATCH
}
