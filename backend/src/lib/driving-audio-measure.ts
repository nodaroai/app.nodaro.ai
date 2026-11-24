/**
 * The server's measurement of an audio-to-video run's driving clip (catalog
 * `drivingAudio`, LTX 2.5 Fast — decided 2026-11-23), before anything is held:
 * the clip is downloaded under the provider's size limit (50 MB), decoded
 * (the decoded length, never a length a header states: `measureAudio`, the
 * reader Lip Sync prices by) from one of the containers the endpoint takes
 * (MP3, WAV, M4A/MP4, AAC, OGG, FLAC), and priced by the shared rule
 * (`drivingAudioRun`). A length the caller sends is never read.
 *
 * One rule for every place such a run starts: the two video routes' preHandler
 * (a 400 before the credit guard) and the workflow run (a coded refusal before
 * the jobs row's reservation). Input validation, not a credit feature: it runs
 * in every edition.
 */
import { drivingAudioMaxSec, drivingAudioOf, drivingAudioRun, drivingAudioTooLongMessage, type DrivingAudioRun } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { CLIP_PRICE_GRACE_SEC } from "@nodaro/shared/media"
import { measureAudio } from "./lip-sync-inputs.js"
import { LIP_SYNC_MEASURE_SLOT_WAIT_MS, LIP_SYNC_RUN_MEASURE_SLOT_WAIT_MS } from "./lip-sync-download-slots.js"
import { safeUrlSchema } from "./url-validator.js"
import { probeImageSource } from "./image-source-probe.js"
import { AVIF_BRANDS, HEIF_BRANDS, isoBrandsOf, sniffInputType } from "./media-sniff.js"
import { looksLikeSvg } from "./svg-sanitize.js"

/** The most bytes the endpoint takes for its audio (its schema: up to 50 MB). */
export const DRIVING_AUDIO_MAX_BYTES = 50_000_000

/**
 * The containers the endpoint takes (MP3 / WAV / M4A / AAC / OGG / FLAC), as
 * ffmpeg's demuxers name them: `mov` reads M4A — and MP4 / MOV video too, so
 * the file is also required to carry no picture (`audioOnly`): a video file
 * wired as audio is refused at measurement. Anything else is refused before
 * the hold rather than sent and refused by the provider.
 */
export const DRIVING_AUDIO_FORMATS: readonly string[] = ["mp3", "wav", "mov", "aac", "ogg", "flac"]

export type DrivingAudioMeasure =
  | (Extract<DrivingAudioRun, { ok: true }> & { readonly audioSec: number })
  | { readonly ok: false; readonly code: string; readonly message: string }

/** Measure `audioUrl` and price the run that `provider` makes from it at this resolution and frame rate. */
export async function measureDrivingAudio(args: {
  provider: string
  audioUrl: unknown
  resolution?: unknown
  fps?: unknown
  userId?: string
  /** How long to wait for a measuring slot: a request's 30 s by default; a workflow run waits longer, as Lip Sync's does. */
  slotWaitMs?: number
}): Promise<DrivingAudioMeasure> {
  const label = MODEL_CATALOG[args.provider]?.label ?? args.provider
  const spec = drivingAudioOf(args.provider)
  if (!spec) return { ok: false, code: "validation_error", message: `${label} does not make a video from an audio clip.` }
  if (typeof args.audioUrl !== "string" || !safeUrlSchema.safeParse(args.audioUrl).success) {
    return { ok: false, code: "validation_error", message: `${label}: the audio clip must be an http(s) link that does not point to localhost or a private network.` }
  }
  // Decode one grace past the longest the run can take, so a hair over is still measured (and held at the maximum).
  const capSec = drivingAudioMaxSec(args.provider, { resolution: args.resolution, fps: args.fps }) + CLIP_PRICE_GRACE_SEC
  const reading = await measureAudio(
    args.audioUrl,
    capSec,
    { audio: { maxSourceBytes: DRIVING_AUDIO_MAX_BYTES } },
    args.userId,
    args.slotWaitMs ?? LIP_SYNC_MEASURE_SLOT_WAIT_MS,
    DRIVING_AUDIO_FORMATS,
    { audioOnly: true },
  )
  switch (reading.kind) {
    case "busy":
      return { ok: false, code: "audio_busy", message: `${label}: too many audio files are being measured right now. Nothing was charged; try again in a moment.` }
    case "stopped":
      return { ok: false, code: "audio_measure_stopped", message: `${label}: measuring the audio took too long on our side and was stopped. Nothing was charged; try again in a moment.` }
    case "has_video":
      return { ok: false, code: "audio_has_video", message: `${label} takes an audio file; this one is a video. Wire its audio (an MP3, WAV, M4A, AAC, OGG or FLAC file) instead. Nothing was charged.` }
    case "too_large":
      return { ok: false, code: "audio_too_large", message: `${label} takes an audio file of up to 50 MB; this one is larger. Nothing was charged.` }
    case "unreadable":
      return {
        ok: false,
        code: "audio_unreadable",
        message:
          reading.why === "slow" || reading.why === "download"
            ? `${label} could not download the audio clip. Use a link that serves the file directly. Nothing was charged.`
            : `${label} could not read the audio clip to its end. Use an MP3, WAV, M4A, AAC, OGG or FLAC file with an audio track. Nothing was charged.`,
      }
    case "measured": {
      if (reading.length.overCap) {
        // The decode stopped past the longest the run takes: longer than the limit, at a length it never read.
        return { ok: false, code: "audio_too_long", message: drivingAudioTooLongMessage({ provider: args.provider, resolution: args.resolution, fps: args.fps }) }
      }
      const audioSec = reading.length.seconds
      const run = drivingAudioRun({ provider: args.provider, resolution: args.resolution, fps: args.fps, audioSec })
      return run.ok ? { ...run, audioSec } : run
    }
  }
}

/**
 * The workflow run's half: a payload the payload builder marked
 * (`drivingAudioPending`) is measured by the same rule and stamped with the
 * run it prices — the length sent, the resolution, the measured and billed
 * seconds — and its price row; or the refusal, for the executor to throw
 * before the reservation. A payload not marked is returned as it is.
 */
export async function stampDrivingAudioRun(
  payload: Record<string, unknown>,
  modelIdentifier: string,
  userId: string | undefined,
  /** A Lip Sync run: its portrait (`payload.imageUrl`) must be a still image, checked before the voice is read. */
  opts: { readonly face?: true } = {},
): Promise<
  | {
      readonly ok: true
      readonly payload: Record<string, unknown>
      readonly modelIdentifier: string
      /** The measured run, when the payload was an audio-to-video run: what the free-credit check judges. */
      readonly measured?: Extract<DrivingAudioMeasure, { ok: true }>
    }
  | { readonly ok: false; readonly code: string; readonly message: string }
> {
  if (payload.drivingAudioPending !== true) return { ok: true, payload, modelIdentifier }
  const { drivingAudioPending: _pending, ...rest } = payload
  const provider = String(payload.provider)
  const audioUrls = Array.isArray(payload.referenceAudioUrls) ? payload.referenceAudioUrls : []
  if (opts.face) {
    const face = await drivingAudioFaceRefusal(provider, payload.imageUrl)
    if (face) return { ok: false, code: face.code, message: face.message }
  }
  if (audioUrls.length > 1) {
    return { ok: false, code: "validation_error", message: `${MODEL_CATALOG[provider]?.label ?? provider} makes a video from one audio clip; ${audioUrls.length} are wired. Wire one. Nothing was charged.` }
  }
  // A workflow run waits for a measuring slot as long as Lip Sync's run does, so parallel nodes queue rather than fail busy.
  const measured = await measureDrivingAudio({ provider, audioUrl: audioUrls[0], resolution: payload.resolution, fps: payload.fps, userId, slotWaitMs: LIP_SYNC_RUN_MEASURE_SLOT_WAIT_MS })
  if (!measured.ok) return measured
  return {
    ok: true,
    payload: {
      ...rest,
      duration: measured.sentSec,
      resolution: measured.resolution,
      audioToVideo: true,
      drivingAudioSec: measured.audioSec,
      drivingAudioBilledSec: measured.billedSec,
    },
    modelIdentifier: measured.creditId,
    measured,
  }
}

/**
 * What a video run reports as adjusted: an audio-to-video run reads neither the
 * body's length nor its ratio, so a move of either is not reported. The one
 * filter both video routes and `POST /v1/quote` apply.
 */
export function adjustmentsForRun<A extends { readonly field: string }>(adjustments: readonly A[], drivingAudio: unknown): A[] {
  return drivingAudio ? adjustments.filter((a) => a.field !== "duration" && a.field !== "aspectRatio") : [...adjustments]
}

/**
 * The free-credit request of an audio-to-video run, built ONLY from the
 * server's own measurement (the route's `req.drivingAudio`, the workflow
 * run's stamp) — never read off a request body or a payload, so a client
 * cannot claim an audio-driven run it is not.
 */
export function drivingAudioFreeVideoRequest(provider: string, measured: { readonly billedSec: number; readonly resolution: string }): {
  provider: string
  duration: number
  resolution: string
  videoSize: null
  audioDriven: true
} {
  return { provider, duration: measured.billedSec, resolution: measured.resolution, videoSize: null, audioDriven: true }
}

/**
 * The HTTP status a refusal of the driving clip answers with — one mapper for
 * every route that reads one (Generate Video's two, Lip Sync's): busy is a 429
 * (try again in a moment), a stopped reading a 503 (ours), the rest the
 * request's own (400).
 */
export function drivingAudioRefusalStatus(code: string): number {
  if (code === "audio_busy") return 429
  if (code === "audio_measure_stopped") return 503
  return 400
}

/** The still-image formats an LTX 2.5 Fast portrait runs from: the start-frame step converts each (a HEIC through its own decoder). */
const FACE_FORMATS = "PNG, JPEG, WebP, AVIF, HEIC, GIF, TIFF or SVG"
/** Still-image formats the start-frame step cannot read at all: BMP (the image library has no BMP reader). */
const UNDECODED_IMAGE_EXTS: ReadonlySet<string> = new Set(["bmp"])
/** ISO-BMFF major brands that make the file certainly audio (an M4A / M4B / M4P). */
const AUDIO_BRANDS: ReadonlySet<string> = new Set(["M4A ", "M4B ", "M4P "])
/** ISO-BMFF major brands that make the file certainly a QuickTime movie. */
const MOVIE_BRANDS: ReadonlySet<string> = new Set(["qt  "])
/**
 * ISO-BMFF brands of an audio-or-video file: the MP4 family, an H.264 / M4V
 * file, a DASH or CMAF segment, F4V. The 3GPP families are matched by prefix
 * (`isAvBrand`), being open-ended. A brand outside these, the image brands and
 * the two above is not called anything: the file is let through (a raw still
 * such as `crx ` among them).
 */
const AV_BRANDS: ReadonlySet<string> = new Set([
  "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "mp71", "avc1", "M4V ", "M4VH", "M4VP",
  "dash", "msdh", "msix", "cmfc", "cmf2", "cmfs", "f4v ", "mmp4", "MSNV", "NDAS",
])

/** An audio-or-video brand: one listed above, or one of the 3GPP families (`3gp*`, `3g2*`, `3ge*`). */
function isAvBrand(brand: string): boolean {
  return AV_BRANDS.has(brand) || /^3g(p|2|e)/.test(brand)
}

/**
 * What a non-image file is, as sure as its first bytes make it: "a video (AVI)", "an audio file (WAV)",
 * or — for a container that holds either (MP4 by most brands, WebM, Ogg) — "a video or audio file (MP4)".
 * An ISO-BMFF file is named only by a brand that makes it so; one that lists an image brand anywhere is an
 * image, and one whose brands say neither is not named (undefined: let through).
 */
function mediaKindOf(head: Buffer): string | undefined {
  const brands = isoBrandsOf(head)
  if (brands) {
    const all = [brands.major, ...brands.compatible]
    // An image brand anywhere comes first: the file is an image.
    if (all.some((b) => AVIF_BRANDS.has(b) || HEIF_BRANDS.has(b))) return undefined
    if (AUDIO_BRANDS.has(brands.major)) return "an audio file (M4A)"
    if (MOVIE_BRANDS.has(brands.major)) return "a video (MOV)"
    if (isAvBrand(brands.major)) return "a video or audio file (MP4)"
    // A major brand not known here: a compatible brand still makes it so. The generic `iso*` base brands do not
    // (an image lists them too).
    if (brands.compatible.some((b) => AUDIO_BRANDS.has(b))) return "an audio file (M4A)"
    return brands.compatible.some((b) => isAvBrand(b) && !/^iso/.test(b)) ? "a video or audio file (MP4)" : undefined
  }
  const video = sniffInputType(head, "video")
  const audio = sniffInputType(head, "audio")
  if (!video && !audio) return undefined
  if (video && audio) return `a video or audio file (${video.ext.toUpperCase()})`
  return video ? `a video (${video.ext.toUpperCase()})` : `an audio file (${audio!.ext.toUpperCase()})`
}

/**
 * Why the face of an audio-to-video Lip Sync run (LTX 2.5 Fast, decided
 * 2026-11-24) is refused before anything is held, or undefined to let the run
 * go on. The ONE check the Lip Sync route's measuring step and the workflow
 * run's stamp both run. Read by content, never the link's name: the existing
 * header probe (`probeImageSource`) and the first bytes it read, by the
 * first-bytes sniff (`sniffInputType`).
 *
 * It refuses ONLY what it positively read and is not a picture the run can
 * use: a video or an audio file, a file that is no image at all (a PDF, a web
 * page, an empty body), or a still image the start-frame step cannot read
 * (BMP; a HEIC it converts, so it passes). A portrait it could NOT read — the fetch failed, timed out, or
 * the host refused it — is never refused here: the run goes on as before, and
 * the provider fetches it itself.
 */
export async function drivingAudioFaceRefusal(provider: string, imageUrl: unknown): Promise<{ readonly code: string; readonly message: string } | undefined> {
  const label = MODEL_CATALOG[provider]?.label ?? provider
  const takes = `a still image (${FACE_FORMATS})`
  if (typeof imageUrl !== "string" || !safeUrlSchema.safeParse(imageUrl).success) {
    return { code: "validation_error", message: `${label}: the portrait must be an http(s) link that does not point to localhost or a private network. Nothing was charged.` }
  }
  const probe = await probeImageSource(imageUrl)
  // Not read (a failed or slow fetch, a host that refused it): never refused on what we could not see.
  if (!probe.fetched || !probe.head) return undefined
  if (probe.head.length === 0) {
    return { code: "image_unreadable", message: `${label} takes ${takes} as the portrait; this link answered with an empty file. Nothing was charged.` }
  }
  const image = sniffInputType(probe.head, "image")
  if (image && UNDECODED_IMAGE_EXTS.has(image.ext)) {
    return { code: "image_unreadable", message: `${label} takes ${takes} as the portrait; this one is a ${image.ext.toUpperCase()} image, which it cannot read. Convert it to one of those. Nothing was charged.` }
  }
  // An SVG has no binary signature: its text says so (the existing sniff, `looksLikeSvg`, past a BOM, an XML
  // declaration, a doctype and comments). One with no size of its own still runs: the start-frame step draws it.
  if (image || probe.size || looksLikeSvg(probe.head)) return undefined
  const media = mediaKindOf(probe.head)
  // An ISO-BMFF file its brands do not make certainly audio or video (an image brand anywhere, or brands that
  // say neither) is let through, as a file it could not read is.
  if (media === undefined && isoBrandsOf(probe.head)) return undefined
  if (media) return { code: "lip_sync_image_required", message: `${label} takes ${takes} as the portrait; this one is ${media}. Nothing was charged.` }
  return { code: "image_unreadable", message: `${label} could not read the portrait as an image. It takes ${takes}. Nothing was charged.` }
}
