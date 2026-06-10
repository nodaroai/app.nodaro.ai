/**
 * Lottie slot substitution — single source of truth (design §5).
 *
 * A slotted property is an object containing a `sid` key (canonically exactly
 * `{"sid": "name"}`; tolerantly also the annotation form `{a, k, sid}`). The
 * slot manifest maps sid → { p: <whatever belongs at the reference position> }.
 * Overrides map sid → raw value (what UI controls write).
 *
 * KEY CONVENTION: a slot's `p` is, by design, EXACTLY what belongs at the
 * reference position — and we substitute it VERBATIM, never auto-wrapping it in
 * an `{a:0,k:...}` envelope. At a property position (a fill color, a shape size)
 * that means `p` is a property object like `{"a":0,"k":[1,0,0,1]}`. At a RAW
 * position inside a text document — `layers[].t.d.k[0].s.t`, where lottie-web's
 * `buildFinalText` iterates string characters — `p` is a BARE string, e.g.
 * `{ "nameText": { "p": "John Smith" } }` substitutes the string `"John Smith"`
 * straight onto `s.t`. (Auto-wrapping there produced `{a:0,k:"John Smith"}` and
 * broke text rendering — the defect this contract fixes.)
 *
 * An override is wrapped ONLY when it lands on a property-object default: the
 * `{...p, k: override}` form preserves the default's envelope (animated/static
 * flags). On a raw default (or a missing slot) the override is substituted
 * verbatim too — so a raw text override stays a bare string.
 *
 * Substitution is renderer-agnostic: we replace every sid node ourselves and
 * never rely on lottie-web's version-dependent native slot support.
 */

type JsonRecord = Record<string, unknown>

function isPlainObject(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** True when `p` already looks like a lottie animated-property object. */
function isPropertyObject(v: unknown): v is JsonRecord {
  return isPlainObject(v) && "k" in v
}

function resolveSlotNode(
  node: JsonRecord,
  slots: JsonRecord,
  overrides: JsonRecord,
): unknown {
  const sid = node.sid as string
  const slot = slots[sid]
  const slotP = isPlainObject(slot) ? (slot as JsonRecord).p : undefined
  const override = overrides[sid]

  if (override !== undefined) {
    // Wrap into the default's property-object envelope when the default IS one
    // (preserves animated/static flags); otherwise substitute the raw override
    // verbatim — a raw text override must stay a bare string at `s.t`.
    if (isPropertyObject(slotP)) return { ...slotP, k: structuredClone(override) }
    return structuredClone(override)
  }
  if (slotP !== undefined) {
    // `p` is by convention exactly what belongs at the reference position —
    // substitute it verbatim, never auto-wrap (a bare string stays a string).
    return structuredClone(slotP)
  }
  // No slot, no override — leave the node as-is (validator rule #6 should
  // prevent this; belt-and-braces for hand-fed documents).
  return node
}

function walk(value: unknown, slots: JsonRecord, overrides: JsonRecord): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, slots, overrides))
  }
  if (isPlainObject(value)) {
    if (typeof value.sid === "string") {
      const resolved = resolveSlotNode(value, slots, overrides)
      // The original node comes back only in the missing-slot case; replacements
      // are leaf property objects and need no further walking.
      if (resolved === value) {
        const copy: JsonRecord = {}
        for (const [k, v] of Object.entries(value)) copy[k] = walk(v, slots, overrides)
        return copy
      }
      return resolved
    }
    const copy: JsonRecord = {}
    for (const [k, v] of Object.entries(value)) copy[k] = walk(v, slots, overrides)
    return copy
  }
  return value
}

/** Pure: returns a new document; never mutates inputs. */
export function applySlots(
  lottie: JsonRecord,
  slots: JsonRecord | undefined,
  overrides: JsonRecord | undefined,
): JsonRecord {
  return walk(lottie, slots ?? {}, overrides ?? {}) as JsonRecord
}

// ── Slot control descriptors (Phase 2 — UI mapping) ──────────────────────────
//
// A slot manifest entry is `{ p: <whatever belongs at the reference position> }`
// (Amendment 1). `describeSlotControl` unwraps that envelope to the editable raw
// value and classifies it into the control kind the config panel should render.
// `p` is either a property object `{a, k}` (colors, sizes, scalars) whose `k`
// holds the value, or a bare raw value (text strings live unwrapped at `s.t`).

export type SlotControlKind = "color" | "text" | "number" | "point"
export interface SlotControlDescriptor {
  kind: SlotControlKind
  value: unknown
}

/**
 * Unwraps a slot entry to its editable raw value and classifies it:
 *   {p:{a:0,k:[1,0,0,1]}} → { kind:"color", value:[1,0,0,1] }
 *   {p:"John"}            → { kind:"text",  value:"John" }
 *   {p:{a:0,k:42}}        → { kind:"number", value:42 }
 *   {p:{a:0,k:[10,20]}}   → { kind:"point", value:[10,20] }
 * Animated property objects (`a:1`) and anything that doesn't map to a known
 * control kind return null (no editable control).
 */
export function describeSlotControl(slot: unknown): SlotControlDescriptor | null {
  if (!isPlainObject(slot)) return null
  const p = (slot as JsonRecord).p
  let value: unknown = p
  if (isPropertyObject(p)) {
    if ((p as JsonRecord).a === 1) return null
    value = (p as JsonRecord).k
  }
  if (typeof value === "string") return { kind: "text", value }
  if (typeof value === "number") return { kind: "number", value }
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === "number" && n >= 0 && n <= 1)
  ) {
    return { kind: "color", value }
  }
  if (Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number")) {
    return { kind: "point", value }
  }
  return null
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function toHexByte(component: number): string {
  return Math.round(clamp01(component) * 255)
    .toString(16)
    .padStart(2, "0")
}

/**
 * RGBA array (components 0..1) → hex string. The alpha component is omitted
 * when it is exactly 1 (`[1,0,0,1]` → `"#ff0000"`); otherwise an 8-digit hex is
 * emitted (`[0,1,0,0.5]` → `"#00ff0080"`). Output is always lowercase.
 */
export function rgbaArrayToHex(rgba: number[]): string {
  const [r = 0, g = 0, b = 0, a = 1] = rgba
  const base = `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`
  return a >= 1 ? base : `${base}${toHexByte(a)}`
}

/**
 * Hex string → RGBA array (components 0..1). Accepts `#rgb`, `#rrggbb`, and
 * `#rrggbbaa`; alpha defaults to 1 when absent. Leading `#` is optional.
 */
export function hexToRgbaArray(hex: string): number[] {
  let h = hex.trim().replace(/^#/, "")
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("")
  }
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return [r, g, b, a]
}

/** Manifest sids in insertion order (drives the slot-control list ordering). */
export function listSlotSids(slots: Record<string, unknown>): string[] {
  return Object.keys(slots ?? {})
}
