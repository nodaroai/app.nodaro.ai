/**
 * Image Overlay — the layer KINDS a node can carry beyond a wired image, and
 * the wire contract for each. Shared by the route's Zod, the MCP tool, the
 * worker's renderer and the canvas preview/editor, so a field exists once.
 *
 *   image — a wired picture (logo, cut-out, sticker); placement + effects
 *   text  — real typography from a bundled font (rendered server-side from
 *           the same TTF the browser previews with, so the two agree)
 *   qr    — a QR code generated from a payload string
 *   shape — a flat rectangle / pill / circle / ribbon (badges, price tags,
 *           text backgrounds)
 *
 * Sizes are PERCENT of the base image (text `fontSize` = % of base height),
 * pixels are only used where a real pixel count is the honest unit (stroke,
 * padding, radius, blur — on the base image).
 */
import { z } from "zod"

/** The nine points a layer attaches to on the base image. THE definition —
 *  the route's Zod, the compositor, the canvas, the SDK and the CLI all read
 *  this one (it used to be spelled out separately in each). */
export const OVERLAY_ANCHORS = [
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
] as const
export type OverlayAnchor = (typeof OVERLAY_ANCHORS)[number]

export const OVERLAY_LAYER_KINDS = ["image", "text", "qr", "shape"] as const
export type OverlayLayerKind = (typeof OVERLAY_LAYER_KINDS)[number]

export const OVERLAY_TEXT_ALIGNS = ["left", "center", "right"] as const
export type OverlayTextAlign = (typeof OVERLAY_TEXT_ALIGNS)[number]

import { OVERLAY_SHAPES } from "./image-overlay-shapes.js"

export const OVERLAY_IMAGE_MASKS = ["none", "circle"] as const
export type OverlayImageMask = (typeof OVERLAY_IMAGE_MASKS)[number]

/**
 * The bundled font faces. `file` names the TTF under
 * backend/src/assets/fonts (served at GET /v1/fonts/:file for the preview);
 * `variable` faces carry a `wght` axis and honour any weight 100–900, static
 * faces render at their single weight. `scripts` tells the picker which faces
 * can set Hebrew / Arabic.
 */
export const OVERLAY_FONTS = [
  { id: "inter", family: "Inter", file: "Inter.ttf", variable: true, scripts: ["latin"], category: "sans" },
  { id: "montserrat", family: "Montserrat", file: "Montserrat.ttf", variable: true, scripts: ["latin"], category: "sans" },
  { id: "space-grotesk", family: "Space Grotesk", file: "SpaceGrotesk.ttf", variable: true, scripts: ["latin"], category: "sans" },
  { id: "playfair-display", family: "Playfair Display", file: "PlayfairDisplay.ttf", variable: true, scripts: ["latin"], category: "serif" },
  { id: "oswald", family: "Oswald", file: "Oswald.ttf", variable: true, scripts: ["latin"], category: "display" },
  { id: "bebas-neue", family: "Bebas Neue", file: "BebasNeue.ttf", variable: false, scripts: ["latin"], category: "display" },
  { id: "anton", family: "Anton", file: "Anton.ttf", variable: false, scripts: ["latin"], category: "display" },
  { id: "pacifico", family: "Pacifico", file: "Pacifico.ttf", variable: false, scripts: ["latin"], category: "script" },
  { id: "rubik", family: "Rubik", file: "Rubik.ttf", variable: true, scripts: ["latin", "hebrew"], category: "sans" },
  { id: "heebo", family: "Heebo", file: "Heebo.ttf", variable: true, scripts: ["latin", "hebrew"], category: "sans" },
] as const

export type OverlayFontId = (typeof OVERLAY_FONTS)[number]["id"]
export const OVERLAY_FONT_IDS = OVERLAY_FONTS.map((f) => f.id) as unknown as readonly [OverlayFontId, ...OverlayFontId[]]

export function overlayFontById(id: string): (typeof OVERLAY_FONTS)[number] | undefined {
  return OVERLAY_FONTS.find((f) => f.id === id)
}

const hex6 = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB color")

export const overlayStrokeSchema = z.object({
  /** px on the base image */
  width: z.number().min(0).max(50),
  color: hex6,
})

/** Text layer style — everything the renderer and the preview need. */
export const overlayTextStyleSchema = z.object({
  text: z.string().min(1).max(500),
  fontId: z.enum(OVERLAY_FONT_IDS).default("inter"),
  fontWeight: z.number().int().min(100).max(900).default(700),
  /** % of the BASE height */
  fontSize: z.number().min(1).max(50).default(8),
  color: hex6.default("#ffffff"),
  align: z.enum(OVERLAY_TEXT_ALIGNS).default("center"),
  /** em */
  letterSpacing: z.number().min(-0.2).max(1).default(0),
  lineHeight: z.number().min(0.8).max(2.5).default(1.15),
  uppercase: z.boolean().default(false),
  stroke: overlayStrokeSchema.optional(),
  /** A filled box behind the text — a pill, a badge, a lower third. */
  background: z
    .object({
      color: hex6,
      opacity: z.number().min(0).max(1).default(1),
      /** px on the base image */
      padding: z.number().min(0).max(300).default(24),
      /** px corner radius; a huge value makes a pill */
      radius: z.number().min(0).max(1000).default(0),
    })
    .optional(),
})
export type OverlayTextStyle = z.infer<typeof overlayTextStyleSchema>

export const overlayQrStyleSchema = z.object({
  /** The link / text the code opens. May be empty ONLY while `fromInput` is
   *  set — the run then fills it from the node's "QR link" text handle. */
  text: z.string().max(2000).default(""),
  /** Take the payload from the node's QR link handle (a Text node, a List
   *  column, any text output) instead of this style's `text`. */
  fromInput: z.boolean().optional(),
  color: hex6.default("#000000"),
  /** Absent = transparent quiet zone and background. */
  background: hex6.optional(),
  /** Quiet-zone modules */
  margin: z.number().int().min(0).max(8).default(1),
})
export type OverlayQrStyle = z.infer<typeof overlayQrStyleSchema>

export const overlayShapeStyleSchema = z.object({
  shape: z.enum(OVERLAY_SHAPES).default("rect"),
  color: hex6.default("#ff0073"),
  stroke: overlayStrokeSchema.optional(),
})
export type OverlayShapeStyle = z.infer<typeof overlayShapeStyleSchema>

/** Finishing for IMAGE layers: cut to a circle, fade the edges, outline, glow. */
export const overlayImageEffectsSchema = z.object({
  mask: z.enum(OVERLAY_IMAGE_MASKS).optional(),
  /** px on the base image — edge fade width */
  feather: z.number().min(0).max(500).optional(),
  stroke: overlayStrokeSchema.optional(),
  glow: z
    .object({
      blur: z.number().min(0).max(200),
      color: hex6,
      opacity: z.number().min(0).max(1),
    })
    .optional(),
})
export type OverlayImageEffects = z.infer<typeof overlayImageEffectsSchema>

/** Sensible starting points for a freshly added non-image layer. */
export const DEFAULT_OVERLAY_TEXT: OverlayTextStyle = {
  text: "Your text",
  fontId: "inter",
  fontWeight: 700,
  fontSize: 8,
  color: "#ffffff",
  align: "center",
  letterSpacing: 0,
  lineHeight: 1.15,
  uppercase: false,
}
export const DEFAULT_OVERLAY_QR: OverlayQrStyle = { text: "https://nodaro.ai", color: "#000000", background: "#ffffff", margin: 1 }
export const DEFAULT_OVERLAY_SHAPE: OverlayShapeStyle = { shape: "pill", color: "#ff0073" }

/** True when the string carries a right-to-left script (Hebrew / Arabic ranges). */
export function isRtlText(text: string): boolean {
  return /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/.test(text)
}
