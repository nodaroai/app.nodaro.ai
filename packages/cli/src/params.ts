import { readFileSync } from "node:fs"
import type { WizardSelection } from "@nodaro/shared"

/**
 * Strict "true"/"false" → boolean coercion for CLI flags whose value commander
 * hands us as a raw string. Throws on anything else so users don't silently
 * pass `--style-lock yes` and get `false`.
 *
 * Shared across update commands that accept tristate-ish toggles.
 */
export function parseBoolFlag(raw: string, flagName: string): boolean {
  if (raw === "true") return true
  if (raw === "false") return false
  throw new Error(`--${flagName} must be "true" or "false" (got "${raw}")`)
}

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

/**
 * Parse `--selection category=value` (repeatable) into WizardSelection[].
 * Unlike parseParamPairs: preserves string values (NO primitive coercion),
 * allows duplicate categories (NO last-wins), splits on the first `=`. The
 * scriptable path always sets isCustom:false (custom answers are wizard-only).
 */
export function parseSelectionPairs(pairs: string[] | undefined): WizardSelection[] {
  if (!pairs || pairs.length === 0) return []
  const out: WizardSelection[] = []
  for (const raw of pairs) {
    const eq = raw.indexOf("=")
    if (eq < 0) throw new Error(`invalid --selection "${raw}": expected category=value`)
    const category = raw.slice(0, eq).trim()
    const value = raw.slice(eq + 1)
    if (!category) throw new Error(`invalid --selection "${raw}": empty category`)
    out.push({ category, value, isCustom: false })
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

/**
 * Combined helper used by `apps run` and `nodes run` — loads a JSON file (if
 * `filePath` is given), parses any `--param key=value` flags, and merges so
 * flag values override file values for the same key. Either input may be
 * absent.
 */
export function resolveParams(
  pairs: string[] | undefined,
  filePath: string | undefined,
): Record<string, unknown> {
  const fromFile = filePath ? loadParamsFile(filePath) : {}
  const fromFlags = parseParamPairs(pairs)
  return mergeParams(fromFile, fromFlags)
}
