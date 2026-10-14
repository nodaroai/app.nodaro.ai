/**
 * START/END FRAME FIT — the pixels half.
 *
 * `computeFrameFitPlan` (@nodaro/shared) decides WHAT a frame should become from
 * the measured output canvases; this module makes it so: download, reshape with
 * sharp, upload, hand back the new URL. Called from every video dispatch path
 * (see `video-frame-fit-totality.test.ts`), never from a route.
 *
 * Why it exists: a start frame that is not already the model's own canvas gets
 * reshaped by the provider instead, and Seedance 2.5 does it one frame IN — the
 * opening frame is the user's image, then the rest of the clip is ~2% taller.
 * Five of ten production runs with a 940x1672 image snapped; three of three with
 * the same image resized to 720x1280 did not.
 *
 * Three promises this makes to its callers:
 *   1. BEST EFFORT. Any failure (download, decode, upload) returns the ORIGINAL
 *      urls and logs — a frame we could not reshape is still a frame the model
 *      can use, and this must never be the reason a paid render dies.
 *   2. NO-OP IS FREE. A frame already at its canvas, or a model/resolution we
 *      have never measured, costs one metadata read and returns the same url.
 *   3. DETERMINISTIC KEYS. The object key is a hash of (source url, target,
 *      crop), so a retry, a re-run and every clip of a chained sequence reuse
 *      one object instead of filling the bucket with copies.
 */
// `fetch-own-media` and `storage` are imported LAZILY inside the fit below:
// both pull `lib/config.ts`, and a static import here would drag Supabase's
// required env into the import graph of everything that dispatches a video
// (the router, the plugin toolkit) — which breaks their unit tests and makes a
// missing key a boot-time failure for a path that may never fit a frame.
import { createHash } from "node:crypto"
import sharp from "sharp"
import {
  computeFrameFitPlan,
  resolveOutputCanvas,
  resolveFrameFitAspect,
  DEFAULT_FRAME_FIT,
  type FrameFit,
  type FrameFitPlan,
} from "@nodaro/shared/video"

/** Where reshaped frames live. Same `tmp/` prefix the provider-input converter
 *  uses, so the existing sweeper reclaims them. */
const FRAME_FIT_PREFIX = "tmp/frame-fit/"

/** Frames larger than this are left alone — the provider's own cap applies. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024

/** What we did to one frame, for logs and for the job's output_data. */
export interface FrameFitApplied {
  readonly role: "start" | "end"
  readonly from: { readonly width: number; readonly height: number }
  readonly to: { readonly width: number; readonly height: number }
  readonly cropped: boolean
  readonly reason: FrameFitPlan["reason"]
  readonly url: string
}

export interface PrepareVideoFramesArgs {
  readonly provider: string | undefined
  readonly resolution?: string
  readonly aspectRatio?: string
  readonly imageUrl?: string
  readonly endFrameUrl?: string
  /** Absent means the platform default (`resolution`). */
  readonly fit?: FrameFit
}

export interface PrepareVideoFramesResult {
  readonly imageUrl?: string
  readonly endFrameUrl?: string
  readonly applied: readonly FrameFitApplied[]
}

/** In-process memo: the same source+target inside one worker uploads once. */
const uploadedByKey = new Map<string, string>()

// The two config-bearing modules, imported once and REMEMBERED. Memoizing the
// promise (rather than calling `import()` per frame) matters: the start and end
// frames are fitted concurrently, and two in-flight imports of the same module
// is a race — one of them can resolve against a different module instance than
// the other, which is exactly how the end frame silently lost its mock (and
// would, in production, pay for the module init twice).
let mediaModulePromise: Promise<typeof import("./fetch-own-media.js")> | undefined
let storageModulePromise: Promise<typeof import("./storage.js")> | undefined
const mediaModule = () => (mediaModulePromise ??= import("./fetch-own-media.js"))
const storageModule = () => (storageModulePromise ??= import("./storage.js"))

function objectKey(sourceUrl: string, plan: FrameFitPlan, ext: string): string {
  const hash = createHash("sha256")
    .update(sourceUrl)
    .update(`|${plan.width}x${plan.height}`)
    .update(plan.crop ? `|crop:${plan.crop.left},${plan.crop.top},${plan.crop.width},${plan.crop.height}` : "|nocrop")
    .digest("hex")
    .slice(0, 32)
  return `${FRAME_FIT_PREFIX}${hash}.${ext}`
}

/**
 * Reshape one frame. Returns the original url when there is nothing to do or
 * anything goes wrong.
 */
async function fitOneFrame(
  role: "start" | "end",
  url: string,
  args: PrepareVideoFramesArgs,
): Promise<{ url: string; applied?: FrameFitApplied }> {
  const fit = args.fit ?? DEFAULT_FRAME_FIT
  if (fit === "original") return { url }

  try {
    const { fetchOwnMedia } = await mediaModule()
    const res = await fetchOwnMedia(url)
    if (!res.ok) {
      console.warn(`[frame-fit] ${role} frame: download ${res.status} — sending the original`)
      return { url }
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > MAX_SOURCE_BYTES) {
      console.warn(`[frame-fit] ${role} frame: ${(buffer.length / 1e6).toFixed(1)}MB is over the fit cap — sending the original`)
      return { url }
    }

    const meta = await sharp(buffer).metadata()
    // `rotate()` below bakes EXIF orientation in, which swaps the axes for a
    // sideways-tagged photo — so plan against the ORIENTED size.
    const swapped = typeof meta.orientation === "number" && meta.orientation >= 5
    const sourceWidth = (swapped ? meta.height : meta.width) ?? 0
    const sourceHeight = (swapped ? meta.width : meta.height) ?? 0
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) return { url }

    const plan = computeFrameFitPlan({
      fit,
      provider: args.provider,
      resolution: args.resolution,
      aspect: args.aspectRatio,
      sourceWidth,
      sourceHeight,
    })
    if (!plan) return { url }

    const isPng = (meta.format ?? "") === "png"
    const ext = isPng ? "png" : "jpg"
    const contentType = isPng ? "image/png" : "image/jpeg"
    const key = objectKey(url, plan, ext)

    const memo = uploadedByKey.get(key)
    if (memo) {
      return {
        url: memo,
        applied: {
          role,
          from: { width: sourceWidth, height: sourceHeight },
          to: { width: plan.width, height: plan.height },
          cropped: Boolean(plan.crop),
          reason: plan.reason,
          url: memo,
        },
      }
    }

    let pipeline = sharp(buffer).rotate()
    if (plan.crop) pipeline = pipeline.extract(plan.crop)
    // `fit: "fill"` is the point: the frame is STRETCHED to the canvas. Any
    // ratio gap wide enough to notice was already cropped away above, so what
    // remains is the sub-percent correction that stops the provider doing its
    // own (visibly worse) reshape.
    pipeline = pipeline.resize(plan.width, plan.height, { fit: "fill", kernel: "lanczos3" })
    const out = isPng
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
      : await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer()

    const { uploadBufferToR2 } = await storageModule()
    const uploaded = await uploadBufferToR2(out, key, contentType)
    uploadedByKey.set(key, uploaded)
    console.log(
      `[frame-fit] ${role} frame ${sourceWidth}x${sourceHeight} → ${plan.width}x${plan.height}` +
        `${plan.crop ? " (cropped to ratio first)" : ""} for ${args.provider ?? "?"} ${args.resolution ?? "?"} ${args.aspectRatio ?? "adaptive"}`,
    )
    return {
      url: uploaded,
      applied: {
        role,
        from: { width: sourceWidth, height: sourceHeight },
        to: { width: plan.width, height: plan.height },
        cropped: Boolean(plan.crop),
        reason: plan.reason,
        url: uploaded,
      },
    }
  } catch (err) {
    console.warn(`[frame-fit] ${role} frame: ${err instanceof Error ? err.message : String(err)} — sending the original`)
    return { url }
  }
}

/**
 * Fit the start and end frames of one video request. Both frames get the same
 * treatment; either may be absent.
 */
export async function prepareVideoFrames(args: PrepareVideoFramesArgs): Promise<PrepareVideoFramesResult> {
  if (!args.imageUrl && !args.endFrameUrl) return { applied: [] }

  const [start, end] = await Promise.all([
    args.imageUrl ? fitOneFrame("start", args.imageUrl, args) : undefined,
    args.endFrameUrl ? fitOneFrame("end", args.endFrameUrl, args) : undefined,
  ])

  const applied: FrameFitApplied[] = []
  if (start?.applied) applied.push(start.applied)
  if (end?.applied) applied.push(end.applied)

  return {
    ...(args.imageUrl ? { imageUrl: start?.url ?? args.imageUrl } : {}),
    ...(args.endFrameUrl ? { endFrameUrl: end?.url ?? args.endFrameUrl } : {}),
    applied,
  }
}

/**
 * Does this request have a measured canvas to aim at? Used by the config panel
 * endpoint and by tests; `prepareVideoFrames` answers the same question
 * internally through `computeFrameFitPlan`.
 */
export function hasMeasuredCanvas(args: {
  provider: string | undefined
  resolution: string | undefined
  aspectRatio: string | undefined
  sourceWidth: number
  sourceHeight: number
}): boolean {
  const aspect = resolveFrameFitAspect({
    provider: args.provider,
    requestedAspect: args.aspectRatio,
    sourceWidth: args.sourceWidth,
    sourceHeight: args.sourceHeight,
  })
  return resolveOutputCanvas(args.provider, args.resolution, aspect) !== undefined
}

/** Exported for the tmp sweeper and tests. */
export { FRAME_FIT_PREFIX }
