import { readFileSync } from "node:fs"

/**
 * Parse `--param key=value` (and `--input key=value` for apps) into an object.
 * Coerces obvious primitives (`true`/`false`/numbers) — leaves everything else
 * as strings. Supports multiple `=` in the value (only the first splits the
 * key from the rest, so a value can contain `=` characters).
 *
 *   --param prompt=hello              → { prompt: "hello" }
 *   --param duration=8                → { duration: 8 }
 *   --param generateAudio=true        → { generateAudio: true }
 *   --param prompt="a=b"              → { prompt: "a=b" }
 *
 * Repeated keys overwrite (last wins). For typed JSON values (arrays, objects,
 * null), use `--params-file file.json` instead — see `loadParamsFile`.
 */
export function parseParamPairs(pairs: string[] | undefined): Record<string, unknown> {
  if (!pairs || pairs.length === 0) return {}
  const out: Record<string, unknown> = {}
  for (const raw of pairs) {
    const eq = raw.indexOf("=")
    if (eq < 0) {
      throw new Error(`invalid param "${raw}": expected key=value`)
    }
    const key = raw.slice(0, eq).trim()
    const value = raw.slice(eq + 1)
    if (!key) throw new Error(`invalid param "${raw}": empty key`)
    out[key] = coerce(value)
  }
  return out
}

function coerce(value: string): unknown {
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null") return null
  // Integer or float — but only if the WHOLE value is numeric
  if (/^-?\d+$/.test(value)) return Number(value)
  if (/^-?\d*\.\d+$/.test(value)) return Number(value)
  return value
}

/**
 * Load parameters from a JSON file. The file must parse as a JSON object;
 * arrays or scalars at the top level are rejected because the caller wants
 * a key-value map.
 */
export function loadParamsFile(path: string): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (err) {
    throw new Error(`cannot read --params-file ${path}: ${(err as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`--params-file ${path} is not valid JSON: ${(err as Error).message}`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`--params-file ${path} must contain a JSON object at the top level`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Merge params from a file (lower priority) with --param flags (higher
 * priority). Returns a new object; neither input is mutated.
 */
export function mergeParams(
  fromFile: Record<string, unknown>,
  fromFlags: Record<string, unknown>,
): Record<string, unknown> {
  return { ...fromFile, ...fromFlags }
}
