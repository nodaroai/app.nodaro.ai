/**
 * Storyboard badges for the Image Collage — PURE, no I/O.
 *
 * Builds the full-canvas SVG overlay that stamps a rounded dark pill with white
 * bold text in one corner of EACH fitted image — top-left by default, or
 * top-right — (a 1-based sequence number,
 * an optional per-image label, or both as `3 · Close-up`). It is deliberately
 * side-effect-free so the exact SVG string can be asserted exhaustively in unit
 * tests — the local dev ffmpeg has no `drawtext` (no libfreetype), so text is
 * rendered by sharp/Pango from this SVG, never by ffmpeg, and an unsanitized
 * label reaching the SVG crashes libvips' XML parser. This module is the choke
 * point that guarantees that never happens.
 *
 * Geometry mirrors the ffmpeg overlay maths in `collage.ts`
 * (`force_original_aspect_ratio=decrease` + centred overlay) to within ~1px, so
 * badges land on the image, not on the letterbox bars of a grid cell. Escaping
 * discipline mirrors `reference-sheet/compositor.ts` (parts[] + escapeSvgText).
 */
import { escapeSvgText } from "../../services/reference-sheet/svg.js"
import type { ImageDim, Rect } from "./collage-layout.js"

/** Max label length, in Unicode code points. Matches the route/CLI/SDK caps. */
export const MAX_LABEL_CHARS = 80

/** Which corner of each image a badge sits in. */
export type CollageBadgePosition = "top-left" | "top-right"
/** Storyboard convention: the shot number leads the frame in reading order. */
export const DEFAULT_BADGE_POSITION: CollageBadgePosition = "top-left"
/** Coerce an untrusted wire/node-data value to a badge position — anything that
 *  is not exactly "top-right" is the default, so the workflow-run path (which
 *  bypasses route Zod) can never carry an unknown corner into the renderer. */
export function resolveBadgePosition(v: unknown): CollageBadgePosition {
  return v === "top-right" ? "top-right" : DEFAULT_BADGE_POSITION
}

/** Pill fill — semi-opaque dark so white text reads over any image. */
const PILL_FILL = "rgba(0,0,0,0.62)"
/** Text fill. */
const TEXT_FILL = "#ffffff"
/** Match compositor.ts; the prod runner installs fonts-dejavu-core. */
const FONT_FAMILY = "DejaVu Sans, sans-serif"

/**
 * Sanitize ONE user label into a safe, trimmed string — or `undefined` when
 * nothing usable remains.
 *
 * WHY this is strict: the result is interpolated (after XML-escaping) into an
 * SVG that libvips parses as XML-1.0. XML-1.0 forbids most control characters
 * outright, and libvips' parser aborts the whole render on one — so a stray NUL
 * or 0x0B in a caption would fail the job, not just look wrong. Bidi/zero-width
 * format controls are stripped too: they cannot help a short storyboard caption
 * and can be used to spoof or scramble the visible order.
 *
 * Order matters: tab/newline/CR become a space first (so a multi-line paste
 * collapses to one line rather than losing the words either side), THEN the
 * remaining C0/C1 controls, bidi/zero-width marks, and unpaired surrogates are
 * removed, THEN whitespace runs collapse and the string is trimmed and capped
 * at {@link MAX_LABEL_CHARS} CODE POINTS (never splitting a surrogate pair).
 */
export function sanitizeCollageLabel(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  let s = raw
    // Tab / newline / CR → single space (keep the words on either side).
    .replace(/[\t\n\r]/g, " ")
    // Remaining C0 controls + DEL + C1 controls (XML-1.0-invalid / dangerous).
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    // Zero-width + bidi format controls (spoofing / invisible junk), plus the
    // two BMP non-characters U+FFFE/U+FFFF \u2014 valid JS strings, but NOT XML-1.0
    // `Char`s, so libxml2 aborts the SVG parse on them exactly like a NUL.
    // (Astral U+nFFFE/U+nFFFF ARE valid XML Chars and need no handling.)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\uFFFE\uFFFF]/g, "")
    // Unpaired surrogates (a high not followed by a low, or a low not preceded
    // by a high) — these make an ill-formed UTF-16 string libvips rejects.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    // Collapse whitespace runs to one space, then trim the ends.
    .replace(/\s+/g, " ")
    .trim()
  if (s === "") return undefined
  // Cap at MAX_LABEL_CHARS code points (Array.from splits on code points, so a
  // surrogate pair is one unit and is never cut in half).
  const cps = Array.from(s)
  if (cps.length > MAX_LABEL_CHARS) s = cps.slice(0, MAX_LABEL_CHARS).join("").trim()
  return s === "" ? undefined : s
}

/**
 * Normalize a whole `imageLabels` array at the WIRE boundary (the HTTP route
 * and the workflow-engine payload builder): every entry goes through
 * {@link sanitizeCollageLabel}, `null` marks "no caption", and the result is
 * `undefined` when nothing survives (so callers omit the key and the renderer
 * takes its no-overlay path).
 *
 * WHY at the boundary and not only in the renderer: the array is persisted to
 * `jobs.input_data` (JSONB) BEFORE the worker runs, and Postgres rejects a
 * `\u0000` inside JSONB outright — a NUL in a caption used to 500 job creation
 * instead of rendering a sanitized badge. Sanitizing here means what is stored
 * is exactly what gets drawn. `limit` trims extras (index-aligned with the
 * images; the renderer ignores extras anyway).
 */
export function normalizeCollageLabels(
  labels: readonly unknown[] | undefined,
  limit?: number,
): (string | null)[] | undefined {
  if (!Array.isArray(labels)) return undefined
  const sliced = limit !== undefined ? labels.slice(0, limit) : labels
  const out = sliced.map((l) => sanitizeCollageLabel(l) ?? null)
  return out.some((l) => l !== null) ? out : undefined
}

/**
 * The badge text for each image, index-aligned with the FINAL wire order.
 *
 * `numbered` stamps a 1-based sequence (`i + 1`); each label is sanitized. Both
 * present → `${number} · ${label}` (a U+00B7 middot with spaces); exactly one →
 * that one; neither → `undefined` (no badge for that image). Extra labels are
 * ignored and a short `labels` array pads with none — matching how the route
 * and provider treat `imageSizes`.
 */
export function collageBadgeTexts(
  n: number,
  numbered: boolean,
  labels?: readonly (string | null | undefined)[],
): (string | undefined)[] {
  const out: (string | undefined)[] = []
  for (let i = 0; i < n; i++) {
    const number = numbered ? String(i + 1) : undefined
    const label = sanitizeCollageLabel(labels?.[i])
    if (number !== undefined && label !== undefined) out.push(`${number} · ${label}`)
    else if (number !== undefined) out.push(number)
    else if (label !== undefined) out.push(label)
    else out.push(undefined)
  }
  return out
}

/**
 * The pixel rect the DECODED image actually occupies inside its layout cell.
 *
 * ffmpeg fits each image with `scale=…:force_original_aspect_ratio=decrease`
 * and centres it, so in grid mode (uniform cells, mixed aspects) the image is
 * letterboxed and the cell is wider/taller than the image. Badges must sit on
 * the image, not on the bar — hence this reproduces the same fit+centre maths.
 * It APPROXIMATES ffmpeg's rounding to within ~1px (documented; there is no
 * pixel-exact test), which is invisible for a corner badge.
 */
export function fittedImageRect(dim: ImageDim, rect: Rect): Rect {
  const dw = dim.w > 0 ? dim.w : 1
  const dh = dim.h > 0 ? dim.h : 1
  const scale = Math.min(rect.w / dw, rect.h / dh)
  const fw = Math.round(dw * scale)
  const fh = Math.round(dh * scale)
  return {
    x: rect.x + Math.floor((rect.w - fw) / 2),
    y: rect.y + Math.floor((rect.h - fh) / 2),
    w: fw,
    h: fh,
  }
}

/** Resolved integer geometry for one badge. No `dominant-baseline` — see WHY. */
export interface CollageBadgeGeometry {
  readonly fontSize: number
  readonly pillX: number
  readonly pillY: number
  readonly pillW: number
  readonly pillH: number
  readonly rx: number
  readonly textX: number
  /** `start` for a top-left badge, `end` for top-right — the text hugs the
   *  image edge the pill is anchored to, so a mis-estimated width can only
   *  mis-size the pill, never push glyphs past the corner. */
  readonly textAnchor: "start" | "end"
  /** Explicit baseline: sharp/Pango honours `dominant-baseline` inconsistently,
   *  so the y is computed here (pillY + padY + round(fontSize*0.79)). */
  readonly textBaselineY: number
  /** The (possibly ellipsized) text actually drawn. */
  readonly text: string
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/**
 * Per-code-point horizontal advance as a fraction of the font size. A cheap
 * proportional estimate (there is no font metrics library on the render path) —
 * intentionally generous for wide scripts so the pill never underestimates and
 * clips glyphs. Buckets follow the spec.
 */
function advance(cp: number): number {
  // ASCII digits and Latin letters.
  if ((cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return 0.62
  if (cp === 0x20) return 0.32 // space
  if (cp === 0x00b7) return 0.34 // ·
  // Wide: CJK / Hangul / fullwidth / emoji / symbols.
  if (
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xffef) ||
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf)
  ) {
    return 1.05
  }
  // Latin-1 letters, Latin Extended, Greek, Cyrillic, Hebrew, Arabic.
  if (
    (cp >= 0x00c0 && cp <= 0x00ff) ||
    (cp >= 0x0100 && cp <= 0x024f) ||
    (cp >= 0x0370 && cp <= 0x03ff) ||
    (cp >= 0x0400 && cp <= 0x04ff) ||
    (cp >= 0x0590 && cp <= 0x05ff) ||
    (cp >= 0x0600 && cp <= 0x06ff)
  ) {
    return 0.62
  }
  return 0.75
}

/** Rounded text width in px for a run of code points at `fontSize`. */
function textWidthPx(cps: readonly string[], fontSize: number): number {
  let sum = 0
  for (const ch of cps) sum += advance(ch.codePointAt(0) ?? 0)
  return Math.round(sum * fontSize)
}

/** Largest badge font the canvas allows — a sanity ceiling for tiny sheets. */
function maxBadgeFont(canvasW: number): number {
  return Math.max(1, Math.round(canvasW * 0.05))
}

/** The badge font for ONE image in isolation: 9% of its shorter fitted side. */
function isolatedBadgeFont(fitted: Rect, canvasW: number): number {
  return clamp(Math.round(Math.min(fitted.w, fitted.h) * 0.09), 12, maxBadgeFont(canvasW))
}

/**
 * ONE font size for the whole sheet.
 *
 * WHY uniform: a storyboard is read as a sequence, and the first visual gate
 * showed that sizing each badge from its own image makes the number on a
 * narrow portrait frame a fraction of the one on the wide frame beside it —
 * the numbering stops reading as one series. So the base size comes from the
 * MEDIAN fitted short side (adapts to how dense the sheet is: 4 frames get big
 * badges, 30 get small ones), with a canvas-relative floor so a dense sheet's
 * numbers survive the downscale a video model applies (~1K wide). Individual
 * images only ever SHRINK from this (see {@link layoutCollageBadge}'s clamps),
 * and only when the shared size would not physically fit them.
 */
export function sheetBadgeFontSize(fittedRects: readonly Rect[], canvasW: number): number {
  const shorts = fittedRects
    .map((r) => Math.min(r.w, r.h))
    .filter((s) => s > 0)
    .sort((a, b) => a - b)
  const floor = Math.max(12, Math.round(canvasW * 0.01))
  if (shorts.length === 0) return floor
  const mid = shorts.length >> 1
  const median = shorts.length % 2 === 1 ? shorts[mid]! : (shorts[mid - 1]! + shorts[mid]!) / 2
  return clamp(Math.round(median * 0.09), floor, maxBadgeFont(canvasW))
}

/**
 * Resolve one badge's integer geometry, or `undefined` to SKIP it.
 *
 * Sizing: fontSize starts at `baseFontSize` (the sheet-uniform size from
 * {@link sheetBadgeFontSize}; defaults to this image's isolated size, which is
 * what the unit tests pin), then shrinks proportionally until the pill height
 * is ≤ 35% of the image height AND a number-only pill is ≤ 60% of the image
 * width and fits the ellipsize budget. If it still doesn't fit at fontSize 8,
 * the badge is skipped (returns `undefined`) rather than drawn oversized. The
 * label is then ellipsized (by code points, keeping the leading number,
 * appending `…`) so the pill fits `fw − 2*margin`. The pill is clipped to its
 * own rect by the caller, so an underestimated width can never spill white
 * glyphs onto the bare image.
 */
export function layoutCollageBadge(
  text: string,
  fitted: Rect,
  canvasW: number,
  baseFontSize?: number,
  position: CollageBadgePosition = DEFAULT_BADGE_POSITION,
): CollageBadgeGeometry | undefined {
  const fw = fitted.w
  const fh = fitted.h
  if (fw <= 0 || fh <= 0) return undefined
  const maxFont = maxBadgeFont(canvasW)
  // Leading digits are the "number" we keep intact; if the text has none (a
  // label-only badge) use its first code point as the minimum-width proxy.
  const cps = Array.from(text)
  const numMatch = text.match(/^\d+/)
  const numberCps = numMatch ? Array.from(numMatch[0]) : cps.slice(0, 1)

  let fontSize = clamp(Math.round(baseFontSize ?? isolatedBadgeFont(fitted, canvasW)), 8, maxFont)
  let padX = 0
  let padY = 0
  let pillH = 0
  let margin = 0
  for (;;) {
    padX = Math.round(fontSize * 0.5)
    padY = Math.round(fontSize * 0.28)
    margin = Math.round(fontSize * 0.35)
    pillH = fontSize + 2 * padY
    const numberOnlyPillW = textWidthPx(numberCps, fontSize) + 2 * padX
    const widthCap = Math.min(0.6 * fw, fw - 2 * margin)
    if (pillH <= 0.35 * fh && numberOnlyPillW <= widthCap) break
    if (fontSize <= 8) return undefined
    // Proportional shrink toward whichever cap is violated, always making
    // progress (strictly smaller) so the loop terminates at 8.
    const hScale = (0.35 * fh) / pillH
    const wScale = widthCap > 0 ? widthCap / numberOnlyPillW : 0
    let next = Math.floor(fontSize * Math.min(hScale, wScale, 1))
    if (next >= fontSize) next = fontSize - 1
    if (next < 8) next = 8
    fontSize = next
  }

  const rx = Math.round(fontSize * 0.3)
  const budget = fw - 2 * margin

  // Ellipsize by code points if the full text overflows the budget, keeping the
  // number (leading digits) intact and trimming the label from the end.
  const ELLIPSIS = "…"
  const fullW = textWidthPx(cps, fontSize) + 2 * padX
  let drawnCps: string[]
  if (fullW <= budget) {
    drawnCps = cps
  } else {
    const kept = cps.slice()
    const protectedLen = numberCps.length
    const fitsWithEllipsis = (arr: string[]): boolean =>
      textWidthPx([...arr, ELLIPSIS], fontSize) + 2 * padX <= budget
    while (kept.length > protectedLen && !fitsWithEllipsis(kept)) kept.pop()
    if (fitsWithEllipsis(kept)) {
      drawnCps = [...kept, ELLIPSIS]
    } else {
      // Not even number + ellipsis fits: fall back to the number alone (the fit
      // loop guaranteed it fits the budget). If there is no number, skip.
      if (protectedLen > 0 && textWidthPx(numberCps, fontSize) + 2 * padX <= budget) {
        drawnCps = numberCps.slice()
      } else {
        return undefined
      }
    }
  }

  const drawnText = drawnCps.join("")
  const pillW = textWidthPx(drawnCps, fontSize) + 2 * padX
  const pillX = position === "top-right" ? fitted.x + fw - margin - pillW : fitted.x + margin
  const pillY = fitted.y + margin
  const textAnchor = position === "top-right" ? "end" : "start"
  const textX = textAnchor === "end" ? pillX + pillW - padX : pillX + padX
  const textBaselineY = pillY + padY + Math.round(fontSize * 0.79)

  return { fontSize, pillX, pillY, pillW, pillH, rx, textX, textAnchor, textBaselineY, text: drawnText }
}

/**
 * Build the full-canvas SVG overlay for the collage badges, or `undefined` when
 * no badge is to be drawn (the caller then returns the untouched ffmpeg PNG —
 * the no-badge byte-identity path). Each drawn badge is one `<g>` clipped to its
 * pill rect, with the pill `<rect>` and the escaped `<text>` inside.
 */
export function buildCollageBadgesSvg(opts: {
  canvasW: number
  canvasH: number
  rects: readonly Rect[]
  dims: readonly ImageDim[]
  texts: readonly (string | undefined)[]
  /** Corner for every badge on the sheet. Default {@link DEFAULT_BADGE_POSITION}. */
  position?: CollageBadgePosition
}): string | undefined {
  const { canvasW, canvasH, rects, dims, texts } = opts
  const position = opts.position ?? DEFAULT_BADGE_POSITION
  // Fitted rects of every image that gets a badge — the sheet-uniform font size
  // is derived from these, so images without a badge don't skew the median.
  const fittedByIndex = new Map<number, Rect>()
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] === undefined) continue
    const rect = rects[i]
    const dim = dims[i]
    if (rect && dim) fittedByIndex.set(i, fittedImageRect(dim, rect))
  }
  const baseFontSize = sheetBadgeFontSize([...fittedByIndex.values()], canvasW)
  const defs: string[] = []
  const bodies: string[] = []
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]
    const fitted = fittedByIndex.get(i)
    if (text === undefined || !fitted) continue
    const g = layoutCollageBadge(text, fitted, canvasW, baseFontSize, position)
    if (!g) continue
    const clipId = `cb${i}`
    defs.push(
      `<clipPath id="${clipId}"><rect x="${g.pillX}" y="${g.pillY}" width="${g.pillW}" height="${g.pillH}" rx="${g.rx}"/></clipPath>`,
    )
    bodies.push(
      `<g clip-path="url(#${clipId})">` +
        `<rect x="${g.pillX}" y="${g.pillY}" width="${g.pillW}" height="${g.pillH}" rx="${g.rx}" fill="${PILL_FILL}"/>` +
        `<text x="${g.textX}" y="${g.textBaselineY}" font-family="${FONT_FAMILY}" font-size="${g.fontSize}" ` +
        `font-weight="700" fill="${TEXT_FILL}" text-anchor="${g.textAnchor}" xml:space="preserve">${escapeSvgText(g.text)}</text>` +
        `</g>`,
    )
  }
  if (bodies.length === 0) return undefined
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}"><defs>${defs.join("")}</defs>${bodies.join("")}</svg>`
}
