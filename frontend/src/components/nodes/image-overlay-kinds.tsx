"use client"

import { createElement, useEffect, useState, type CSSProperties } from "react"
import QRCode from "qrcode"
import { overlayShapeElement, type OverlayImageEffects, type OverlayQrStyle, type OverlayShape, type OverlayShapeStyle, type OverlayTextStyle } from "@nodaro/shared"
import { ensureOverlayFonts, overlayFontFamily } from "@/lib/overlay-fonts"

/**
 * Preview renderers for the generated layer kinds and the image effects.
 * Each is the CSS twin of a sharp routine in backend/src/providers/image —
 * same font file, same QR encoder, same shape geometry — so the stage shows
 * what the run produces. Sizes arrive already scaled to stage pixels.
 */

export function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace(/^#/, "")
  const ok = /^[0-9a-fA-F]{6}$/.test(raw) ? raw : "000000"
  return `rgba(${parseInt(ok.slice(0, 2), 16)}, ${parseInt(ok.slice(2, 4), 16)}, ${parseInt(ok.slice(4, 6), 16)}, ${alpha})`
}

/** Text at its natural size; `fontPx` = fontSize% of the base height × stage scale. */
export function TextLayerPreview({ style, fontPx, scale }: { style: OverlayTextStyle; fontPx: number; scale: number }) {
  useEffect(() => ensureOverlayFonts(), [])
  const bg = style.background
  const stroke = style.stroke
  const css: CSSProperties = {
    fontFamily: overlayFontFamily(style.fontId),
    fontWeight: style.fontWeight,
    fontSize: fontPx,
    lineHeight: style.lineHeight,
    letterSpacing: `${style.letterSpacing}em`,
    color: style.color,
    textAlign: style.align,
    textTransform: style.uppercase ? "uppercase" : "none",
    whiteSpace: "pre",
    padding: bg ? bg.padding * scale : 0,
    borderRadius: bg ? bg.radius * scale : 0,
    background: bg ? hexToRgba(bg.color, bg.opacity) : "transparent",
    WebkitTextStroke: stroke && stroke.width > 0 ? `${stroke.width * scale}px ${stroke.color}` : undefined,
    paintOrder: "stroke fill",
    direction: /[֐-׿؀-ۿ]/.test(style.text) ? "rtl" : "ltr",
  }
  return <div style={css}>{style.text}</div>
}

/** A QR as an SVG data URL from the same encoder the worker uses. */
export function QrLayerPreview({ style }: { style: OverlayQrStyle }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toString(style.text || " ", {
      type: "svg",
      margin: style.margin,
      color: { dark: style.color, light: style.background ?? "#00000000" },
    })
      .then((svg) => { if (alive) setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`) })
      .catch(() => { if (alive) setSrc(null) })
    return () => { alive = false }
  }, [style.text, style.margin, style.color, style.background])
  return src ? <img src={src} alt="" draggable={false} className="w-full h-full pointer-events-none" style={{ imageRendering: "pixelated" }} /> : <div className="w-full h-full bg-black/20" />
}

/**
 * A flat shape filling its box — the SAME element the server rasterises,
 * drawn in base-image pixels (`boxW` × `boxH`) and scaled by the viewBox, so
 * the stroke and the corners scale exactly like the run's.
 */
export function ShapeLayerPreview({ style, boxW, boxH }: { style: OverlayShapeStyle; boxW: number; boxH: number }) {
  const w = Math.max(2, boxW)
  const h = Math.max(2, boxH)
  const strokeW = style.stroke ? Math.max(0, Math.min(50, style.stroke.width)) : 0
  const el = overlayShapeElement(style.shape, w, h, strokeW / 2)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height="100%" style={{ display: "block" }} aria-hidden>
      {createElement(el.tag, { ...el.attrs, fill: style.color, stroke: strokeW > 0 ? style.stroke!.color : undefined, strokeWidth: strokeW > 0 ? strokeW : undefined })}
    </svg>
  )
}

/** A small glyph of a shape for pickers — the same geometry at 40 × 24. */
export function ShapeGlyph({ shape, className }: { shape: OverlayShape; className?: string }) {
  const el = overlayShapeElement(shape, 40, 24)
  return (
    <svg viewBox="0 0 40 24" width="40" height="24" className={className} aria-hidden>
      {createElement(el.tag, { ...el.attrs, fill: "currentColor" })}
    </svg>
  )
}

/** CSS approximation of the image effects (mask, feather, stroke, glow). */
export function imageEffectStyle(effects: OverlayImageEffects | undefined, scale: number): CSSProperties {
  if (!effects) return {}
  const css: CSSProperties = {}
  const filters: string[] = []
  if (effects.mask === "circle") css.borderRadius = "50%"
  if (effects.feather && effects.feather > 0) {
    const f = `${effects.feather * scale}px`
    const m = `linear-gradient(to right, transparent, #000 ${f}, #000 calc(100% - ${f}), transparent), linear-gradient(to bottom, transparent, #000 ${f}, #000 calc(100% - ${f}), transparent)`
    css.maskImage = m
    css.WebkitMaskImage = m
    css.maskComposite = "intersect"
    css.WebkitMaskComposite = "source-in"
  }
  if (effects.glow) filters.push(`drop-shadow(0 0 ${2 * effects.glow.blur * scale}px ${hexToRgba(effects.glow.color, effects.glow.opacity)})`)
  if (effects.stroke && effects.stroke.width > 0) {
    const w = effects.stroke.width * scale
    const c = effects.stroke.color
    for (const [dx, dy] of [[w, 0], [-w, 0], [0, w], [0, -w], [w * 0.7, w * 0.7], [-w * 0.7, w * 0.7], [w * 0.7, -w * 0.7], [-w * 0.7, -w * 0.7]]) {
      filters.push(`drop-shadow(${dx}px ${dy}px 0 ${c})`)
    }
  }
  if (filters.length) css.filter = filters.join(" ")
  return css
}
