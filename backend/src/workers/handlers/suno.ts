import { uploadToR2 } from "../../lib/storage.js"
import {
  sunoGenerate, sunoCover, sunoExtend, sunoLyrics, sunoSeparate, sunoMusicVideo,
  sunoMashup, sunoReplaceSection, sunoAddInstrumental, sunoAddVocals, sunoConvertWav, sunoUploadExtend,
  type SunoModel, type SunoAddTrackModel, type SunoSeparateType,
} from "../../providers/kie/suno-client.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  generateAndUploadThumbnail,
  isSocialUrl,
  downloadAudioToR2,
  type HandlerFn,
} from "../shared.js"

const handleSunoGenerate: HandlerFn = async function handleSunoGenerate(job, ctx) {
  const { prompt, model, lyrics, style, title, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight, customMode, instrumental } = job.data as {
    jobId: string; prompt: string; model?: SunoModel; lyrics?: string; style?: string; title?: string
    negativeStyle?: string; vocalGender?: string; styleWeight?: number; weirdnessConstraint?: number; audioWeight?: number
    customMode?: boolean; instrumental?: boolean
  }
  console.log(`[worker] suno-generate ${ctx.jobId} (model: ${model ?? "V5"}, customMode: ${customMode}, instrumental: ${instrumental})`)
  const result = await sunoGenerate({ prompt, model, lyrics, style, title, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight, customMode, instrumental })
  await job.updateProgress(50)
  // Upload first track to R2 for permanent storage (Suno URLs expire in 14 days)
  const firstTrack = result.tracks[0]
  if (!firstTrack) throw new Error("Suno returned no tracks")
  const r2Url = await uploadToR2(firstTrack.audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url, sunoTrackId: firstTrack.id, sunoTitle: firstTrack.title, sunoDuration: firstTrack.duration, sunoImageUrl: firstTrack.imageUrl, sunoTaskId: result.taskId, trackCount: result.tracks.length },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (${result.tracks.length} tracks)`)
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
  const result = await sunoCover({ prompt, uploadUrl: resolvedUploadUrl, model, lyrics, style, title, negativeStyle, vocalGender, customMode, instrumental })
  await job.updateProgress(50)
  const firstTrack = result.tracks[0]
  if (!firstTrack) throw new Error("Suno cover returned no tracks")
  const r2Url = await uploadToR2(firstTrack.audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url, sunoTrackId: firstTrack.id, sunoTitle: firstTrack.title, sunoDuration: firstTrack.duration, sunoImageUrl: firstTrack.imageUrl, sunoTaskId: result.taskId, trackCount: result.tracks.length },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (${result.tracks.length} tracks)`)
}

const handleSunoExtend: HandlerFn = async function handleSunoExtend(job, ctx) {
  const { audioId, defaultParamFlag, prompt, model, style, title, continueAt, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight } = job.data as {
    jobId: string; audioId: string; defaultParamFlag?: boolean; prompt?: string; model?: SunoModel; style?: string; title?: string
    continueAt?: number; negativeStyle?: string; vocalGender?: string; styleWeight?: number; weirdnessConstraint?: number; audioWeight?: number
  }
  console.log(`[worker] suno-extend ${ctx.jobId} (model: ${model ?? "V5"}, audioId: ${audioId})`)
  const result = await sunoExtend({ audioId, defaultParamFlag, prompt, model, style, title, continueAt, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight })
  await job.updateProgress(50)
  const firstTrack = result.tracks[0]
  if (!firstTrack) throw new Error("Suno extend returned no tracks")
  const r2Url = await uploadToR2(firstTrack.audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url, sunoTrackId: firstTrack.id, sunoTitle: firstTrack.title, sunoDuration: firstTrack.duration, sunoImageUrl: firstTrack.imageUrl, sunoTaskId: result.taskId, trackCount: result.tracks.length },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (${result.tracks.length} tracks)`)
}

const handleSunoLyrics: HandlerFn = async function handleSunoLyrics(job, ctx) {
  const { prompt } = job.data as { jobId: string; prompt: string; usageLogId?: string }
  console.log(`[worker] suno-lyrics ${ctx.jobId}`)
  const result = await sunoLyrics({ prompt })
  await job.updateProgress(100)
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
  const result = await sunoSeparate({ taskId: sunoTaskId, audioId, type: sepType })
  await job.updateProgress(50)

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

  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, { output_data: outputData })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${uploadedCount} stem(s) uploaded`)
}

const handleSunoMusicVideo: HandlerFn = async function handleSunoMusicVideo(job, ctx) {
  const { taskId: sunoTaskId, audioId } = job.data as { jobId: string; taskId: string; audioId: string; usageLogId?: string }
  console.log(`[worker] suno-music-video ${ctx.jobId}`)
  const result = await sunoMusicVideo({ taskId: sunoTaskId, audioId })
  await job.updateProgress(50)
  const r2Url = await uploadToR2(result.videoUrl, ctx.jobId, "video", ctx.jobUserId)
  await job.updateProgress(100)
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
  const result = await sunoMashup({ uploadUrlList, model, customMode, style, title, negativeStyle, vocalGender })
  await job.updateProgress(50)
  const firstTrack = result.tracks[0]
  if (!firstTrack) throw new Error("Suno mashup returned no tracks")
  const r2Url = await uploadToR2(firstTrack.audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url, sunoTrackId: firstTrack.id, sunoTitle: firstTrack.title, sunoDuration: firstTrack.duration, sunoImageUrl: firstTrack.imageUrl, sunoTaskId: result.taskId, trackCount: result.tracks.length },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (${result.tracks.length} tracks)`)
}

const handleSunoReplaceSection: HandlerFn = async function handleSunoReplaceSection(job, ctx) {
  const { taskId: sunoTaskId, audioId, infillStartS, infillEndS, prompt, tags, title } = job.data as {
    jobId: string; taskId: string; audioId: string; infillStartS: number; infillEndS: number; prompt: string; tags: string; title?: string
  }
  console.log(`[worker] suno-replace-section ${ctx.jobId} (audioId: ${audioId}, ${infillStartS}s-${infillEndS}s)`)
  const result = await sunoReplaceSection({ taskId: sunoTaskId, audioId, infillStartS, infillEndS, prompt, tags, title })
  await job.updateProgress(50)
  const firstTrack = result.tracks[0]
  if (!firstTrack) throw new Error("Suno replace-section returned no tracks")
  const r2Url = await uploadToR2(firstTrack.audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url, sunoTrackId: firstTrack.id, sunoTitle: firstTrack.title, sunoDuration: firstTrack.duration, sunoImageUrl: firstTrack.imageUrl, sunoTaskId: result.taskId, trackCount: result.tracks.length },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (${result.tracks.length} tracks)`)
}

const handleSunoAddInstrumental: HandlerFn = async function handleSunoAddInstrumental(job, ctx) {
  const { taskId: sunoTaskId, audioId, model } = job.data as {
    jobId: string; taskId: string; audioId: string; model?: SunoAddTrackModel
  }
  console.log(`[worker] suno-add-instrumental ${ctx.jobId} (model: ${model ?? "V5"}, audioId: ${audioId})`)
  const result = await sunoAddInstrumental({ taskId: sunoTaskId, audioId, model })
  await job.updateProgress(50)
  const firstTrack = result.tracks[0]
  if (!firstTrack) throw new Error("Suno add-instrumental returned no tracks")
  const r2Url = await uploadToR2(firstTrack.audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url, sunoTrackId: firstTrack.id, sunoTitle: firstTrack.title, sunoDuration: firstTrack.duration, sunoImageUrl: firstTrack.imageUrl, sunoTaskId: result.taskId, trackCount: result.tracks.length },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (${result.tracks.length} tracks)`)
}

const handleSunoAddVocals: HandlerFn = async function handleSunoAddVocals(job, ctx) {
  const { taskId: sunoTaskId, audioId, model } = job.data as {
    jobId: string; taskId: string; audioId: string; model?: SunoAddTrackModel
  }
  console.log(`[worker] suno-add-vocals ${ctx.jobId} (model: ${model ?? "V5"}, audioId: ${audioId})`)
  const result = await sunoAddVocals({ taskId: sunoTaskId, audioId, model })
  await job.updateProgress(50)
  const firstTrack = result.tracks[0]
  if (!firstTrack) throw new Error("Suno add-vocals returned no tracks")
  const r2Url = await uploadToR2(firstTrack.audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url, sunoTrackId: firstTrack.id, sunoTitle: firstTrack.title, sunoDuration: firstTrack.duration, sunoImageUrl: firstTrack.imageUrl, sunoTaskId: result.taskId, trackCount: result.tracks.length },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (${result.tracks.length} tracks)`)
}

const handleSunoConvertWav: HandlerFn = async function handleSunoConvertWav(job, ctx) {
  const { taskId: sunoTaskId, audioId } = job.data as { jobId: string; taskId: string; audioId: string; usageLogId?: string }
  console.log(`[worker] suno-convert-wav ${ctx.jobId}`)
  const result = await sunoConvertWav({ taskId: sunoTaskId, audioId })
  await job.updateProgress(50)
  const r2Url = await uploadToR2(result.audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)
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
  const result = await sunoUploadExtend({ uploadUrl: resolvedUploadUrl, continueAt, defaultParamFlag, model, style, title, negativeStyle, vocalGender })
  await job.updateProgress(50)
  const firstTrack = result.tracks[0]
  if (!firstTrack) throw new Error("Suno upload-extend returned no tracks")
  const r2Url = await uploadToR2(firstTrack.audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url, sunoTrackId: firstTrack.id, sunoTitle: firstTrack.title, sunoDuration: firstTrack.duration, sunoImageUrl: firstTrack.imageUrl, sunoTaskId: result.taskId, trackCount: result.tracks.length },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (${result.tracks.length} tracks)`)
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
