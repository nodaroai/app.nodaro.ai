/**
 * Gemini Omni Flash 1.2 (`google/gemini-omni-flash-1-2`): one KIE id, four
 * modes, picked by the inputs sent (docs.kie.ai/market/google/gemini-omni-flash-1-2).
 *
 *   - text or reference images: `image_urls`, `duration` 3-15
 *   - first frame: `first_frame_url`, `duration` 3-15, no other image
 *   - first and last frame: both URLs, `duration` 3-10, no other image
 *   - video edit: `video_list` (one plain URL, up to 15 s), NO `duration`
 *
 * It shares the family's routing but not 1.1's wire: no `character_ids` or
 * `audio_ids`, `seeds` (10000-99999) instead of `seed`, an integer `duration`,
 * and a source clip with no trim window. The body is an explicit allow-list.
 *
 * The frames follow the Seedance rule: only frames wired, they go in as real
 * frames; anything else wired, they join `image_urls` after the caller's own
 * images and the prompt names them. The second form also carries a first +
 * last pair past the 10 s that the real-frames mode allows.
 */
import { dirname } from "node:path"
import sharp from "sharp"
import { placeFramesAfterReferences } from "@nodaro/prompts/assembly"
import { videoProviderReferenceSyntax } from "@nodaro/shared/models"
import { resolveFrameFitAspect } from "@nodaro/shared/video"
import { fetchOwnMedia } from "../../lib/fetch-own-media.js"
import { uploadJobScratchFile } from "../../lib/job-scratch.js"
import { geminiOmni12CutEndSec, geminiOmni12SourceWindow, type VideoSourceTrim } from "../../lib/gemini-omni-12-source.js"
import { cleanupWorkDir, probeMediaDuration } from "../video/ffmpeg-utils.js"
import { trimVideo } from "../video/trim-video.js"
import { createSanitizedError } from "./client.js"
import { atInputStep, urlForLog } from "./input-label.js"

/** Our id for this model: its catalog entry says how the prompt names images. */
const MODEL_KEY = "gemini-omni-flash-1-2"
/** Most images in `image_urls`. */
const MAX_IMAGES = 6
/** images + {@link VIDEO_QUOTA_UNITS} for a source video must stay within this. */
const INPUT_QUOTA = 7
const VIDEO_QUOTA_UNITS = 2
/** The real first + last frame mode's longest clip. */
const FIRST_LAST_MAX_SEC = 10
const SEED_MIN = 10000
const SEED_MAX = 99999

/** KIE's rate, in USD per second of video (4 / 9 / 10 / 22 KIE credits). */
export const GEMINI_OMNI_12_RATE_USD_PER_SEC: Readonly<Record<string, number>> = {
  "360p": 0.02,
  "720p": 0.045,
  "1080p": 0.05,
  "4k": 0.11,
}

export interface GeminiOmni12RequestArgs {
  prompt: string
  durationSec: number
  /** Already one of the model's resolutions. */
  resolution: string
  /** Already one of the model's ratios. */
  aspectRatio: string
  seed?: number
  startFrameUrl?: string
  endFrameUrl?: string
  referenceImageUrls?: readonly (string | undefined)[]
  /** The source clip, already within KIE's limit. */
  sourceVideoUrl?: string
}

export type GeminiOmni12Mode = "reference" | "first-frame" | "first-last-frame" | "video-edit"

export interface GeminiOmni12Request {
  mode: GeminiOmni12Mode
  input: Record<string, unknown>
  /** Trailing caller references dropped to keep the frames inside the image cap. */
  droppedRefImages: number
}

/**
 * Whether a request goes out with real frames: only frames wired, with a start
 * frame (KIE has no last-frame-only mode), and first + last within its 10 s.
 */
export function geminiOmni12SendsRealFrames(args: {
  startFrameUrl?: string
  endFrameUrl?: string
  durationSec: number
  hasReferenceImages: boolean
  hasSourceVideo: boolean
}): boolean {
  return !args.hasSourceVideo && !args.hasReferenceImages && !!args.startFrameUrl
    && (!args.endFrameUrl || args.durationSec <= FIRST_LAST_MAX_SEC)
}

/**
 * The ratio to send for `auto` beside real frames: KIE reads `auto` as 16:9 when
 * no reference image is sent, which crops a portrait frame. The frame's own
 * shape picks, by the rule the frame fit already used. A frame that cannot be
 * read stays `auto`.
 */
export async function geminiOmni12FrameAspect(modelKey: string, frameUrl: string, logLabel: string): Promise<string> {
  try {
    const res = await fetchOwnMedia(frameUrl)
    if (!res.ok) return "auto"
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    const swapped = typeof meta.orientation === "number" && meta.orientation >= 5
    const sourceWidth = (swapped ? meta.height : meta.width) ?? 0
    const sourceHeight = (swapped ? meta.width : meta.height) ?? 0
    return resolveFrameFitAspect({ provider: modelKey, requestedAspect: "auto", sourceWidth, sourceHeight }) ?? "auto"
  } catch (err) {
    console.warn(`[KIE.ai] ${logLabel}: could not read the start frame's shape, sending auto: ${err instanceof Error ? err.message : String(err)}`)
    return "auto"
  }
}

export function buildGeminiOmni12Request(args: GeminiOmni12RequestArgs): GeminiOmni12Request {
  const refs = (args.referenceImageUrls ?? []).filter((u): u is string => typeof u === "string" && u.trim().length > 0)
  const { startFrameUrl, endFrameUrl, sourceVideoUrl, durationSec, seed } = args
  const base = {
    resolution: args.resolution,
    aspect_ratio: args.aspectRatio,
    ...(seed !== undefined && Number.isInteger(seed) && seed >= SEED_MIN && seed <= SEED_MAX ? { seeds: seed } : {}),
  }

  if (geminiOmni12SendsRealFrames({ startFrameUrl, endFrameUrl, durationSec, hasReferenceImages: refs.length > 0, hasSourceVideo: !!sourceVideoUrl })) {
    return {
      mode: endFrameUrl ? "first-last-frame" : "first-frame",
      input: {
        prompt: args.prompt,
        ...base,
        duration: durationSec,
        first_frame_url: startFrameUrl,
        ...(endFrameUrl ? { last_frame_url: endFrameUrl } : {}),
      },
      droppedRefImages: 0,
    }
  }

  const placed = placeFramesAfterReferences({
    prompt: args.prompt,
    firstFrameUrl: startFrameUrl,
    lastFrameUrl: endFrameUrl,
    refImageUrls: refs,
    imageCap: Math.min(MAX_IMAGES, INPUT_QUOTA - (sourceVideoUrl ? VIDEO_QUOTA_UNITS : 0)),
    syntax: videoProviderReferenceSyntax(MODEL_KEY),
    bindIdentities: true,
  })
  return {
    mode: sourceVideoUrl ? "video-edit" : "reference",
    input: {
      prompt: placed.promptSuffix ? `${args.prompt}\n\n${placed.promptSuffix}` : args.prompt,
      ...base,
      ...(sourceVideoUrl ? { video_list: [sourceVideoUrl] } : { duration: durationSec }),
      ...(placed.imageUrls.length > 0 ? { image_urls: placed.imageUrls } : {}),
    },
    droppedRefImages: placed.droppedRefImages,
  }
}

/**
 * The URL KIE should fetch for a source clip, and the seconds it bills: the clip
 * itself when it fits, otherwise the requested stretch, cut and put in the
 * running job's scratch folder.
 */
export async function prepareGeminiOmni12Source(
  videoUrl: string,
  trim: VideoSourceTrim,
  logLabel: string,
): Promise<{ url: string; billedSec: number }> {
  let clipSec: number | undefined
  try {
    clipSec = await probeMediaDuration(videoUrl)
  } catch (err) {
    console.warn(`[KIE.ai] ${logLabel}: could not probe the source clip (${urlForLog(videoUrl)}): ${err instanceof Error ? err.message : String(err)}`)
  }
  const window = geminiOmni12SourceWindow({ clipSec, trim })
  if (window.spanSec <= 0) {
    throw createSanitizedError(`The trim starts past the end of the ${clipSec}s source clip`, "Video generation")
  }
  if (!window.cut) return { url: videoUrl, billedSec: window.spanSec }

  console.log(`[KIE.ai] ${logLabel}: sending ${window.startSec}s-${window.endSec}s of the source clip`)
  const label = `${logLabel} source video`
  let workDir: string | undefined
  try {
    const { videoPath } = await atInputStep(label, videoUrl, "shrink", () =>
      // CRF 18: the clip is re-encoded again by the model, so lose little here.
      trimVideo({ videoUrl, startTime: window.startSec, endTime: geminiOmni12CutEndSec(window), crf: 18 }))
    workDir = dirname(videoPath)
    // A provider input: the running job's scratch folder, emptied when the job ends.
    const url = await atInputStep(label, videoUrl, "upload", () =>
      uploadJobScratchFile(videoPath, "provider-omni-source", "mp4", "video/mp4"))
    return { url, billedSec: window.spanSec }
  } catch (err) {
    console.error(`[KIE.ai] ${label} cut failed: ${err instanceof Error ? err.message : String(err)}`)
    throw createSanitizedError("Could not cut the source video for this model", "Video generation")
  } finally {
    if (workDir) await cleanupWorkDir(workDir)
  }
}
