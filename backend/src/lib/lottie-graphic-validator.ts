/**
 * Server-side validate / auto-fix layer for LLM-authored Lottie documents
 * (design §3, planType "lottie-graphic"). Pure, no I/O.
 *
 * The LLM emits a complete Lottie (Bodymovin) document. This module clones it
 * once, applies a fixed sequence of auto-fix rules (1-10) — each appending a
 * human-readable line to `autoFixed` when it fires — and ASSEMBLES the render
 * plan envelope itself (planType + canvas fields from `expected`, the fixed
 * document, the extracted+augmented root slots, and an empty slotValues map).
 *
 * Two rules REJECT (retry/fail upstream) rather than fix: image assets (#8) and
 * size caps (#9). An unparseable structure (not a plain object, or no `layers`
 * array) is rejected before any rule runs.
 *
 * Result wording mirrors `motion-graphics-validator.ts` (autoFixed = "Fixed …"
 * style lines; errors = fatal reasons + dropped-structure notes).
 */

export interface LottieGraphicExpected {
  fps: number
  width: number
  height: number
  durationInFrames: number
  backgroundColor: string
}

export interface LottieGraphicValidationResult {
  /** Assembled plan; null when rejected. */
  plan: Record<string, unknown> | null
  /** Non-fatal issues (kept in output_data.validationErrors) + fatal reasons when rejected. */
  errors: string[]
  /** Human-readable auto-fix log. */
  autoFixed: string[]
  /** True for rules #8/#9 violations and unparseable structure. */
  rejected: boolean
}

/** The 20 self-hosted Google Fonts the renderer loads (drift-guarded against both the elements and lottie system prompts). */
export const LOTTIE_FONT_SAFELIST: readonly string[] = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Montserrat",
  "Poppins",
  "Raleway",
  "Nunito",
  "Lato",
  "Playfair Display",
  "Merriweather",
  "Lora",
  "EB Garamond",
  "Bebas Neue",
  "Oswald",
  "Anton",
  "Dancing Script",
  "Pacifico",
  "Caveat",
  "Roboto Mono",
  "Fira Code",
]

const MAX_SERIALIZED_BYTES = 131_072 // 128 KB
const MAX_LAYERS = 50
const BARE_SHAPE_TYPES = new Set(["el", "rc", "sh", "sr", "fl", "st", "gf", "gs"])
// Solid fill (`fl`) / stroke (`st`) store their color under `c`. Gradient
// fill/stroke (`gf`/`gs`) keep colors in `g.k` stop arrays, not `c`, so they are
// intentionally excluded — gradient-stop normalization is out of scope for v1.
const COLOR_ITEM_TYPES = new Set(["fl", "st"])

type JsonRecord = Record<string, unknown>

function isPlainObject(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function defaultTransform(): JsonRecord {
  return {
    ty: "tr",
    p: { a: 0, k: [0, 0] },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Every layer object the rules must reach: root `layers[]` + precomp `assets[].layers[]`. */
function collectLayers(doc: JsonRecord): JsonRecord[] {
  const out: JsonRecord[] = []
  const roots = doc.layers
  if (Array.isArray(roots)) for (const l of roots) if (isPlainObject(l)) out.push(l)
  const assets = doc.assets
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      if (isPlainObject(asset) && Array.isArray(asset.layers)) {
        for (const l of asset.layers) if (isPlainObject(l)) out.push(l)
      }
    }
  }
  return out
}

function totalLayerCount(doc: JsonRecord): number {
  return collectLayers(doc).length
}

// ── Rule 1: envelope fr/ip/op/w/h ──────────────────────────────────────────
function fixEnvelope(doc: JsonRecord, expected: LottieGraphicExpected, autoFixed: string[]): void {
  const targets: Array<[keyof JsonRecord, number]> = [
    ["fr", expected.fps],
    ["ip", 0],
    ["op", expected.durationInFrames],
    ["w", expected.width],
    ["h", expected.height],
  ]
  for (const [key, want] of targets) {
    if (doc[key] !== want) {
      autoFixed.push(`Fixed envelope ${String(key)} from ${JSON.stringify(doc[key])} to ${want}`)
      doc[key] = want
    }
  }
}

// ── Rule 2: clamp layer ip/op to [0, op] ───────────────────────────────────
function clampLayerTimes(doc: JsonRecord, op: number, autoFixed: string[]): void {
  for (const layer of collectLayers(doc)) {
    for (const key of ["ip", "op"] as const) {
      const v = layer[key]
      if (typeof v === "number") {
        const clamped = clamp(v, 0, op)
        if (clamped !== v) {
          autoFixed.push(`Clamped layer ${key} from ${v} to ${clamped}`)
          layer[key] = clamped
        }
      }
    }
  }
}

// ── Rule 3: wrap bare shape primitives; ensure groups end in tr ─────────────
function endsWithTransform(it: unknown[]): boolean {
  const last = it[it.length - 1]
  return isPlainObject(last) && last.ty === "tr"
}

/** Ensure an existing group's `it` ends with a tr, recursing into nested groups. */
function fixGroupItems(it: unknown[], autoFixed: string[]): void {
  for (const item of it) {
    if (isPlainObject(item) && item.ty === "gr" && Array.isArray(item.it)) {
      fixGroupItems(item.it, autoFixed)
    }
  }
  if (it.length > 0 && !endsWithTransform(it)) {
    it.push(defaultTransform())
    autoFixed.push("Appended a default transform to a group missing one")
  }
}

function wrapShapes(shapes: unknown[], autoFixed: string[]): unknown[] {
  const hasBare = shapes.some((s) => isPlainObject(s) && BARE_SHAPE_TYPES.has(s.ty as string))
  if (!hasBare) {
    // No bare primitives: still fix any existing groups in place.
    for (const item of shapes) {
      if (isPlainObject(item) && item.ty === "gr" && Array.isArray(item.it)) {
        fixGroupItems(item.it, autoFixed)
      }
    }
    return shapes
  }
  // Bare primitives present: collect every bare primitive into ONE group,
  // keep non-bare items (existing groups, modifiers) in their original order.
  const bare: unknown[] = []
  const others: unknown[] = []
  for (const item of shapes) {
    if (isPlainObject(item) && BARE_SHAPE_TYPES.has(item.ty as string)) bare.push(item)
    else {
      if (isPlainObject(item) && item.ty === "gr" && Array.isArray(item.it)) fixGroupItems(item.it, autoFixed)
      others.push(item)
    }
  }
  const group: JsonRecord = { ty: "gr", it: [...bare, defaultTransform()] }
  autoFixed.push(`Wrapped ${bare.length} bare shape primitive(s) in a group with a default transform`)
  return [group, ...others]
}

function fixShapeGrouping(doc: JsonRecord, autoFixed: string[]): void {
  for (const layer of collectLayers(doc)) {
    if (Array.isArray(layer.shapes)) {
      layer.shapes = wrapShapes(layer.shapes, autoFixed)
    }
  }
}

// ── Rule 4: normalize color components > 1 to [0, 1] ───────────────────────
function normalizeColorArray(arr: unknown[]): number[] | null {
  if (!arr.every((n) => typeof n === "number")) return null
  const nums = arr as number[]
  // Only touch arrays that contain an out-of-range component (a 0-255 channel).
  if (!nums.some((n) => n > 1)) return null
  // Scale RGB (indices 0-2) by 255. Alpha (index 3) is commonly already
  // normalized even when RGB is 0-255 (e.g. [255,128,0,1]) — only divide it by
  // 255 if alpha itself exceeds 1, otherwise leave it as-is.
  const out = nums.map((n, i) => (i < 3 || n > 1 ? clamp(n / 255, 0, 1) : clamp(n, 0, 1)))
  if (out.length === 3) out.push(1)
  return out
}

/** Apply rule 4 to one color property object `c` (`{ a, k }`). */
function fixColorProperty(c: JsonRecord, autoFixed: string[]): void {
  const k = c.k
  if (Array.isArray(k)) {
    if (k.length > 0 && isPlainObject(k[0])) {
      // Keyframed: each entry's s/e is a color array. Log once per property,
      // not once per s/e value (a 2-keyframe property has up to 3 such values).
      let didFix = false
      for (const kf of k) {
        if (!isPlainObject(kf)) continue
        for (const field of ["s", "e"] as const) {
          if (Array.isArray(kf[field])) {
            const fixed = normalizeColorArray(kf[field] as unknown[])
            if (fixed) {
              kf[field] = fixed
              didFix = true
            }
          }
        }
      }
      if (didFix) autoFixed.push("Normalized keyframed color components to 0-1 range")
    } else {
      // Static color array.
      const fixed = normalizeColorArray(k)
      if (fixed) {
        c.k = fixed
        autoFixed.push("Normalized color components to 0-1 range")
      }
    }
  }
}

function fixColors(node: unknown, autoFixed: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) fixColors(item, autoFixed)
    return
  }
  if (!isPlainObject(node)) return
  if (COLOR_ITEM_TYPES.has(node.ty as string) && isPlainObject(node.c)) {
    fixColorProperty(node.c as JsonRecord, autoFixed)
  }
  for (const value of Object.values(node)) fixColors(value, autoFixed)
}

// ── Rule 5: wrap bare-number keyframe s/e in single-element arrays ──────────
function fixKeyframeArrays(node: unknown, autoFixed: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) fixKeyframeArrays(item, autoFixed)
    return
  }
  if (!isPlainObject(node)) return
  if (node.a === 1 && Array.isArray(node.k)) {
    for (const kf of node.k) {
      if (!isPlainObject(kf)) continue
      for (const field of ["s", "e"] as const) {
        if (typeof kf[field] === "number") {
          kf[field] = [kf[field]]
          autoFixed.push(`Wrapped keyframe ${field} scalar in an array`)
        }
      }
    }
  }
  for (const value of Object.values(node)) fixKeyframeArrays(value, autoFixed)
}

// ── Rule 6: auto-add referenced-but-missing sids to slots ──────────────────
function collectSids(node: unknown, found: Map<string, unknown>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectSids(item, found)
    return
  }
  if (!isPlainObject(node)) return
  if (typeof node.sid === "string" && !found.has(node.sid)) {
    if ("k" in node) {
      const { sid: _sid, ...rest } = node
      found.set(node.sid, rest)
    } else {
      found.set(node.sid, null)
    }
  }
  for (const value of Object.values(node)) collectSids(value, found)
}

function addMissingSlots(doc: JsonRecord, slots: JsonRecord, autoFixed: string[]): void {
  const found = new Map<string, unknown>()
  collectSids(doc, found)
  for (const [sid, inline] of found) {
    if (sid in slots) continue
    slots[sid] = { p: inline === null ? { a: 0, k: 0 } : inline }
    autoFixed.push(`Auto-added missing slot "${sid}" from its inline value`)
  }
}

// ── Rule 7: delete string-valued "x" (expressions) anywhere ────────────────
function stripExpressions(node: unknown, path: string, autoFixed: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => stripExpressions(item, `${path}[${i}]`, autoFixed))
    return
  }
  if (!isPlainObject(node)) return
  if (typeof node.x === "string") {
    delete node.x
    autoFixed.push(`Expression stripped at ${path}.x`)
  }
  for (const [key, value] of Object.entries(node)) {
    stripExpressions(value, `${path}.${key}`, autoFixed)
  }
}

// ── Rule 8: reject image assets (vector-only) ──────────────────────────────
function hasImageAsset(doc: JsonRecord): boolean {
  const assets = doc.assets
  if (!Array.isArray(assets)) return false
  for (const asset of assets) {
    if (!isPlainObject(asset)) continue
    if ("layers" in asset) continue // precomp — allowed
    if ("p" in asset || "u" in asset) return true
  }
  return false
}

// ── Rule 10: strip external font refs; snap unknown families to Inter ──────
function fixFonts(doc: JsonRecord, autoFixed: string[]): void {
  const fonts = doc.fonts
  if (!isPlainObject(fonts) || !Array.isArray(fonts.list)) return
  for (const font of fonts.list) {
    if (!isPlainObject(font)) continue
    for (const key of ["fPath", "fOrigin", "origin"] as const) {
      if (key in font) {
        delete font[key]
        autoFixed.push(`Removed external font reference "${key}"`)
      }
    }
    if (typeof font.fFamily === "string" && !LOTTIE_FONT_SAFELIST.includes(font.fFamily)) {
      autoFixed.push(`Snapped font family "${font.fFamily}" to "Inter"`)
      font.fFamily = "Inter"
    }
  }
}

export function validateLottieGraphic(
  raw: unknown,
  expected: LottieGraphicExpected,
): LottieGraphicValidationResult {
  const errors: string[] = []
  const autoFixed: string[] = []

  // Structural gate (before any rule).
  if (!isPlainObject(raw) || !Array.isArray((raw as JsonRecord).layers)) {
    errors.push("Lottie document must be an object with an array `layers`.")
    return { plan: null, errors, autoFixed, rejected: true }
  }

  const doc = structuredClone(raw) as JsonRecord

  // Extract root slots (assembled separately, not part of the lottie document).
  const slots: JsonRecord = {}
  if ("slots" in doc) {
    const rootSlots = doc.slots
    if (isPlainObject(rootSlots)) {
      for (const [k, v] of Object.entries(rootSlots)) slots[k] = v
    } else {
      errors.push("Root `slots` was not a plain object; dropped.")
    }
    delete doc.slots
  }

  // Rules in order.
  fixEnvelope(doc, expected, autoFixed) // #1
  clampLayerTimes(doc, expected.durationInFrames, autoFixed) // #2
  fixShapeGrouping(doc, autoFixed) // #3
  fixColors(doc, autoFixed) // #4
  fixKeyframeArrays(doc, autoFixed) // #5
  addMissingSlots(doc, slots, autoFixed) // #6
  stripExpressions(doc, "lottie", autoFixed) // #7
  // #7 also covers the extracted slots: root-provided slots are never part of
  // `doc`, and rule #6 can copy a sid node's inline value (with a string `x`)
  // into a new slot. `applySlots` substitutes the whole `p` object back into the
  // renderable surface, so an un-stripped expression would re-enter there.
  stripExpressions(slots, "slots", autoFixed)

  // #8 — image assets (reject).
  if (hasImageAsset(doc)) {
    errors.push("Image assets are not supported (vector-only).")
    return { plan: null, errors, autoFixed, rejected: true }
  }

  fixFonts(doc, autoFixed) // #10 (fonts) — applied before size cap so it counts toward the limit

  // #9 — size caps AFTER fixes.
  const layerCount = totalLayerCount(doc)
  if (layerCount > MAX_LAYERS) {
    errors.push(`Too many layers: ${layerCount} (limit ${MAX_LAYERS}).`)
    return { plan: null, errors, autoFixed, rejected: true }
  }
  const serializedLength = JSON.stringify(doc).length
  if (serializedLength > MAX_SERIALIZED_BYTES) {
    errors.push(`Lottie document too large: ${serializedLength} bytes (limit ${MAX_SERIALIZED_BYTES}).`)
    return { plan: null, errors, autoFixed, rejected: true }
  }

  const plan: Record<string, unknown> = {
    planType: "lottie-graphic",
    fps: expected.fps,
    width: expected.width,
    height: expected.height,
    durationInFrames: expected.durationInFrames,
    backgroundColor: expected.backgroundColor,
    lottie: doc,
    slots,
    slotValues: {},
  }

  return { plan, errors, autoFixed, rejected: false }
}
