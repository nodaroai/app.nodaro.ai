import { dirname } from "node:path"
import { promises as fs } from "node:fs"
import { supabase } from "../../lib/supabase.js"
import { uploadToR2, uploadBufferToR2, uploadFileToR2 } from "../../lib/storage.js"
import { textToSpeech as routedTextToSpeech } from "../../providers/index.js"
import { directElevenLabsTTS, stripAudioTags } from "../../providers/elevenlabs/direct-tts.js"
import { generateMusic, type MusicProvider } from "../../providers/audio/generate-music.js"
import { textToAudio, type AudioProvider } from "../../providers/audio/text-to-audio.js"
import { KieAudioProvider, isKieAcceptedVoice } from "../../providers/kie/audio.js"
import { transcribe, type TranscribeProvider } from "../../providers/audio/transcribe.js"
import { extractYouTubeAudio } from "../../providers/audio/youtube-extractor.js"
import { voiceChangerFromUrl, directVoiceChanger } from "../../providers/elevenlabs/voice-changer.js"
import { extractAudioTrack } from "../../providers/video/extract-audio-track.js"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import { cleanupWorkDir } from "../../providers/video/ffmpeg-utils.js"
import { startDubbing, waitForDubbing, downloadDubbedAudio } from "../../providers/elevenlabs/dubbing.js"
import { remixVoice } from "../../providers/elevenlabs/voice-remix.js"
import { designVoice } from "../../providers/elevenlabs/voice-design.js"
import { forcedAlignment } from "../../providers/elevenlabs/forced-alignment.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  markJobCompleted,
  buildProviderMeta,
  setJobProgress,
  withProgressRamp,
  generateAndUploadThumbnail,
  createAssetFromJob,
  type HandlerFn,
} from "../shared.js"
import { finalizeJobWithMedia } from "../../lib/job-finalize.js"
import { makeOnTaskCreated, markProviderCallStart } from "../../lib/reconcile/persistence.js"
import { providerKindForTtsModel } from "../../lib/reconcile/provider-kind.js"

const handleTextToSpeech: HandlerFn = async function handleTextToSpeech(job, ctx) {
  const { text, voice, provider, voiceType, stability, similarityBoost, style, speed, languageCode } = job.data as {
    jobId: string
    text: string
    voice?: string
    provider?: string
    voiceType?: "premade" | "custom" | "library"
    stability?: number
    similarityBoost?: number
    style?: number
    speed?: number
    languageCode?: string
  }
  console.log(`[worker] text-to-speech ${ctx.jobId} (provider: ${provider ?? "elevenlabs-turbo"}, voiceType: ${voiceType ?? "premade"})`)

  const ttsOptions = { stability, similarityBoost, style, speed, languageCode }
  const hasOptions = stability != null || similarityBoost != null || style != null || speed != null || languageCode != null

  // Route through direct ElevenLabs API for: v3 model, custom clones, Voice Library voices,
  // or any premade voice UUID that isn't in KIE's 21 accepted voices.
  const useDirectApi = provider === "elevenlabs-v3" || (voice && (
    voiceType === "custom" || voiceType === "library" || !isKieAcceptedVoice(voice)
  ))

  // Strip [audio tags] from text when NOT using v3 — v2 models speak them as literal text
  const processedText = provider === "elevenlabs-v3" ? text : stripAudioTags(text)

  if (useDirectApi) {
    const audioBuffer = await directElevenLabsTTS(processedText, voice ?? "Rachel", provider, hasOptions ? ttsOptions : undefined)
    await setJobProgress(job, ctx.jobId, 50)

    const r2Url = await uploadBufferToR2(audioBuffer, `audio/${ctx.jobId}.mp3`, "audio/mpeg", ctx.jobUserId)
    await setJobProgress(job, ctx.jobId, 100)

    const { ok } = await finalizeJobWithMedia({
      jobId: ctx.jobId,
      jobType: "text-to-speech",
      result: { url: r2Url, cost: null, providerUsed: "elevenlabs-direct" },
      mediaUrl: r2Url,
    })
    if (!ok) return
    console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: elevenlabs-direct)`)
    return
  }

  const resolvedTtsProvider = provider ?? "elevenlabs-turbo"
  const ttsOnTaskCreated = makeOnTaskCreated(
    ctx.jobId,
    providerKindForTtsModel(resolvedTtsProvider),
  )
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => routedTextToSpeech(processedText, resolvedTtsProvider, voice, hasOptions ? ttsOptions : undefined, { onTaskCreated: ttsOnTaskCreated }),
  )
  await setJobProgress(job, ctx.jobId, 50)

  const r2Url = await uploadToR2(result.url, ctx.jobId, "audio", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "text-to-speech",
    result,
    mediaUrl: r2Url,
    extraOutputData: buildProviderMeta(result),
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleGenerateMusic: HandlerFn = async function handleGenerateMusic(job, ctx) {
  const { prompt, provider, duration, modelVersion, lyrics, referenceAudioUrl } = job.data as { jobId: string; prompt: string; provider?: MusicProvider; duration?: number; modelVersion?: string; lyrics?: string; referenceAudioUrl?: string }
  console.log(`[worker] generate-music ${ctx.jobId} (provider: ${provider ?? "musicgen"})`)
  const replicateUrl = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => generateMusic(prompt, provider, duration, modelVersion, lyrics, referenceAudioUrl),
  )
  await setJobProgress(job, ctx.jobId, 50)
  const r2Url = await uploadToR2(replicateUrl, ctx.jobId, "audio", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "generate-music",
    result: { url: r2Url, cost: null, providerUsed: provider ?? "musicgen" },
    mediaUrl: r2Url,
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleTextToAudio: HandlerFn = async function handleTextToAudio(job, ctx) {
  const { prompt, provider, duration, loop, promptInfluence } = job.data as {
    jobId: string; prompt: string; provider?: AudioProvider | "elevenlabs-sfx"
    duration?: number; loop?: boolean; promptInfluence?: number
  }
  console.log(`[worker] text-to-audio ${ctx.jobId} (provider: ${provider ?? "tangoflux"})`)

  const sfxOnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-standard")
  const audioUrl: string = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    async () => {
      if (provider === "elevenlabs-sfx") {
        const kieAudio = new KieAudioProvider()
        const result = await kieAudio.generateSoundEffect(prompt, {
          duration,
          loop,
          promptInfluence,
        }, { onTaskCreated: sfxOnTaskCreated })
        return result.url
      }
      // Replicate `replicate.run()` path (tangoflux) blocks until done; no
      // early taskId is exposed, so no onTaskCreated wiring possible.
      return await textToAudio(prompt, provider as AudioProvider | undefined, duration)
    },
  )

  await setJobProgress(job, ctx.jobId, 50)
  const r2Url = await uploadToR2(audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "text-to-audio",
    result: { url: r2Url, cost: null, providerUsed: provider ?? "tangoflux" },
    mediaUrl: r2Url,
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

// URLs for social platforms that need audio extraction before the STT provider
// can consume them. Matches the frontend regex in execute-node.ts so both
// paths (single-node HTTP + orchestrator BullMQ) accept the same inputs.
const SOCIAL_VIDEO_URL_RE = /(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com)/i

const handleTranscribe: HandlerFn = async function handleTranscribe(job, ctx) {
  const { audioUrl: rawAudioUrl, provider, language, diarize, tagAudioEvents, wordTimestamps } = job.data as { jobId: string; audioUrl: string; provider?: TranscribeProvider; language?: string; diarize?: boolean; tagAudioEvents?: boolean; wordTimestamps?: boolean }
  console.log(`[worker] transcribe ${ctx.jobId} (provider: ${provider ?? "whisper"}, language: ${language ?? "auto"})`)

  // If the caller passed a social-platform video URL, extract audio first.
  // STT providers can't consume a youtube/tiktok/etc. page URL directly.
  let audioUrl = rawAudioUrl
  if (SOCIAL_VIDEO_URL_RE.test(audioUrl)) {
    console.log(`[worker] transcribe ${ctx.jobId}: extracting audio from social video URL`)
    audioUrl = await extractYouTubeAudio(audioUrl)
    await setJobProgress(job, ctx.jobId, 20)
  }

  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 25, cap: 90 },
    () =>
      transcribe(audioUrl, provider, language, {
        diarize,
        tagAudioEvents,
        wordTimestamps,
        // Persist the Replicate prediction id (whisper paths) so a BullMQ
        // stall-retry recovers via the replicate reconcile handler instead of
        // re-billing the transcribe call.
        onTaskCreated: makeOnTaskCreated(ctx.jobId, "replicate-prediction"),
      }),
  )
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const outputData: Record<string, unknown> = { text: result.text, language: result.language, segments: result.segments }
  if (result.words) outputData.words = result.words
  const ok = await markJobCompleted(ctx.jobId, { output_data: outputData })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId, result.cost)
  console.log(`[worker] Job ${ctx.jobId} completed: transcribed ${result.text.length} chars (language: ${result.language})`)
}

const handleExtractYoutubeAudio: HandlerFn = async function handleExtractYoutubeAudio(job, ctx) {
  const { youtubeUrl } = job.data as { jobId: string; youtubeUrl: string }
  console.log(`[worker] extract-youtube-audio ${ctx.jobId}`)
  const audioUrl = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 80 },
    () => extractYouTubeAudio(youtubeUrl),
  )
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, { output_data: { audioUrl } })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${audioUrl}`)
}

const handleAudioIsolation: HandlerFn = async function handleAudioIsolation(job, ctx) {
  const { audioUrl } = job.data as { jobId: string; audioUrl: string }
  console.log(`[worker] audio-isolation ${ctx.jobId}`)
  const kieAudio = new KieAudioProvider()
  const audioIsoOnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-standard")
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => kieAudio.isolateAudio(audioUrl, { onTaskCreated: audioIsoOnTaskCreated }),
  )
  await setJobProgress(job, ctx.jobId, 50)
  const r2Url = await uploadToR2(result.url, ctx.jobId, "audio", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "audio-isolation",
    result,
    mediaUrl: r2Url,
    extraOutputData: buildProviderMeta(result),
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleTextToDialogue: HandlerFn = async function handleTextToDialogue(job, ctx) {
  const { dialogue, stability, languageCode } = job.data as {
    jobId: string
    dialogue: Array<{ text: string; voice: string }>
    stability?: number
    languageCode?: string
  }
  console.log(`[worker] text-to-dialogue ${ctx.jobId} (${dialogue.length} lines)`)
  const kieAudio = new KieAudioProvider()
  const dialogueOnTaskCreated = makeOnTaskCreated(ctx.jobId, "kie-standard")
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => kieAudio.generateDialogue(dialogue, {
      stability,
      languageCode,
    }, { onTaskCreated: dialogueOnTaskCreated }),
  )
  await setJobProgress(job, ctx.jobId, 50)
  const r2Url = await uploadToR2(result.url, ctx.jobId, "audio", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "generate-dialogue",
    result,
    mediaUrl: r2Url,
    extraOutputData: buildProviderMeta(result),
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleVoiceChanger: HandlerFn = async function handleVoiceChanger(job, ctx) {
  const { audioUrl, videoUrl, voiceId, stability, similarityBoost, style, removeBackgroundNoise } = job.data as {
    jobId: string; audioUrl?: string; videoUrl?: string; voiceId: string
    stability?: number; similarityBoost?: number; style?: number; removeBackgroundNoise?: boolean
  }
  const opts = { stability, similarityBoost, style, removeBackgroundNoise }

  // --- Video mode: demux audio → speech-to-speech → remux onto the original
  // video. Video takes precedence when both inputs are wired (matches the route
  // + frontend). Output exposes BOTH a video and the revoiced audio track. ---
  if (videoUrl) {
    console.log(`[worker] voice-changer ${ctx.jobId} (video mode)`)

    // 1. Download once + extract audio (throws NoAudioTrackError → friendly
    //    failure when the source clip is silent).
    const { audioPath, workDir } = await extractAudioTrack(videoUrl)
    let newAudioR2Url: string
    try {
      const sourceAudio = await fs.readFile(audioPath)
      await setJobProgress(job, ctx.jobId, 20)
      const revoiced = await withProgressRamp(
        job,
        ctx.jobId,
        { start: 20, cap: 60 },
        () => directVoiceChanger(sourceAudio, voiceId, opts),
      )
      // Upload the revoiced audio — needed as a URL for the remux step AND
      // surfaced on the node's audio output handle.
      newAudioR2Url = await uploadBufferToR2(revoiced, `audio/${ctx.jobId}.mp3`, "audio/mpeg", ctx.jobUserId)
    } finally {
      await cleanupWorkDir(workDir)
    }
    await setJobProgress(job, ctx.jobId, 70)

    // 2. Remux the new audio onto the original video. Reuses merge-video-audio
    //    (VP8/VP9 re-encode + length handling). keepOriginalAudio:false replaces
    //    the source dialogue entirely.
    const mergedPath = await mergeVideoAudio({
      videoUrl,
      audioTracks: [{ url: newAudioR2Url, startTime: 0, volume: 100, sourceType: "audio" }],
      keepOriginalAudio: false,
    })
    const videoR2Url = await uploadFileToR2(mergedPath, ctx.jobId, "video", ctx.jobUserId)
    await cleanupWorkDir(dirname(mergedPath))
    const thumbUrl = await generateAndUploadThumbnail(videoR2Url, ctx.jobId, ctx.jobUserId)
    await setJobProgress(job, ctx.jobId, 100)

    if (!await shouldSaveJobResult(ctx.jobId)) return
    const ok = await markJobCompleted(ctx.jobId, {
      output_data: { videoUrl: videoR2Url, audioUrl: newAudioR2Url, thumbnailUrl: thumbUrl },
    })
    if (!ok) return
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
    await createAssetFromJob(ctx.jobId, ctx.jobUserId)
    console.log(`[worker] Job ${ctx.jobId} completed (video): ${videoR2Url}`)
    return
  }

  // --- Audio mode (unchanged): speech-to-speech → audio. ---
  if (!audioUrl) throw new Error("voice-changer requires audioUrl or videoUrl")
  console.log(`[worker] voice-changer ${ctx.jobId}`)
  const audioBuffer = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => voiceChangerFromUrl(audioUrl, voiceId, opts),
  )
  await setJobProgress(job, ctx.jobId, 50)
  const r2Url = await uploadBufferToR2(audioBuffer, `audio/${ctx.jobId}.mp3`, "audio/mpeg", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "voice-clone",
    result: { url: r2Url, cost: null, providerUsed: "elevenlabs-direct" },
    mediaUrl: r2Url,
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleDubbing: HandlerFn = async function handleDubbing(job, ctx) {
  const { audioUrl, targetLanguage, sourceLanguage, numSpeakers } = job.data as {
    jobId: string; audioUrl: string; targetLanguage: string
    sourceLanguage?: string; numSpeakers?: number
  }
  console.log(`[worker] dubbing ${ctx.jobId} (target: ${targetLanguage})`)
  const dubbingOnTaskCreated = makeOnTaskCreated(ctx.jobId, "elevenlabs-async")
  const { dubbingId } = await startDubbing(
    audioUrl,
    targetLanguage,
    { sourceLang: sourceLanguage, numSpeakers },
    { onTaskCreated: dubbingOnTaskCreated },
  )
  await setJobProgress(job, ctx.jobId, 20)

  await waitForDubbing(dubbingId, (status) => {
    if (status === "dubbing") void setJobProgress(job, ctx.jobId, 50)
  })
  await setJobProgress(job, ctx.jobId, 70)

  const audioBuffer = await downloadDubbedAudio(dubbingId, targetLanguage)
  await setJobProgress(job, ctx.jobId, 85)
  const r2Url = await uploadBufferToR2(audioBuffer, `audio/${ctx.jobId}.mp3`, "audio/mpeg", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "text-to-audio",
    result: { url: r2Url, cost: null, providerUsed: "elevenlabs-direct" },
    mediaUrl: r2Url,
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleVoiceRemix: HandlerFn = async function handleVoiceRemix(job, ctx) {
  const { text, voiceDescription } = job.data as { jobId: string; text: string; voiceDescription: string }
  console.log(`[worker] voice-remix ${ctx.jobId}`)
  const audioBuffer = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => remixVoice(text, voiceDescription),
  )
  await setJobProgress(job, ctx.jobId, 50)
  const r2Url = await uploadBufferToR2(audioBuffer, `audio/${ctx.jobId}.mp3`, "audio/mpeg", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "voice-clone",
    result: { url: r2Url, cost: null, providerUsed: "elevenlabs-direct" },
    mediaUrl: r2Url,
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleVoiceDesign: HandlerFn = async function handleVoiceDesign(job, ctx) {
  const { text, voiceDescription, model, loudness, guidanceScale, seed, quality, shouldEnhance } = job.data as {
    jobId: string; text: string; voiceDescription: string
    model?: string; loudness?: number; guidanceScale?: number
    seed?: number; quality?: number; shouldEnhance?: boolean
  }
  console.log(`[worker] voice-design ${ctx.jobId}`)
  await markProviderCallStart(ctx.jobId, "elevenlabs-sync")
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 45 },
    () => designVoice(text, voiceDescription, { model, loudness, guidanceScale, seed, quality, shouldEnhance }),
  )
  await setJobProgress(job, ctx.jobId, 50)
  const r2Url = await uploadBufferToR2(result.audioBuffer, `audio/${ctx.jobId}.mp3`, "audio/mpeg", ctx.jobUserId)
  await setJobProgress(job, ctx.jobId, 100)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "voice-clone",
    result: { url: r2Url, cost: null, providerUsed: "elevenlabs-direct" },
    mediaUrl: r2Url,
    extraOutputData: { generatedVoiceId: result.generatedVoiceId },
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (voiceId: ${result.generatedVoiceId})`)
}

const handleForcedAlignment: HandlerFn = async function handleForcedAlignment(job, ctx) {
  const { audioUrl, transcript } = job.data as { jobId: string; audioUrl: string; transcript: string }
  console.log(`[worker] forced-alignment ${ctx.jobId}`)
  await markProviderCallStart(ctx.jobId, "elevenlabs-sync")
  const result = await forcedAlignment(audioUrl, transcript)
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: { alignment: result.alignment, text: transcript },
    provider: "elevenlabs-direct",
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: aligned ${result.alignment.length} words`)
}

export const audioAIHandlers: Record<string, HandlerFn> = {
  "text-to-speech": handleTextToSpeech,
  "generate-music": handleGenerateMusic,
  "text-to-audio": handleTextToAudio,
  "transcribe": handleTranscribe,
  "extract-youtube-audio": handleExtractYoutubeAudio,
  "audio-isolation": handleAudioIsolation,
  "text-to-dialogue": handleTextToDialogue,
  "voice-changer": handleVoiceChanger,
  "dubbing": handleDubbing,
  "voice-remix": handleVoiceRemix,
  "voice-design": handleVoiceDesign,
  "forced-alignment": handleForcedAlignment,
}
