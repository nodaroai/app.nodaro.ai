import { dirname } from "node:path"
import { safeFetch } from "../../lib/safe-fetch.js"
import { config } from "../../lib/config.js"
import { isNodaroConnected } from "../../lib/nodaro-connect.js"
import { requireProviderKey } from "../../providers/provider-keys.js"
import type { TextToSpeechOptions } from "../../providers/provider.interface.js"
import { promises as fs } from "node:fs"
import { uploadToR2, uploadBufferToR2, uploadFileToR2, mediaObjectKey } from "../../lib/storage.js"
import { runPostProcessing } from "../../lib/post-processing-error.js"
import { directElevenLabsTTS, stripAudioTags } from "../../providers/elevenlabs/direct-tts.js"
import { directElevenLabsDialogue } from "../../providers/elevenlabs/direct-dialogue.js"
import { defaultAllowedVoiceId } from "../../lib/voice-policy.js"
import { FALLBACK_VOICES } from "../../lib/premade-voices.js"
import { generateMusic, type MusicProvider } from "../../providers/audio/generate-music.js"
import { textToAudio, type AudioProvider } from "../../providers/audio/text-to-audio.js"
import { KieAudioProvider } from "../../providers/kie/audio.js"
import { ReplicateAudioSeparationProvider } from "../../providers/replicate/audio-separation.js"
import { transcribe, type TranscribeProvider } from "../../providers/audio/transcribe.js"
import { extractYouTubeAudio } from "../../providers/audio/youtube-extractor.js"
import { voiceChangerFromUrl, directVoiceChanger } from "../../providers/elevenlabs/voice-changer.js"
import { extractAudioTrack } from "../../providers/video/extract-audio-track.js"
import { mergeVideoAudio } from "../../providers/video/merge-video-audio.js"
import { cleanupWorkDir } from "../../providers/video/ffmpeg-utils.js"
import { classifyMediaSource, isVideoMode } from "../../providers/video/media-source.js"
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

// ALL ElevenLabs text-to-speech now routes through the direct ElevenLabs API
// (never KIE's TTS proxy) — standing repo rule "always ElevenLabs direct,
// never KIE's elevenlabs-* wrappers". The KIE proxy was the path responsible
// for garbled Hebrew output and a history of queue hangs; `directElevenLabsTTS`
// already maps every model (v3/turbo/multilingual) and resolves the 21
// premade voice names to UUIDs. Because the call is synchronous (no polling
// task), there is no `makeOnTaskCreated`/reconcile wiring for TTS jobs going
// forward — the reconcile cron only ever picks up rows with a persisted
// `provider_call_started_at`, which this path never sets.

/**
 * Speech through the connected cloud, returned as bytes so the caller's
 * storage path is untouched.
 *
 * The cloud answers with a URL on ITS storage; downloading here means the
 * finished audio lives on this instance like any local result — same R2 key,
 * same gallery row, same cleanup — and nothing downstream learns where it was
 * generated.
 */
async function generateSpeechViaCloud(
  text: string,
  voice: string | undefined,
  provider: string,
  options: TextToSpeechOptions,
): Promise<Buffer> {
  const { NodaroCloudAudioProvider } = await import("../../providers/nodaro/audio.js")
  const result = await new NodaroCloudAudioProvider().textToSpeech(text, voice, provider, options)
  const res = await safeFetch(result.url)
  if (!res.ok) {
    throw new Error(`nodaro.ai: could not download the generated audio (${res.status})`)
  }
  return Buffer.from(await res.arrayBuffer())
}

const handleTextToSpeech: HandlerFn = async function handleTextToSpeech(job, ctx) {
  const { text, voice, provider: rawProvider, stability, similarityBoost, style, speed, languageCode, allowDefaultVoiceFallback } = job.data as {
    jobId: string
    text: string
    voice?: string
    provider?: string
    stability?: number
    similarityBoost?: number
    style?: number
    speed?: number
    languageCode?: string
    allowDefaultVoiceFallback?: boolean
  }
  // Defensive default: every current enqueuer (routes/text-to-speech.ts,
  // payload-builder.ts's "text-to-speech" case, pipeline-generate-speech.ts,
  // pipeline-generate-narration.ts) already resolves a concrete provider
  // before enqueueing — this only guards a future caller that forgets to.
  const provider = rawProvider ?? "elevenlabs-v3"
  console.log(`[worker] text-to-speech ${ctx.jobId} (provider: ${provider}, direct API)`)

  const ttsOptions = { stability, similarityBoost, style, speed, languageCode }
  const hasOptions = stability != null || similarityBoost != null || style != null || speed != null || languageCode != null

  // Strip [audio tags] from text when NOT using v3 — v2 models speak them as literal text
  const processedText = provider === "elevenlabs-v3" ? text : stripAudioTags(text)

  // Three ways out, in this order — the order IS the contract:
  //   1. local key      -> direct ElevenLabs (keyed installs are byte-identical)
  //   2. no key, connected -> the cloud (TTS never reaches the capability
  //      router, so declaring the capability alone could not rescue it; the
  //      founder hit exactly this on 2026-08-14)
  //   3. no key, not connected -> the SHARED missing-key error
  //
  // Step 3 is not a formality. Without it the unconnected install falls into
  // the cloud path and surfaces `nodaro.ai is not connected` — which tells a
  // self-hoster to check a connection they never set up, instead of telling
  // them to add the key they actually meant to use. That is the exact bug
  // family this whole effort exists to remove, so the keyless-unconnected
  // install must reach `requireProviderKey` and no further.
  let audioBuffer: Buffer
  if (config.ELEVENLABS_API_KEY) {
    audioBuffer = await directElevenLabsTTS(processedText, voice ?? defaultAllowedVoiceId(FALLBACK_VOICES, "Rachel"), provider, {
      ...(hasOptions ? ttsOptions : {}),
      allowDefaultVoiceFallback: Boolean(allowDefaultVoiceFallback),
    })
  } else if (await isNodaroConnected().catch(() => false)) {
    audioBuffer = await generateSpeechViaCloud(
      processedText,
      voice,
      provider,
      hasOptions ? ttsOptions : {},
    )
  } else {
    // Throws MissingProviderKeyError — the one phrasing every provider uses.
    requireProviderKey(config.ELEVENLABS_API_KEY, "ELEVENLABS_API_KEY")
    throw new Error("unreachable: requireProviderKey throws on an empty key")
  }
  await setJobProgress(job, ctx.jobId, 50)

  // POST-PROVIDER: the provider already delivered the audio (we were billed) —
  // an R2 upload failure here is post-delivery, so skip the refund.
  const r2Url = await runPostProcessing(() => uploadBufferToR2(audioBuffer, mediaObjectKey(ctx.jobId, "audio", "mp3"), "audio/mpeg", ctx.jobUserId))
  await setJobProgress(job, ctx.jobId, 100)

  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "text-to-speech",
    result: { url: r2Url, cost: null, providerUsed: "elevenlabs-direct" },
    mediaUrl: r2Url,
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: elevenlabs-direct)`)
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
  // POST-PROVIDER: the music provider already delivered `replicateUrl` (we were
  // billed) — an R2 upload failure here is post-delivery, so skip the refund.
  const r2Url = await runPostProcessing(() => uploadToR2(replicateUrl, ctx.jobId, "audio", ctx.jobUserId))
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
  // POST-PROVIDER: the SFX/audio provider already delivered `audioUrl` (we were
  // billed) — an R2 upload failure here is post-delivery, so skip the refund.
  const r2Url = await runPostProcessing(() => uploadToR2(audioUrl, ctx.jobId, "audio", ctx.jobUserId))
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

  // The same three-way ladder as handleTextToSpeech, for the same reason:
  // transcription calls a vendor client straight from the worker and never
  // reaches the capability router, so a keyless-but-connected install could
  // not be rescued by any capability declaration (#761 — the sibling of the
  // 2026-08-14 TTS incident). Key resolution is per-PROVIDER: elevenlabs-stt
  // needs ELEVENLABS_API_KEY, the two whisper lanes need REPLICATE_API_TOKEN.
  //   1. local key for the chosen provider -> local transcribe(), byte-identical
  //   2. no key, connected -> replay the payload on the cloud (which holds
  //      keys for BOTH lanes) and take its output verbatim — same code runs
  //      there, so the shape is the local shape
  //   3. no key, not connected -> the local path's own shared missing-key error
  const localKey = provider === "elevenlabs-stt" ? config.ELEVENLABS_API_KEY : config.REPLICATE_API_TOKEN
  const { shouldRunOnCloud, runJobOnCloud } = await import("../../providers/nodaro/run-on-cloud.js")
  let outputData: Record<string, unknown>
  let actualCost: number | undefined
  if (await shouldRunOnCloud(localKey)) {
    const cloud = await runJobOnCloud("transcribe", { ...(job.data as Record<string, unknown>), audioUrl }, async (p) => {
      await setJobProgress(job, ctx.jobId, Math.min(90, Math.max(25, Math.round(p))))
    })
    // Validate rather than trust — an empty payload from a version-skewed
    // cloud must fail loudly, not complete with no text (suno-lyrics rule).
    if (typeof cloud.text !== "string") {
      throw new Error("nodaro.ai returned no transcription")
    }
    outputData = cloud
  } else {
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
    actualCost = result.cost
    outputData = { text: result.text, language: result.language, segments: result.segments }
    if (result.words) outputData.words = result.words
  }
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, { output_data: outputData })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId, actualCost)
  console.log(`[worker] Job ${ctx.jobId} completed: transcribed ${(outputData.text as string).length} chars (language: ${String(outputData.language ?? "auto")})`)
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
  // POST-PROVIDER: KIE already delivered the isolated audio (we were billed) —
  // an R2 upload failure here is post-delivery, so skip the refund.
  const r2Url = await runPostProcessing(() => uploadToR2(result.url, ctx.jobId, "audio", ctx.jobUserId))
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

/**
 * Dialogue through the connected cloud, returned as bytes so the caller's
 * storage path is untouched (same contract as `generateSpeechViaCloud`, which
 * is TTS-shaped — single text — and so not reusable for a script of lines).
 * The old cloud route strips `seed`/`applyTextNormalization` until the new
 * route deploys there — harmless degradation, the dialogue still renders.
 */
async function generateDialogueViaCloud(body: Record<string, unknown>): Promise<Buffer> {
  const { createCloudJob, waitForCloudJob, NodaroCloudError } = await import("../../providers/nodaro/client.js")
  const jobId = await createCloudJob("/v1/text-to-dialogue", body)
  const cloudJob = await waitForCloudJob(jobId)
  const output = (cloudJob.output_data ?? {}) as { audioUrl?: unknown }
  const url = typeof output.audioUrl === "string" ? output.audioUrl : undefined
  if (!url) {
    throw new NodaroCloudError(`nodaro.ai: dialogue job ${jobId} completed but returned no audioUrl`)
  }
  const res = await safeFetch(url)
  if (!res.ok) {
    throw new Error(`nodaro.ai: could not download the generated audio (${res.status})`)
  }
  return Buffer.from(await res.arrayBuffer())
}

const handleTextToDialogue: HandlerFn = async function handleTextToDialogue(job, ctx) {
  const { dialogue, stability, languageCode, seed, applyTextNormalization } = job.data as {
    jobId: string
    dialogue: Array<{ text: string; voice: string }>
    stability?: number
    languageCode?: string
    seed?: number
    applyTextNormalization?: "auto" | "on" | "off"
  }
  console.log(`[worker] text-to-dialogue ${ctx.jobId} (${dialogue.length} lines, direct API)`)

  // Same three ways out as handleTextToSpeech, same order, same reasons —
  // the order IS the contract (see the TTS ladder comment above):
  //   1. local key -> direct ElevenLabs; 2. no key + connected -> the cloud;
  //   3. neither -> the SHARED missing-key error, and no further.
  // Synchronous call → no onTaskCreated lane, no reconcile kind stamped:
  // the worker pre-task sentinel / 30-min sweep is the crash backstop,
  // byte-identical to text-to-speech. Deliberately NOT `elevenlabs-sync` —
  // its 5-minute stale threshold would race a legitimate near-300s dialogue
  // + R2 upload into a false fail+refund.
  let audioBuffer: Buffer
  const dialogueOptions = { stability, languageCode, seed, applyTextNormalization }
  if (config.ELEVENLABS_API_KEY) {
    audioBuffer = await withProgressRamp(
      job,
      ctx.jobId,
      { start: 5, cap: 45 },
      () => directElevenLabsDialogue(dialogue, dialogueOptions),
    )
  } else if (await isNodaroConnected().catch(() => false)) {
    audioBuffer = await withProgressRamp(
      job,
      ctx.jobId,
      { start: 5, cap: 45 },
      () => generateDialogueViaCloud({ dialogue, ...dialogueOptions }),
    )
  } else {
    // Throws MissingProviderKeyError — the one phrasing every provider uses.
    requireProviderKey(config.ELEVENLABS_API_KEY, "ELEVENLABS_API_KEY")
    throw new Error("unreachable: requireProviderKey throws on an empty key")
  }
  await setJobProgress(job, ctx.jobId, 50)
  // POST-PROVIDER: the provider already delivered the audio (we were billed) —
  // an R2 upload failure here is post-delivery, so skip the refund.
  const r2Url = await runPostProcessing(() => uploadBufferToR2(audioBuffer, mediaObjectKey(ctx.jobId, "audio", "mp3"), "audio/mpeg", ctx.jobUserId))
  await setJobProgress(job, ctx.jobId, 100)
  const { ok } = await finalizeJobWithMedia({
    jobId: ctx.jobId,
    jobType: "generate-dialogue",
    result: { url: r2Url, cost: null, providerUsed: "elevenlabs-direct" },
    mediaUrl: r2Url,
  })
  if (!ok) return
  console.log(`[worker] Job ${ctx.jobId} completed: ${r2Url} (provider: elevenlabs-direct)`)
}

const handleVoiceChanger: HandlerFn = async function handleVoiceChanger(job, ctx) {
  const { audioUrl, videoUrl, voiceId, model, stability, similarityBoost, style, removeBackgroundNoise, useSpeakerBoost, seed } = job.data as {
    jobId: string; audioUrl?: string; videoUrl?: string; voiceId: string; model?: string
    stability?: number; similarityBoost?: number; style?: number; removeBackgroundNoise?: boolean
    useSpeakerBoost?: boolean; seed?: number
  }
  // modelId omitted → provider falls back to eleven_multilingual_sts_v2
  // (ElevenLabs-recommended default, also required for non-English audio).
  const opts = { modelId: model, stability, similarityBoost, style, removeBackgroundNoise, useSpeakerBoost, seed }

  // THE MEDIA DECIDES THE MODE, NEVER THE INPUT SLOT (incident 2026-08-30: an
  // audio-only M4A uploaded as .mp4 sat in the video slot, ran the paid pass,
  // then died at the remux). Video takes precedence when both inputs are wired
  // (matches the route + frontend) — the video-slot media stays the source even
  // when it turns out to be audio-only; it is then DEMOTED to audio mode. A
  // video file in the AUDIO slot takes the demux path too (the speech-to-speech
  // provider must never see a video container) and delivers audio, as asked.
  // The probe fails OPEN (slot's word) — see providers/video/media-source.ts.
  const sourceUrl = videoUrl || audioUrl
  if (!sourceUrl) throw new Error("voice-changer requires audioUrl or videoUrl")
  const source = await classifyMediaSource(sourceUrl, videoUrl ? "video" : "audio")
  const videoMode = isVideoMode(source)

  // --- Demux path: extract audio → speech-to-speech → (video mode) remux onto
  // the original video. Output exposes BOTH a video and the revoiced audio
  // track in video mode; the revoiced audio alone when demoted. ---
  if (source.slot === "video" || source.hasVideo) {
    console.log(
      `[worker] voice-changer ${ctx.jobId} (${videoMode ? "video" : "audio"} mode` +
      `${source.slot === "video" && !videoMode ? " — the video input carries no video stream, delivering audio" : ""})`,
    )

    // 1. Download once + extract audio (throws NoAudioTrackError → friendly
    //    failure when the source clip is silent).
    const { audioPath, workDir } = await extractAudioTrack(sourceUrl)
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
      // POST-PROVIDER: `revoiced` is the speech-to-speech provider's delivered
      // output (we were billed) — an R2 upload failure is post-delivery, skip refund.
      newAudioR2Url = await runPostProcessing(() => uploadBufferToR2(revoiced, mediaObjectKey(ctx.jobId, "audio", "mp3"), "audio/mpeg", ctx.jobUserId))
    } finally {
      await cleanupWorkDir(workDir)
    }
    await setJobProgress(job, ctx.jobId, 70)

    if (!videoMode) {
      // DEMOTED: nothing to remux onto. Deliver the revoiced audio exactly the
      // way audio mode does; `sourceHasVideo` keeps the decision legible.
      await setJobProgress(job, ctx.jobId, 100)
      const { ok } = await finalizeJobWithMedia({
        jobId: ctx.jobId,
        jobType: "voice-clone",
        result: { url: newAudioR2Url, cost: null, providerUsed: "elevenlabs-direct" },
        mediaUrl: newAudioR2Url,
        extraOutputData: { sourceHasVideo: source.hasVideo },
      })
      if (!ok) return
      console.log(`[worker] Job ${ctx.jobId} completed (audio): ${newAudioR2Url}`)
      return
    }

    // 2. Remux the new audio onto the original video. Reuses merge-video-audio
    //    (VP8/VP9 re-encode + length handling). keepOriginalAudio:false replaces
    //    the source dialogue entirely.
    const mergedPath = await mergeVideoAudio({
      videoUrl: sourceUrl,
      audioTracks: [{ url: newAudioR2Url, startTime: 0, volume: 100, sourceType: "audio" }],
      keepOriginalAudio: false,
    })
    // POST-PROVIDER: `mergedPath` is the revoiced (provider) audio remuxed onto
    // the video — an R2 upload failure is post-delivery, so skip the refund.
    const videoR2Url = await runPostProcessing(() => uploadFileToR2(mergedPath, ctx.jobId, "video", ctx.jobUserId))
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
  // POST-PROVIDER: the speech-to-speech provider already delivered `audioBuffer`
  // (we were billed) — an R2 upload failure is post-delivery, so skip the refund.
  const r2Url = await runPostProcessing(() => uploadBufferToR2(audioBuffer, mediaObjectKey(ctx.jobId, "audio", "mp3"), "audio/mpeg", ctx.jobUserId))
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
  const { audioUrl, targetLanguage, sourceLanguage, numSpeakers, disableVoiceCloning, dropBackgroundAudio } = job.data as {
    jobId: string; audioUrl: string; targetLanguage: string
    sourceLanguage?: string; numSpeakers?: number
    disableVoiceCloning?: boolean; dropBackgroundAudio?: boolean
  }
  console.log(`[worker] dubbing ${ctx.jobId} (target: ${targetLanguage})`)
  const dubbingOnTaskCreated = makeOnTaskCreated(ctx.jobId, "elevenlabs-async")
  const { dubbingId } = await startDubbing(
    audioUrl,
    targetLanguage,
    { sourceLang: sourceLanguage, numSpeakers, disableVoiceCloning, dropBackgroundAudio },
    { onTaskCreated: dubbingOnTaskCreated },
  )
  await setJobProgress(job, ctx.jobId, 20)

  await waitForDubbing(dubbingId, (status) => {
    if (status === "dubbing") void setJobProgress(job, ctx.jobId, 50)
  })
  await setJobProgress(job, ctx.jobId, 70)

  const audioBuffer = await downloadDubbedAudio(dubbingId, targetLanguage)
  await setJobProgress(job, ctx.jobId, 85)
  // POST-PROVIDER: ElevenLabs already produced + delivered the dub (we were
  // billed) — an R2 upload failure here is post-delivery, so skip the refund.
  const r2Url = await runPostProcessing(() => uploadBufferToR2(audioBuffer, mediaObjectKey(ctx.jobId, "audio", "mp3"), "audio/mpeg", ctx.jobUserId))
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
  // POST-PROVIDER: ElevenLabs already delivered the remixed audio (we were
  // billed) — an R2 upload failure here is post-delivery, so skip the refund.
  const r2Url = await runPostProcessing(() => uploadBufferToR2(audioBuffer, mediaObjectKey(ctx.jobId, "audio", "mp3"), "audio/mpeg", ctx.jobUserId))
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
  // POST-PROVIDER: ElevenLabs already delivered the designed voice audio (we
  // were billed) — an R2 upload failure here is post-delivery, so skip the refund.
  const r2Url = await runPostProcessing(() => uploadBufferToR2(result.audioBuffer, mediaObjectKey(ctx.jobId, "audio", "mp3"), "audio/mpeg", ctx.jobUserId))
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

const handleAudioSeparation: HandlerFn = async function handleAudioSeparation(job, ctx) {
  const { audioUrl, mode, quality } = job.data as {
    jobId: string
    audioUrl: string
    mode?: "vocal_instrumental" | "stems"
    quality?: "auto" | "fast" | "best"
  }
  const sepMode = mode ?? "vocal_instrumental"
  const sepQuality = quality ?? "auto"
  console.log(`[worker] audio-separation ${ctx.jobId} (mode: ${sepMode}, quality: ${sepQuality})`)
  const provider = new ReplicateAudioSeparationProvider()
  // No onTaskCreated: a crash fails+refunds rather than being single-URL
  // reconcile-recovered (which would flatten the stems). See design §C(c).
  const result = await withProgressRamp(
    job,
    ctx.jobId,
    { start: 5, cap: 80 },
    () => provider.separateAudio(audioUrl, { mode: sepMode, quality: sepQuality }),
  )

  // Upload each returned stem to R2. POST-PROVIDER: Demucs already delivered
  // the separation (billed) — an R2 upload failure here skips the refund.
  const stemFields = [
    ["vocals", "vocalUrl"],
    ["instrumental", "instrumentalUrl"],
    ["drums", "drumsUrl"],
    ["bass", "bassUrl"],
    ["other", "otherUrl"],
    ["guitar", "guitarUrl"],
    ["piano", "pianoUrl"],
  ] as const
  const present = stemFields.filter(([stem]) => result[stem])
  const uploaded = await runPostProcessing(() =>
    Promise.all(
      present.map(async ([stem, field]) => {
        const r2Url = await uploadToR2(result[stem] as string, `${ctx.jobId}-${stem}`, "audio", ctx.jobUserId)
        return { field, r2Url }
      }),
    ),
  )

  const outputData: Record<string, unknown> = {}
  for (const { field, r2Url } of uploaded) {
    outputData[field] = r2Url
  }
  // Primary audioUrl for single-handle downstream routing + gallery.
  outputData.audioUrl = outputData.vocalUrl ?? outputData.instrumentalUrl

  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, { output_data: outputData })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${uploaded.length} stem(s) uploaded`)
}

export const audioAIHandlers: Record<string, HandlerFn> = {
  "text-to-speech": handleTextToSpeech,
  "generate-music": handleGenerateMusic,
  "text-to-audio": handleTextToAudio,
  "transcribe": handleTranscribe,
  "extract-youtube-audio": handleExtractYoutubeAudio,
  "audio-isolation": handleAudioIsolation,
  "audio-separation": handleAudioSeparation,
  "text-to-dialogue": handleTextToDialogue,
  "voice-changer": handleVoiceChanger,
  "dubbing": handleDubbing,
  "voice-remix": handleVoiceRemix,
  "voice-design": handleVoiceDesign,
  "forced-alignment": handleForcedAlignment,
}
