import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseArgs,
  run,
  classifyUser,
  UsageError,
  OWNER_PROBES,
  REVISION_PROBES,
  JOB_PROBES,
} from "../scene3d-cleanup-probe-owner.mjs"

const USER = "163d3ed2-55a3-46ae-b42a-1ff8d5018469"
const EMAIL = "scene3d-retained-owner-38f79dd8-f4a4-48af-9303-31e300d0592c@example.com"
const JOB = "43ed0e4d-f6c9-443e-bab0-eb60ab46aeb9"
const REV_A = "d16a42eb-88f4-4672-a44f-0d45c052cbdf"
const REV_B = "606b33f2-9f73-4bd7-b84d-26d844a8f742"

const baseArgs = ["--user-id", USER, "--email", EMAIL]

/**
 * In-memory stand-in for the admin client + PostgREST reads.
 *
 * `rows` maps "<table>.<column>" to either a count or an array of row objects,
 * for the phase before deletion; `rowsAfter` overrides it once the user has
 * been deleted (default: everything empty, i.e. the cascade worked).
 */
function makeDeps({ user = { id: USER, email: EMAIL }, rows = {}, rowsAfter = null, deleteError = null, selectErrors = {} } = {}) {
  const calls = { getUserById: [], deleteUser: [], select: [] }
  let deleted = false
  const phaseRows = () => (deleted ? (rowsAfter ?? {}) : rows)
  return {
    calls,
    supabaseHost: "example.supabase.co",
    now: () => "2026-09-10T00:00:00.000Z",
    log: () => {},
    admin: {
      async getUserById(id) {
        calls.getUserById.push(id)
        if (deleted || !user) return { data: { user: null }, error: { status: 404, code: "user_not_found", message: "User not found" } }
        return { data: { user }, error: null }
      },
      async deleteUser(id, soft) {
        calls.deleteUser.push({ id, soft })
        if (deleteError) return { data: null, error: { message: deleteError } }
        deleted = true
        return { data: { user: null }, error: null }
      },
    },
    db: {
      async select(table, { columns, column, values, head }) {
        const key = `${table}.${column}`
        calls.select.push({ key, columns, values, head })
        if (selectErrors[key]) return { count: null, rows: [], error: selectErrors[key] }
        const v = phaseRows()[key] ?? 0
        if (Array.isArray(v)) return { count: v.length, rows: v, error: null }
        return { count: v, rows: [], error: null }
      },
    },
  }
}

// ── argument parsing ──────────────────────────────────────────────────────

test("parseArgs: accepts the full documented invocation", () => {
  const o = parseArgs([...baseArgs, "--expect-jobs", JOB, "--expect-revisions", `${REV_A},${REV_B}`, "--receipt", "/tmp/r.json", "--apply"])
  assert.deepEqual(o, {
    userId: USER,
    email: EMAIL,
    expectJobs: [JOB],
    expectRevisions: [REV_A, REV_B],
    receiptPath: "/tmp/r.json",
    apply: true,
    help: false,
  })
})

test("parseArgs: --flag=value form, and dry run is the default", () => {
  const o = parseArgs([`--user-id=${USER}`, `--email=${EMAIL}`, `--expect-revisions=${REV_A}, ${REV_B}`])
  assert.equal(o.userId, USER)
  assert.equal(o.email, EMAIL)
  assert.deepEqual(o.expectRevisions, [REV_A, REV_B])
  assert.equal(o.apply, false, "--apply must be opt-in")
  assert.equal(o.receiptPath, null)
})

test("parseArgs: there are no baked-in identity defaults", () => {
  assert.throws(() => parseArgs([]), UsageError)
  assert.throws(() => parseArgs(["--user-id", USER]), (e) => e instanceof UsageError && /--email is required/.test(e.message))
  assert.throws(() => parseArgs(["--email", EMAIL]), (e) => e instanceof UsageError && /--user-id is required/.test(e.message))
})

test("parseArgs: rejects malformed ids, addresses, values and unknown flags", () => {
  assert.throws(() => parseArgs(["--user-id", "not-a-uuid", "--email", EMAIL]), UsageError)
  assert.throws(() => parseArgs(["--user-id", USER, "--email", "nope"]), UsageError)
  assert.throws(() => parseArgs([...baseArgs, "--expect-jobs", "abc"]), UsageError)
  assert.throws(() => parseArgs([...baseArgs, "--expect-jobs", ""]), UsageError)
  assert.throws(() => parseArgs([...baseArgs, "--wat"]), UsageError)
  assert.throws(() => parseArgs([...baseArgs, "--receipt"]), (e) => e instanceof UsageError && /needs a value/.test(e.message))
  assert.throws(() => parseArgs([...baseArgs, "--apply=yes"]), UsageError)
})

test("parseArgs: --help short-circuits the required-argument checks", () => {
  assert.equal(parseArgs(["--help"]).help, true)
})

// ── identity guard ────────────────────────────────────────────────────────

test("classifyUser: 404 and a null user both read as absent; other errors do not", () => {
  assert.equal(classifyUser({ data: { user: null }, error: { status: 404 } }).state, "absent")
  assert.equal(classifyUser({ data: { user: null }, error: { code: "user_not_found" } }).state, "absent")
  assert.equal(classifyUser({ data: { user: null }, error: null }).state, "absent")
  assert.equal(classifyUser({ data: { user: { id: USER } }, error: null }).state, "present")
  assert.equal(classifyUser({ data: null, error: { status: 500, message: "boom" } }).state, "error")
})

test("identity guard: a mismatched email aborts with NO delete call", async () => {
  const deps = makeDeps({ user: { id: USER, email: "someone-else@example.com" } })
  const { receipt, exitCode } = await run(parseArgs([...baseArgs, "--apply"]), deps)
  assert.equal(deps.calls.deleteUser.length, 0, "must never delete on an identity mismatch")
  assert.equal(exitCode, 1)
  assert.equal(receipt.outcome, "aborted")
  assert.equal(receipt.identity.emailMatches, false)
  assert.equal(deps.calls.select.length, 0, "must abort before it even inventories")
  assert.ok(receipt.checks.some((c) => c.name === "identity-guard" && c.status === "fail"))
})

test("identity guard: email match is case- and whitespace-insensitive", async () => {
  const deps = makeDeps({ user: { id: USER, email: EMAIL.toUpperCase() } })
  const { receipt } = await run(parseArgs([...baseArgs, "--apply"]), deps)
  assert.equal(receipt.identity.emailMatches, true)
  assert.equal(deps.calls.deleteUser.length, 1)
})

test("identity guard: an auth lookup error aborts rather than assuming absence", async () => {
  const deps = makeDeps()
  deps.admin.getUserById = async () => ({ data: null, error: { status: 500, message: "gateway" } })
  const { receipt, exitCode } = await run(parseArgs([...baseArgs, "--apply"]), deps)
  assert.equal(exitCode, 1)
  assert.equal(receipt.outcome, "aborted")
  assert.equal(deps.calls.deleteUser.length, 0)
})

// ── dry run vs apply ──────────────────────────────────────────────────────

test("dry run: inventories, writes a receipt and never calls delete", async () => {
  const deps = makeDeps({ rows: { "scene3d_artifacts.user_id": [{ id: "a1" }, { id: "a2" }], "jobs.user_id": 1 } })
  const { receipt, exitCode } = await run(parseArgs([...baseArgs, "--expect-jobs", JOB, "--expect-revisions", REV_A]), deps)
  assert.equal(deps.calls.deleteUser.length, 0, "dry run must never delete")
  assert.equal(exitCode, 0, "a dry run that read cleanly exits 0 even with rows present")
  assert.equal(receipt.outcome, "dry-run")
  assert.equal(receipt.dryRun, true)
  assert.equal(receipt.inventoryAfter, null)
  assert.equal(receipt.inventoryBefore.probes.length, OWNER_PROBES.length + REVISION_PROBES.length + JOB_PROBES.length)
  const artifacts = receipt.inventoryBefore.probes.find((p) => p.label === "scene3d_artifacts.user_id")
  assert.equal(artifacts.count, 2)
  assert.deepEqual(artifacts.ids, ["a1", "a2"])
  assert.ok(receipt.checks.some((c) => c.name === "deletion" && c.status === "skip"))
})

test("apply: deletes exactly once, hard (soft=false), then verifies", async () => {
  const deps = makeDeps({ rows: { "scene3d_artifacts.user_id": [{ id: "a1" }], "scene3d_revisions.user_id": [{ id: REV_A }], "jobs.user_id": 1 } })
  const { receipt, exitCode } = await run(parseArgs([...baseArgs, "--apply", "--expect-revisions", REV_A]), deps)
  assert.deepEqual(deps.calls.deleteUser, [{ id: USER, soft: false }], "exactly one hard delete")
  assert.equal(exitCode, 0)
  assert.equal(receipt.outcome, "applied")
  assert.equal(receipt.dryRun, false)
  assert.ok(receipt.inventoryAfter, "must re-inventory after deleting")
  assert.ok(receipt.checks.some((c) => c.name === "auth-user-absent" && c.status === "pass"))
  assert.equal(receipt.actions.length, 1)
  assert.equal(receipt.actions[0].softDelete, false)
})

test("apply: surviving owner rows fail the run", async () => {
  const deps = makeDeps({
    rows: { "scene3d_artifacts.user_id": [{ id: "a1" }] },
    rowsAfter: { "scene3d_artifacts.user_id": [{ id: "a1" }] },
  })
  const { receipt, exitCode } = await run(parseArgs([...baseArgs, "--apply"]), deps)
  assert.equal(exitCode, 1)
  assert.ok(receipt.checks.some((c) => c.name === "empty:scene3d_artifacts.user_id" && c.status === "fail"))
})

test("apply: a failed Auth deletion is not reported as success", async () => {
  const deps = makeDeps({ deleteError: "service unavailable" })
  const { receipt, exitCode } = await run(parseArgs([...baseArgs, "--apply"]), deps)
  assert.equal(exitCode, 1)
  assert.equal(receipt.outcome, "aborted")
  assert.equal(receipt.actions[0].ok, false)
})

test("a query error is a failure, never an empty table", async () => {
  const deps = makeDeps({ selectErrors: { "scene3d_upload_intents.user_id": "permission denied" } })
  const { receipt, exitCode } = await run(parseArgs([...baseArgs, "--apply"]), deps)
  assert.equal(exitCode, 1)
  assert.ok(receipt.checks.some((c) => c.name === "empty:scene3d_upload_intents.user_id" && c.status === "fail"))
})

// ── already gone ──────────────────────────────────────────────────────────

test("already gone: records the state, runs the read-only checks, exits 0", async () => {
  const deps = makeDeps({ user: null })
  const { receipt, exitCode } = await run(parseArgs([...baseArgs, "--apply"]), deps)
  assert.equal(deps.calls.deleteUser.length, 0)
  assert.equal(exitCode, 0)
  assert.equal(receipt.outcome, "already-gone")
  assert.equal(receipt.identity.authUserFound, false)
  assert.ok(receipt.inventoryBefore)
})

test("already gone but rows remain: exits non-zero", async () => {
  const deps = makeDeps({ user: null, rows: { "jobs.user_id": 3 } })
  const { exitCode } = await run(parseArgs([...baseArgs, "--apply"]), deps)
  assert.equal(exitCode, 1)
})

// ── tombstones ────────────────────────────────────────────────────────────

test("tombstones are reported from the pre-deletion artifact ids and never fail the run", async () => {
  const deps = makeDeps({
    rows: {
      "scene3d_artifacts.user_id": [{ id: "a1" }, { id: "a2" }],
      "scene3d_upload_intents.user_id": [{ artifact_id: "a3" }],
      "scene3d_artifact_gc.artifact_id": [
        { artifact_id: "a1", resolution: "deleted", resolved_at: "2026-09-08T00:00:00Z" },
        { artifact_id: "a2", resolution: null, resolved_at: null },
      ],
    },
    rowsAfter: {
      "scene3d_artifact_gc.artifact_id": [
        { artifact_id: "a1", resolution: "deleted", resolved_at: "2026-09-08T00:00:00Z" },
        { artifact_id: "a2", resolution: null, resolved_at: null },
      ],
    },
  })
  const { receipt, exitCode } = await run(parseArgs([...baseArgs, "--apply"]), deps)
  assert.equal(exitCode, 0, "an unresolved tombstone must not fail the run")
  assert.equal(receipt.tombstones.persistByDesign, true)
  assert.deepEqual(receipt.tombstones.checked, ["a1", "a2", "a3"])
  assert.equal(receipt.tombstones.rows.length, 2)
})

// ── receipt shape ─────────────────────────────────────────────────────────

test("the receipt is JSON-serializable, carries no secret and always names an outcome", async () => {
  const deps = makeDeps()
  const { receipt } = await run(parseArgs([...baseArgs, "--apply", "--expect-jobs", JOB]), deps)
  const json = JSON.stringify(receipt)
  assert.ok(json.length > 0)
  assert.equal(receipt.supabaseHost, "example.supabase.co")
  assert.ok(!/SERVICE_ROLE|eyJ/.test(json), "no key material in the receipt")
  for (const k of ["tool", "receiptVersion", "outcome", "dryRun", "startedAt", "finishedAt", "target", "identity", "inventoryBefore", "actions", "inventoryAfter", "tombstones", "checks", "exitCode"]) {
    assert.ok(k in receipt, `receipt is missing ${k}`)
  }
  assert.equal(receipt.startedAt, "2026-09-10T00:00:00.000Z")
  assert.ok(receipt.finishedAt)
})
