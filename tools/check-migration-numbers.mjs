#!/usr/bin/env node
// Migration-number guard: fails a PR whose new supabase/migrations/NNN_*.sql
// takes a number that the LATEST base branch (dev) already holds under a
// different filename, and names the free number to use instead.
//
// Why `.sequence` was not enough: every migration PR bumps the one-line
// supabase/migrations/.sequence, meant to turn a parallel allocation into a
// merge conflict. But two PRs that allocate the SAME number write the SAME
// line, git merges identical hunks cleanly, and the lock never fires — which
// is how 459 and 464 were each taken twice on dev (decided 2026-10-06 to add
// this guard). Each PR's own CI is green against its own merge ref, so the
// check reads the base branch over the API at run time instead, and the
// dev-push half of the workflow re-runs it on every open migration PR.
//
// The free number is max(base, every other open PR's new migrations, this
// PR's own non-colliding ones) + 1. Listing open PRs is best-effort: when the
// token cannot, the number comes from the base branch alone (and says so).
//
// A free number BELOW the base's highest is flagged too (out of order): if the
// higher one is promoted to main first, the later promote carries a migration
// that sorts before an applied one, and the plain `supabase db push` in the
// migrate job refuses it — production deploy skipped. It warns today;
// OUT_OF_ORDER_FAILS turns it into a failure. A PR that renames a base
// migration's description under the same number is neither a collision nor
// out of order: the base file it removes is subtracted first.
//
//   node tools/check-migration-numbers.mjs check     # env: GITHUB_REPOSITORY, PR_NUMBER, BASE_REF
//   node tools/check-migration-numbers.mjs recheck   # env: GITHUB_REPOSITORY, BASE_REF, GUARD_WORKFLOW
//
// Both need `gh` with GH_TOKEN. Node builtins only — the CI job runs it with
// no install. Self-tests: tools/__tests__/check-migration-numbers.test.mjs.

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

const MIGRATIONS_DIR = "supabase/migrations"
const TOP_LEVEL_MIGRATION = /^(\d+)_[^/]*\.sql$/
const NEW_FILE_STATUSES = new Set(["added", "renamed", "copied"])
const PAGE = 100

/** Whether a free number below the base's highest fails the check (true) or only warns (false). */
export const OUT_OF_ORDER_FAILS = false

/** How long the dev-push recheck waits, in all, for in-progress guard runs to finish before re-running them. */
const RECHECK_WAIT_MS = 120_000
const RECHECK_POLL_MS = 10_000

const basename = (p) => p.slice(p.lastIndexOf("/") + 1)

/** The NNN of a top-level `supabase/migrations/NNN_*.sql` (or a bare filename); null otherwise. */
export function migrationNumber(path) {
  let name = path
  if (path.includes("/")) {
    if (!path.startsWith(`${MIGRATIONS_DIR}/`)) return null
    name = path.slice(MIGRATIONS_DIR.length + 1)
  }
  const m = TOP_LEVEL_MIGRATION.exec(name)
  return m ? Number(m[1]) : null
}

/**
 * The migration files a PR introduces, from the pulls/N/files API. A rename
 * counts: moving a migration to a new number is a new allocation.
 */
export function addedMigrations(prFiles) {
  return prFiles
    .filter((f) => NEW_FILE_STATUSES.has(f.status) && migrationNumber(f.filename) !== null)
    .map((f) => f.filename)
}

/**
 * The base migrations a PR takes away, as basenames: the old side of a rename
 * and removed files. Subtracted from the base before judging the PR, so
 * renaming 466_a.sql to 466_b.sql is not a collision with 466_a.sql.
 */
export function removedMigrations(prFiles) {
  return prFiles
    .map((f) => (f.status === "renamed" ? f.previous_filename : f.status === "removed" ? f.filename : null))
    .filter((p) => p && migrationNumber(p) !== null)
    .map(basename)
}

/**
 * @param {object} input
 * @param {string[]} input.added       migration paths this PR introduces
 * @param {string[]} [input.removed]   base migration basenames this PR removes or renames away
 * @param {string[]} input.baseFiles   filenames in the base branch's supabase/migrations/
 * @param {{number:number, added:string[]}[] | null} input.openPrs  other open PRs; null = unknown
 */
export function evaluate({ added, removed = [], baseFiles, openPrs }) {
  const gone = new Set(removed.map(basename))
  const baseByNumber = new Map()
  const baseNames = new Set()
  // Every number the base holds, INCLUDING files this PR removes: a slot the
  // base already has keeps its place in the order whatever its file is called.
  const baseSlots = new Set()
  for (const name of baseFiles) {
    const n = migrationNumber(name)
    if (n === null) continue
    baseSlots.add(n)
    if (gone.has(name)) continue
    baseNames.add(name)
    baseByNumber.set(n, [...(baseByNumber.get(n) ?? []), name])
  }

  // Open PRs' files the base already holds by name (a promote, a PR that
  // merged the base in) are not allocations of their own.
  const pending = (openPrs ?? []).flatMap((pr) =>
    pr.added
      .filter((f) => !baseNames.has(basename(f)))
      .map((f) => ({ pr: pr.number, file: f, number: migrationNumber(f) })),
  )

  const baseHighest = Math.max(0, ...baseSlots)
  const colliding = []
  const below = []
  const own = []
  for (const file of [...added].sort()) {
    const number = migrationNumber(file)
    const taken = (baseByNumber.get(number) ?? []).filter((name) => name !== basename(file))
    if (taken.length > 0) colliding.push({ file, number, baseFiles: taken })
    else {
      own.push({ file, number })
      // Only a NEW slot below the base's top is late.
      if (!baseSlots.has(number) && number < baseHighest) below.push({ file, number, highest: baseHighest })
    }
  }

  const highest = Math.max(baseHighest, ...pending.map((p) => p.number), ...own.map((o) => o.number))
  const nextFree = highest + 1
  const collisions = colliding.map((c, i) => ({ ...c, suggested: nextFree + i }))
  const outOfOrder = below.map((o, i) => ({ ...o, suggested: nextFree + collisions.length + i }))

  const openPrClashes = own.flatMap(({ file, number }) =>
    pending
      .filter((p) => p.number === number && basename(p.file) !== basename(file))
      .map((p) => ({ file, number, pr: p.pr, prFile: p.file })),
  )

  return { collisions, outOfOrder, openPrClashes, nextFree, openPrsKnown: openPrs !== null }
}

const renamed = (file, number) => `${number}_${basename(file).replace(/^\d+_/, "")}`

/**
 * Human-readable lines; `errors` fail the check, `warnings` do not. Each
 * error/warning carries the file it is about, for the annotation.
 */
export function formatReport(result, { base, outOfOrderFails = OUT_OF_ORDER_FAILS }) {
  const source = result.openPrsKnown ? `${base} and every open PR` : `${base} only — open PRs could not be listed`
  const outOfOrder = result.outOfOrder ?? []
  const renames = [...result.collisions, ...outOfOrder]
  const sequenceTo = renames.length > 0 ? renames[renames.length - 1].suggested : null
  const collisionLines = result.collisions.map((c) => ({
    file: c.file,
    message:
      `${basename(c.file)} takes migration number ${c.number}, which ${base} already holds as ${c.baseFiles.join(", ")}. ` +
      `Rename it to ${renamed(c.file, c.suggested)} (the next free number across ${source}) ` +
      `and set ${MIGRATIONS_DIR}/.sequence to ${sequenceTo}.`,
  }))
  const outOfOrderLines = outOfOrder.map((o) => ({
    file: o.file,
    message:
      `${basename(o.file)} takes migration number ${o.number}, below ${base}'s highest (${o.highest}). ` +
      `If ${o.highest} reaches main first, this one sorts before an applied migration and \`supabase db push\` ` +
      `on main refuses it, which skips the production deploy. ` +
      `Rename it to ${renamed(o.file, o.suggested)} (the next free number across ${source}) ` +
      `and set ${MIGRATIONS_DIR}/.sequence to ${sequenceTo}.`,
  }))
  const errorLines = outOfOrderFails ? [...collisionLines, ...outOfOrderLines] : collisionLines
  const errors = errorLines.map((e) => e.message)
  let next = result.nextFree + renames.length
  const warnings = result.openPrClashes.map((c) => {
    const msg =
      `${basename(c.file)} and open PR #${c.pr} (${basename(c.prFile)}) both add migration ${c.number}; ` +
      `whichever merges second will fail this check. ${next} is free now.`
    next += 1
    return msg
  })
  return {
    errors,
    errorFiles: errorLines.map((e) => e.file),
    warnings: [...(outOfOrderFails ? [] : outOfOrderLines.map((o) => o.message)), ...warnings],
  }
}

// ── GitHub I/O ──────────────────────────────────────────────────────────────

const execFileP = promisify(execFile)

/** `gh api` as JSON. Injected in tests. */
async function ghApi(method, path) {
  const { stdout } = await execFileP("gh", ["api", "-X", method, "-H", "Accept: application/vnd.github+json", path], {
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout.trim() === "" ? null : JSON.parse(stdout)
}

async function paged(gh, path) {
  const sep = path.includes("?") ? "&" : "?"
  const all = []
  for (let page = 1; ; page++) {
    const items = await gh("GET", `${path}${sep}per_page=${PAGE}&page=${page}`)
    all.push(...items)
    if (items.length < PAGE) return all
  }
}

const prFiles = (gh, repo, number) => paged(gh, `repos/${repo}/pulls/${number}/files`)
const prMigrations = async (gh, repo, number) => addedMigrations(await prFiles(gh, repo, number))

/** Filenames in supabase/migrations/ at the TIP of `ref`, read now (not the PR's merge ref). */
async function baseMigrationFiles(gh, repo, ref) {
  const entries = await gh("GET", `repos/${repo}/contents/supabase?ref=${encodeURIComponent(ref)}`)
  const dir = entries.find((e) => e.name === "migrations" && e.type === "dir")
  if (!dir) throw new Error(`${MIGRATIONS_DIR} not found on ${ref}`)
  const tree = await gh("GET", `repos/${repo}/git/trees/${dir.sha}`)
  if (tree.truncated) throw new Error(`the ${MIGRATIONS_DIR} tree on ${ref} came back truncated — refusing to judge against a partial list`)
  return tree.tree.filter((e) => e.type === "blob").map((e) => e.path)
}

async function openPrMigrations(gh, repo, { base, exclude } = {}) {
  const query = base ? `state=open&base=${encodeURIComponent(base)}` : "state=open"
  const prs = (await paged(gh, `repos/${repo}/pulls?${query}`)).filter((pr) => String(pr.number) !== String(exclude))
  const out = []
  for (const pr of prs) out.push({ number: pr.number, headSha: pr.head.sha, added: await prMigrations(gh, repo, pr.number) })
  return out
}

const escapeData = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
const escapeProperty = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C")

/** The pull_request half. Returns the exit code. */
export async function runCheck({ gh = ghApi, repo, pr, base, log = console.log }) {
  const files = await prFiles(gh, repo, pr)
  const added = addedMigrations(files)
  if (added.length === 0) {
    log(`PR #${pr} adds no migration — nothing to check.`)
    return 0
  }
  let openPrs = null
  try {
    // Every open PR, whatever its base: a stacked PR's migration lands on dev too.
    openPrs = await openPrMigrations(gh, repo, { exclude: pr })
  } catch (err) {
    log(`::warning::Could not list open PRs (${escapeData(String(err.message ?? err).split("\n")[0])}); the free number below is from ${base} only.`)
  }
  // Read the base LAST: listing open PRs takes a call per PR, and the base
  // snapshot this run judges against should be as fresh as it can be.
  const baseFiles = await baseMigrationFiles(gh, repo, base)
  const result = evaluate({ added, removed: removedMigrations(files), baseFiles, openPrs })
  const { errors, errorFiles, warnings } = formatReport(result, { base })
  for (const w of warnings) log(`::warning::${escapeData(w)}`)
  errors.forEach((e, i) => log(`::error file=${escapeProperty(errorFiles[i])}::${escapeData(e)}`))
  if (errors.length === 0) log(`OK: ${added.map(basename).join(", ")} — no number already taken on ${base}.`)
  return errors.length === 0 ? 0 : 1
}

/**
 * The push-to-base half: re-run this guard on every open PR into `base` that
 * adds a migration, so a PR whose number the push just took turns red now
 * rather than after it merges. A run still queued reads the base when it
 * starts, so it is left alone; a run IN PROGRESS may already have read the
 * base from before this push, so it is waited out (one shared deadline for
 * all of them) and then re-run. Best-effort — needs `actions: write`; a
 * refused re-run, or a run that outlasts the deadline, is a warning, never a
 * failure of the push.
 */
export async function runRecheck({
  gh = ghApi,
  repo,
  base,
  workflow,
  log = console.log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  waitMs = RECHECK_WAIT_MS,
  pollMs = RECHECK_POLL_MS,
}) {
  const prs = (await openPrMigrations(gh, repo, { base })).filter((pr) => pr.added.length > 0)
  if (prs.length === 0) log(`No open PR into ${base} adds a migration.`)
  const rerun = async (pr, runId) => {
    try {
      await gh("POST", `repos/${repo}/actions/runs/${runId}/rerun`)
      log(`#${pr.number}: re-running guard run ${runId}.`)
    } catch (err) {
      log(`::warning::Could not re-run the migration-number guard for #${pr.number} (run ${runId}): ${escapeData(String(err.message ?? err).split("\n")[0])}. Re-run it by hand.`)
    }
  }
  const running = []
  for (const pr of prs) {
    const runs = await gh(
      "GET",
      `repos/${repo}/actions/workflows/${workflow}/runs?event=pull_request&head_sha=${pr.headSha}&per_page=1`,
    )
    const run = runs?.workflow_runs?.[0]
    if (!run) {
      log(`#${pr.number}: no guard run for ${pr.headSha.slice(0, 9)} yet — its next push runs it.`)
    } else if (run.status === "completed") {
      await rerun(pr, run.id)
    } else if (run.status === "in_progress") {
      running.push({ pr, runId: run.id })
    } else {
      log(`#${pr.number}: guard run ${run.id} is ${run.status} — it reads ${base} when it starts; left alone.`)
    }
  }

  const deadline = now() + waitMs
  let waiting = running
  while (waiting.length > 0) {
    const still = []
    for (const w of waiting) {
      const run = await gh("GET", `repos/${repo}/actions/runs/${w.runId}`)
      if (run?.status === "completed") await rerun(w.pr, w.runId)
      else still.push(w)
    }
    waiting = still
    if (waiting.length === 0) break
    if (now() >= deadline) {
      for (const w of waiting) {
        log(`::warning::The migration-number guard for #${w.pr.number} (run ${w.runId}) was still running after ${Math.round(waitMs / 1000)}s and may have read ${base} from before this push. Re-run it by hand once it finishes.`)
      }
      break
    }
    log(`Waiting for ${waiting.length} in-progress guard run(s): ${waiting.map((w) => `#${w.pr.number}`).join(", ")}.`)
    await sleep(pollMs)
  }
  return 0
}

async function main() {
  const mode = process.argv[2]
  const env = (k) => {
    const v = process.env[k]
    if (!v) throw new Error(`${k} is required`)
    return v
  }
  if (mode === "check") {
    return runCheck({ repo: env("GITHUB_REPOSITORY"), pr: env("PR_NUMBER"), base: env("BASE_REF") })
  }
  if (mode === "recheck") {
    return runRecheck({ repo: env("GITHUB_REPOSITORY"), base: env("BASE_REF"), workflow: env("GUARD_WORKFLOW") })
  }
  throw new Error("usage: check-migration-numbers.mjs check|recheck")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`::error::${escapeData(String(err.message ?? err))}`)
      process.exit(2)
    },
  )
}
