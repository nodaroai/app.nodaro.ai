#!/usr/bin/env node
/**
 * Scene3D probe-account cleanup — delete a used probe owner the NORMAL way and
 * prove nothing it owned survives.
 *
 * WHY IT EXISTS. A Scene3D acceptance probe creates a throwaway owner, runs a
 * real path through it (jobs, revisions, artifacts, upload intents, deliveries)
 * and then must be removed. The removal is not housekeeping — it IS the
 * acceptance evidence for migration 403: the auth-deletion cascade runs the
 * scene3d GC trigger functions under the DELETING role, and those functions are
 * SECURITY DEFINER precisely so that cascade does not fail on metadata the
 * deleting role may not read. So:
 *
 *   - Deletion goes through the Supabase Auth admin API. NEVER hand-delete DB
 *     rows: hand-deleting would destroy the very behaviour being proven, and
 *     the program forbids ad hoc DDL/DML against the managed database.
 *   - Everything after the deletion is READ-ONLY verification.
 *   - Tombstones are EXPECTED to survive. `scene3d_artifact_gc` retires an
 *     artifact id forever (see migration 389); a persisting row there is the
 *     trigger having fired, not a leak.
 *
 * WHAT IT CHECKS. Before (always) and after (only with --apply) it counts every
 * row keyed by the owner, by the named revisions and by the named jobs across
 * the scene3d surface plus the cascade roots (`profiles`, `workflows`, `jobs`).
 * A query ERROR is a failure, never a zero — a broken read must not read as a
 * clean account.
 *
 * IDENTITY GUARD. --user-id and --email are both required and must BOTH match
 * the same live Auth user. A mismatch aborts before any deletion. There is no
 * "delete by email" and no interactive confirmation: the caller states the full
 * identity or nothing happens.
 *
 * USAGE
 *   node tools/scene3d-cleanup-probe-owner.mjs \
 *     --user-id <uuid> --email <address> \
 *     [--expect-jobs <uuid,uuid>] [--expect-revisions <uuid,uuid>] \
 *     [--receipt <path>] [--apply]
 *
 *   Default is a DRY RUN: identity check + read-only inventory + receipt, and
 *   no deletion. --apply performs the Auth deletion, then re-verifies.
 *
 *   Environment (same names and client construction as backend/src/lib/supabase.ts):
 *     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   Neither is ever printed or written to the receipt; only the URL host is.
 *
 * EXAMPLE — the 2026-09-08 retained owner (documented example values, NOT
 * defaults; every id must be passed explicitly):
 *   node tools/scene3d-cleanup-probe-owner.mjs \
 *     --user-id 163d3ed2-55a3-46ae-b42a-1ff8d5018469 \
 *     --email scene3d-retained-owner-38f79dd8-f4a4-48af-9303-31e300d0592c@example.com \
 *     --expect-jobs 43ed0e4d-f6c9-443e-bab0-eb60ab46aeb9 \
 *     --expect-revisions d16a42eb-88f4-4672-a44f-0d45c052cbdf,606b33f2-9f73-4bd7-b84d-26d844a8f742 \
 *     --receipt /tmp/scene3d-owner-cleanup.json
 *
 * OUTPUT. The receipt JSON is the ONLY thing on stdout; every progress line
 * goes to stderr. That is what makes a remote run retrievable — the receipt
 * lives inside an ephemeral container, so
 *   railway ssh … -- node /app/tools/scene3d-cleanup-probe-owner.mjs … > receipt.json
 * captures it verbatim while the log still streams to the terminal. --receipt
 * additionally writes the same JSON to a path inside the container.
 *
 * EXIT CODES. 0 = dry run finished / owner already gone / applied and every
 * post-check passed. Non-zero = bad arguments, missing env, identity mismatch,
 * a failed post-check, or any query error. The receipt is written either way.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Thrown for anything the caller can fix by re-invoking differently. */
export class UsageError extends Error {}

/**
 * Rows keyed by the OWNER. `profiles` and `workflows` are the cascade roots
 * (auth.users -> profiles -> jobs/workflows/assets); the scene3d tables are the
 * state migration 403 exists to collect. `collectIds` marks probes whose ids we
 * carry forward so the tombstone report can name them after the rows are gone.
 */
export const OWNER_PROBES = [
  { table: "profiles", column: "id" },
  { table: "workflows", column: "user_id" },
  { table: "jobs", column: "user_id" },
  { table: "scene3d_revisions", column: "user_id", collectIds: "id" },
  { table: "scene3d_artifacts", column: "user_id", collectIds: "id" },
  { table: "scene3d_revision_artifacts", column: "user_id" },
  { table: "scene3d_upload_intents", column: "user_id", collectIds: "artifact_id" },
  { table: "scene3d_deliveries", column: "user_id" },
  { table: "scene3d_deliveries", column: "source_owner_id" },
  { table: "scene3d_delivery_artifacts", column: "artifact_owner_id" },
]

/** Rows reachable from a revision id, including the ones that keep their own owner anchor. */
export const REVISION_PROBES = [
  { table: "scene3d_revisions", column: "id" },
  { table: "scene3d_revision_artifacts", column: "revision_id" },
  { table: "scene3d_upload_intents", column: "revision_id" },
  { table: "scene3d_deliveries", column: "source_revision_id" },
  { table: "scene3d_delivery_artifacts", column: "via_revision_id" },
]

/** Rows reachable from a job id. Several of these are ON DELETE SET NULL, so they are checked, not assumed. */
export const JOB_PROBES = [
  { table: "jobs", column: "id" },
  { table: "scene3d_deliveries", column: "job_id" },
  { table: "scene3d_deliveries", column: "source_job_id" },
  { table: "scene3d_delivery_artifacts", column: "job_id" },
  { table: "scene3d_revisions", column: "source_job_id" },
  { table: "scene3d_artifacts", column: "source_job_id" },
  { table: "scene3d_upload_intents", column: "job_id" },
]

/** Retires artifact ids forever (migration 389). Rows here are evidence, never a leak. */
export const TOMBSTONE_TABLE = "scene3d_artifact_gc"

const label = (p) => `${p.table}.${p.column}`

function readValue(argv, i, flag) {
  const v = argv[i + 1]
  if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`)
  return v
}

function uuidList(raw, flag) {
  const out = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  for (const id of out) if (!UUID_RE.test(id)) throw new UsageError(`${flag}: not a uuid: ${id}`)
  if (out.length === 0) throw new UsageError(`${flag} was empty`)
  return out
}

export function parseArgs(argv) {
  const opts = { userId: null, email: null, expectJobs: [], expectRevisions: [], receiptPath: null, apply: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]
    let inline = null
    const eq = arg.indexOf("=")
    if (arg.startsWith("--") && eq !== -1) {
      inline = arg.slice(eq + 1)
      arg = arg.slice(0, eq)
    }
    const value = (flag) => (inline !== null ? inline : readValue(argv, i++, flag))
    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true
        break
      case "--apply":
        if (inline !== null) throw new UsageError("--apply takes no value")
        opts.apply = true
        break
      case "--user-id":
        opts.userId = value("--user-id").trim()
        break
      case "--email":
        opts.email = value("--email").trim()
        break
      case "--expect-jobs":
        opts.expectJobs = uuidList(value("--expect-jobs"), "--expect-jobs")
        break
      case "--expect-revisions":
        opts.expectRevisions = uuidList(value("--expect-revisions"), "--expect-revisions")
        break
      case "--receipt":
        opts.receiptPath = value("--receipt")
        break
      default:
        throw new UsageError(`unknown argument: ${arg}`)
    }
  }
  if (opts.help) return opts
  if (!opts.userId) throw new UsageError("--user-id is required (there are no baked-in defaults)")
  if (!UUID_RE.test(opts.userId)) throw new UsageError(`--user-id: not a uuid: ${opts.userId}`)
  if (!opts.email) throw new UsageError("--email is required (there are no baked-in defaults)")
  if (!opts.email.includes("@")) throw new UsageError(`--email: not an address: ${opts.email}`)
  return opts
}

const sameEmail = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase()

/** A getUserById result, reduced to the three states the caller cares about. */
export function classifyUser(res) {
  const error = res?.error
  const user = res?.data?.user ?? null
  if (error) {
    if (error.status === 404 || error.code === "user_not_found") return { state: "absent" }
    return { state: "error", message: error.message || String(error) }
  }
  if (!user) return { state: "absent" }
  return { state: "present", user }
}

async function inventory(deps, opts, artifactIdSink) {
  const probes = []
  let failed = false
  const add = async (scope, probe, values) => {
    const res = await deps.db.select(probe.table, {
      columns: probe.collectIds ?? "*",
      column: probe.column,
      values,
      head: !probe.collectIds,
    })
    const entry = {
      scope,
      table: probe.table,
      column: probe.column,
      label: label(probe),
      match: Array.isArray(values) ? values : [values],
      count: res.error ? null : (res.count ?? (res.rows?.length ?? 0)),
      error: res.error ?? null,
    }
    if (probe.collectIds && !res.error) {
      const ids = (res.rows ?? []).map((r) => r[probe.collectIds]).filter(Boolean)
      entry.ids = ids
      for (const id of ids) artifactIdSink?.add?.(id)
    }
    if (res.error) failed = true
    probes.push(entry)
  }

  for (const probe of OWNER_PROBES) await add("owner", probe, opts.userId)
  if (opts.expectRevisions.length) for (const probe of REVISION_PROBES) await add("revision", probe, opts.expectRevisions)
  if (opts.expectJobs.length) for (const probe of JOB_PROBES) await add("job", probe, opts.expectJobs)

  return { probes, queryErrors: failed }
}

async function tombstones(deps, artifactIds) {
  if (!artifactIds.length) return { table: TOMBSTONE_TABLE, persistByDesign: true, checked: [], rows: [], error: null, note: "no artifact ids were observed before deletion" }
  const res = await deps.db.select(TOMBSTONE_TABLE, {
    columns: "artifact_id,resolution,resolved_at",
    column: "artifact_id",
    values: artifactIds,
    head: false,
  })
  return {
    table: TOMBSTONE_TABLE,
    persistByDesign: true,
    checked: artifactIds,
    rows: res.error ? [] : (res.rows ?? []),
    error: res.error ?? null,
    note: "rows here are the migration-403 cascade having fired; they are RETIRED ids and must not be deleted",
  }
}

/**
 * Perform the cleanup (or the dry run) against injected dependencies.
 *
 * deps = {
 *   admin: { getUserById(id), deleteUser(id, shouldSoftDelete) },
 *   db:    { select(table, { columns, column, values, head }) -> { count, rows, error } },
 *   now:   () => ISO string,
 *   supabaseHost: string,
 *   log:   (line) => void,
 * }
 */
export async function run(opts, deps) {
  const log = deps.log ?? (() => {})
  const now = deps.now ?? (() => new Date().toISOString())
  const checks = []
  const actions = []
  const check = (name, status, detail) => {
    checks.push({ name, status, detail: detail ?? null })
    log(`${status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "  ->"}  ${name}${detail ? ` — ${detail}` : ""}`)
  }
  const receipt = {
    tool: "scene3d-cleanup-probe-owner",
    receiptVersion: 1,
    outcome: "aborted",
    dryRun: !opts.apply,
    startedAt: now(),
    finishedAt: null,
    supabaseHost: deps.supabaseHost ?? null,
    target: { userId: opts.userId, email: opts.email, expectJobs: opts.expectJobs, expectRevisions: opts.expectRevisions },
    identity: { checked: false, authUserFound: null, emailMatches: null, observedEmail: null },
    inventoryBefore: null,
    actions,
    inventoryAfter: null,
    tombstones: null,
    checks,
    exitCode: 1,
  }

  try {
    // 1. Identity guard — before anything else, and before any deletion path.
    const before = classifyUser(await deps.admin.getUserById(opts.userId))
    receipt.identity.checked = true
    if (before.state === "error") {
      check("identity-guard", "fail", `auth lookup failed: ${before.message}`)
      return finish(receipt, now, 1)
    }
    receipt.identity.authUserFound = before.state === "present"

    if (before.state === "absent") {
      // Already gone: record the state, run the read-only checks, exit 0.
      check("identity-guard", "skip", "auth user already absent — nothing to delete")
      const seen = new Set()
      receipt.inventoryBefore = await inventory(deps, opts, seen)
      receipt.tombstones = await tombstones(deps, [...seen])
      const clean = verifyEmpty(receipt.inventoryBefore, check)
      receipt.outcome = "already-gone"
      return finish(receipt, now, clean && !receipt.inventoryBefore.queryErrors ? 0 : 1)
    }

    receipt.identity.observedEmail = before.user.email ?? null
    const matches = sameEmail(before.user.email, opts.email)
    receipt.identity.emailMatches = matches
    if (!matches) {
      // Deliberately does NOT echo the observed address as if it were expected:
      // the abort is the point, not a suggestion to retry with what was found.
      check("identity-guard", "fail", `auth user ${opts.userId} does not carry the stated email — refusing to delete`)
      return finish(receipt, now, 1)
    }
    check("identity-guard", "pass", "auth user id and email agree")

    // 2. Read-only inventory (always).
    const artifactIds = new Set()
    receipt.inventoryBefore = await inventory(deps, opts, artifactIds)
    if (receipt.inventoryBefore.queryErrors) check("inventory-before-readable", "fail", "one or more inventory queries errored")
    else check("inventory-before-readable", "pass", `${receipt.inventoryBefore.probes.length} probes`)

    if (!opts.apply) {
      receipt.outcome = "dry-run"
      check("deletion", "skip", "dry run — pass --apply to delete")
      receipt.tombstones = await tombstones(deps, [...artifactIds])
      return finish(receipt, now, receipt.inventoryBefore.queryErrors ? 1 : 0)
    }

    // 3. Normal Auth admin deletion. shouldSoftDelete is passed FALSE on
    //    purpose: a soft delete keeps the auth.users row, fires no cascade, and
    //    would quietly defeat the entire proof.
    const del = await deps.admin.deleteUser(opts.userId, false)
    const delError = del?.error ?? null
    actions.push({ action: "auth.admin.deleteUser", at: now(), softDelete: false, ok: !delError, error: delError ? delError.message || String(delError) : null })
    if (delError) {
      check("auth-delete", "fail", delError.message || String(delError))
      receipt.outcome = "aborted"
      return finish(receipt, now, 1)
    }
    check("auth-delete", "pass", "deleted through the Auth admin API")

    // 4. Read-only verification.
    const after = classifyUser(await deps.admin.getUserById(opts.userId))
    if (after.state === "absent") check("auth-user-absent", "pass", "GET returns not-found")
    else if (after.state === "error") check("auth-user-absent", "fail", `auth lookup failed: ${after.message}`)
    else check("auth-user-absent", "fail", "auth user still present after deletion")

    receipt.inventoryAfter = await inventory(deps, opts, null)
    if (receipt.inventoryAfter.queryErrors) check("inventory-after-readable", "fail", "one or more verification queries errored")
    verifyEmpty(receipt.inventoryAfter, check)
    receipt.tombstones = await tombstones(deps, [...artifactIds])
    if (receipt.tombstones.error) check("tombstones-readable", "fail", receipt.tombstones.error)
    else check("tombstones-reported", "pass", `${receipt.tombstones.rows.length} of ${receipt.tombstones.checked.length} artifact ids retired in ${TOMBSTONE_TABLE} (persist by design)`)

    receipt.outcome = "applied"
    return finish(receipt, now, checks.some((c) => c.status === "fail") ? 1 : 0)
  } catch (err) {
    check("unexpected-error", "fail", err?.message ?? String(err))
    receipt.outcome = "aborted"
    return finish(receipt, now, 1)
  }
}

/** Every probe must be zero (or the read failed, which is also a failure). */
function verifyEmpty(inv, check) {
  let ok = true
  for (const p of inv.probes) {
    if (p.error) {
      check(`empty:${p.label}`, "fail", `query error: ${p.error}`)
      ok = false
    } else if (p.count !== 0) {
      check(`empty:${p.label}`, "fail", `${p.count} row(s) remain`)
      ok = false
    } else {
      check(`empty:${p.label}`, "pass", "0 rows")
    }
  }
  return ok
}

function finish(receipt, now, exitCode) {
  receipt.finishedAt = now()
  receipt.exitCode = exitCode
  return { receipt, exitCode }
}

// ── CLI entry ────────────────────────────────────────────────────────────
// The supabase client is imported LAZILY so the pure exports above stay
// importable with no dependencies installed (the tools/__tests__ CI job runs
// straight off a checkout, without npm ci).
async function main() {
  const { writeFileSync } = await import("node:fs")
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`scene3d-cleanup-probe-owner: ${err.message}`)
      console.error("run with --help for usage")
      process.exit(2)
    }
    throw err
  }
  if (opts.help) {
    console.log(
      [
        "Usage: node tools/scene3d-cleanup-probe-owner.mjs --user-id <uuid> --email <address>",
        "         [--expect-jobs <uuid,...>] [--expect-revisions <uuid,...>]",
        "         [--receipt <path>] [--apply]",
        "",
        "Default is a DRY RUN (identity check + read-only inventory + receipt, no deletion).",
        "Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.",
        "",
        "The receipt JSON is written to stdout (and to --receipt if given); the",
        "progress log goes to stderr, so `… > receipt.json` captures it cleanly.",
      ].join("\n"),
    )
    process.exit(0)
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error("scene3d-cleanup-probe-owner: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set")
    process.exit(2)
  }

  const { createClient } = await import("@supabase/supabase-js")
  // Same construction as backend/src/lib/supabase.ts — service role, no session.
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "public" },
  })

  const deps = {
    supabaseHost: (() => {
      try {
        return new URL(url).host
      } catch {
        return null
      }
    })(),
    // stderr, never stdout: stdout carries the receipt JSON verbatim so a
    // remote `railway ssh … > receipt.json` captures it cleanly.
    log: (line) => console.error(line),
    now: () => new Date().toISOString(),
    admin: {
      getUserById: (id) => supabase.auth.admin.getUserById(id),
      deleteUser: (id, soft) => supabase.auth.admin.deleteUser(id, soft),
    },
    db: {
      async select(table, { columns, column, values, head }) {
        let q = supabase.from(table).select(columns ?? "*", { count: "exact", head: Boolean(head) })
        q = Array.isArray(values) ? q.in(column, values) : q.eq(column, values)
        const { data, count, error } = await q
        if (error) return { count: null, rows: [], error: error.message || String(error) }
        return { count: count ?? (data?.length ?? 0), rows: data ?? [], error: null }
      },
    },
  }

  console.error(`scene3d-cleanup-probe-owner: ${opts.apply ? "APPLY" : "DRY RUN"} against ${deps.supabaseHost ?? "(unparsable host)"}`)
  const { receipt, exitCode } = await run(opts, deps)
  const json = JSON.stringify(receipt, null, 2)
  if (opts.receiptPath) {
    writeFileSync(opts.receiptPath, json + "\n")
    console.error(`receipt written to ${opts.receiptPath}`)
  }
  process.stdout.write(json + "\n")
  console.error(`outcome: ${receipt.outcome} (exit ${exitCode})`)
  process.exit(exitCode)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("scene3d-cleanup-probe-owner: unexpected failure:", err?.message ?? err)
    process.exit(1)
  })
}
