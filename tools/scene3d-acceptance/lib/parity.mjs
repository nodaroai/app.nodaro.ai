/**
 * Server-side input parity for a controlled A/B.
 *
 * The claim an A/B makes is "only the thing under test differs". That claim is
 * about what the SERVER stored, not about what the harness believes it sent —
 * a route that normalizes, defaults or injects a field can make two locally
 * identical bodies arrive as two different requests. So parity is checked by
 * reading both jobs' `input_data` back and diffing THOSE.
 *
 * Pure. No network: the caller fetches, this compares.
 */

/**
 * Order-insensitive for object keys, order-SENSITIVE for arrays.
 *
 * `undefined` is given its own token rather than collapsing into `null`: a key
 * the server stored as null on one arm and did not store at all on the other
 * is exactly the kind of quiet asymmetry this comparison exists to catch, and
 * `JSON.stringify(undefined)` is `undefined`, which would hide it.
 */
const ABSENT = "\u0000absent"

function stableStringify(value) {
  if (value === undefined) return ABSENT
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? ABSENT
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`
}

export function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b)
}

/** Every top-level key present in either object whose values differ. */
export function differingKeys(a, b) {
  const left = a && typeof a === "object" ? a : {}
  const right = b && typeof b === "object" ? b : {}
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  return keys.filter((key) => !deepEqual(left[key], right[key]))
}

/**
 * The A/B's parity verdict.
 *
 * `allowed` is the set of keys the experiment DELIBERATELY varies. Anything
 * else that differs is `unexpected` and fails parity — including a key that
 * differs only because one arm carried it and the other did not.
 *
 * Values are summarised, never dumped: a full prompt body in the diff would
 * make the receipt unreadable and would repeat content already recorded under
 * `inputs`.
 */
export function compareInputs(a, b, options = {}) {
  const allowed = new Set(options.allowed ?? ["prompt", "userPrompt", "referenceVideoUrls"])
  const differing = differingKeys(a, b)
  const unexpected = differing.filter((key) => !allowed.has(key))
  return {
    allowed: [...allowed],
    differingKeys: differing,
    unexpectedKeys: unexpected,
    summary: differing.map((key) => ({
      key,
      a: summarize(a?.[key]),
      b: summarize(b?.[key]),
      expected: allowed.has(key),
    })),
    pass: unexpected.length === 0,
  }
}

/** A short, safe description of a value: shape and size, not content. */
export function summarize(value) {
  if (value === undefined) return { kind: "absent" }
  if (value === null) return { kind: "null" }
  if (Array.isArray(value)) return { kind: "array", length: value.length, items: value.map(summarize) }
  if (typeof value === "string") return { kind: "string", length: value.length, sha: shortHash(value) }
  if (typeof value === "object") return { kind: "object", keys: Object.keys(value).sort() }
  return { kind: typeof value, value }
}

/**
 * A short, stable, non-cryptographic digest, used only to say "these two
 * strings are/are not the same" inside a receipt without reprinting either.
 */
export function shortHash(text) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`
}

/**
 * The half of an A/B prompt the two arms are supposed to SHARE.
 *
 * Arm B is arm A plus a scoping sentence, so the shared body is arm A verbatim
 * and the addition is what is left. Compared by digest so the receipt proves
 * the common body was identical without carrying it twice.
 */
export function comparePromptBodies(promptA, promptB) {
  const trimmedA = (promptA ?? "").trim()
  const trimmedB = (promptB ?? "").trim()
  const bStartsWithA = trimmedB.startsWith(trimmedA)
  return {
    commonBodySha: shortHash(trimmedA),
    armBSha: shortHash(trimmedB),
    armBExtendsArmA: bStartsWithA,
    addedText: bStartsWithA ? trimmedB.slice(trimmedA.length).trim() : null,
    pass: bStartsWithA && trimmedB.length > trimmedA.length,
  }
}
