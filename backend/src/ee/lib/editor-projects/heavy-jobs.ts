import { gunzipSync, gzipSync } from "node:zlib"
import type { Operation } from "fast-json-patch"
import { canonicalJson, contentHash } from "./canonical.js"
import { PATCH_TEXT_MAX_BYTES, PROJECT_TEXT_MAX_BYTES } from "./limits.js"
import { MAX_INDEX_OPS, applyProjectPatch, checkedPatch } from "./patch.js"
import { EditorProjectRefusal, refuse } from "./refusal.js"
import { rebuildVersionText, storesAsPatch } from "./versions.js"

/**
 * The CPU-heavy work of the editor-project routes, as whole pipelines from
 * bytes to bytes: inflating, parsing, applying a patch, canonicalising,
 * hashing, diffing and gzipping. Every job runs on the heavy-work thread
 * (`heavy.ts` → `heavy-worker.ts`), with a wall-clock and a memory limit;
 * nothing here runs on a request thread, and a job hands back only bytes and
 * flags, never a parsed value. Pure: no storage, no database, no logging.
 *
 * Refusals are thrown as `EditorProjectRefusal` (`refusal.ts`) and answered
 * as they are; the inflate cap is enforced while inflating, so a small body
 * never makes the thread hold more than the cap.
 */

/** A cut stores a version as a patch only when both canonical texts are at most this. */
export const DIFF_TEXT_MAX_BYTES = 2 * 1024 * 1024
/** A cut's diff stops, and the version is stored whole, once it has more operations than this. */
export const DIFF_MAX_OPS = 50_000

export type HeavyJob =
  /** PUT: the body's gzip to the canonical text and its gzip, checked against `hash`. */
  | { kind: "content"; body: Uint8Array; hash: string }
  /** PATCH: the client's patch applied to the saved file, checked against `hash`. */
  | { kind: "patch"; patch: Uint8Array; base: Uint8Array; hash: string }
  /** Whether a stored project file inflates to text with this hash, and that text's size. */
  | { kind: "verify"; file: Uint8Array; hash: string }
  /** A cut: the gzip of a patch from the full version `base` to `current`, or none (store whole). */
  | { kind: "diff"; base: Uint8Array; baseHash: string; current: Uint8Array; currentHash: string }
  /** A version's whole content, rebuilt and verified, as gzip. */
  | { kind: "version"; file: Uint8Array; version: VersionToRebuild; base: { file: Uint8Array; content_hash: string } | null }

export interface VersionToRebuild {
  kind: "full" | "patch"
  content_hash: string
}

export type HeavyResult =
  | { kind: "content"; text: Uint8Array; gz: Uint8Array }
  | { kind: "verified"; ok: boolean; textBytes: number }
  | { kind: "diff"; patch: Uint8Array | null }
  | { kind: "version"; gz: Uint8Array }

export function runHeavyJob(job: HeavyJob): HeavyResult {
  switch (job.kind) {
    case "content":
      return contentOf(parseJson(inflate(job.body, PROJECT_TEXT_MAX_BYTES)), job.hash)
    case "patch": {
      // The op rules first, before the saved content is inflated.
      const ops = checkedPatch(parseJson(inflate(job.patch, PATCH_TEXT_MAX_BYTES)), { indexBudget: MAX_INDEX_OPS })
      const base = parseJson(inflate(job.base, PROJECT_TEXT_MAX_BYTES))
      return contentOf(applyProjectPatch(base, ops), job.hash)
    }
    case "verify": {
      const text = textWithHash(job.file, job.hash)
      return { kind: "verified", ok: text !== null, textBytes: text === null ? 0 : Buffer.byteLength(text, "utf8") }
    }
    case "diff":
      return { kind: "diff", patch: diffOf(job) }
    case "version":
      return { kind: "version", gz: own(gzipSync(Buffer.from(versionText(job), "utf8"))) }
  }
}

/** `gz` inflated, refused past `maxBytes` (413 `too_large`) or when it is not gzip (400 `invalid_gzip`). */
export function inflate(gz: Uint8Array, maxBytes: number): Buffer {
  try {
    return gunzipSync(gz, { maxOutputLength: maxBytes })
  } catch (err) {
    if ((err as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE") throw refuse(413, "too_large")
    throw refuse(400, "invalid_gzip")
  }
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"))
  } catch {
    throw refuse(400, "invalid_json")
  }
}

/** The canonical text of `value` and its gzip, refused over the cap (413) or when its hash is not `expected` (422). */
function contentOf(value: unknown, expected: string): HeavyResult {
  let text: string
  try {
    text = canonicalJson(value)
  } catch {
    throw refuse(400, "invalid_json")
  }
  const bytes = Buffer.from(text, "utf8")
  if (bytes.length > PROJECT_TEXT_MAX_BYTES) throw refuse(413, "too_large")
  if (contentHash(text) !== expected) throw refuse(422, "hash_mismatch")
  return { kind: "content", text: own(bytes), gz: own(gzipSync(bytes)) }
}

/** The file's text when it inflates within the cap and hashes to `hash`, else null. */
function textWithHash(file: Uint8Array, hash: string): string | null {
  let text: string
  try {
    text = inflate(file, PROJECT_TEXT_MAX_BYTES).toString("utf8")
  } catch (err) {
    if (err instanceof EditorProjectRefusal) return null
    throw err
  }
  return contentHash(text) === hash ? text : null
}

/**
 * A patch version's gzip, or null to store the version whole: when either
 * text is unverifiable or over `DIFF_TEXT_MAX_BYTES`, when the diff passes
 * `DIFF_MAX_OPS` operations, when its gzip is not under a quarter of the
 * whole's, or when it does not rebuild to the current content exactly as a
 * read will rebuild it.
 */
function diffOf(job: Extract<HeavyJob, { kind: "diff" }>): Uint8Array | null {
  const baseText = textWithHash(job.base, job.baseHash)
  const currentText = baseText === null ? null : textWithHash(job.current, job.currentHash)
  if (baseText === null || currentText === null) return null
  if (Buffer.byteLength(baseText, "utf8") > DIFF_TEXT_MAX_BYTES || Buffer.byteLength(currentText, "utf8") > DIFF_TEXT_MAX_BYTES) return null
  const ops = boundedCompare(JSON.parse(baseText), JSON.parse(currentText), DIFF_MAX_OPS)
  if (ops === null) return null
  const patchText = canonicalJson(ops)
  if (Buffer.byteLength(patchText, "utf8") > PROJECT_TEXT_MAX_BYTES) return null
  const gz = gzipSync(Buffer.from(patchText, "utf8"))
  if (!storesAsPatch(gz.length, job.current.byteLength)) return null
  try {
    rebuildVersionText({ kind: "patch", content_hash: job.currentHash }, patchText, baseText)
  } catch {
    return null
  }
  return own(gz)
}

/** A version's rebuilt, verified canonical text (500 `version_unreadable` otherwise). */
function versionText(job: Extract<HeavyJob, { kind: "version" }>): string {
  const fileText = versionFileText(job.file)
  if (job.version.kind === "full") return rebuildVersionText(job.version, fileText, null)
  if (!job.base) throw refuse(500, "version_unreadable")
  const baseText = rebuildVersionText({ kind: "full", content_hash: job.base.content_hash }, versionFileText(job.base.file), null)
  return rebuildVersionText(job.version, fileText, baseText)
}

function versionFileText(file: Uint8Array): string {
  try {
    return inflate(file, PROJECT_TEXT_MAX_BYTES).toString("utf8")
  } catch (err) {
    if (err instanceof EditorProjectRefusal) throw refuse(500, "version_unreadable")
    throw err
  }
}

const escapeSegment = (key: string) => (key.includes("/") || key.includes("~") ? key.replace(/~/g, "~0").replace(/\//g, "~1") : key)

const isContainer = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

/**
 * The JSON Patch from `a` to `b`, as fast-json-patch's `compare` writes it
 * (the same walk: removals from the last key down, then additions), or null
 * once it passes `maxOps` operations: the walk stops there, so a difference
 * of millions of elements never builds millions of operations. Values are
 * referenced, not copied (the caller writes them out at once).
 */
export function boundedCompare(a: unknown, b: unknown, maxOps: number): Operation[] | null {
  const ops: Operation[] = []
  const push = (op: Operation) => {
    if (ops.length >= maxOps) throw TOO_MANY
    ops.push(op)
  }
  const walk = (mirror: Record<string, unknown>, obj: Record<string, unknown>, path: string) => {
    if (mirror === obj) return
    const newKeys = Object.keys(obj)
    const oldKeys = Object.keys(mirror)
    let deleted = false
    for (let t = oldKeys.length - 1; t >= 0; t--) {
      const key = oldKeys[t]!
      const oldVal = mirror[key]
      const at = `${path}/${escapeSegment(key)}`
      if (Object.hasOwn(obj, key) && !(obj[key] === undefined && oldVal !== undefined && !Array.isArray(obj))) {
        const newVal = obj[key]
        if (isContainer(oldVal) && isContainer(newVal) && Array.isArray(oldVal) === Array.isArray(newVal)) walk(oldVal, newVal, at)
        else if (oldVal !== newVal) push({ op: "replace", path: at, value: newVal })
      } else if (Array.isArray(mirror) === Array.isArray(obj)) {
        push({ op: "remove", path: at })
        deleted = true
      } else {
        push({ op: "replace", path, value: obj })
      }
    }
    if (!deleted && newKeys.length === oldKeys.length) return
    for (const key of newKeys) {
      if (!Object.hasOwn(mirror, key) && obj[key] !== undefined) push({ op: "add", path: `${path}/${escapeSegment(key)}`, value: obj[key] })
    }
  }
  try {
    if (isContainer(a) && isContainer(b) && Array.isArray(a) === Array.isArray(b)) walk(a, b, "")
    else if (a !== b) push({ op: "replace", path: "", value: b })
  } catch (err) {
    if (err === TOO_MANY) return null
    throw err
  }
  return ops
}

const TOO_MANY = new Error("too many operations")

/** Bytes this thread owns outright, so they can be transferred (a pooled Buffer's memory cannot). */
function own(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}
