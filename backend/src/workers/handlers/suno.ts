import { variantJobId } from "@nodaro/shared"
import type { Job } from "bullmq"
import { uploadToR2 } from "../../lib/storage.js"
import {
  sunoGenerate, sunoCover, sunoExtend, sunoLyrics, sunoSeparate, sunoMusicVideo,
  sunoMashup, sunoReplaceSection, sunoAddInstrumental, sunoAddVocals, sunoConvertWav, sunoUploadExtend,
  type SunoModel, type SunoAddTrackModel, type SunoSeparateType, type SunoTaskResult,
} from "../../providers/kie/suno-client.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  generateAndUploadThumbnail,
  isSocialUrl,
  downloadAudioToR2,
  setJobProgress,
  withProgressRamp,
  type HandlerFn,
  type JobContext,
} from "../shared.js"

/**
 * Upload every Suno track to R2 in parallel under variant-suffixed keys and
 * assemble the persistence-shape output_data. Suno almost always returns two
 * tracks per generation; this surfaces both as variants in the version pill
 * instead of silently throwing the second away.
 *
 * Returns null when no tracks survived the upload filter — caller throws with
 * the operation label.
 */
async function uploadAllSunoTracks(
  result: SunoTaskResult,
  jobId: string,
  jobUserId: string | undefined,
): Promise<Record<string, unknown> | null> {
  const validTracks = result.tracks.filter((t) => t.audioUrl)
  if (validTracks.length === 0) return null
  const r2Urls = await Promise.all(
    validTracks.map((t, i) =>
      uploadToR2(t.audioUrl, variantJobId(jobId, i), "audio", jobUserId),
    ),
  )
  const primary = validTracks[0]!
  return {
    audioUrl: r2Urls[0]!,
    ...(r2Urls.length > 1 ? { audioUrls: r2Urls } : {}),
    sunoTrackId: primary.id,
    sunoTitle: primary.title,
    sunoDuration: primary.duration,
    sunoImageUrl: primary.imageUrl,
    sunoTaskId: result.taskId,
    sunoTracks: validTracks.map((t, i) => ({
      id: t.id,
      title: t.title,
      duration: t.duration,
      imageUrl: t.imageUrl,
      audioUrl: r2Urls[i]!,
    })),
    trackCount: validTracks.length,
  }
}

/**
 * Shared tail for every multi-track Suno handler: progress 50→100, persist,
 * commit credits, log. Replaces 8 copies of the same 7-line block.
 */
async function finalizeSunoJob(
  job: Job,
  ctx: JobContext,
  result: SunoTaskResult,
  emptyTracksLabel: string,
): Promise<void> {
  await setJobProgress(job, ctx.jobId, 50)
  const outputData = await uploadAllSunoTracks(result, ctx.jobId, ctx.jobUserId)
  if (!outputData) throw new Error(emptyTracksLabel)
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  if (!await markJobCompleted(ctx.jobId, { output_data: outputData })) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${outputData.audioUrl as string} (${outputData.trackCount as number} tracks)`)
}

const handleSunoGenerate: HandlerFn = async function handleSunoGenerate(job, ctx) {
  const { prompt, model, lyrics, style, title, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight, customMode, instrumental } = job.data as {
    jobId: string; prompt: string; model?: SunoModel; lyrics?: string; style?: string; title?: string
    negativeStyle?: string; vocalGender?: string; styleWeight?: number; weirdnessConstraint?: number; audioWeight?: number
    customMode?: boolean; instrumental?: boolean
  }
  console.log(`[worker] suno-generate ${ctx.jobId} (model: ${model ?? "V5"}, customMode: ${customMode}, instrumental: ${instrumental})`)
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoGenerate({ prompt, model, lyrics, style, title, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight, customMode, instrumental }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno returned no tracks")
}

const handleSunoCover: HandlerFn = async function handleSunoCover(job, ctx) {
  const { prompt, uploadUrl, model, lyrics, style, title, negativeStyle, vocalGender, customMode, instrumental } = job.data as {
    jobId: string; prompt: string; uploadUrl: string; model?: SunoModel; lyrics?: string; style?: string; title?: string
    negativeStyle?: string; vocalGender?: string; customMode?: boolean; instrumental?: boolean
  }
  console.log(`[worker] suno-cover ${ctx.jobId} (model: ${model ?? "V5"}, customMode: ${customMode}, instrumental: ${instrumental})`)
  // If upload_url is a social media URL, download audio to R2 first
  let resolvedUploadUrl = uploadUrl
  if (isSocialUrl(uploadUrl)) {
    console.log(`[worker] Social URL detected for cover, downloading audio first...`)
    resolvedUploadUrl = await downloadAudioToR2(uploadUrl)
  }
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoCover({ prompt, uploadUrl: resolvedUploadUrl, model, lyrics, style, title, negativeStyle, vocalGender, customMode, instrumental }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno cover returned no tracks")
}

const handleSunoExtend: HandlerFn = async function handleSunoExtend(job, ctx) {
  const { audioId, defaultParamFlag, prompt, model, style, title, continueAt, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight } = job.data as {
    jobId: string; audioId: string; defaultParamFlag?: boolean; prompt?: string; model?: SunoModel; style?: string; title?: string
    continueAt?: number; negativeStyle?: string; vocalGender?: string; styleWeight?: number; weirdnessConstraint?: number; audioWeight?: number
  }
  console.log(`[worker] suno-extend ${ctx.jobId} (model: ${model ?? "V5"}, audioId: ${audioId})`)
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoExtend({ audioId, defaultParamFlag, prompt, model, style, title, continueAt, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno extend returned no tracks")
}

const handleSunoLyrics: HandlerFn = async function handleSunoLyrics(job, ctx) {
  const { prompt } = job.data as { jobId: string; prompt: string; usageLogId?: string }
  console.log(`[worker] suno-lyrics ${ctx.jobId}`)
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 10, cap: 80 },
    () => sunoLyrics({ prompt }),
  )
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { lyrics: result.lyrics, sunoTaskId: result.taskId },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${result.lyrics.length} lyrics generated`)
}

const handleSunoSeparate: HandlerFn = async function handleSunoSeparate(job, ctx) {
  const { taskId: sunoTaskId, audioId, separateType } = job.data as {
    jobId: string; taskId: string; audioId: string; separateType?: SunoSeparateType; usageLogId?: string
  }
  const sepType = separateType ?? "separate_vocal"
  console.log(`[worker] suno-separate ${ctx.jobId} (type: ${sepType}, audioId: ${audioId})`)
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoSeparate({ taskId: sunoTaskId, audioId, type: sepType }),
  )
  await setJobProgress(job, ctx.jobId, 50)

  // Upload available stems to R2
  const outputData: Record<string, unknown> = {
    separateType: sepType,
    sunoTaskId: result.taskId,
  }

  const stemFields = [
    "vocalUrl", "instrumentalUrl", "backingVocalsUrl", "drumsUrl",
    "bassUrl", "guitarUrl", "pianoUrl", "keyboardUrl",
    "percussionUrl", "stringsUrl", "synthUrl", "fxUrl",
    "brassUrl", "woodwindsUrl",
  ] as const

  // Upload stems in parallel
  const uploadPromises = stemFields
    .filter(field => result[field])
    .map(async (field) => {
      const url = result[field] as string
      const stemName = field.replace("Url", "")
      const r2Url = await uploadToR2(url, `${ctx.jobId}-${stemName}`, "audio", ctx.jobUserId)
      return { field, r2Url }
    })
  const uploaded = await Promise.all(uploadPromises)
  for (const { field, r2Url } of uploaded) {
    outputData[field] = r2Url
  }
  const uploadedCount = uploaded.length

  // Set primary audioUrl for downstream routing
  outputData.audioUrl = outputData.vocalUrl ?? outputData.instrumentalUrl

  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, { output_data: outputData })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${uploadedCount} stem(s) uploaded`)
}

const handleSunoMusicVideo: HandlerFn = async function handleSunoMusicVideo(job, ctx) {
  const { taskId: sunoTaskId, audioId } = job.data as { jobId: string; taskId: string; audioId: string; usageLogId?: string }
  console.log(`[worker] suno-music-video ${ctx.jobId}`)
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoMusicVideo({ taskId: sunoTaskId, audioId }),
  )
  await setJobProgress(job, ctx.jobId, 50)
  const r2Url = await uploadToR2(result.videoUrl, ctx.jobId, "video", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl, sunoTaskId: result.taskId },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: music video generated`)
}

const handleSunoMashup: HandlerFn = async function handleSunoMashup(job, ctx) {
  const { uploadUrlList, model, customMode, style, title, negativeStyle, vocalGender } = job.data as {
    jobId: string; uploadUrlList: [string, string]; model?: SunoModel; customMode?: boolean; style?: string; title?: string
    negativeStyle?: string; vocalGender?: string
  }
  console.log(`[worker] suno-mashup ${ctx.jobId} (model: ${model ?? "V5"})`)
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoMashup({ uploadUrlList, model, customMode, style, title, negativeStyle, vocalGender }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno mashup returned no tracks")
}

const handleSunoReplaceSection: HandlerFn = async function handleSunoReplaceSection(job, ctx) {
  const { taskId: sunoTaskId, audioId, infillStartS, infillEndS, prompt, tags, title } = job.data as {
    jobId: string; taskId: string; audioId: string; infillStartS: number; infillEndS: number; prompt: string; tags: string; title?: string
  }
  console.log(`[worker] suno-replace-section ${ctx.jobId} (audioId: ${audioId}, ${infillStartS}s-${infillEndS}s)`)
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoReplaceSection({ taskId: sunoTaskId, audioId, infillStartS, infillEndS, prompt, tags, title }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno replace-section returned no tracks")
}

const handleSunoAddInstrumental: HandlerFn = async function handleSunoAddInstrumental(job, ctx) {
  const { taskId: sunoTaskId, audioId, model } = job.data as {
    jobId: string; taskId: string; audioId: string; model?: SunoAddTrackModel
  }
  console.log(`[worker] suno-add-instrumental ${ctx.jobId} (model: ${model ?? "V5"}, audioId: ${audioId})`)
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoAddInstrumental({ taskId: sunoTaskId, audioId, model }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno add-instrumental returned no tracks")
}

const handleSunoAddVocals: HandlerFn = async function handleSunoAddVocals(job, ctx) {
  const { taskId: sunoTaskId, audioId, model } = job.data as {
    jobId: string; taskId: string; audioId: string; model?: SunoAddTrackModel
  }
  console.log(`[worker] suno-add-vocals ${ctx.jobId} (model: ${model ?? "V5"}, audioId: ${audioId})`)
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoAddVocals({ taskId: sunoTaskId, audioId, model }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno add-vocals returned no tracks")
}

const handleSunoConvertWav: HandlerFn = async function handleSunoConvertWav(job, ctx) {
  const { taskId: sunoTaskId, audioId } = job.data as { jobId: string; taskId: string; audioId: string; usageLogId?: string }
  console.log(`[worker] suno-convert-wav ${ctx.jobId}`)
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoConvertWav({ taskId: sunoTaskId, audioId }),
  )
  await setJobProgress(job, ctx.jobId, 50)
  const r2Url = await uploadToR2(result.audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url, sunoTaskId: result.taskId },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: WAV conversion done`)
}

const handleSunoUploadExtend: HandlerFn = async function handleSunoUploadExtend(job, ctx) {
  const { uploadUrl, continueAt, defaultParamFlag, model, style, title, negativeStyle, vocalGender } = job.data as {
    jobId: string; uploadUrl: string; continueAt: number; defaultParamFlag?: boolean; model?: SunoModel; style?: string; title?: string
    negativeStyle?: string; vocalGender?: string
  }
  console.log(`[worker] suno-upload-extend ${ctx.jobId} (model: ${model ?? "V5"}, continueAt: ${continueAt}s)`)
  // If upload_url is a social media URL, download audio to R2 first
  let resolvedUploadUrl = uploadUrl
  if (isSocialUrl(uploadUrl)) {
    console.log(`[worker] Social URL detected for upload-extend, downloading audio first...`)
    resolvedUploadUrl = await downloadAudioToR2(uploadUrl)
  }
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoUploadExtend({ uploadUrl: resolvedUploadUrl, continueAt, defaultParamFlag, model, style, title, negativeStyle, vocalGender }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno upload-extend returned no tracks")
}

export const sunoHandlers: Record<string, HandlerFn> = {
  "suno-generate": handleSunoGenerate,
  "suno-cover": handleSunoCover,
  "suno-extend": handleSunoExtend,
  "suno-lyrics": handleSunoLyrics,
  "suno-separate": handleSunoSeparate,
  "suno-music-video": handleSunoMusicVideo,
  "suno-mashup": handleSunoMashup,
  "suno-replace-section": handleSunoReplaceSection,
  "suno-add-instrumental": handleSunoAddInstrumental,
  "suno-add-vocals": handleSunoAddVocals,
  "suno-convert-wav": handleSunoConvertWav,
  "suno-upload-extend": handleSunoUploadExtend,
}
