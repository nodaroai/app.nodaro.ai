/**
 * Image Overlay provider — places one or more images (a logo, a badge, a
 * cut-out from `remove-background`, a QR code…) ON TOP of a base image at an
 * exact position and size, locally with sharp. Deterministic, no AI, no ffmpeg.
 *
 * Coordinates are PERCENTAGES of the base image, not pixels: the base's size
 * is decided upstream (a 2K generation today, a 4K one tomorrow, a 1128×191
 * LinkedIn strip someone uploaded), and "12% wide, 4% in from the right" keeps
 * meaning the same thing on all of them where "x = 1834px" does not. The
 * config panel shows the pixel equivalent next to each field once a base is
 * connected; this module is the only place that turns the % into px.
 *
 * Pipeline: download base + layers → probe the base → for each layer: resolve
 * its pixel box (pure, tested) → rasterise/resize the layer into that box
 * (SVG at the TARGET size, so logos stay crisp) → apply rounded corners,
 * opacity, rotation, drop shadow → clip to the base bounds (sharp only
 * composites what fits) → one `sharp(base).composite([...])` call.
 *
 * Every pure step is exported and unit-tested without I/O; `createImageOverlay`
 * is the worker's entry point and returns a local file path exactly like
 * `createImageCollage` (the caller uploads and cleans up).
 */

import { join } from "node:path"
import { readFile } from "node:fs/promises"
import sharp from "sharp"
import { cleanupWorkDir, createWorkDir, downloadFile, withFfmpegSlot } from "../video/ffmpeg-utils.js"
import { settledWithLimit } from "../../lib/settled-with-limit.js"
import { probeImageSize } from "./collage.js"
import { OVERLAY_MAX_LAYERS, OVERLAY_HANDLE_IDS, OVERLAY_MAX_LAYER_EDGE, OVERLAY_PIXEL_LIMIT } from "./overlay-contract.js"
import {
  OVERLAY_ANCHORS,
  type OverlayAnchor,
  OVERLAY_LAYER_KINDS,
  overlayTextStyleSchema,
  overlayQrStyleSchema,
  overlayShapeStyleSchema,
  overlayImageEffectsSchema,
  type OverlayLayerKind,
  type OverlayTextStyle,
  type OverlayQrStyle,
  type OverlayShapeStyle,
  type OverlayImageEffects,
  overlayPlatformById,
  OVERLAY_MAX_VARIANTS,
} from "@nodaro/shared"
import { renderTextLayer } from "./overlay-text.js"
import { renderQrLayer, renderShapeLayer } from "./overlay-shapes.js"
import { applyCircleMask, applyFeather, buildStroke, buildGlow } from "./overlay-effects.js"

export { OVERLAY_MAX_LAYERS, OVERLAY_HANDLE_IDS }

const DOWNLOAD_CONCURRENCY = 4
/** Hard cap on the rasterised size of any single layer (px on the longest edge). */
const MAX_LAYER_EDGE = OVERLAY_MAX_LAYER_EDGE
/** Hard cap on the output canvas edge — matches the route's Zod bound. */
const MAX_CANVAS_EDGE = 8192
/** Explicit decode ceiling for every image we did not create ourselves (sharp's
 *  default is ~268 MP; a 16k² layer would otherwise decode to ~1 GB). */
const PIXEL_LIMIT = OVERLAY_PIXEL_LIMIT
/** Sum of every layer box (px) one job may rasterise — 12 full-bleed 8K layers
 *  would otherwise hold ~3 GB of PNG buffers for one flat-priced run. */
const MAX_TOTAL_LAYER_PIXELS = 400_000_000
/** Per-file download cap — matches the upload route's image limit. */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
/** The sharp phase runs inside the shared ffmpeg slot; a runaway render must
 *  not hold that slot forever. */
const RENDER_TIMEOUT_MS = 180_000

const img = (input: Buffer, opts: sharp.SharpOptions = {}): sharp.Sharp => sharp(input, { limitInputPixels: PIXEL_LIMIT, ...opts })

// The anchors live in @nodaro/shared (one vocabulary for route Zod, canvas,
// SDK and CLI); re-exported here so the compositor's importers are unchanged.
export { OVERLAY_ANCHORS }
export type { OverlayAnchor }

export const OVERLAY_BLENDS = ["over", "multiply", "screen"] as const
export type OverlayBlend = (typeof OVERLAY_BLENDS)[number]

export const OVERLAY_FITS = ["contain", "cover", "stretch"] as const
export type OverlayFit = (typeof OVERLAY_FITS)[number]

export interface OverlayShadow {
  /** Gaussian blur sigma, px on the base. */
  readonly blur: number
  readonly offsetX: number
  readonly offsetY: number
  /** "#RRGGBB" */
  readonly color: string
  readonly opacity: number
}

export interface OverlayLayerParams {
  /** What the layer is. Absent = "image" (a wired picture). */
  readonly kind?: OverlayLayerKind
  /** The wired picture — required for kind "image", ignored otherwise. */
  readonly imageUrl?: string
  readonly text?: OverlayTextStyle
  readonly qr?: OverlayQrStyle
  readonly shape?: OverlayShapeStyle
  /** Finishing for image layers (circle mask, feather, stroke, glow). */
  readonly effects?: OverlayImageEffects
  readonly anchor: OverlayAnchor
  /** Offset from the anchor, % of base WIDTH (−100..100). Negative moves inward from a right anchor. */
  readonly x: number
  /** Offset from the anchor, % of base HEIGHT (−100..100). */
  readonly y: number
  /** Layer width, % of base width (1..100). */
  readonly width: number
  /** Optional layer height, % of base height. Absent = keep the layer's aspect. */
  readonly height?: number
  readonly opacity: number
  /** Degrees, −180..180, around the layer's own centre. */
  readonly rotation: number
  readonly blend: OverlayBlend
  /** How the source fills width×height when BOTH are given. */
  readonly fit: OverlayFit
  readonly shadow?: OverlayShadow
  /** Corner radius in px on the base, applied to the layer before compositing. */
  readonly roundedCorners?: number
  /** Render order — higher draws on top; absent = wire order (layer 1 lowest). */
  readonly zIndex?: number
}

export interface OverlayCanvasParams {
  readonly width: number
  readonly height: number
  /** "#RRGGBB" shown where the base does not cover the canvas. */
  readonly backgroundColor: string
}

export interface ImageOverlayParams {
  readonly imageUrl: string
  readonly layers: readonly OverlayLayerParams[]
  /** Optional output size ≠ base size. The base is placed with `baseFit`. */
  readonly canvas?: OverlayCanvasParams
  readonly baseFit?: "contain" | "cover"
  readonly outputFormat?: "png" | "jpg" | "webp"
  /** Extra platform renders (OVERLAY_PLATFORMS ids): the same composite fitted into each platform's canvas. */
  readonly variants?: readonly string[]
  /** The mask the node also emits: the layers' silhouette, a ring AROUND it
   *  (`maskSpread` px — the region an AI finish may repaint), everything
   *  OUTSIDE it, or none. */
  readonly maskMode?: "none" | "layers" | "around" | "outside"
  /** Text wired into the node's QR link handle — fills every QR layer whose style says `fromInput`. */
  readonly qrText?: string
  readonly maskSpread?: number
}

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback)

/**
 * Tolerant normalisation of a layer read from a stored job row (the worker is
 * reached from `input_data`, not only from the validated route): defaults
 * every missing field and clamps every number into the route's own bounds so
 * a malformed value degrades to a sane render instead of throwing.
 */
export function resolveLayer(raw: Partial<OverlayLayerParams>): OverlayLayerParams {
  const kind: OverlayLayerKind = (OVERLAY_LAYER_KINDS as readonly string[]).includes(String(raw.kind)) ? (raw.kind as OverlayLayerKind) : "image"
  // Generated kinds carry a style object validated by the SAME schema the
  // route uses — a malformed one is a clear failure, never a silent skip.
  const text = kind === "text" ? parseStyle(overlayTextStyleSchema, raw.text, "text") : undefined
  const qr = kind === "qr" ? parseStyle(overlayQrStyleSchema, raw.qr, "qr") : undefined
  if (qr && !qr.text.trim()) {
    throw new Error(qr.fromInput
      ? "A QR layer takes its link from the node's QR link handle, but nothing is connected there"
      : "A QR layer has no link — type one, or switch it to the QR link handle")
  }
  const shape = kind === "shape" ? parseStyle(overlayShapeStyleSchema, raw.shape, "shape") : undefined
  const effects = kind === "image" && raw.effects ? overlayImageEffectsSchema.safeParse(raw.effects).data : undefined
  const anchor = (OVERLAY_ANCHORS as readonly string[]).includes(String(raw.anchor)) ? (raw.anchor as OverlayAnchor) : "center"
  const blend = (OVERLAY_BLENDS as readonly string[]).includes(String(raw.blend)) ? (raw.blend as OverlayBlend) : "over"
  const fit = (OVERLAY_FITS as readonly string[]).includes(String(raw.fit)) ? (raw.fit as OverlayFit) : "contain"
  const height = raw.height === undefined || raw.height === null ? undefined : clamp(num(raw.height, 25), 1, 100)
  const shadow = raw.shadow
    ? {
        blur: clamp(num(raw.shadow.blur, 20), 0, 200),
        offsetX: clamp(num(raw.shadow.offsetX, 0), -200, 200),
        offsetY: clamp(num(raw.shadow.offsetY, 0), -200, 200),
        color: /^#?[0-9a-fA-F]{6}$/.test(String(raw.shadow.color ?? "")) ? String(raw.shadow.color).replace(/^#?/, "#") : "#000000",
        opacity: clamp(num(raw.shadow.opacity, 0.5), 0, 1),
      }
    : undefined
  return {
    kind,
    imageUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : undefined,
    text,
    qr,
    shape,
    effects,
    anchor,
    x: clamp(num(raw.x, 0), -100, 100),
    y: clamp(num(raw.y, 0), -100, 100),
    width: clamp(num(raw.width, 25), 1, 100),
    height,
    opacity: clamp(num(raw.opacity, 1), 0, 1),
    rotation: clamp(num(raw.rotation, 0), -180, 180),
    blend,
    fit,
    shadow,
    roundedCorners: raw.roundedCorners === undefined ? undefined : clamp(Math.round(num(raw.roundedCorners, 0)), 0, 500),
    zIndex: raw.zIndex === undefined || raw.zIndex === null ? undefined : clamp(Math.round(num(raw.zIndex, 0)), 0, 100),
  }
}

function parseStyle<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }, raw: unknown, what: string): T {
  const r = schema.safeParse(raw ?? {})
  if (!r.success || r.data === undefined) throw new Error(`Image Overlay: the ${what} layer has an invalid or missing ${what} style`)
  return r.data
}

/** Composite order: explicit zIndex wins, ties keep wire order. Mirrors the
 *  canvas preview's overlayRenderOrder (frontend lib/image-overlay-geometry.ts). */
export function overlayRenderOrder(layers: ReadonlyArray<{ zIndex?: number }>): number[] {
  return layers
    .map((l, i) => ({ i, z: typeof l.zIndex === "number" && Number.isFinite(l.zIndex) ? l.zIndex : i }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((e) => e.i)
}

/**
 * Where a layer lands on the base, in whole pixels, BEFORE rotation.
 *
 * `layerAspect` is the source's width/height (used when `height` is absent).
 * Anchor semantics: the anchor names a point on the base AND the matching
 * corner/edge/centre of the layer box; `x`/`y` then shift the box from there.
 * So `bottom-right` with `x: -4, y: -6` is "4% in from the right, 6% up from
 * the bottom" — the watermark everyone wants — and `center` with zeros is
 * dead centre.
 */
export function resolveOverlayGeometry(base: { w: number; h: number }, layer: OverlayLayerParams, layerAspect: number): Box {
  const aspect = layerAspect > 0 && Number.isFinite(layerAspect) ? layerAspect : 1
  const rawWidth = Math.max(1, Math.round((base.w * layer.width) / 100))
  const rawHeight = Math.max(1, layer.height !== undefined ? Math.round((base.h * layer.height) / 100) : Math.round(rawWidth / aspect))
  // Never larger than the raster cap on either axis — scaled proportionally,
  // so the geometry and the bitmap always agree (the canvas twin does the same).
  const shrink = Math.min(1, MAX_LAYER_EDGE / Math.max(rawWidth, rawHeight))
  const width = Math.max(1, Math.round(rawWidth * shrink))
  const height = Math.max(1, Math.round(rawHeight * shrink))

  const [vAnchor, hAnchor] = splitAnchor(layer.anchor)
  const ax = hAnchor === "left" ? 0 : hAnchor === "center" ? base.w / 2 : base.w
  const ay = vAnchor === "top" ? 0 : vAnchor === "center" ? base.h / 2 : base.h
  const dx = (base.w * layer.x) / 100
  const dy = (base.h * layer.y) / 100
  const left = hAnchor === "left" ? ax + dx : hAnchor === "center" ? ax + dx - width / 2 : ax + dx - width
  const top = vAnchor === "top" ? ay + dy : vAnchor === "center" ? ay + dy - height / 2 : ay + dy - height
  return { left: Math.round(left), top: Math.round(top), width, height }
}

function splitAnchor(anchor: OverlayAnchor): ["top" | "center" | "bottom", "left" | "center" | "right"] {
  switch (anchor) {
    case "top-left": return ["top", "left"]
    case "top": return ["top", "center"]
    case "top-right": return ["top", "right"]
    case "left": return ["center", "left"]
    case "center": return ["center", "center"]
    case "right": return ["center", "right"]
    case "bottom-left": return ["bottom", "left"]
    case "bottom": return ["bottom", "center"]
    case "bottom-right": return ["bottom", "right"]
  }
}

export interface ClippedPlacement {
  /** Where the (cropped) layer goes on the base — never negative. */
  readonly left: number
  readonly top: number
  /** The region of the layer that is actually visible, in layer pixels. */
  readonly cropLeft: number
  readonly cropTop: number
  readonly cropWidth: number
  readonly cropHeight: number
}

/**
 * sharp refuses an overlay that is not fully inside the base ("Image to
 * composite must have same dimensions or smaller" / negative offsets). A logo
 * that intentionally bleeds off the edge is a legitimate design, so instead of
 * failing we crop the layer to its visible region and pin the offset. A layer
 * with nothing visible returns null and is skipped.
 */
export function clipToBase(box: Box, base: { w: number; h: number }): ClippedPlacement | null {
  const x0 = Math.max(0, box.left)
  const y0 = Math.max(0, box.top)
  const x1 = Math.min(base.w, box.left + box.width)
  const y1 = Math.min(base.h, box.top + box.height)
  if (x1 <= x0 || y1 <= y0) return null
  return {
    left: x0,
    top: y0,
    cropLeft: x0 - box.left,
    cropTop: y0 - box.top,
    cropWidth: x1 - x0,
    cropHeight: y1 - y0,
  }
}

export interface CanvasPlacement {
  /** Output size. */
  readonly w: number
  readonly h: number
  /** Where the (resized) base sits on the output; may be negative for `cover`. */
  readonly left: number
  readonly top: number
  /** The base's size after fitting. */
  readonly baseW: number
  readonly baseH: number
}

/** Without a canvas the base IS the output; with one, fit the base into it. */
export function resolveCanvasPlacement(
  base: { w: number; h: number },
  canvas: OverlayCanvasParams | undefined,
  baseFit: "contain" | "cover",
): CanvasPlacement {
  if (!canvas) return { w: base.w, h: base.h, left: 0, top: 0, baseW: base.w, baseH: base.h }
  const w = clamp(Math.round(canvas.width), 16, MAX_CANVAS_EDGE)
  const h = clamp(Math.round(canvas.height), 16, MAX_CANVAS_EDGE)
  const scale = baseFit === "cover" ? Math.max(w / base.w, h / base.h) : Math.min(w / base.w, h / base.h)
  const baseW = Math.max(1, Math.round(base.w * scale))
  const baseH = Math.max(1, Math.round(base.h * scale))
  return { w, h, left: Math.round((w - baseW) / 2), top: Math.round((h - baseH) / 2), baseW, baseH }
}

/** Pixel size AFTER EXIF auto-orientation — what `.rotate()` will render. */
export async function orientedSize(buffer: Buffer): Promise<{ w: number; h: number }> {
  const meta = await img(buffer).metadata()
  const w = meta.autoOrient?.width ?? meta.width ?? 1
  const h = meta.autoOrient?.height ?? meta.height ?? 1
  return { w: Math.max(1, w), h: Math.max(1, h) }
}

/**
 * Tolerant twin of resolveLayer for the optional canvas: a workflow-JSON row
 * may carry `{ width, height }` with no colour, or a non-number — the render
 * must degrade (defaults, clamps) rather than throw a raw TypeError.
 */
export function resolveCanvas(raw: Partial<OverlayCanvasParams> | null | undefined): OverlayCanvasParams | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const color = String(raw.backgroundColor ?? "")
  return {
    width: clamp(Math.round(num(raw.width, 1024)), 16, MAX_CANVAS_EDGE),
    height: clamp(Math.round(num(raw.height, 1024)), 16, MAX_CANVAS_EDGE),
    backgroundColor: /^#?[0-9a-fA-F]{6}$/.test(color) ? color.replace(/^#?/, "#") : "#000000",
  }
}

function toSharpColor(hex: string, alpha = 1): { r: number; g: number; b: number; alpha: number } {
  const raw = hex.replace(/^#/, "")
  const ok = /^[0-9a-fA-F]{6}$/.test(raw) ? raw : "000000"
  return { r: parseInt(ok.slice(0, 2), 16), g: parseInt(ok.slice(2, 4), 16), b: parseInt(ok.slice(4, 6), 16), alpha }
}

function isSvg(buf: Buffer): boolean {
  // 4 KB, not 512 B: a licence comment or a long XML preamble before <svg>
  // must not demote a vector logo to the raster path (blurry — the exact bug
  // this node exists to avoid).
  const head = buf.subarray(0, 4096).toString("utf8").trimStart()
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")) || (head.startsWith("<!--") && head.includes("<svg"))
}

/**
 * Rasterise/resize one layer into its pixel box. SVGs are rendered by librsvg
 * at a density that makes the TARGET width crisp — rendering a 128px viewBox
 * and scaling it up is exactly the blurry-logo bug this node exists to avoid.
 */
async function rasteriseLayer(buffer: Buffer, box: Box, fit: OverlayFit, hasExplicitHeight: boolean): Promise<Buffer> {
  const targetW = clamp(box.width, 1, MAX_LAYER_EDGE)
  const targetH = clamp(box.height, 1, MAX_LAYER_EDGE)
  let src: sharp.Sharp
  if (isSvg(buffer)) {
    const meta = await img(buffer).metadata()
    const svgW = meta.width && meta.width > 0 ? meta.width : 128
    const svgH = meta.height && meta.height > 0 ? meta.height : 128
    // librsvg renders at 72 dpi by default; scale the density so the natural
    // render is at least the target size on BOTH axes, then resize down/none.
    const density = clamp(Math.ceil(72 * Math.max(targetW / svgW, targetH / svgH)), 72, 20000)
    src = img(buffer, { density })
  } else {
    src = img(buffer)
  }
  const resizeFit: keyof sharp.FitEnum = !hasExplicitHeight ? "fill" : fit === "cover" ? "cover" : fit === "stretch" ? "fill" : "contain"
  return src
    .rotate() // honour EXIF orientation like the rest of the platform
    .resize(targetW, targetH, { fit: resizeFit, background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: false })
    .ensureAlpha()
    .png()
    .toBuffer()
}

async function applyRoundedCorners(layerPng: Buffer, radius: number): Promise<Buffer> {
  const { width = 1, height = 1 } = await img(layerPng).metadata()
  const r = clamp(radius, 0, Math.floor(Math.min(width, height) / 2))
  if (r <= 0) return layerPng
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${r}" ry="${r}" fill="#fff"/></svg>`)
  return img(layerPng).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer()
}

async function applyOpacity(layerPng: Buffer, opacity: number): Promise<Buffer> {
  if (opacity >= 1) return layerPng
  const { width = 1, height = 1 } = await img(layerPng).metadata()
  const veil = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: opacity } } }).png().toBuffer()
  return img(layerPng).composite([{ input: veil, blend: "dest-in" }]).png().toBuffer()
}

/** A tinted, blurred silhouette of the layer — composited under it at an offset. */
async function buildShadow(layerPng: Buffer, shadow: OverlayShadow): Promise<Buffer> {
  const { width = 1, height = 1 } = await img(layerPng).metadata()
  const silhouette = await sharp({ create: { width, height, channels: 4, background: toSharpColor(shadow.color, 1) } })
    .png()
    .composite([{ input: layerPng, blend: "dest-in" }])
    .png()
    .toBuffer()
  const pad = Math.ceil(shadow.blur * 3)
  const padded = img(silhouette).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  const blurred = shadow.blur > 0 ? padded.blur(shadow.blur) : padded
  const blurredPng = await blurred.png().toBuffer()
  return applyOpacity(blurredPng, shadow.opacity)
}

export interface PreparedLayer {
  /** Raw bytes of the source image (PNG/JPEG/WebP/SVG…) — image kind only. */
  readonly buffer?: Buffer
  readonly layer: OverlayLayerParams
}

/**
 * Composite `layers` onto `basePng` (any sharp-readable buffer). Pure with
 * respect to I/O: no network, no files. Returns PNG bytes. The worker's entry
 * point wraps this with downloads and the optional canvas.
 */
export async function renderOverlayLayers(baseBuffer: Buffer, layers: readonly PreparedLayer[]): Promise<Buffer> {
  const baseSharp = img(baseBuffer).rotate().ensureAlpha()
  // `metadata()` describes the INPUT bytes; the queued `.rotate()` (EXIF
  // auto-orient) is only applied at render. A portrait phone photo stored
  // landscape + orientation 6 renders 3024×4032, not 4032×3024 — so every
  // geometry decision must use the auto-oriented size or a large layer throws
  // in composite and a small one lands in the wrong place.
  const base = await orientedSize(baseBuffer)
  const composites: sharp.OverlayOptions[] = []
  let layerPixels = 0

  for (const idx of overlayRenderOrder(layers.map((l) => l.layer))) {
    const resolved = resolveLayer(layers[idx].layer)
    // Generated kinds are rendered at their target size first and then placed
    // like any picture: text at its natural size (width = the rendered width),
    // a QR square at width%, a shape at width% × height%.
    const generated = await materialiseLayer(resolved, layers[idx].buffer, base, idx)
    const { buffer, layer } = generated
    const src = await orientedSize(buffer)
    if (!isSvg(buffer) && Math.max(src.w, src.h) > MAX_LAYER_EDGE) {
      throw new Error(`Image Overlay: layer ${idx + 1} is ${src.w}×${src.h}; the long edge must be at most ${MAX_LAYER_EDGE}px — downscale it first`)
    }
    const srcAspect = src.w / src.h
    const box = resolveOverlayGeometry(base, layer, srcAspect)
    layerPixels += box.width * box.height
    if (layerPixels > MAX_TOTAL_LAYER_PIXELS) {
      throw new Error(`Image Overlay: the layers add up to more than ${Math.round(MAX_TOTAL_LAYER_PIXELS / 1e6)} megapixels — use fewer or smaller layers`)
    }

    let png = await rasteriseLayer(buffer, box, layer.fit, layer.height !== undefined)
    if (layer.effects?.mask === "circle") png = await applyCircleMask(png)
    if (layer.roundedCorners) png = await applyRoundedCorners(png, layer.roundedCorners)
    if (layer.effects?.feather) png = await applyFeather(png, layer.effects.feather)
    // Outline and glow are drawn UNDER the layer, in its own alpha; they
    // inherit the layer's rotation because they are built from the rotated
    // bitmap below — so they are appended after rotation, before the shadow.
    png = await applyOpacity(png, layer.opacity)

    // Rotation grows the bounding box; keep the layer's centre where the
    // un-rotated box's centre was.
    let placed: Box = box
    if (layer.rotation !== 0) {
      png = await img(png).rotate(layer.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
      const rm = await img(png).metadata()
      const rw = rm.width ?? box.width
      const rh = rm.height ?? box.height
      placed = { left: Math.round(box.left + box.width / 2 - rw / 2), top: Math.round(box.top + box.height / 2 - rh / 2), width: rw, height: rh }
    }

    if (layer.effects?.glow) {
      const { png: glowPng, pad } = await buildGlow(png, layer.effects.glow)
      await pushUnder(composites, glowPng, placed, pad, base)
    }
    if (layer.effects?.stroke && layer.effects.stroke.width > 0) {
      const { png: strokePng, pad } = await buildStroke(png, layer.effects.stroke.width, layer.effects.stroke.color)
      await pushUnder(composites, strokePng, placed, pad, base)
    }

    if (layer.shadow) {
      const shadowPng = await buildShadow(png, layer.shadow)
      const pad = Math.ceil(layer.shadow.blur * 3)
      const sBox: Box = { left: placed.left - pad + Math.round(layer.shadow.offsetX), top: placed.top - pad + Math.round(layer.shadow.offsetY), width: placed.width + 2 * pad, height: placed.height + 2 * pad }
      const sClip = clipToBase(sBox, base)
      if (sClip) {
        const cropped = await img(shadowPng).extract({ left: sClip.cropLeft, top: sClip.cropTop, width: sClip.cropWidth, height: sClip.cropHeight }).png().toBuffer()
        composites.push({ input: cropped, left: sClip.left, top: sClip.top, blend: "over" })
      }
    }

    const clip = clipToBase(placed, base)
    if (!clip) continue // entirely off-canvas: nothing to draw, not an error
    const visible =
      clip.cropLeft === 0 && clip.cropTop === 0 && clip.cropWidth === placed.width && clip.cropHeight === placed.height
        ? png
        : await img(png).extract({ left: clip.cropLeft, top: clip.cropTop, width: clip.cropWidth, height: clip.cropHeight }).png().toBuffer()
    composites.push({ input: visible, left: clip.left, top: clip.top, blend: layer.blend })
  }

  if (composites.length === 0) return baseSharp.png().toBuffer()
  return baseSharp.composite(composites).png().toBuffer()
}

/** Composite a padded under-layer (glow / stroke) centred on `placed`, clipped to the base. */
async function pushUnder(composites: sharp.OverlayOptions[], png: Buffer, placed: Box, pad: number, base: { w: number; h: number }): Promise<void> {
  const box: Box = { left: placed.left - pad, top: placed.top - pad, width: placed.width + 2 * pad, height: placed.height + 2 * pad }
  const clip = clipToBase(box, base)
  if (!clip) return
  const whole = clip.cropLeft === 0 && clip.cropTop === 0 && clip.cropWidth === box.width && clip.cropHeight === box.height
  const input = whole ? png : await img(png).extract({ left: clip.cropLeft, top: clip.cropTop, width: clip.cropWidth, height: clip.cropHeight }).png().toBuffer()
  composites.push({ input, left: clip.left, top: clip.top, blend: "over" })
}

/**
 * Turn a resolved layer into bytes at its target size. Image layers pass
 * through; generated kinds render now and rewrite their width/height so the
 * shared placement math applies unchanged.
 */
async function materialiseLayer(
  layer: OverlayLayerParams,
  buffer: Buffer | undefined,
  base: { w: number; h: number },
  idx: number,
): Promise<{ buffer: Buffer; layer: OverlayLayerParams }> {
  switch (layer.kind) {
    case "text": {
      const r = await renderTextLayer(layer.text!, base.h)
      return { buffer: r.png, layer: { ...layer, width: clamp((r.width / base.w) * 100, 1, 100), height: undefined, fit: "contain" } }
    }
    case "qr": {
      const px = Math.max(16, Math.round((layer.width / 100) * base.w))
      return { buffer: await renderQrLayer(layer.qr!, px), layer: { ...layer, height: undefined, fit: "contain" } }
    }
    case "shape": {
      const w = Math.max(2, Math.round((layer.width / 100) * base.w))
      const h = Math.max(2, Math.round(layer.height !== undefined ? (layer.height / 100) * base.h : w / 3))
      return { buffer: await renderShapeLayer(layer.shape!, w, h), layer: { ...layer, height: (h / base.h) * 100, fit: "stretch" } }
    }
    default: {
      if (!buffer) throw new Error(`Image Overlay: layer ${idx + 1} has no image (connect an image to its handle)`)
      return { buffer, layer }
    }
  }
}

/**
 * Worker entry point. Downloads the base and every layer (SSRF-guarded via
 * downloadFile), renders, optionally places the result on a canvas, and
 * returns the local output path. The caller uploads to R2 and removes the
 * work dir — the same contract as `createImageCollage`.
 */
export interface OverlayVariantFile {
  readonly id: string
  readonly label: string
  readonly width: number
  readonly height: number
  readonly path: string
}

export interface ImageOverlayRender {
  readonly outputPath: string
  /** Pixel size of the main output — the canvas, or the base's own size. */
  readonly width: number
  readonly height: number
  readonly variants: readonly OverlayVariantFile[]
  /** White where the mask mode says "may change"; absent for maskMode "none". */
  readonly maskPath?: string
}

/**
 * Fill the QR layers that read their link from the node's QR link handle.
 * Pure: layers that carry their own text are returned untouched, and a
 * fromInput layer with nothing wired keeps its empty text so resolveLayer
 * can name the problem.
 */
export function applyOverlayQrText<T extends Partial<OverlayLayerParams>>(layers: readonly T[], qrText: string | undefined): T[] {
  const text = (qrText ?? "").trim()
  return layers.map((l) => (l && l.kind === "qr" && l.qr && (l.qr as { fromInput?: boolean }).fromInput ? { ...l, qr: { ...l.qr, text } } : l))
}

export async function createImageOverlay(params: ImageOverlayParams): Promise<ImageOverlayRender> {
  const layersIn = applyOverlayQrText(params.layers ?? [], params.qrText).filter((l) => l && ((l.kind !== undefined && l.kind !== "image") || (typeof l.imageUrl === "string" && l.imageUrl.length > 0)))
  if (!params.imageUrl) throw new Error("Image Overlay needs a base image")
  if (layersIn.length < 1) throw new Error("Image Overlay needs at least one overlay image")
  if (layersIn.length > OVERLAY_MAX_LAYERS) throw new Error(`Image Overlay supports at most ${OVERLAY_MAX_LAYERS} overlay layers`)

  const workDir = await createWorkDir("image-overlay")
  try {
    // The base first, alone: a base that fails the size cap must fail BEFORE
    // twelve layer downloads are paid for (bandwidth, tmpdir, and the credits
    // are refunded on failure — an unpaid disk-fill primitive otherwise).
    const basePath = join(workDir, "base")
    await downloadFile(params.imageUrl, basePath, { maxBytes: MAX_DOWNLOAD_BYTES })
    const probed = await probeImageSize(basePath)
    if (probed.w <= 1 && probed.h <= 1) throw new Error("Image Overlay: the base image could not be decoded")
    if (Math.max(probed.w, probed.h) > MAX_CANVAS_EDGE) {
      throw new Error(`Image Overlay: the base image is ${probed.w}×${probed.h}; the long edge must be at most ${MAX_CANVAS_EDGE}px — downscale it first`)
    }
    const baseBuffer = await readFile(basePath)

    const downloaded = await settledWithLimit(
      layersIn.map((l, i) => async () => {
        if (l.kind !== undefined && l.kind !== "image") return null
        const dest = join(workDir, `layer-${i}`)
        await downloadFile(l.imageUrl!, dest, { maxBytes: MAX_DOWNLOAD_BYTES })
        return dest
      }),
      DOWNLOAD_CONCURRENCY,
      { cancelled: false },
    )
    const prepared: PreparedLayer[] = []
    for (let i = 0; i < downloaded.length; i++) {
      const r = downloaded[i]
      if (r.status === "rejected") throw r.reason instanceof Error ? r.reason : new Error(String(r.reason))
      prepared.push({ buffer: r.value ? await readFile(r.value) : undefined, layer: layersIn[i] })
    }
    const canvas = resolveCanvas(params.canvas)

    // The whole raster is CPU/memory-bound at 2K–8K; run it under the shared
    // ffmpeg FIFO slot even though nothing here spawns ffmpeg (the worker fans
    // out at high concurrency and sharp would otherwise contend for the same
    // cores). Bounded: a runaway render releases the slot with a clear error.
    const ext = params.outputFormat === "jpg" ? "jpg" : params.outputFormat === "webp" ? "webp" : "png"
    const outputPath = join(workDir, `overlay.${ext}`)
    const variantIds = Array.from(new Set((params.variants ?? []).filter((id) => overlayPlatformById(id)))).slice(0, OVERLAY_MAX_VARIANTS)
    const { variants, maskPath } = await withFfmpegSlot(() =>
      withTimeout(renderAll(baseBuffer, prepared, canvas, params, outputPath, variantIds, workDir, ext), RENDER_TIMEOUT_MS, "Image Overlay: render timed out"),
    )
    const outMeta = await sharp(outputPath).metadata()
    return { outputPath, width: outMeta.width ?? 0, height: outMeta.height ?? 0, variants, maskPath }
  } catch (err) {
    await cleanupWorkDir(workDir).catch(() => undefined)
    throw err
  }
}

/** Composite once, then write the main output and every platform variant from the same bitmap. */
async function renderAll(
  baseBuffer: Buffer,
  prepared: readonly PreparedLayer[],
  canvas: OverlayCanvasParams | undefined,
  params: ImageOverlayParams,
  outputPath: string,
  variantIds: readonly string[],
  workDir: string,
  ext: string,
): Promise<{ variants: OverlayVariantFile[]; maskPath?: string }> {
  const composited = await renderOverlayLayers(baseBuffer, prepared)
  const baseFit = params.baseFit === "cover" ? "cover" : "contain"
  await writeOutput(canvas ? await fitIntoCanvas(composited, canvas, baseFit) : composited, params.outputFormat, outputPath)

  const maskMode = params.maskMode ?? "around"
  let maskPath: string | undefined
  if (maskMode !== "none") {
    const mask = await renderMask(baseBuffer, prepared, maskMode, clamp(num(params.maskSpread, 48), 1, 400))
    const fitted = canvas ? await fitIntoCanvas(mask, { ...canvas, backgroundColor: "#000000" }, baseFit) : mask
    maskPath = join(workDir, "mask.png")
    await img(fitted).png().toFile(maskPath)
  }

  const variants: OverlayVariantFile[] = []
  for (const id of variantIds) {
    const preset = overlayPlatformById(id)
    if (!preset) continue
    const variantCanvas: OverlayCanvasParams = { width: preset.width, height: preset.height, backgroundColor: canvas?.backgroundColor ?? "#000000" }
    // Platform sizes are meant to be filled edge to edge; "contain" would
    // letterbox a 16:9 composite inside a 1:1 post.
    const bytes = await fitIntoCanvas(composited, variantCanvas, "cover")
    const path = join(workDir, `variant-${id}.${ext}`)
    await writeOutput(bytes, params.outputFormat, path)
    variants.push({ id, label: preset.label, width: preset.width, height: preset.height, path })
  }
  return { variants, maskPath }
}

/**
 * The node's mask output, as an opaque grayscale PNG the size of the base:
 * white = "may change". "layers" is the union silhouette of every layer
 * (shadows included), "around" is a ring of `spread` px hugging that
 * silhouette — the region an AI finish may repaint for contact shadows and
 * matching light while the elements stay pixel-exact — and "outside" is its
 * complement (restyle the whole scene, protect the placed elements).
 */
export async function renderMask(baseBuffer: Buffer, prepared: readonly PreparedLayer[], mode: "layers" | "around" | "outside", spread: number): Promise<Buffer> {
  const base = await orientedSize(baseBuffer)
  const transparent = await sharp({ create: { width: base.w, height: base.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
  const layersOnly = await renderOverlayLayers(transparent, prepared)
  const silhouette = await img(layersOnly).ensureAlpha().extractChannel(3).raw().toBuffer()
  const n = base.w * base.h
  const out = Buffer.alloc(n)
  if (mode === "layers") {
    for (let i = 0; i < n; i++) out[i] = silhouette[i] > 127 ? 255 : 0
  } else if (mode === "outside") {
    for (let i = 0; i < n; i++) out[i] = silhouette[i] > 127 ? 0 : 255
  } else {
    // Dilate (blur + threshold) and subtract the silhouette → a ring.
    // sharp re-expands a 1-channel raw input on the way out, so the threshold
    // is applied here, indexed by the channel count it reports.
    const blurred = await sharp(silhouette, { raw: { width: base.w, height: base.h, channels: 1 } })
      .blur(Math.max(0.3, spread / 2))
      .raw()
      .toBuffer({ resolveWithObject: true })
    const ch = blurred.info.channels
    for (let i = 0; i < n; i++) out[i] = blurred.data[i * ch] > 4 && silhouette[i] <= 127 ? 255 : 0
  }
  // RGB, not single-channel gray: every inpainting provider reads a mask as a
  // black/white picture, and a gray PNG is re-expanded inconsistently downstream.
  const rgb = Buffer.alloc(n * 3)
  for (let i = 0; i < n; i++) {
    const v = out[i]
    rgb[i * 3] = v
    rgb[i * 3 + 1] = v
    rgb[i * 3 + 2] = v
  }
  return sharp(rgb, { raw: { width: base.w, height: base.h, channels: 3 } }).png().toBuffer()
}

/** Place the composite inside an output canvas (letterbox or fill). */
async function fitIntoCanvas(composited: Buffer, canvas: OverlayCanvasParams, baseFit: "contain" | "cover"): Promise<Buffer> {
  const baseMeta = await img(composited).metadata()
  const placement = resolveCanvasPlacement({ w: baseMeta.width ?? 1, h: baseMeta.height ?? 1 }, canvas, baseFit)
  const fitted = await img(composited).resize(placement.baseW, placement.baseH, { fit: "fill" }).png().toBuffer()
  const clip = clipToBase({ left: placement.left, top: placement.top, width: placement.baseW, height: placement.baseH }, { w: placement.w, h: placement.h })
  const sheet = sharp({ create: { width: placement.w, height: placement.h, channels: 4, background: toSharpColor(canvas.backgroundColor, 1) } })
  return clip
    ? sheet
        .composite([{ input: await img(fitted).extract({ left: clip.cropLeft, top: clip.cropTop, width: clip.cropWidth, height: clip.cropHeight }).png().toBuffer(), left: clip.left, top: clip.top }])
        .png()
        .toBuffer()
    : sheet.png().toBuffer()
}

async function writeOutput(bytes: Buffer, format: ImageOverlayParams["outputFormat"], outputPath: string): Promise<void> {
  const out = img(bytes)
  if (format === "jpg") await out.flatten({ background: "#000000" }).jpeg({ quality: 92 }).toFile(outputPath)
  else if (format === "webp") await out.webp({ quality: 92 }).toFile(outputPath)
  else await out.png().toFile(outputPath)
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer) })
}
