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
