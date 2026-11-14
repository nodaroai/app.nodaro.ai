// @reads-none reads a dub from the dubbing service over HTTP
import type { DubbingCaptionFormat } from "@nodaro/shared/media"
import { ELEVENLABS_BASE_URL, fetchMediaFromUrl, getElevenLabsHeaders } from "./client.js"
import { providerFetch } from "../egress.js"
import { parseProjectTaskId } from "./dubbing-project-id.js"

/**
 * Reads of a dub the service already holds: what it is made of, its lines and
 * its captions. Nothing here starts, changes or bills anything.
 *
 * A read answers one of four outcomes instead of throwing, so a caller tells
 * "the service no longer holds it" from "it is still being made" from "this
 * part cannot be read" without parsing an error string. Anything else the
 * service answers (its own outage, a refused key) throws.
 */
export type DubbingRead<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** The service no longer holds the dub, or the language asked for. */
  | { readonly kind: "gone" }
  /** It is still being made; there is nothing to read yet. */
  | { readonly kind: "processing" }
  /** The service holds it but refuses this part of it; `code` is its own reason. */
  | { readonly kind: "unsupported"; readonly code: string }

/** One spoken line as the service timed it, in seconds. */
export interface DubbingLine {
  readonly speakerId: string | null
  readonly start: number
  readonly end: number
  readonly text: string
}

/** A dub made in one request: one target language, one id. */
export interface RegularDub {
  readonly status: string
  readonly sourceLanguage: string | null
  readonly targetLanguages: readonly string[]
  readonly durationSec: number | null
}

export interface RegularTranscript {
  readonly language: string | null
  readonly lines: readonly DubbingLine[]
}

export interface ProjectLanguage {
  readonly id: string
  readonly code: string
  readonly status: string
}

/** A project dub: one source, any number of languages. */
export interface ProjectDub {
  readonly status: string
  readonly sourceLanguage: string | null
  readonly durationSec: number | null
  /** Oldest first, so the language the dub was created with leads. */
  readonly languages: readonly ProjectLanguage[]
}

/** A line of a project dub: its id is the same in the source and in every language. */
export interface ProjectLine extends DubbingLine {
  readonly id: string
}

export interface ProjectSource {
  readonly language: string | null
  readonly lines: readonly ProjectLine[]
}

export interface ProjectLanguageLine extends ProjectLine {
  readonly sourceText: string | null
}

/** The name the service gives the original speech where a language code goes. */
export const REGULAR_SOURCE_TRANSCRIPT = "source"

/** Captions are text; anything larger than this is not a caption file. */
export const DUBBING_CAPTIONS_MAX_BYTES = 4 * 1024 * 1024

const LANGUAGE_PAGE_SIZE = 100
/** 500 languages of one dub is far past anything the service offers. */
const LANGUAGE_MAX_PAGES = 5

const CAPTION_FORMAT_TYPE: Readonly<Record<DubbingCaptionFormat, string>> = { srt: "srt", vtt: "webvtt" }

interface RawRegularDub {
  status?: unknown
  source_language?: unknown
  target_languages?: unknown
  media_metadata?: { duration?: unknown } | null
}
interface RawUtterance { text?: unknown; speaker_id?: unknown; start_s?: unknown; end_s?: unknown }
interface RawRegularTranscript { language?: unknown; utterances?: RawUtterance[] | null }
interface RawProject {
  status?: unknown
  source_language?: unknown
  language_ids?: unknown
  media?: { duration_s?: unknown } | null
}
interface RawLanguage {
  language_id?: unknown
  target_language?: unknown
  status?: unknown
  outputs?: { subtitles?: unknown } | null
}
interface RawLanguagePage { languages?: RawLanguage[] | null; next_cursor?: unknown }
interface RawSegment {
  id?: unknown
  speaker_id?: unknown
  start_s?: unknown
  end_s?: unknown
  text?: unknown
  source_text?: unknown
  translation?: unknown
}
interface RawSegments { language?: unknown; segments?: RawSegment[] | null }

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null)
const seconds = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0)
const positive = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [])

async function get(path: string): Promise<Response> {
  return providerFetch(
    { provider: "elevenlabs", operation: "dubbing.status", modelKey: null, body: undefined, dimensions: {} },
    `${ELEVENLABS_BASE_URL}/v1/dubbing/${path}`,
    { method: "GET", headers: getElevenLabsHeaders() },
  )
}

/** The reason the service gave: its `detail.status`, else its `detail.code`. */
async function refusalCode(res: Response): Promise<string> {
  try {
    const body = await res.json() as { detail?: { status?: unknown; code?: unknown } | null } | null
    return text(body?.detail?.status) ?? text(body?.detail?.code) ?? "unknown"
  } catch {
    return "unknown"
  }
}

async function refusalOf(res: Response): Promise<Exclude<DubbingRead<never>, { kind: "ok" }>> {
  if (res.status === 404) return { kind: "gone" }
  if (res.status === 409) return { kind: "processing" }
  if (res.status === 400 || res.status === 422) return { kind: "unsupported", code: await refusalCode(res) }
  throw new Error(`ElevenLabs dubbing read failed (${res.status})`)
}

async function readJson<T>(path: string): Promise<DubbingRead<T>> {
  const res = await get(path)
  if (!res.ok) return refusalOf(res)
  return { kind: "ok", value: await res.json() as T }
}

async function readText(path: string): Promise<DubbingRead<string>> {
  const res = await get(path)
  if (!res.ok) return refusalOf(res)
  return { kind: "ok", value: await res.text() }
}

const projectPath = (taskId: string): string => `project/${encodeURIComponent(parseProjectTaskId(taskId).projectId)}`

function lineOf(raw: RawUtterance | RawSegment, spoken: unknown): DubbingLine {
  return { speakerId: text(raw.speaker_id), start: seconds(raw.start_s), end: seconds(raw.end_s), text: text(spoken) ?? "" }
}

// ── A dub made in one request ────────────────────────────────────────────────

export async function readRegularDub(dubbingId: string): Promise<DubbingRead<RegularDub>> {
  const read = await readJson<RawRegularDub>(encodeURIComponent(dubbingId))
  if (read.kind !== "ok") return read
  const dub = read.value
  return {
    kind: "ok",
    value: {
      status: text(dub.status) ?? "unknown",
      sourceLanguage: text(dub.source_language),
      targetLanguages: strings(dub.target_languages),
      durationSec: positive(dub.media_metadata?.duration),
    },
  }
}

/**
 * The lines of one language of a dub, or of its original speech
 * (`REGULAR_SOURCE_TRANSCRIPT`). The service gives these lines no ids, and
 * times the original and each language separately.
 */
export async function readRegularTranscript(dubbingId: string, language: string): Promise<DubbingRead<RegularTranscript>> {
  const read = await readJson<RawRegularTranscript>(
    `${encodeURIComponent(dubbingId)}/transcript/${encodeURIComponent(language)}?format_type=json`,
  )
  if (read.kind !== "ok") return read
  return {
    kind: "ok",
    value: {
      language: text(read.value.language),
      lines: (read.value.utterances ?? []).map((utterance) => lineOf(utterance, utterance.text)),
    },
  }
}

/** The same lines as a caption file, written by the service itself. */
export async function readRegularCaptions(
  dubbingId: string,
  language: string,
  format: DubbingCaptionFormat,
): Promise<DubbingRead<string>> {
  return readText(
    `${encodeURIComponent(dubbingId)}/transcript/${encodeURIComponent(language)}?format_type=${CAPTION_FORMAT_TYPE[format]}`,
  )
}

// ── A project dub ────────────────────────────────────────────────────────────

/** Every language of a project. The service lists them newest first, a page at a time. */
async function listProjectLanguages(path: string): Promise<DubbingRead<readonly RawLanguage[]>> {
  let listed: readonly RawLanguage[] = []
  let cursor: string | null = null
  for (let page = 0; page < LANGUAGE_MAX_PAGES; page += 1) {
    const query: string = `page_size=${LANGUAGE_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
    const read: DubbingRead<RawLanguagePage> = await readJson<RawLanguagePage>(`${path}/language?${query}`)
    if (read.kind !== "ok") return read
    listed = [...listed, ...(read.value.languages ?? [])]
    cursor = text(read.value.next_cursor)
    if (!cursor) break
  }
  return { kind: "ok", value: listed }
}

/**
 * Oldest first, in the order the project itself names them: the language a dub
 * was created with is the first one, which is what its stored id resolves to.
 * A language the project does not name yet follows, oldest of those first.
 */
function oldestFirst(languageIds: readonly string[], listed: readonly RawLanguage[]): readonly RawLanguage[] {
  const byId = new Map(listed.map((language) => [language.language_id, language] as const))
  const named = languageIds.flatMap((id) => byId.get(id) ?? [])
  const unnamed = [...listed].reverse().filter((language) => !languageIds.includes(text(language.language_id) ?? ""))
  return [...named, ...unnamed]
}

export async function readProjectDub(taskId: string): Promise<DubbingRead<ProjectDub>> {
  const path = projectPath(taskId)
  const project = await readJson<RawProject>(path)
  if (project.kind !== "ok") return project
  const listed = await listProjectLanguages(path)
  if (listed.kind !== "ok") return listed
  const languages = oldestFirst(strings(project.value.language_ids), listed.value).flatMap((language) => {
    const id = text(language.language_id)
    const code = text(language.target_language)
    return id && code ? [{ id, code, status: text(language.status) ?? "unknown" }] : []
  })
  return {
    kind: "ok",
    value: {
      status: text(project.value.status) ?? "unknown",
      sourceLanguage: text(project.value.source_language),
      durationSec: positive(project.value.media?.duration_s),
      languages,
    },
  }
}

/** The original speech of a project dub, line by line. */
export async function readProjectSource(taskId: string): Promise<DubbingRead<ProjectSource>> {
  const read = await readJson<RawSegments>(`${projectPath(taskId)}/transcript`)
  if (read.kind !== "ok") return read
  const lines = (read.value.segments ?? []).flatMap((segment) => {
    const id = text(segment.id)
    return id ? [{ id, ...lineOf(segment, segment.text) }] : []
  })
  return { kind: "ok", value: { language: text(read.value.language), lines } }
}

/** One language of a project dub: every line beside the original line it translates. */
export async function readProjectLanguageLines(
  taskId: string,
  languageId: string,
): Promise<DubbingRead<readonly ProjectLanguageLine[]>> {
  const read = await readJson<RawSegments>(`${projectPath(taskId)}/language/${encodeURIComponent(languageId)}/transcript`)
  if (read.kind !== "ok") return read
  const lines = (read.value.segments ?? []).flatMap((segment) => {
    const id = text(segment.id)
    return id ? [{ id, ...lineOf(segment, segment.translation), sourceText: text(segment.source_text) }] : []
  })
  return { kind: "ok", value: lines }
}

/**
 * The caption file the service wrote for one language of a project dub
 * (WebVTT). The link it hands out is signed and short-lived, so it is read
 * fresh each time and never leaves this module.
 */
export async function readProjectSubtitles(taskId: string, languageId: string): Promise<DubbingRead<string>> {
  const read = await readJson<RawLanguage>(`${projectPath(taskId)}/language/${encodeURIComponent(languageId)}`)
  if (read.kind !== "ok") return read
  const status = text(read.value.status)
  if (status === "queued" || status === "processing") return { kind: "processing" }
  const url = text(read.value.outputs?.subtitles)
  if (!url) return { kind: "unsupported", code: "no_subtitles" }
  const file = await fetchMediaFromUrl(url, DUBBING_CAPTIONS_MAX_BYTES)
  return { kind: "ok", value: file.toString("utf8") }
}
