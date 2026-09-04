/**
 * Nodaro Cloud video provider (community cloud-connect, Phase 4a).
 *
 * Implements ImageToVideoProvider + TextToVideoProvider by POSTing to the
 * connected cloud's own public generation routes —
 *   image-to-video → POST /v1/generate-video   (generateVideoBody)
 *   text-to-video  → POST /v1/text-to-video    (textToVideoBody)
 * — then polling GET /v1/jobs/:id until completion. The connected cloud
 * account's wallet is billed; the instance sees no USD cost (`cost: null`).
 */

import type {
  ImageToVideoProvider,
  TextToVideoProvider,
  LipSyncProvider,
  LipSyncOptions,
  VideoLipSyncOptions,
  VideoUpscaleProvider,
  MotionTransferProvider,
  VideoToVideoProvider,
  SpeechToVideoProvider,
  SpeechToVideoOptions,
  ProviderOptions,
  ProviderResult,
  ReconcileOpts,
} from "../provider.interface.js"
import {
  createCloudJob,
  waitForCloudJob,
  NodaroCloudError,
  ensureCloudReachableMediaUrl,
  ensureCloudReachableMediaUrls,
  type CloudJob,
} from "./client.js"
import { relayResultFields } from "./relay-cost.js"

/**
 * Invert the worker's ProviderOptions.klingElements (KIE wire shape with
 * element_input_urls / element_input_video_urls) back into the route's
 * `elements` shape ({ name, description, type, urls }) — the exact inverse of
 * the mapping workers/handlers/video-ai.ts applies on the way in.
 */
function toRouteElements(
  klingElements: NonNullable<ProviderOptions["klingElements"]>,
): Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }> {
  return klingElements.map((el) => {
    const videoUrls = el.element_input_video_urls ?? []
    const imageUrls = el.element_input_urls ?? []
    return videoUrls.length > 0
      ? { name: el.name, description: el.description, type: "video" as const, urls: videoUrls }
      : { name: el.name, description: el.description, type: "image" as const, urls: imageUrls }
  })
}

/**
 * ProviderOptions → cloud route body fields shared by both video routes.
 * Boolean/number levers use `!== undefined` guards so meaningful falsy values
 * (e.g. `sound: false`, `seed: 0`) still reach the cloud.
 */
function sharedVideoBody(options?: ProviderOptions): Record<string, unknown> {
  if (!options) return {}
  return {
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.sound !== undefined ? { sound: options.sound } : {}),
    ...(options.negativePrompt !== undefined ? { negativePrompt: options.negativePrompt } : {}),
    ...(options.cfgScale !== undefined ? { cfgScale: options.cfgScale } : {}),
    ...(options.multiShots !== undefined ? { multiShot: options.multiShots } : {}),
    ...(options.multiPrompt?.length ? { shots: options.multiPrompt } : {}),
    ...(options.klingElements?.length ? { elements: toRouteElements(options.klingElements) } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.resolution !== undefined ? { resolution: options.resolution } : {}),
    ...(options.generateAudio !== undefined ? { generateAudio: options.generateAudio } : {}),
    ...(options.referenceImageUrls?.length ? { referenceImageUrls: options.referenceImageUrls } : {}),
    ...(options.referenceVideoUrls?.length ? { referenceVideoUrls: options.referenceVideoUrls } : {}),
    ...(options.referenceAudioUrls?.length ? { referenceAudioUrls: options.referenceAudioUrls } : {}),
    ...(options.webSearch !== undefined ? { webSearch: options.webSearch } : {}),
    ...(options.nsfwChecker !== undefined ? { nsfwChecker: options.nsfwChecker } : {}),
    ...(options.enableTranslation !== undefined ? { enableTranslation: options.enableTranslation } : {}),
  }
}

/** Extra fields only the image-to-video route (generateVideoBody) accepts. */
function i2vOnlyBody(options?: ProviderOptions): Record<string, unknown> {
  if (!options) return {}
  return {
    ...(options.aspectRatio !== undefined ? { aspectRatio: options.aspectRatio } : {}),
    ...(options.motionPrompt !== undefined ? { motionPrompt: options.motionPrompt } : {}),
    ...(options.grokMode !== undefined ? { grokMode: options.grokMode } : {}),
    ...(options.cameraFixed !== undefined ? { cameraFixed: options.cameraFixed } : {}),
    ...(options.generationType !== undefined ? { generationType: options.generationType } : {}),
    ...(options.videoTrimStart !== undefined ? { videoTrimStart: options.videoTrimStart } : {}),
    ...(options.videoTrimEnd !== undefined ? { videoTrimEnd: options.videoTrimEnd } : {}),
  }
}

/** Read the finalized video URL out of a completed cloud job. */
function extractVideoResult(
  job: CloudJob,
  jobId: string,
): ProviderResult {
  const output = (job.output_data ?? {}) as { videoUrl?: unknown }
  const url = typeof output.videoUrl === "string" ? output.videoUrl : undefined
  if (!url) {
    throw new NodaroCloudError(
      `nodaro.ai: video job ${jobId} completed but returned no videoUrl`,
    )
  }
  // The cloud's thumbnailUrl is ignored — the instance worker regenerates its
  // own thumbnail from the downloaded clip during finalize.
  //
  // `cost` stays null — the instance sees no USD. What it DOES get is the far
  // end's job id and reserved credits (spec §8.2 lane 1): the handler persists
  // them onto its own job row, which is what a self-host settles its users on
  // and what stops the delete paths destroying an object the far end owns.
  return { url, cost: null, ...relayResultFields(job) }
}

export class NodaroCloudVideoProvider
  implements
    ImageToVideoProvider,
    TextToVideoProvider,
    LipSyncProvider,
    VideoUpscaleProvider,
    MotionTransferProvider,
    VideoToVideoProvider,
    SpeechToVideoProvider
{
  // NOTE: reconcileOpts.onTaskCreated is deliberately NOT called in either
  // method — see the rationale in ./image.ts (provider_kind is model-keyed;
  // persisting the cloud job id would mislabel it as a KIE task and the
  // reconcile cron would force-fail a job still running on the cloud).

  async imageToVideo(
    imageUrl: string | undefined,
    prompt?: string,
    model?: string,
    duration?: number,
    endFrameUrl?: string,
    options?: ProviderOptions,
    _reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    // Instance-local media can't be fetched by the cloud — re-host first.
    const [cloudImageUrl, cloudEndFrameUrl, cloudRefUrls] = await Promise.all([
      ensureCloudReachableMediaUrl(imageUrl),
      ensureCloudReachableMediaUrl(endFrameUrl),
      ensureCloudReachableMediaUrls(options?.referenceImageUrls),
    ])
    const cloudOptions = options
      ? { ...options, referenceImageUrls: cloudRefUrls }
      : options
    const body: Record<string, unknown> = {
      ...(cloudImageUrl !== undefined ? { imageUrl: cloudImageUrl } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      ...(model !== undefined ? { provider: model } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(cloudEndFrameUrl !== undefined ? { endFrameUrl: cloudEndFrameUrl } : {}),
      ...sharedVideoBody(cloudOptions),
      ...i2vOnlyBody(cloudOptions),
    }

    const jobId = await createCloudJob("/v1/generate-video", body)
    const job = await waitForCloudJob(jobId, options?.onProgress)
    return extractVideoResult(job, jobId)
  }

  async textToVideo(
    prompt: string,
    model?: string,
    duration?: number,
    aspectRatio?: string,
    options?: ProviderOptions,
    _reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    const cloudRefUrls = await ensureCloudReachableMediaUrls(options?.referenceImageUrls)
    const cloudOptions = options
      ? { ...options, referenceImageUrls: cloudRefUrls }
      : options
    const body: Record<string, unknown> = {
      prompt,
      ...(model !== undefined ? { provider: model } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(aspectRatio !== undefined ? { aspectRatio } : {}),
      ...sharedVideoBody(cloudOptions),
    }

    const jobId = await createCloudJob("/v1/text-to-video", body)
    const job = await waitForCloudJob(jobId, options?.onProgress)
    return extractVideoResult(job, jobId)
  }

  /**
   * The four capabilities below all follow the i2v shape: re-host any
   * instance-local media (the cloud's safe-fetch refuses private hosts), POST
   * the cloud's own route, poll the job. They were previously declared as
   * empty model lists, so a connected keyless install still fell into the
   * router's "nothing can serve this" path even though the cloud serves all of
   * them (verified against the live cloud with an instance token, 2026-08-14).
   */
  async lipSync(
    imageUrl: string,
    audioUrl: string,
    prompt?: string,
    model?: string,
    resolution?: string,
    audioDurationSec?: number,
    _reconcileOpts?: ReconcileOpts,
    options?: LipSyncOptions,
  ): Promise<ProviderResult> {
    const [cloudImage, cloudAudio] = await Promise.all([
      ensureCloudReachableMediaUrl(imageUrl),
      ensureCloudReachableMediaUrl(audioUrl),
    ])
    const body: Record<string, unknown> = {
      imageUrl: cloudImage,
      audioUrl: cloudAudio,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(model !== undefined ? { provider: model } : {}),
      ...(resolution !== undefined ? { resolution } : {}),
      ...(audioDurationSec !== undefined ? { audioDurationSec } : {}),
      ...(options?.fastMode !== undefined ? { fastMode: options.fastMode } : {}),
      ...(options?.seed !== undefined ? { seed: options.seed } : {}),
    }
    const jobId = await createCloudJob("/v1/lip-sync", body)
    return extractVideoResult(await waitForCloudJob(jobId), jobId)
  }

  async speechToVideo(
    imageUrl: string,
    audioUrl: string,
    prompt: string,
    resolution?: string,
    options?: SpeechToVideoOptions,
    _reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    const [cloudImage, cloudAudio] = await Promise.all([
      ensureCloudReachableMediaUrl(imageUrl),
      ensureCloudReachableMediaUrl(audioUrl),
    ])
    const body: Record<string, unknown> = {
      imageUrl: cloudImage,
      audioUrl: cloudAudio,
      prompt,
      ...(resolution !== undefined ? { resolution } : {}),
      ...(options?.negativePrompt !== undefined ? { negativePrompt: options.negativePrompt } : {}),
      ...(options?.seed !== undefined ? { seed: options.seed } : {}),
      ...(options?.numFrames !== undefined ? { numFrames: options.numFrames } : {}),
      ...(options?.fps !== undefined ? { fps: options.fps } : {}),
      ...(options?.inferenceSteps !== undefined ? { inferenceSteps: options.inferenceSteps } : {}),
      ...(options?.guidanceScale !== undefined ? { guidanceScale: options.guidanceScale } : {}),
      ...(options?.shift !== undefined ? { shift: options.shift } : {}),
    }
    const jobId = await createCloudJob("/v1/speech-to-video", body)
    return extractVideoResult(await waitForCloudJob(jobId), jobId)
  }

  async videoUpscale(
    videoUrl: string,
    upscaleFactor?: "1" | "2" | "4",
    options?: ProviderOptions,
    _reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    // The router resolves the model for chain selection but does not pass it
    // into the provider (VideoUpscaleProvider takes no model arg), so the
    // cloud route applies its own default — the same one KIE uses.
    const body: Record<string, unknown> = {
      videoUrl: await ensureCloudReachableMediaUrl(videoUrl),
      ...(upscaleFactor !== undefined ? { upscaleFactor } : {}),
    }
    const jobId = await createCloudJob("/v1/video-upscale", body)
    return extractVideoResult(await waitForCloudJob(jobId), jobId)
  }

  async motionTransfer(
    imageUrl: string,
    videoUrl: string,
    prompt?: string,
    options?: ProviderOptions & {
      characterOrientation?: "image" | "video"
      resolution?: "480p" | "580p" | "720p" | "1080p"
      provider?: string
      backgroundSource?: "input_video" | "input_image"
      negativePrompt?: string
      videoDuration?: number
    },
    _reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    const [cloudImage, cloudVideo] = await Promise.all([
      ensureCloudReachableMediaUrl(imageUrl),
      ensureCloudReachableMediaUrl(videoUrl),
    ])
    const body: Record<string, unknown> = {
      imageUrl: cloudImage,
      videoUrl: cloudVideo,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(options?.provider !== undefined ? { provider: options.provider } : {}),
      ...(options?.characterOrientation !== undefined
        ? { characterOrientation: options.characterOrientation }
        : {}),
      ...(options?.resolution !== undefined ? { resolution: options.resolution } : {}),
      ...(options?.backgroundSource !== undefined
        ? { backgroundSource: options.backgroundSource }
        : {}),
      ...(options?.negativePrompt !== undefined ? { negativePrompt: options.negativePrompt } : {}),
      ...(options?.videoDuration !== undefined ? { videoDuration: options.videoDuration } : {}),
    }
    const jobId = await createCloudJob("/v1/motion-transfer", body)
    return extractVideoResult(await waitForCloudJob(jobId), jobId)
  }

  async videoToVideo(
    videoUrl: string,
    prompt?: string,
    model?: string,
    options?: ProviderOptions,
    _reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    const [cloudVideo, cloudRefs] = await Promise.all([
      ensureCloudReachableMediaUrl(videoUrl),
      ensureCloudReachableMediaUrls(options?.referenceImageUrls),
    ])
    // sharedVideoBody re-emits options.referenceImageUrls, so it must be given
    // the RE-HOSTED options — passing the originals would have shipped local
    // URLs to the cloud alongside the uploaded ones.
    const cloudOptions = options ? { ...options, referenceImageUrls: cloudRefs } : options
    const body: Record<string, unknown> = {
      videoUrl: cloudVideo,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(model !== undefined ? { provider: model } : {}),
      ...(cloudRefs?.length ? { referenceImageUrl: cloudRefs[0] } : {}),
      ...sharedVideoBody(cloudOptions),
    }
    const jobId = await createCloudJob("/v1/video-to-video", body)
    return extractVideoResult(await waitForCloudJob(jobId), jobId)
  }

  /**
   * Video-input lip-sync. The router calls this instead of `lipSync` when the
   * source is a clip, and throws "does not implement video lip-sync" if a
   * provider lacks it — so without this method a connected instance failed on
   * exactly the nodes the connection was supposed to cover.
   */
  async lipSyncVideo(
    videoUrl: string,
    audioUrl: string,
    opts: VideoLipSyncOptions,
    model?: string,
    audioDurationSec?: number,
    _reconcileOpts?: ReconcileOpts,
  ): Promise<ProviderResult> {
    const [cloudVideo, cloudAudio] = await Promise.all([
      ensureCloudReachableMediaUrl(videoUrl),
      ensureCloudReachableMediaUrl(audioUrl),
    ])
    const body: Record<string, unknown> = {
      videoUrl: cloudVideo,
      audioUrl: cloudAudio,
      ...(model !== undefined ? { provider: model } : {}),
      ...(audioDurationSec !== undefined ? { audioDurationSec } : {}),
      ...(opts?.mode !== undefined ? { mode: opts.mode } : {}),
      ...(opts?.separateVocal !== undefined ? { separateVocal: opts.separateVocal } : {}),
      ...(opts?.openScenedet !== undefined ? { openScenedet: opts.openScenedet } : {}),
      ...(opts?.alignAudio !== undefined ? { alignAudio: opts.alignAudio } : {}),
      ...(opts?.alignAudioReverse !== undefined ? { alignAudioReverse: opts.alignAudioReverse } : {}),
      ...(opts?.templStartSeconds !== undefined ? { templStartSeconds: opts.templStartSeconds } : {}),
    }
    const jobId = await createCloudJob("/v1/lip-sync", body)
    return extractVideoResult(await waitForCloudJob(jobId), jobId)
  }
}
