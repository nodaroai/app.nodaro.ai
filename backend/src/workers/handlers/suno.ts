import { variantJobId } from "@nodaro/shared"
import { config } from "../../lib/config.js"
import type { Job } from "bullmq"
import { uploadToR2 } from "../../lib/storage.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import {
  sunoGenerate, sunoCover, sunoExtend, sunoLyrics, sunoSeparate, sunoMusicVideo,
  sunoMashup, sunoReplaceSection, sunoAddInstrumental, sunoAddVocals, sunoConvertWav, sunoUploadExtend,
  type SunoModel, type SunoAddTrackModel, type SunoSeparateType, type SunoTaskResult,
  type SunoLyricsResult, type SunoSeparateResult, type SunoMusicVideoResult, type SunoConvertWavResult,
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
import { makeOnTaskCreated } from "../../lib/reconcile/persistence.js"
import { providerKindForSuno } from "../../lib/reconcile/provider-kind.js"

/**
 * Upload every Suno track to R2 in parallel under variant-suffixed keys and
 * assemble the persistence-shape output_data. Suno almost always returns two
 * tracks per generation; this surfaces both as variants in the version pill
 * instead of silently throwing the second away.
 *
 * Returns null when no tracks survived the upload filter — caller throws with
 * the operation label.
 */

/**
 * Suno through the connected cloud, shaped back into a SunoTaskResult.
 *
 * The cloud finishes the job on ITS storage and answers with the same
 * `output_data` this instance would have produced (`sunoTracks[]` with
 * `audioUrl`s). Handing those tracks to the normal finalizer re-downloads them
 * into this instance's R2 under its own keys, so a cloud-run Suno job is
 * indistinguishable downstream from a local one.
 *
 * Only used when the install has no KIE key of its own — a keyed install never
 * reaches this and behaves exactly as before.
 */
async function runSunoOnCloud(
  jobType: string,
  payload: Record<string, unknown>,
  onProgress?: (p: number) => Promise<void>,
): Promise<SunoTaskResult> {
  const { runJobOnCloud } = await import("../../providers/nodaro/run-on-cloud.js")
  const output = await runJobOnCloud(jobType, payload, onProgress)
  const tracks = Array.isArray(output.sunoTracks)
    ? (output.sunoTracks as Array<Record<string, unknown>>)
    : typeof output.audioUrl === "string"
      // Single-track operations (convert-wav, separate stems) report only the
      // primary URL; synthesize the one-element list the finalizer expects.
      ? [{ audioUrl: output.audioUrl, id: output.sunoTrackId, title: output.sunoTitle }]
      : []
  return {
    taskId: typeof output.sunoTaskId === "string" ? output.sunoTaskId : "cloud",
    // title / duration / imageUrl are OPTIONAL on SunoTrack. Defaulting them to
    // "" and 0 would turn "unknown" into "empty" and "zero seconds" — a real
    // track would render as 0:00. Absent stays absent.
    tracks: tracks.map((t) => ({
      id: typeof t.id === "string" ? t.id : "",
      audioUrl: typeof t.audioUrl === "string" ? t.audioUrl : "",
      ...(typeof t.title === "string" ? { title: t.title } : {}),
      ...(typeof t.duration === "number" ? { duration: t.duration } : {}),
      ...(typeof t.imageUrl === "string" ? { imageUrl: t.imageUrl } : {}),
    })),
  }
}

/** True when this install has no KIE key and a live nodaro.ai connection. */
async function shouldRunSunoOnCloud(): Promise<boolean> {
  if (config.KIE_API_KEY) return false
  const { isNodaroConnected } = await import("../../lib/nodaro-connect.js")
  return isNodaroConnected().catch(() => false)
}

async function uploadAllSunoTracks(
  result: SunoTaskResult,
  jobId: string,
  jobUserId: string | undefined,
): Promise<Record<string, unknown> | null> {
  const validTracks = result.tracks.filter((t) => t.audioUrl)
  if (validTracks.length === 0) return null
  // POST-PROVIDER: Suno already delivered these tracks (we were billed) — an R2
  // upload failure here is post-delivery, so skip the refund.
  const r2Urls = await runPostProcessing(() =>
    Promise.all(
      validTracks.map((t, i) =>
        uploadToR2(t.audioUrl, variantJobId(jobId, i), "audio", jobUserId),
      ),
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
 * Who actually ran this Suno job — written to `jobs.provider` (#753).
 *
 * The jobs.provider vocabulary, not the reconcile ProviderKind
 * (`providerKindForSuno()` returns "kie-suno", which keys the reconcile
 * probes): "kie" matches the KIE registry id, "nodaro" matches
 * NODARO_PROVIDER_ID — the same values every router-finalized job records.
 * REQUIRED on every finalize tail so tsc forces the next completion path
 * added here to attribute itself; suno.ts finalizes via markJobCompleted
 * directly (never through job-finalize.ts), so this is the only writer.
 */
type SunoProviderUsed = "nodaro" | "kie"

/**
 * Shared tail for every multi-track Suno handler: progress 50→100, persist,
 * commit credits, log. Replaces 8 copies of the same 7-line block.
 */
async function finalizeSunoJob(
  job: Job,
  ctx: JobContext,
  result: SunoTaskResult,
  emptyTracksLabel: string,
  provider: SunoProviderUsed,
): Promise<void> {
  await setJobProgress(job, ctx.jobId, 50)
  const outputData = await uploadAllSunoTracks(result, ctx.jobId, ctx.jobUserId)
  if (!outputData) throw new Error(emptyTracksLabel)
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  if (!await markJobCompleted(ctx.jobId, { output_data: outputData, provider })) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${outputData.audioUrl as string} (${outputData.trackCount as number} tracks)`)
}


/**
 * One line per Suno handler: run it on the cloud when this install has no KIE
 * key, and report whether it did.
 *
 * A helper rather than eight copies of the same branch — every operation here
 * shares the same finalizer, so the only thing that varies is the job type and
 * the empty-result label. A local KIE key always wins; keyed installs never
 * reach this.
 */
async function maybeRunSunoOnCloud(
  job: Job,
  ctx: JobContext,
  jobType: string,
  emptyTracksLabel: string,
): Promise<boolean> {
  if (!(await shouldRunSunoOnCloud())) return false
  const result = await runSunoOnCloud(jobType, job.data as Record<string, unknown>, (p) =>
    setJobProgress(job, ctx.jobId, Math.min(45, Math.round(p * 0.45))),
  )
  await finalizeSunoJob(job, ctx, result, emptyTracksLabel, "nodaro")
  return true
}

/**
 * Cloud output for the four BESPOKE Suno operations (#643) — lyrics, separate,
 * music-video, convert-wav. They don't share the multi-track finalizer, so
 * instead of reshaping into a SunoTaskResult this hands the caller the cloud's
 * raw `output_data`; the per-operation adapter in each handler then feeds the
 * SAME local persistence tail a KIE result would take. Returns null when this
 * install should run the operation itself (has a key, or isn't connected).
 */
async function maybeSunoCloudOutput(
  job: Job,
  ctx: JobContext,
  jobType: string,
): Promise<Record<string, unknown> | null> {
  if (!(await shouldRunSunoOnCloud())) return null
  const { runJobOnCloud } = await import("../../providers/nodaro/run-on-cloud.js")
  return runJobOnCloud(jobType, job.data as Record<string, unknown>, (p) =>
    setJobProgress(job, ctx.jobId, Math.min(45, Math.round(p * 0.45))),
  )
}

/** The cloud's `sunoTaskId`, or a marker when the field didn't survive. */
function cloudTaskId(output: Record<string, unknown>): string {
  return typeof output.sunoTaskId === "string" ? output.sunoTaskId : "cloud"
}

const handleSunoGenerate: HandlerFn = async function handleSunoGenerate(job, ctx) {
  const { prompt, model, lyrics, style, title, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight, customMode, instrumental, duration, personaId, personaModel } = job.data as {
    jobId: string; prompt: string; model?: SunoModel; lyrics?: string; style?: string; title?: string
    negativeStyle?: string; vocalGender?: string; styleWeight?: number; weirdnessConstraint?: number; audioWeight?: number
    customMode?: boolean; instrumental?: boolean; duration?: number
    personaId?: string; personaModel?: "voice_persona" | "style_persona"
  }
  console.log(`[worker] suno-generate ${ctx.jobId} (model: ${model ?? "V5"}, customMode: ${customMode}, instrumental: ${instrumental}${duration != null ? `, duration: ${duration}s` : ""}${personaId ? `, persona: ${personaModel ?? "voice_persona"}` : ""})`)
  if (await maybeRunSunoOnCloud(job, ctx, "suno-generate", "Suno returned no tracks")) return

  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoGenerate({ prompt, model, lyrics, style, title, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight, customMode, instrumental, duration, personaId, personaModel }, { onTaskCreated }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno returned no tracks", "kie")
}

const handleSunoCover: HandlerFn = async function handleSunoCover(job, ctx) {
  const { prompt, uploadUrl, model, lyrics, style, title, negativeStyle, vocalGender, customMode, instrumental, personaId, personaModel } = job.data as {
    jobId: string; prompt: string; uploadUrl: string; model?: SunoModel; lyrics?: string; style?: string; title?: string
    negativeStyle?: string; vocalGender?: string; customMode?: boolean; instrumental?: boolean
    personaId?: string; personaModel?: "voice_persona" | "style_persona"
  }
  console.log(`[worker] suno-cover ${ctx.jobId} (model: ${model ?? "V5"}, customMode: ${customMode}, instrumental: ${instrumental}${personaId ? `, persona: ${personaModel ?? "voice_persona"}` : ""})`)
  // BEFORE the social-URL download below: the cloud's own handler performs the
  // same download, and the local copy's URL is on a private host it could not
  // fetch anyway — downloading here first would cost bandwidth for a file we
  // then never send.
  if (await maybeRunSunoOnCloud(job, ctx, "suno-cover", "Suno cover returned no tracks")) return

  // If upload_url is a social media URL, download audio to R2 first
  let resolvedUploadUrl = uploadUrl
  if (isSocialUrl(uploadUrl)) {
    console.log(`[worker] Social URL detected for cover, downloading audio first...`)
    resolvedUploadUrl = await downloadAudioToR2(uploadUrl)
  }
  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoCover({ prompt, uploadUrl: resolvedUploadUrl, model, lyrics, style, title, negativeStyle, vocalGender, customMode, instrumental, personaId, personaModel }, { onTaskCreated }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno cover returned no tracks", "kie")
}

const handleSunoExtend: HandlerFn = async function handleSunoExtend(job, ctx) {
  const { audioId, defaultParamFlag, prompt, model, style, title, continueAt, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight, personaId, personaModel } = job.data as {
    jobId: string; audioId: string; defaultParamFlag?: boolean; prompt?: string; model?: SunoModel; style?: string; title?: string
    continueAt?: number; negativeStyle?: string; vocalGender?: string; styleWeight?: number; weirdnessConstraint?: number; audioWeight?: number
    personaId?: string; personaModel?: "voice_persona" | "style_persona"
  }
  console.log(`[worker] suno-extend ${ctx.jobId} (model: ${model ?? "V5"}, audioId: ${audioId}${personaId ? `, persona: ${personaModel ?? "voice_persona"}` : ""})`)
  if (await maybeRunSunoOnCloud(job, ctx, "suno-extend", "Suno extend returned no tracks")) return

  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoExtend({ audioId, defaultParamFlag, prompt, model, style, title, continueAt, negativeStyle, vocalGender, styleWeight, weirdnessConstraint, audioWeight, personaId, personaModel }, { onTaskCreated }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno extend returned no tracks", "kie")
}

/** Shared tail for suno-lyrics: local KIE result and cloud replay land here identically. */
async function finalizeSunoLyrics(job: Job, ctx: JobContext, result: SunoLyricsResult, provider: SunoProviderUsed): Promise<void> {
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { lyrics: result.lyrics, sunoTaskId: result.taskId },
    provider,
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${result.lyrics.length} lyrics generated`)
}

const handleSunoLyrics: HandlerFn = async function handleSunoLyrics(job, ctx) {
  const { prompt } = job.data as { jobId: string; prompt: string; usageLogId?: string }
  console.log(`[worker] suno-lyrics ${ctx.jobId}`)
  const cloud = await maybeSunoCloudOutput(job, ctx, "suno-lyrics")
  if (cloud) {
    // Lyrics are pure text — the cloud's output_data already IS the local
    // shape, nothing to re-host. Validate rather than trust: an empty payload
    // from a version-skewed cloud must fail loudly, not complete empty.
    const lyrics = Array.isArray(cloud.lyrics)
      ? (cloud.lyrics as Array<Record<string, unknown>>)
          .filter((l) => typeof l?.text === "string")
          .map((l) => ({ text: l.text as string, title: typeof l.title === "string" ? l.title : "" }))
      : []
    if (lyrics.length === 0) throw new Error("nodaro.ai returned no lyrics")
    return finalizeSunoLyrics(job, ctx, { taskId: cloudTaskId(cloud), lyrics }, "nodaro")
  }
  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 10, cap: 80 },
    () => sunoLyrics({ prompt }, { onTaskCreated }),
  )
  await finalizeSunoLyrics(job, ctx, result, "kie")
}

const STEM_FIELDS = [
  "vocalUrl", "instrumentalUrl", "backingVocalsUrl", "drumsUrl",
  "bassUrl", "guitarUrl", "pianoUrl", "keyboardUrl",
  "percussionUrl", "stringsUrl", "synthUrl", "fxUrl",
  "brassUrl", "woodwindsUrl",
] as const

/**
 * Shared tail for suno-separate: uploads whichever stems the result carries —
 * KIE-delivered or the connected cloud's R2 — into THIS instance's R2 under
 * `<jobId>-<stem>` keys and persists the same output_data either way.
 */
async function finalizeSunoSeparate(
  job: Job,
  ctx: JobContext,
  result: SunoSeparateResult,
  sepType: SunoSeparateType,
  provider: SunoProviderUsed,
): Promise<void> {
  await setJobProgress(job, ctx.jobId, 50)

  const outputData: Record<string, unknown> = {
    separateType: sepType,
    sunoTaskId: result.taskId,
  }

  // Upload stems in parallel. POST-PROVIDER: stems are the delivered Suno
  // separation result (billed) — an R2 upload failure here skips the refund.
  const uploadPromises = STEM_FIELDS
    .filter(field => result[field])
    .map(async (field) => {
      const url = result[field] as string
      const stemName = field.replace("Url", "")
      const r2Url = await uploadToR2(url, `${ctx.jobId}-${stemName}`, "audio", ctx.jobUserId)
      return { field, r2Url }
    })
  const uploaded = await runPostProcessing(() => Promise.all(uploadPromises))
  for (const { field, r2Url } of uploaded) {
    outputData[field] = r2Url
  }

  // Set primary audioUrl for downstream routing
  outputData.audioUrl = outputData.vocalUrl ?? outputData.instrumentalUrl

  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, { output_data: outputData, provider })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${uploaded.length} stem(s) uploaded`)
}

const handleSunoSeparate: HandlerFn = async function handleSunoSeparate(job, ctx) {
  const { taskId: sunoTaskId, audioId, separateType } = job.data as {
    jobId: string; taskId: string; audioId: string; separateType?: SunoSeparateType; usageLogId?: string
  }
  const sepType = separateType ?? "separate_vocal"
  console.log(`[worker] suno-separate ${ctx.jobId} (type: ${sepType}, audioId: ${audioId})`)
  const cloud = await maybeSunoCloudOutput(job, ctx, "suno-separate")
  if (cloud) {
    // The cloud's output_data carries the SAME stem field names with URLs on
    // ITS storage; the shared tail re-downloads them under this instance's
    // keys. An empty separation is a failure, not an empty success.
    const stems: Partial<Record<(typeof STEM_FIELDS)[number], string>> = {}
    for (const field of STEM_FIELDS) {
      const url = cloud[field]
      if (typeof url === "string" && url) stems[field] = url
    }
    if (Object.keys(stems).length === 0) throw new Error("nodaro.ai returned no stems")
    return finalizeSunoSeparate(job, ctx, { taskId: cloudTaskId(cloud), ...stems }, sepType, "nodaro")
  }
  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoSeparate({ taskId: sunoTaskId, audioId, type: sepType }, { onTaskCreated }),
  )
  await finalizeSunoSeparate(job, ctx, result, sepType, "kie")
}

/** Shared tail for suno-music-video: upload to this instance's R2, thumbnail, persist. */
async function finalizeSunoMusicVideo(job: Job, ctx: JobContext, result: SunoMusicVideoResult, provider: SunoProviderUsed): Promise<void> {
  await setJobProgress(job, ctx.jobId, 50)
  // POST-PROVIDER: Suno delivered the music video (billed) → skip refund on R2 fail.
  const r2Url = await runPostProcessing(() => uploadToR2(result.videoUrl, ctx.jobId, "video", ctx.jobUserId))
  await setJobProgress(job, ctx.jobId, 100)
  const thumbUrl = await generateAndUploadThumbnail(r2Url, ctx.jobId, ctx.jobUserId)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { videoUrl: r2Url, thumbnailUrl: thumbUrl, sunoTaskId: result.taskId },
    provider,
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: music video generated`)
}

const handleSunoMusicVideo: HandlerFn = async function handleSunoMusicVideo(job, ctx) {
  const { taskId: sunoTaskId, audioId } = job.data as { jobId: string; taskId: string; audioId: string; usageLogId?: string }
  console.log(`[worker] suno-music-video ${ctx.jobId}`)
  const cloud = await maybeSunoCloudOutput(job, ctx, "suno-music-video")
  if (cloud) {
    if (typeof cloud.videoUrl !== "string" || !cloud.videoUrl) throw new Error("nodaro.ai returned no music video")
    return finalizeSunoMusicVideo(job, ctx, { taskId: cloudTaskId(cloud), videoUrl: cloud.videoUrl }, "nodaro")
  }
  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoMusicVideo({ taskId: sunoTaskId, audioId }, { onTaskCreated }),
  )
  await finalizeSunoMusicVideo(job, ctx, result, "kie")
}

const handleSunoMashup: HandlerFn = async function handleSunoMashup(job, ctx) {
  const { uploadUrlList, model, customMode, style, title, negativeStyle, vocalGender } = job.data as {
    jobId: string; uploadUrlList: [string, string]; model?: SunoModel; customMode?: boolean; style?: string; title?: string
    negativeStyle?: string; vocalGender?: string
  }
  console.log(`[worker] suno-mashup ${ctx.jobId} (model: ${model ?? "V5"})`)
  if (await maybeRunSunoOnCloud(job, ctx, "suno-mashup", "Suno mashup returned no tracks")) return

  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoMashup({ uploadUrlList, model, customMode, style, title, negativeStyle, vocalGender }, { onTaskCreated }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno mashup returned no tracks", "kie")
}

const handleSunoReplaceSection: HandlerFn = async function handleSunoReplaceSection(job, ctx) {
  const { taskId: sunoTaskId, audioId, infillStartS, infillEndS, prompt, tags, title, fullLyrics, negativeTags } = job.data as {
    jobId: string; taskId: string; audioId: string; infillStartS: number; infillEndS: number; prompt: string; tags: string; title?: string
    fullLyrics?: string; negativeTags?: string
  }
  console.log(`[worker] suno-replace-section ${ctx.jobId} (audioId: ${audioId}, ${infillStartS}s-${infillEndS}s)`)
  if (await maybeRunSunoOnCloud(job, ctx, "suno-replace-section", "Suno replace-section returned no tracks")) return

  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoReplaceSection({ taskId: sunoTaskId, audioId, infillStartS, infillEndS, prompt, tags, title, fullLyrics, negativeTags }, { onTaskCreated }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno replace-section returned no tracks", "kie")
}

const handleSunoAddInstrumental: HandlerFn = async function handleSunoAddInstrumental(job, ctx) {
  const { taskId: sunoTaskId, audioId, model } = job.data as {
    jobId: string; taskId: string; audioId: string; model?: SunoAddTrackModel
  }
  console.log(`[worker] suno-add-instrumental ${ctx.jobId} (model: ${model ?? "V5"}, audioId: ${audioId})`)
  if (await maybeRunSunoOnCloud(job, ctx, "suno-add-instrumental", "Suno add-instrumental returned no tracks")) return

  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoAddInstrumental({ taskId: sunoTaskId, audioId, model }, { onTaskCreated }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno add-instrumental returned no tracks", "kie")
}

const handleSunoAddVocals: HandlerFn = async function handleSunoAddVocals(job, ctx) {
  const { taskId: sunoTaskId, audioId, model } = job.data as {
    jobId: string; taskId: string; audioId: string; model?: SunoAddTrackModel
  }
  console.log(`[worker] suno-add-vocals ${ctx.jobId} (model: ${model ?? "V5"}, audioId: ${audioId})`)
  if (await maybeRunSunoOnCloud(job, ctx, "suno-add-vocals", "Suno add-vocals returned no tracks")) return

  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoAddVocals({ taskId: sunoTaskId, audioId, model }, { onTaskCreated }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno add-vocals returned no tracks", "kie")
}

/** Shared tail for suno-convert-wav: upload the wav to this instance's R2, persist. */
async function finalizeSunoConvertWav(job: Job, ctx: JobContext, result: SunoConvertWavResult, provider: SunoProviderUsed): Promise<void> {
  await setJobProgress(job, ctx.jobId, 50)
  // POST-PROVIDER: Suno delivered the WAV (billed) → skip refund on R2 fail.
  const r2Url = await runPostProcessing(() => uploadToR2(result.audioUrl, ctx.jobId, "audio", ctx.jobUserId))
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { audioUrl: r2Url, sunoTaskId: result.taskId },
    provider,
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: WAV conversion done`)
}

const handleSunoConvertWav: HandlerFn = async function handleSunoConvertWav(job, ctx) {
  const { taskId: sunoTaskId, audioId } = job.data as { jobId: string; taskId: string; audioId: string; usageLogId?: string }
  console.log(`[worker] suno-convert-wav ${ctx.jobId}`)
  const cloud = await maybeSunoCloudOutput(job, ctx, "suno-convert-wav")
  if (cloud) {
    if (typeof cloud.audioUrl !== "string" || !cloud.audioUrl) throw new Error("nodaro.ai returned no WAV")
    return finalizeSunoConvertWav(job, ctx, { taskId: cloudTaskId(cloud), audioUrl: cloud.audioUrl }, "nodaro")
  }
  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoConvertWav({ taskId: sunoTaskId, audioId }, { onTaskCreated }),
  )
  await finalizeSunoConvertWav(job, ctx, result, "kie")
}

const handleSunoUploadExtend: HandlerFn = async function handleSunoUploadExtend(job, ctx) {
  const { uploadUrl, continueAt, defaultParamFlag, model, style, title, negativeStyle, vocalGender } = job.data as {
    jobId: string; uploadUrl: string; continueAt: number; defaultParamFlag?: boolean; model?: SunoModel; style?: string; title?: string
    negativeStyle?: string; vocalGender?: string
  }
  console.log(`[worker] suno-upload-extend ${ctx.jobId} (model: ${model ?? "V5"}, continueAt: ${continueAt}s)`)
  // BEFORE the social-URL download below: the cloud's own handler performs the
  // same download, and the local copy's URL is on a private host it could not
  // fetch anyway — downloading here first would cost bandwidth for a file we
  // then never send.
  if (await maybeRunSunoOnCloud(job, ctx, "suno-upload-extend", "Suno upload-extend returned no tracks")) return

  // If upload_url is a social media URL, download audio to R2 first
  let resolvedUploadUrl = uploadUrl
  if (isSocialUrl(uploadUrl)) {
    console.log(`[worker] Social URL detected for upload-extend, downloading audio first...`)
    resolvedUploadUrl = await downloadAudioToR2(uploadUrl)
  }
  const onTaskCreated = makeOnTaskCreated(ctx.jobId, providerKindForSuno())
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => sunoUploadExtend({ uploadUrl: resolvedUploadUrl, continueAt, defaultParamFlag, model, style, title, negativeStyle, vocalGender }, { onTaskCreated }),
  )
  await finalizeSunoJob(job, ctx, result, "Suno upload-extend returned no tracks", "kie")
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
