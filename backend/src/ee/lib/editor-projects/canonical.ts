import { createHash } from "node:crypto"

/**
 * The canonical text of a saved video-editor project, and its hash.
 *
 * A save is identified by the SHA-256 of this text. The editor writes it and
 * the platform writes it again from what it parsed, so both must produce the
 * same text for the same value: `JSON.stringify` with every object's keys
 * sorted by UTF-16 code unit at every depth (plain `.sort()`, never a locale
 * comparison), arrays in order, no whitespace. The text is built by hand, not
 * through a `JSON.stringify` replacer, because an engine always lists
 * integer-like keys ("9", "10") first, in numeric order, whatever order they
 * were added in.
 *
 * `__tests__/canonical-vectors.json` holds ten values with their expected
 * text and hash; the editor carries the same file.
 */

/** The canonical JSON text of `value`. Throws a TypeError for what JSON cannot write. */
export function canonicalJson(value: unknown): string {
  const text = write(value, "", new Set())
  if (text === undefined) throw new TypeError("canonicalJson: the value has no JSON text")
  return text
}

/** SHA-256 of the text's UTF-8 bytes, as 64 lowercase hex characters. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** A content hash as the platform stores it: 64 lowercase hex characters. */
export const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/

/** One value's text, or undefined where JSON has none (an object member is then left out). */
function write(input: unknown, key: string, open: Set<object>): string | undefined {
  let value = input
  if (value !== null && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    value = (value as { toJSON: (key: string) => unknown }).toJSON(key)
  }
  switch (typeof value) {
    case "string":
      return JSON.stringify(value)
    case "number":
      // As JSON.stringify writes them: -0 as 0, 1e21 as 1e+21, NaN and ±Infinity as null.
      return Number.isFinite(value) ? JSON.stringify(value) : "null"
    case "boolean":
      return value ? "true" : "false"
    case "bigint":
      throw new TypeError("canonicalJson: a BigInt has no JSON text")
    case "undefined":
    case "function":
    case "symbol":
      return undefined
  }
  if (value === null) return "null"
  const object = value as object
  if (open.has(object)) throw new TypeError("canonicalJson: the value contains itself")
  open.add(object)
  try {
    if (Array.isArray(object)) {
      // Array.from, not map: a hole is written as null, as JSON.stringify does.
      return `[${Array.from(object, (item, index) => write(item, String(index), open) ?? "null").join(",")}]`
    }
    const record = object as Record<string, unknown>
    const members: string[] = []
    for (const name of Object.keys(record).sort()) {
      const text = write(record[name], name, open)
      if (text !== undefined) members.push(`${JSON.stringify(name)}:${text}`)
    }
    return `{${members.join(",")}}`
  } finally {
    open.delete(object)
  }
}
