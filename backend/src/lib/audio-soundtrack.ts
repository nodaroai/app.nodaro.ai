// @reads-none renders a still-frame clip from request media; reads no repo files
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  AUDIO_SOUNDTRACK_FPS,
  applyDefaultVideoSelection,
  getMaxVideoPromptChars,
  audioSoundtrackActive,
  audioSoundtrackClipSec,
  audioSoundtrackPrompt,
  pricedOutputDurationSec,
  VIDEO_REF_LIMITS_BY_PROVIDER,
} from "@nodaro/shared/models"
import { cleanupWorkDir, createWorkDir, downloadFile, probeMediaDuration, runFfmpeg } from "../providers/video/ffmpeg-utils.js"
import { rememberRefVideoDuration } from "./ref-video-probe.js"

/**
 * Plays a run's first reference audio clip as its soundtrack, for a model that
 * otherwise takes audio only as voice samples (`audioSoundtrackActive`,
 * @nodaro/shared `audio-soundtrack.ts` — Kling 4.0). The clip becomes a short
 * reference VIDEO — one still frame carrying the audio — appended after the
 * caller's own reference videos and sent with `keepOriginalSound`, which makes
 * the provider keep that audio as the result's sound (measured 2026-10-28: the
 * result's track matched the clip at 0.998).
 *
 * It runs where a request ENTERS — the video routes' first pre-check and the
 * DAG's worker dispatch — so from then on the run is an ordinary reference-video
 * run: its price, the 5-clip and 30-second caps, the settlement and the
 * provider request all read the clip like any other.
 *
 * The clip is keyed by what it is made of (audio, frame, length, canvas), so a
 * quote and its run, or a run done again, make it once.
 */

/** The fields of a video request (route body or DAG payload) this step reads and writes. */
export interface AudioSoundtrackRequest {
  provider?: unknown
  duration?: unknown
  prompt?: unknown
  aspectRatio?: unknown
  audioSoundtrack?: unknown
  imageUrl?: unknown
  referenceImageUrls?: unknown
  referenceVideoUrls?: unknown
  referenceAudioUrls?: unknown
  characterReferences?: unknown
  keepOriginalSound?: unknown
}

/** What the step writes on a request it applies to. */
interface AudioSoundtrackApplied {
  audioSoundtrack: false
  prompt: string
  referenceVideoUrls: string[]
  referenceAudioUrls: string[]
  keepOriginalSound: true
}

export type AudioSoundtrackOutcome<T> =
  | { readonly ok: true; readonly request: T & Partial<AudioSoundtrackApplied>; readonly applied: boolean }
  | { readonly ok: false; readonly message: string }

const LONG_SIDE = 1280
const FPS = AUDIO_SOUNDTRACK_FPS

const urlsOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && u.trim() !== "").map((u) => u.trim()) : []

const firstImage = (req: AudioSoundtrackRequest): string | undefined => {
  if (typeof req.imageUrl === "string" && req.imageUrl.trim()) return req.imageUrl.trim()
  const ref = urlsOf(req.referenceImageUrls)[0]
  if (ref) return ref
  const chars = Array.isArray(req.characterReferences) ? req.characterReferences : []
  for (const c of chars) {
    const url = (c as { imageUrl?: unknown } | null)?.imageUrl
    if (typeof url === "string" && url.trim()) return url.trim()
  }
  return undefined
}

/** The canvas the clip is drawn on: the run's aspect ratio when it states one, else the frame's own shape. */
function canvasFor(aspectRatio: unknown): { w: number; h: number } | undefined {
  const m = typeof aspectRatio === "string" ? /^(\d+):(\d+)$/.exec(aspectRatio.trim()) : null
  if (!m) return undefined
  const [aw, ah] = [Number(m[1]), Number(m[2])]
  if (!(aw > 0 && ah > 0)) return undefined
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return aw >= ah ? { w: LONG_SIDE, h: even((LONG_SIDE * ah) / aw) } : { w: even((LONG_SIDE * aw) / ah), h: LONG_SIDE }
}

/** The ffmpeg arguments for the clip: the frame (or black) held for `sec` seconds over the audio, padded with silence. */
export function audioSoundtrackFfmpegArgs(args: {
  framePath: string | undefined
  audioPath: string
  outPath: string
  sec: number
  canvas: { w: number; h: number } | undefined
}): string[] {
  const { framePath, audioPath, outPath, sec, canvas } = args
  const box = canvas ?? { w: LONG_SIDE, h: LONG_SIDE }
  // The inputs are files a user supplied (downloaded first): ffmpeg may read
  // only local files for them, never fetch a URL a crafted file points at.
  const local = ["-protocol_whitelist", "file"]
  const picture = framePath
    ? [...local, "-loop", "1", "-framerate", String(FPS), "-i", framePath]
    : ["-f", "lavfi", "-i", `color=c=black:s=${(canvas ?? { w: LONG_SIDE, h: 720 }).w}x${(canvas ?? { w: LONG_SIDE, h: 720 }).h}:r=${FPS}`]
  const fit = canvas
    ? `scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease,pad=${box.w}:${box.h}:(ow-iw)/2:(oh-ih)/2:color=black`
    : `scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`
  return [
    "-y", ...picture, ...local, "-i", audioPath,
    "-filter_complex", `[0:v]${fit},setsar=1,format=yuv420p[v];[1:a]apad[a]`,
    "-map", "[v]", "-map", "[a]",
    // Whole frames (the length the price was quoted at); the audio stops with them.
    "-frames:v", String(Math.round(sec * FPS)), "-t", sec.toFixed(6),
    "-r", String(FPS), "-c:v", "libx264", "-tune", "stillimage", "-preset", "veryfast",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart", outPath,
  ]
}

/**
 * The request with its first reference audio clip played as the soundtrack —
 * unchanged when the run does not play one. Refused (with a sentence the
 * caller can act on) when the clip has no reference-video place left or its
 * audio cannot be read.
 */
export async function applyAudioSoundtrack<T extends AudioSoundtrackRequest>(
  request: T,
  userId: string | undefined,
): Promise<AudioSoundtrackOutcome<T>> {
  const provider = applyDefaultVideoSelection({
    provider: typeof request.provider === "string" ? request.provider : undefined,
    duration: request.duration as number | string | undefined,
  }).provider
  const audio = urlsOf(request.referenceAudioUrls)
  const flag = typeof request.audioSoundtrack === "boolean" ? request.audioSoundtrack : undefined
  if (!audioSoundtrackActive({ provider, audioSoundtrack: flag, audioRefCount: audio.length })) {
    return { ok: true, request: request as T & Partial<AudioSoundtrackApplied>, applied: false }
  }

  const videos = urlsOf(request.referenceVideoUrls)
  const videoCap = VIDEO_REF_LIMITS_BY_PROVIDER[provider]?.videos ?? 0
  if (videos.length >= videoCap) {
    return {
      ok: false,
      message:
        `The first audio clip plays as the soundtrack, which takes one of this model's ${videoCap} reference-video places, ` +
        `and ${videos.length} reference videos are connected. Remove a reference video, or turn off "Play audio as soundtrack".`,
    }
  }

  const audioUrl = audio[0]!
  const frameUrl = firstImage(request)
  const outputSec = pricedOutputDurationSec(provider, request.duration as number | string | undefined)
  const audioSec = await probeMediaDuration(audioUrl).catch(() => Number.NaN)
  if (!Number.isFinite(audioSec) || audioSec <= 0) {
    return { ok: false, message: "The first audio clip could not be read, so it cannot play as the soundtrack. Check the file, or turn off \"Play audio as soundtrack\"." }
  }
  const sec = audioSoundtrackClipSec(audioSec, outputSec)
  const canvas = canvasFor(request.aspectRatio)

  const digest = createHash("sha256")
    .update(JSON.stringify({ audioUrl, frameUrl: frameUrl ?? null, sec, canvas: canvas ?? null }))
    .digest("hex")
    .slice(0, 32)
  const key = `uploads/video/${userId ?? "shared"}/soundtrack-${digest}.mp4`
  // Loaded only when a clip is made: the video routes import this module, and
  // the storage client is not something every request (or test) should load.
  const { headR2Object, r2Url } = await import("./storage.js")
  const url = (await headR2Object(key)).exists ? r2Url(key) : await renderClip({ key, audioUrl, frameUrl, sec, canvas, userId })
  rememberRefVideoDuration(url, sec)

  const prompt = typeof request.prompt === "string" ? request.prompt : ""
  return {
    ok: true,
    applied: true,
    request: {
      ...request,
      keepOriginalSound: true as const,
      // Applied once: a request read again (a retry, a re-run of its stored
      // input) keeps its remaining clips as voices instead of playing the next.
      audioSoundtrack: false,
      prompt: audioSoundtrackPrompt(prompt, videos.length + 1, getMaxVideoPromptChars(provider)),
      referenceVideoUrls: [...videos, url],
      referenceAudioUrls: audio.slice(1),
    },
  }
}

async function renderClip(args: {
  key: string
  audioUrl: string
  frameUrl: string | undefined
  sec: number
  canvas: { w: number; h: number } | undefined
  userId: string | undefined
}): Promise<string> {
  const workDir = await createWorkDir("audio-soundtrack")
  try {
    const audioPath = join(workDir, "audio")
    const framePath = args.frameUrl ? join(workDir, "frame") : undefined
    const outPath = join(workDir, "soundtrack.mp4")
    await Promise.all([
      downloadFile(args.audioUrl, audioPath),
      ...(framePath && args.frameUrl ? [downloadFile(args.frameUrl, framePath)] : []),
    ])
    await runFfmpeg(audioSoundtrackFfmpegArgs({ framePath, audioPath, outPath, sec: args.sec, canvas: args.canvas }))
    const { uploadBufferToR2 } = await import("./storage.js")
    return await uploadBufferToR2(await readFile(outPath), args.key, "video/mp4", args.userId)
  } finally {
    await cleanupWorkDir(workDir)
  }
}
