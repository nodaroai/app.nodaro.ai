import { supabase } from "../../lib/supabase.js"
import { uploadToR2 } from "../../lib/storage.js"
import { textToSpeech as routedTextToSpeech } from "../../providers/index.js"
import { generateMusic, type MusicProvider } from "../../providers/audio/generate-music.js"
import { textToAudio, type AudioProvider } from "../../providers/audio/text-to-audio.js"
import { KieAudioProvider } from "../../providers/kie/audio.js"
import { transcribe, type TranscribeProvider } from "../../providers/audio/transcribe.js"
import { extractYouTubeAudio } from "../../providers/audio/youtube-extractor.js"
import {
  commitJobCredits,
  shouldSaveJobResult,
  type HandlerFn,
} from "../shared.js"

const handleTextToSpeech: HandlerFn = async function handleTextToSpeech(job, ctx) {
  const { text, voice, provider, stability, similarityBoost, style, speed, languageCode } = job.data as {
    jobId: string
    text: string
    voice?: string
    provider?: string
    stability?: number
    similarityBoost?: number
    style?: number
    speed?: number
    languageCode?: string
  }
  console.log(`[worker] text-to-speech ${ctx.jobId} (provider: ${provider ?? "elevenlabs-turbo"})`)

  const ttsOptions = {
    ...(stability != null && { stability }),
    ...(similarityBoost != null && { similarityBoost }),
    ...(style != null && { style }),
    ...(speed != null && { speed }),
    ...(languageCode && { languageCode }),
  }
  const result = await routedTextToSpeech(text, provider ?? "elevenlabs-turbo", voice, Object.keys(ttsOptions).length > 0 ? ttsOptions : undefined)
  await job.updateProgress(50)

  const r2Url = await uploadToR2(result.url, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)

  if (!await shouldSaveJobResult(ctx.jobId)) return

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      progress: 100,
      output_data: { audioUrl: r2Url },
      completed_at: new Date().toISOString(),
      provider: result.providerUsed,
      provider_cost: result.cost,
      display_cost: result.displayCost,
    })
    .eq("id", ctx.jobId)

  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: ${result.providerUsed}, cost: $${result.cost?.toFixed(6) ?? "N/A"})`)
}

const handleGenerateMusic: HandlerFn = async function handleGenerateMusic(job, ctx) {
  const { prompt, provider, duration, modelVersion, lyrics, referenceAudioUrl } = job.data as { jobId: string; prompt: string; provider?: MusicProvider; duration?: number; modelVersion?: string; lyrics?: string; referenceAudioUrl?: string }
  console.log(`[worker] generate-music ${ctx.jobId} (provider: ${provider ?? "musicgen"})`)
  const replicateUrl = await generateMusic(prompt, provider, duration, modelVersion, lyrics, referenceAudioUrl)
  await job.updateProgress(50)
  const r2Url = await uploadToR2(replicateUrl, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleTextToAudio: HandlerFn = async function handleTextToAudio(job, ctx) {
  const { prompt, provider, duration, loop, promptInfluence } = job.data as {
    jobId: string; prompt: string; provider?: AudioProvider | "elevenlabs-sfx"
    duration?: number; loop?: boolean; promptInfluence?: number
  }
  console.log(`[worker] text-to-audio ${ctx.jobId} (provider: ${provider ?? "tangoflux"})`)

  let audioUrl: string
  if (provider === "elevenlabs-sfx") {
    const kieAudio = new KieAudioProvider()
    const result = await kieAudio.generateSoundEffect(prompt, {
      duration,
      loop,
      promptInfluence,
    })
    audioUrl = result.url
  } else {
    audioUrl = await textToAudio(prompt, provider as AudioProvider | undefined, duration)
  }

  await job.updateProgress(50)
  const r2Url = await uploadToR2(audioUrl, ctx.jobId, "audio", ctx.jobUserId)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl: r2Url }, completed_at: new Date().toISOString() }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url}`)
}

const handleTranscribe: HandlerFn = async function handleTranscribe(job, ctx) {
  const { audioUrl, provider, language } = job.data as { jobId: string; audioUrl: string; provider?: TranscribeProvider; language?: string }
  console.log(`[worker] transcribe ${ctx.jobId} (provider: ${provider ?? "whisper"}, language: ${language ?? "auto"})`)
  const result = await transcribe(audioUrl, provider, language)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  await supabase.from("jobs").update({
    status: "completed",
    progress: 100,
    output_data: { text: result.text, language: result.language, segments: result.segments },
    completed_at: new Date().toISOString(),
  }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: transcribed ${result.text.length} chars (language: ${result.language})`)
}

const handleExtractYoutubeAudio: HandlerFn = async function handleExtractYoutubeAudio(job, ctx) {
  const { youtubeUrl } = job.data as { jobId: string; youtubeUrl: string }
  console.log(`[worker] extract-youtube-audio ${ctx.jobId}`)
  const audioUrl = await extractYouTubeAudio(youtubeUrl)
  await job.updateProgress(100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  await supabase.from("jobs").update({ status: "completed", progress: 100, output_data: { audioUrl }, completed_at: new Date().toISOString() }).eq("id", ctx.jobId)
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${audioUrl}`)
}

export const audioAIHandlers: Record<string, HandlerFn> = {
  "text-to-speech": handleTextToSpeech,
  "generate-music": handleGenerateMusic,
  "text-to-audio": handleTextToAudio,
  "transcribe": handleTranscribe,
  "extract-youtube-audio": handleExtractYoutubeAudio,
}
