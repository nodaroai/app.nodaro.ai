/**
 * The receipt: what a run actually did, written so it can be committed.
 *
 * Two properties matter more than the schema itself.
 *
 * ONE — it is written EARLY and rewritten on every material step, not composed
 * at the end. A 30-second 21:9 Pro run with two repair passes is a long,
 * expensive, cancellable operation; a harness that only writes evidence after
 * the last assertion loses the whole run to a poll exception, and the credits
 * are still spent.
 *
 * TWO — nothing that reaches it may carry a secret. The API key is passed on a
 * header the harness constructs, never echoed into inputs, and every finished
 * receipt is scanned before it is written. A committed receipt that leaks a key
 * is worse than no receipt.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const RECEIPT_SCHEMA_VERSION = 1

/** Terminal verdicts a receipt can carry. `in-progress` is written mid-run. */
export const RECEIPT_STATUSES = Object.freeze(["in-progress", "passed", "failed", "unavailable", "error"])

export function createReceipt({ subcommand, runId, baseUrl, inputs = {}, notes = [] }) {
  if (!subcommand) throw new Error("receipt: subcommand is required")
  if (!runId) throw new Error("receipt: runId is required")
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    subcommand,
    runId,
    // Host only. A base URL can carry a token in a query string; a hostname
    // cannot, and the hostname is the only part an operator needs to read.
    baseUrlHost: hostOf(baseUrl),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "in-progress",
    pass: null,
    inputs,
    quote: null,
    jobs: [],
    credits: { balanceBefore: null, balanceAfter: null, committed: null, transactions: [] },
    timings: {},
    measurements: {},
    outputs: {},
    assertions: [],
    notes: [...notes],
  }
}

function hostOf(baseUrl) {
  if (!baseUrl) return null
  try {
    return new URL(baseUrl).host
  } catch {
    return String(baseUrl).replace(/^https?:\/\//, "").split("/")[0] || null
  }
}

/**
 * Record one assertion and return whether it passed, so a caller can branch on
 * the same value the receipt keeps. `expected` and `actual` are stored as given
 * — an assertion the reader cannot re-derive is not evidence.
 */
export function assert(receipt, name, { expected, actual, pass, detail }) {
  const verdict = typeof pass === "boolean" ? pass : deepEquals(expected, actual)
  receipt.assertions.push({
    name,
    expected: expected ?? null,
    actual: actual ?? null,
    pass: verdict,
    ...(detail === undefined ? {} : { detail }),
    at: new Date().toISOString(),
  })
  return verdict
}

function deepEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Add or replace a job record, keyed by job id. */
export function recordJob(receipt, job) {
  if (!job?.jobId) throw new Error("receipt: a job record needs a jobId")
  const existing = receipt.jobs.findIndex((j) => j.jobId === job.jobId)
  const merged = existing >= 0 ? { ...receipt.jobs[existing], ...job } : job
  if (existing >= 0) receipt.jobs[existing] = merged
  else receipt.jobs.push(merged)
  return merged
}

export function addNote(receipt, note) {
  receipt.notes.push(note)
  return receipt
}

/**
 * Seal the receipt.
 *
 * `pass` is the conjunction of every recorded assertion — never a separately
 * maintained flag, which is how a harness ends up reporting a pass it did not
 * measure. A run with no assertions at all is NOT a pass.
 */
export function finalize(receipt, { status } = {}) {
  const allPassed = receipt.assertions.length > 0 && receipt.assertions.every((a) => a.pass)
  receipt.pass = allPassed
  receipt.finishedAt = new Date().toISOString()
  receipt.status = status ?? (allPassed ? "passed" : "failed")
  if (!RECEIPT_STATUSES.includes(receipt.status)) throw new Error(`receipt: unknown status ${receipt.status}`)
  return receipt
}

/** Structural problems with a receipt, as a list. Empty means valid. */
export function validateReceipt(receipt) {
  const issues = []
  if (!receipt || typeof receipt !== "object") return ["receipt is not an object"]
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) issues.push("schemaVersion mismatch")
  for (const key of ["subcommand", "runId", "startedAt", "status", "inputs", "jobs", "assertions", "credits"]) {
    if (receipt[key] === undefined) issues.push(`missing ${key}`)
  }
  if (!RECEIPT_STATUSES.includes(receipt.status)) issues.push(`unknown status ${receipt.status}`)
  if (!Array.isArray(receipt.jobs)) issues.push("jobs is not an array")
  if (!Array.isArray(receipt.assertions)) issues.push("assertions is not an array")
  for (const [i, a] of (receipt.assertions ?? []).entries()) {
    if (!a || typeof a.name !== "string") issues.push(`assertion ${i} has no name`)
    else if (typeof a.pass !== "boolean") issues.push(`assertion "${a.name}" has no boolean pass`)
    if (a && !("expected" in a)) issues.push(`assertion "${a?.name}" has no expected`)
    if (a && !("actual" in a)) issues.push(`assertion "${a?.name}" has no actual`)
  }
  if (receipt.status !== "in-progress" && typeof receipt.pass !== "boolean") issues.push("finished receipt has no pass verdict")
  if (receipt.status !== "in-progress" && receipt.pass === true && receipt.assertions.length === 0) {
    issues.push("passed with no assertions")
  }
  return issues
}

/**
 * Patterns that must never appear in a committed receipt.
 *
 * The literal key is checked separately (it is only known at runtime); these
 * catch the shapes a key or token takes when something copies a header, a
 * config file or an error body into the evidence by accident.
 */
export const SECRET_PATTERNS = Object.freeze([
  { id: "nodaro-api-key", pattern: /\bndr_[A-Za-z0-9_-]{6,}/ },
  { id: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/i },
  { id: "supabase-jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { id: "authorization-header", pattern: /"authorization"\s*:/i },
  { id: "api-key-env", pattern: /NODARO_API_KEY\s*[:=]\s*["']?[A-Za-z0-9]/ },
  { id: "service-role", pattern: /SERVICE_ROLE_KEY\s*[:=]\s*["']?[A-Za-z0-9]/i },
])

/** Every secret finding in a receipt. Empty means safe to commit. */
export function findSecrets(receipt, literals = []) {
  const text = JSON.stringify(receipt)
  const findings = []
  for (const { id, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) findings.push(id)
  }
  for (const literal of literals) {
    if (typeof literal === "string" && literal.length >= 8 && text.includes(literal)) findings.push("literal-credential")
  }
  return [...new Set(findings)]
}

export function assertNoSecrets(receipt, literals = []) {
  const findings = findSecrets(receipt, literals)
  if (findings.length > 0) throw new Error(`receipt would leak a credential (${findings.join(", ")}) — refusing to write it`)
  return receipt
}

export function receiptPath(outDir, receipt) {
  return join(outDir, `${receipt.subcommand}-${receipt.runId}.json`)
}

/**
 * Write the receipt, validating and secret-scanning first.
 *
 * Called repeatedly during a run, so it must be cheap and must never throw for
 * an in-progress receipt that is simply incomplete.
 */
export function writeReceipt(outDir, receipt, { literals = [] } = {}) {
  assertNoSecrets(receipt, literals)
  const path = receiptPath(outDir, receipt)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8")
  return path
}
