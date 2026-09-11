// The receipt is the ONLY durable product of a paid acceptance run. These
// tests pin the three properties that make it worth having: it is structurally
// complete, its verdict is DERIVED from the assertions rather than asserted
// separately, and it cannot be written carrying a credential.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  RECEIPT_SCHEMA_VERSION, assert as recordAssertion, assertNoSecrets, createReceipt,
  finalize, findSecrets, receiptPath, recordJob, validateReceipt, writeReceipt,
} from "../scene3d-acceptance/lib/receipt.mjs"
import { redactArgv } from "../scene3d-acceptance/lib/harness.mjs"

const RUN = "11111111-2222-3333-4444-555555555555"

function fresh() {
  return createReceipt({ subcommand: "authoring", runId: RUN, baseUrl: "https://next.nodaro.ai/v1", inputs: { fps: 24 } })
}

test("a fresh receipt is in-progress, structurally valid, and names only the host", () => {
  const receipt = fresh()
  assert.equal(receipt.schemaVersion, RECEIPT_SCHEMA_VERSION)
  assert.equal(receipt.status, "in-progress")
  assert.equal(receipt.pass, null)
  // A base URL can carry a token in a query string; a hostname cannot.
  assert.equal(receipt.baseUrlHost, "next.nodaro.ai")
  assert.deepEqual(validateReceipt(receipt), [])
})

test("createReceipt refuses to exist without an identity", () => {
  assert.throws(() => createReceipt({ runId: RUN }), /subcommand is required/)
  assert.throws(() => createReceipt({ subcommand: "authoring" }), /runId is required/)
})

test("an assertion records expected AND actual, and returns its own verdict", () => {
  const receipt = fresh()
  assert.equal(recordAssertion(receipt, "schema is v2", { expected: 2, actual: 2 }), true)
  assert.equal(recordAssertion(receipt, "poster present", { expected: "an id", actual: null, pass: false }), false)
  const [first, second] = receipt.assertions
  assert.equal(first.pass, true)
  assert.equal(second.expected, "an id")
  assert.equal(second.actual, null)
  assert.equal(typeof second.at, "string")
})

test("the verdict is the conjunction of the assertions, never a separate flag", () => {
  const receipt = fresh()
  recordAssertion(receipt, "a", { expected: 1, actual: 1 })
  recordAssertion(receipt, "b", { expected: 1, actual: 2 })
  finalize(receipt)
  assert.equal(receipt.pass, false)
  assert.equal(receipt.status, "failed")
})

test("a run with no assertions at all is NOT a pass", () => {
  const receipt = finalize(fresh())
  assert.equal(receipt.pass, false)
  assert.equal(receipt.status, "failed")
  const issues = validateReceipt(receipt)
  assert.deepEqual(issues, [])
})

test("an explicit terminal status (unavailable) survives finalize and validates", () => {
  const receipt = finalize(fresh(), { status: "unavailable" })
  assert.equal(receipt.status, "unavailable")
  assert.deepEqual(validateReceipt(receipt), [])
  assert.throws(() => finalize(fresh(), { status: "nonsense" }), /unknown status/)
})

test("validateReceipt names every structural hole it finds", () => {
  const receipt = fresh()
  receipt.assertions.push({ name: "half-written" })
  const issues = validateReceipt(receipt)
  assert.ok(issues.some((i) => /has no boolean pass/.test(i)))
  assert.ok(issues.some((i) => /has no expected/.test(i)))
  assert.ok(validateReceipt({ schemaVersion: 99 }).some((i) => /schemaVersion mismatch/.test(i)))
})

test("jobs are merged by id, so a later record enriches rather than duplicates", () => {
  const receipt = fresh()
  recordJob(receipt, { jobId: "job-1", role: "authoring" })
  recordJob(receipt, { jobId: "job-1", terminalStatus: "completed" })
  recordJob(receipt, { jobId: "job-2", role: "render-only" })
  assert.equal(receipt.jobs.length, 2)
  assert.deepEqual(receipt.jobs[0], { jobId: "job-1", role: "authoring", terminalStatus: "completed" })
  assert.throws(() => recordJob(receipt, { role: "nameless" }), /needs a jobId/)
})

test("credential shapes are refused before anything reaches disk", () => {
  // Assembled at runtime so the source never contains a key-shaped literal (gitleaks generic-api-key).
  const key = ["ndr", "livekey", "abcdef1234567890"].join("_") // gitleaks:allow — fake fixture, not a credential
  const receipt = fresh()
  receipt.inputs.oops = `Authorization: Bearer ${key}`
  assert.ok(findSecrets(receipt).includes("nodaro-api-key"))
  assert.throws(() => assertNoSecrets(receipt), /refusing to write it/)

  const jwt = fresh()
  jwt.notes.push("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature")
  assert.ok(findSecrets(jwt).includes("supabase-jwt"))
})

test("the literal key in this process's environment is caught even when it looks like nothing", () => {
  const receipt = fresh()
  receipt.inputs.label = "run-with-Sup3rSecretValue"
  assert.deepEqual(findSecrets(receipt), [])
  assert.deepEqual(findSecrets(receipt, ["Sup3rSecretValue"]), ["literal-credential"])
})

test("writeReceipt writes <subcommand>-<runId>.json and round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "s3d-receipt-"))
  const receipt = fresh()
  recordAssertion(receipt, "ok", { expected: 1, actual: 1 })
  finalize(receipt)
  const path = writeReceipt(dir, receipt)
  assert.equal(path, receiptPath(dir, receipt))
  assert.ok(path.endsWith(`authoring-${RUN}.json`))
  const parsed = JSON.parse(readFileSync(path, "utf8"))
  assert.equal(parsed.pass, true)
  assert.deepEqual(validateReceipt(parsed), [])
})

test("the recorded command line keeps content and signed URLs out of the receipt", () => {
  const argv = [
    "--prompt", "the whole fixture brief, verbatim",
    "--ref", "https://cdn.test/uploads/a.png?X-Amz-Signature=deadbeefdeadbeefdeadbeefdeadbeef#layout",
    "--duration", "30",
  ]
  const redacted = redactArgv(argv)
  assert.equal(redacted.includes("the whole fixture brief, verbatim"), false, "a brief must never be recorded verbatim")
  assert.ok(/^<sha [0-9a-f]{16}>$/.test(redacted[1]))
  // The signature is a live credential no SECRET_PATTERN would recognise.
  assert.equal(redacted[3].includes("X-Amz-Signature"), false)
  assert.ok(redacted[3].startsWith("<cdn.test sha "))
  assert.ok(redacted[3].endsWith(">#layout"), "the role must survive — it is what the reference MEANS")
  // Flags and plain values pass through, so the line is still readable.
  assert.deepEqual(redacted.slice(4), ["--duration", "30"])
  // Two runs of the same brief are provably the same brief.
  assert.equal(redactArgv(["--prompt", "x"])[1], redactArgv(["--prompt", "x"])[1])
  assert.notEqual(redactArgv(["--prompt", "x"])[1], redactArgv(["--prompt", "y"])[1])
})

test("an in-progress receipt is writable — evidence is saved before the run ends, not after", () => {
  const dir = mkdtempSync(join(tmpdir(), "s3d-receipt-"))
  const receipt = fresh()
  const path = writeReceipt(dir, receipt)
  assert.equal(JSON.parse(readFileSync(path, "utf8")).status, "in-progress")
})
