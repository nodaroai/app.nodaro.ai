// backend/src/providers/video/video-overlay-images.ts
/**
 * Video Overlay — fetching and gating the layer images (spec §4.2 step 5).
 * Every refusal is a DeterministicJobError (a pure function of the inputs:
 * the worker fails the row once, refunds, and runs no retry) whose message is
 * layer-indexed and carries no URL, HTTP status or vendor text — the node
 * card, the MCP result and the community smoke render it verbatim.
 */
import { open, stat } from "node:fs/promises"
import sharp from "sharp"
import { VIDEO_OVERLAY_MAX_TOTAL_LAYER_BYTES, videoOverlayLayerLabel, type VideoOverlayWarning } from "@nodaro/shared"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { downloadFile } from "./ffmpeg-utils.js"
import { OVERLAY_MAX_DOWNLOAD_BYTES, OVERLAY_MAX_LAYER_EDGE, OVERLAY_MAX_TOTAL_LAYER_PIXELS } from "../image/overlay-contract.js"
import { displayDims } from "../image/collage.js"
import { isSvgBuffer } from "../image/svg-sniff.js"

/** Longest edge a layer SOURCE may have — bounds sharp's one-time decode. */
export const VIDEO_OVERLAY_MAX_IMAGE_EDGE = OVERLAY_MAX_LAYER_EDGE
const ACCEPTED_FORMATS: ReadonlySet<string> = new Set(["png", "jpeg", "webp"])
const MB = 1024 * 1024

export interface VideoOverlayLayerRef {
  /** 0-based index in the request's layers[]. */
  readonly layer: number
  readonly slot?: number
}

/**
 * Download one layer image under the per-file byte cap. ANY failure — a 4xx /
 * 5xx, a safeFetch refusal, DNS, a timeout — is "could not be fetched"; the
 * cap is "larger than 25 MB". The original error goes to the log only.
 */
export async function fetchVideoOverlayImage(url: string, dest: string, ref: VideoOverlayLayerRef): Promise<void> {
  try {
    await downloadFile(url, dest, { maxBytes: OVERLAY_MAX_DOWNLOAD_BYTES })
  } catch (err) {
    const label = videoOverlayLayerLabel(ref)
    const raw = err instanceof Error ? err.message : String(err)
    console.warn(`[video-overlay] ${label} image fetch failed: ${raw}`)
    if (raw.startsWith("Download exceeds")) {
      throw new DeterministicJobError(`${label}: image is larger than ${OVERLAY_MAX_DOWNLOAD_BYTES / MB} MB`, { cause: err })
    }
    throw new DeterministicJobError(`${label}: image could not be fetched`, { cause: err })
  }
}

export interface VideoOverlayImageFacts {
  readonly bytes: number
  readonly svg: boolean
  /** sharp could read the header. */
  readonly decodable: boolean
  readonly format?: string
  readonly width?: number
  readonly height?: number
  readonly orientation?: number
  readonly pages?: number
}

async function readHead(path: string, bytes: number): Promise<Buffer> {
  const fh = await open(path, "r")
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/** Size, an SVG sniff of the first 4 KB (sharp would silently rasterise SVG, so it is caught first), and sharp's header metadata — no pixel decode. */
export async function inspectVideoOverlayImage(path: string): Promise<VideoOverlayImageFacts> {
  const { size } = await stat(path)
  if (isSvgBuffer(await readHead(path, 4096))) return { bytes: size, svg: true, decodable: false }
  try {
    const m = await sharp(path).metadata()
    return { bytes: size, svg: false, decodable: true, format: m.format, width: m.width, height: m.height, orientation: m.orientation, pages: m.pages }
  } catch {
    return { bytes: size, svg: false, decodable: false }
  }
}

export interface VideoOverlayImageTotals {
  readonly bytes: number
  readonly pixels: number
}

/**
 * Spec §4.2 steps 5.1 (Σ bytes) and 5.2–5.6, in order. Returns the image's
 * DISPLAY aspect (EXIF orientations 5–8 swap the axes — the pre-fit's
 * `.rotate()` applies them physically), an `animated_first_frame` warning for
 * a multi-page image (the pre-fit decodes page 0), and the new running totals.
 */
export function gateVideoOverlayImage(
  facts: VideoOverlayImageFacts,
  totals: VideoOverlayImageTotals,
  ref: VideoOverlayLayerRef,
): { aspect: number; warning?: VideoOverlayWarning; totals: VideoOverlayImageTotals } {
  const label = videoOverlayLayerLabel(ref)
  const bytes = totals.bytes + facts.bytes
  if (bytes > VIDEO_OVERLAY_MAX_TOTAL_LAYER_BYTES) {
    throw new DeterministicJobError(`Layers total more than ${VIDEO_OVERLAY_MAX_TOTAL_LAYER_BYTES / MB} MB`)
  }
  if (facts.svg) {
    throw new DeterministicJobError(`${label}: SVG images are not supported by Video Overlay yet — rasterise it with Image Overlay first`)
  }
  if (!facts.decodable || !facts.format || !ACCEPTED_FORMATS.has(facts.format) || !facts.width || !facts.height) {
    throw new DeterministicJobError(`${label}: not an image (PNG, JPEG or WebP)`)
  }
  const dims = displayDims(facts.width, facts.height, facts.orientation)
  if (Math.max(dims.w, dims.h) > VIDEO_OVERLAY_MAX_IMAGE_EDGE) {
    throw new DeterministicJobError(`${label}: image exceeds ${VIDEO_OVERLAY_MAX_IMAGE_EDGE} px`)
  }
  const pixels = totals.pixels + dims.w * dims.h
  if (pixels > OVERLAY_MAX_TOTAL_LAYER_PIXELS) {
    throw new DeterministicJobError(`Layers total more than ${OVERLAY_MAX_TOTAL_LAYER_PIXELS / 1_000_000} megapixels`)
  }
  const warning: VideoOverlayWarning | undefined =
    facts.pages !== undefined && facts.pages > 1
      ? { layer: ref.layer, ...(ref.slot !== undefined ? { slot: ref.slot } : {}), code: "animated_first_frame", detail: `animated image (${facts.pages} frames): its first frame is used` }
      : undefined
  return { aspect: dims.w / dims.h, ...(warning ? { warning } : {}), totals: { bytes, pixels } }
}
