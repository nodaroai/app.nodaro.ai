// @reads-none reads only the dub it renders into a work dir
import { dubbingModelIdentifier } from "../../lib/dubbing-model.js"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { ELEVENLABS_BASE_URL, getElevenLabsHeaders } from "./client.js"
import { providerFetch } from "../egress.js"
import type { DubbingOptions, DubbingSource, DubbingStatus } from "./dubbing.js"
import { mergeVideoAudio } from "../video/merge-video-audio.js"
import { cleanupWorkDir, createWorkDir, downloadFile, runFfmpeg } from "../video/ffmpeg-utils.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"

// Persist the project itself immediately after create. Language IDs can be
// recovered by reading that project; recovery must never create another target.
export const DUBBING_PROJECT_PREFIX = "project:"
export const isDubbingProject = (id: string): boolean => id.startsWith(DUBBING_PROJECT_PREFIX)
export const usesDubbingProject = (language: string): boolean => dubbingModelIdentifier(language) === "elevenlabs-dubbing-v2"

export function validateProjectDubbing(source: DubbingSource, options?: DubbingOptions): void {
  if (!source.url) throw new Error("Hebrew dubbing requires an uploaded audio or video file. Import the video first.")
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
  const projectId = encodeURIComponent(id.slice(DUBBING_PROJECT_PREFIX.length))
  const project = await projectGet<Project>(projectId)
  if (project.status === "failed") return { project }
  const languageId = project.language_ids?.[0]
  if (!languageId) return { project }
  return { project, language: await projectGet<Language>(`${projectId}/language/${encodeURIComponent(languageId)}`) }
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
