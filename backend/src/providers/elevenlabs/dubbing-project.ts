// @reads-none reads only the dub it renders into a work dir
import { PROJECT_DUBBING_MODEL_ID, PROJECT_DUBBING_NEEDS_UPLOAD, dubsAsProject } from "../../lib/dubbing-model.js"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { ELEVENLABS_BASE_URL, getElevenLabsHeaders } from "./client.js"
import { providerFetch } from "../egress.js"
import type { ReconcileOpts } from "../provider.interface.js"
import type { DubbingOptions, DubbingSource, DubbingStartResult, DubbingStatus } from "./dubbing.js"
import { mergeVideoAudio } from "../video/merge-video-audio.js"
import { cleanupWorkDir, createWorkDir, downloadFile, runFfmpeg } from "../video/ffmpeg-utils.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import {
  DUBBING_PROJECT_PREFIX,
  isDubbingProject,
  parseProjectTaskId,
  projectTaskId,
  type ProjectTaskId,
} from "./dubbing-project-id.js"

// The stored id of a project dub is read in places that render nothing; its
// helpers live in their own file and are passed on here for the callers that
// already take them from this one.
export { DUBBING_PROJECT_PREFIX, isDubbingProject, parseProjectTaskId, projectTaskId }
export type { ProjectTaskId }
export const usesDubbingProject = (language: string): boolean => dubsAsProject(language)

export function validateProjectDubbing(source: DubbingSource, options?: DubbingOptions): void {
  if (!source.url) throw new Error(PROJECT_DUBBING_NEEDS_UPLOAD)
  const unsupported = [
    options?.disableVoiceCloning && "disableVoiceCloning",
    options?.dropBackgroundAudio && "dropBackgroundAudio",
    options?.numSpeakers && "numSpeakers",
    options?.watermark && "watermark",
    options?.startTime != null && "startTime",
    options?.endTime != null && "endTime",
    options?.useProfanityFilter && "useProfanityFilter",
    options?.targetAccent && "targetAccent",
  ].filter(Boolean)
  if (unsupported.length) throw new Error(`Hebrew dubbing does not support these settings: ${unsupported.join(", ")}. Use automatic speakers, keep original voices and background, and trim the source before dubbing.`)
}

interface Project {
  status: string
  language_ids?: string[]
  error?: { message?: string; code?: string } | null
  media?: { mime_type?: string; has_video?: boolean; duration_s?: number } | null
}
interface Language {
  status: string
  target_language: string
  error?: { message?: string; code?: string } | null
  outputs?: { lossless_audio?: string | null } | null
}

async function projectGet<T>(path: string): Promise<T> {
  const res = await providerFetch(
    { provider: "elevenlabs", operation: "dubbing.status", modelKey: null, body: undefined, dimensions: {} },
    `${ELEVENLABS_BASE_URL}/v1/dubbing/project/${path}`,
    { method: "GET", headers: getElevenLabsHeaders() },
  )
  if (!res.ok) throw new Error(`ElevenLabs dubbing project status failed (${res.status})`)
  return await res.json() as T
}

async function readProject(id: string): Promise<{ project: Project; language?: Language }> {
  const { projectId, languageId: named } = parseProjectTaskId(id)
  const path = encodeURIComponent(projectId)
  const project = await projectGet<Project>(path)
  if (project.status === "failed") return { project }
  // A language added later is named in the id; a dub's first language is the project's oldest.
  const languageId = named ?? project.language_ids?.[0]
  if (!languageId) return { project }
  return { project, language: await projectGet<Language>(`${path}/language/${encodeURIComponent(languageId)}`) }
}

/**
 * Dub a project into one more language. The project keeps the source it was
 * made from, so nothing is uploaded again, and the languages it already has are
 * left as they are. The id handed back names the new language, so the poll and
 * the download read it and never the project's first one.
 */
export async function addDubbingProjectLanguage(
  taskId: string,
  targetLanguage: string,
  reconcileOpts?: ReconcileOpts,
): Promise<DubbingStartResult> {
  const { projectId } = parseProjectTaskId(taskId)
  const body = { target_language: targetLanguage }
  const response = await providerFetch(
    { provider: "elevenlabs", operation: "dubbing.start", modelKey: PROJECT_DUBBING_MODEL_ID, body, dimensions: reconcileOpts?.dimensions ?? {} },
    `${ELEVENLABS_BASE_URL}/v1/dubbing/project/${encodeURIComponent(projectId)}/language`,
    { method: "POST", headers: { ...getElevenLabsHeaders(), "content-type": "application/json" }, body: JSON.stringify(body) },
  )
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Dubbing start failed (${response.status}): ${errorText}`)
  }
  const result = await response.json() as { language_id?: string }
  if (!result.language_id) throw new Error("ElevenLabs dubbing project response omitted language_id")
  const dubbingId = projectTaskId(projectId, result.language_id)
  await fireOnTaskCreated(reconcileOpts, dubbingId, "[elevenlabs/dubbing]")
  return { dubbingId, expectedDurationSec: 0 }
}

/**
 * A language the server filed for a project dub: the project takes the
 * language, or, when the project already holds it with no job delivering it,
 * that language is the one delivered and nothing new is made. Either way the
 * id handed back names the language.
 */
export async function startDubbingProjectLanguage(
  taskId: string,
  targetLanguage: string,
  adoptLanguageId: string | undefined,
  reconcileOpts?: ReconcileOpts,
): Promise<DubbingStartResult> {
  if (!adoptLanguageId) return addDubbingProjectLanguage(taskId, targetLanguage, reconcileOpts)
  const dubbingId = projectTaskId(parseProjectTaskId(taskId).projectId, adoptLanguageId)
  await fireOnTaskCreated(reconcileOpts, dubbingId, "[elevenlabs/dubbing]")
  return { dubbingId, expectedDurationSec: 0 }
}

export async function pollDubbingProject(id: string): Promise<DubbingStatus> {
  const { project, language } = await readProject(id)
  const failed = project.status === "failed" || language?.status === "failed"
  return {
    dubbing_id: id,
    status: failed ? "failed" : language?.status === "completed" ? "dubbed" : "dubbing",
    error: project.error?.message ?? project.error?.code ?? language?.error?.message ?? language?.error?.code,
    target_languages: language ? [language.target_language] : undefined,
    media_metadata: project.media ? {
      content_type: project.media.has_video ? "video/mp4" : project.media.mime_type,
      duration: project.media.duration_s,
    } : undefined,
  }
}

/** Project output is FLAC, never an MP4/MP3 despite the input's media type.
 * Fetch a fresh signed URL each attempt, without forwarding provider credentials.
 * Reuse the production mux so video stays browser-playable and its audio is
 * replaced, not mixed with the original speech a second time.
 */
export async function downloadDubbingProject(id: string, videoMode: boolean, sourceUrl?: string): Promise<Buffer> {
  const { language } = await readProject(id)
  const audioUrl = language?.outputs?.lossless_audio
  if (language?.status !== "completed" || !audioUrl) throw new Error("Dubbed audio is not ready")
  return runPostProcessing(async () => {
    if (videoMode) {
      if (!sourceUrl) throw new Error("The original video is required to deliver this dub")
      const output = await mergeVideoAudio({ videoUrl: sourceUrl, audioUrl, keepOriginalAudio: false })
      try { return await readFile(output) } finally { await cleanupWorkDir(dirname(output)) }
    }
    const workDir = await createWorkDir("dub-project-audio")
    try {
      const input = join(workDir, "dub.flac")
      const output = join(workDir, "dub.mp3")
      await downloadFile(audioUrl, input)
      await runFfmpeg(["-y", "-i", input, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", output])
      return await readFile(output)
    } finally { await cleanupWorkDir(workDir) }
  })
}
