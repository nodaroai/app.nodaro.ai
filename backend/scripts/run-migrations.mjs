#!/usr/bin/env node
/**
 * Self-host migration runner — applies supabase/migrations/*.sql in filename
 * order against a direct Postgres connection.
 *
 * SCOPE: self-host boots ONLY. Cloud (and staging) migrations remain
 * PR-event-driven through the Supabase GitHub integration — this script must
 * never point at a managed Nodaro environment. It runs from start.sh when
 * BOTH `RUN_MIGRATIONS_ON_BOOT=true` AND `DATABASE_URL` are set (the
 * community compose sets them; Railway never does).
 *
 * Behavior:
 *   - Waits for Postgres to accept connections (fresh compose stacks race).
 *   - Serializes concurrent runners via pg_advisory_lock (two app containers
 *     sharing one DB apply the set exactly once).
 *   - Tracks applied files in public._nodaro_migrations by filename; already-
 *     applied files are skipped, so boot after the first is O(1).
 *   - Each file runs inside a transaction — EXCEPT files containing
 *     CREATE INDEX CONCURRENTLY (271, 303), which Postgres forbids inside a
 *     transaction block; those run unwrapped, which is safe because a partial
 *     failure there leaves at worst an INVALID index that the file's own
 *     IF NOT EXISTS guards tolerate on retry.
 *   - First failure aborts with the filename and error; the process exits 1
 *     and start.sh refuses to boot the API against a half-migrated schema.
 *
 * Requires: `pg` (backend dependency), MIGRATIONS_DIR override optional
 * (defaults to <repo>/supabase/migrations relative to this script, which is
 * /app/supabase/migrations inside the image).
 */
// @reads supabase/migrations/**
import { readdirSync, readFileSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR || resolve(__dirname, "..", "..", "supabase", "migrations")
const DATABASE_URL = process.env.DATABASE_URL
const WAIT_SECONDS = Number(process.env.MIGRATIONS_WAIT_SECONDS || 60)

// Arbitrary but stable app-wide advisory lock key for "nodaro migrations".
const ADVISORY_LOCK_KEY = 0x6e6f6461

if (!DATABASE_URL) {
  console.error("[migrations] DATABASE_URL is not set — nothing to do")
  process.exit(1)
}

/** Connect with retries — a fresh compose stack races the DB's first boot. */
async function connectWithRetry() {
  const deadline = Date.now() + WAIT_SECONDS * 1000
  let lastError
  for (;;) {
    const client = new pg.Client({ connectionString: DATABASE_URL })
    try {
      await client.connect()
      return client
    } catch (err) {
      lastError = err
      try { await client.end() } catch { /* ignore */ }
      if (Date.now() > deadline) {
        console.error(
          `[migrations] Postgres did not become reachable within ${WAIT_SECONDS}s:`,
          lastError instanceof Error ? lastError.message : lastError,
        )
        process.exit(1)
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

function listMigrationFiles() {
  let names
  try {
    names = readdirSync(MIGRATIONS_DIR)
  } catch (err) {
    console.error(`[migrations] cannot read ${MIGRATIONS_DIR}:`, err instanceof Error ? err.message : err)
    process.exit(1)
  }
  return names.filter((n) => n.endsWith(".sql")).sort()
}

const client = await connectWithRetry()

try {
  await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY])

  await client.query(`
    CREATE TABLE IF NOT EXISTS public._nodaro_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const appliedRows = await client.query("SELECT filename FROM public._nodaro_migrations")
  const applied = new Set(appliedRows.rows.map((r) => r.filename))

  const files = listMigrationFiles()
  const pending = files.filter((f) => !applied.has(f))

  if (pending.length === 0) {
    console.log(`[migrations] up to date (${files.length} applied)`)
  } else {
    console.log(`[migrations] applying ${pending.length} of ${files.length} migrations...`)
    for (const file of pending) {
      // Strip a UTF-8 BOM — some files were saved with one on Windows and
      // Postgres rejects it as a syntax error.
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8").replace(/^﻿/, "")
      // CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
      const transactional = !/CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(sql)
      try {
        if (transactional) await client.query("BEGIN")
        await client.query(sql)
        await client.query("INSERT INTO public._nodaro_migrations (filename) VALUES ($1)", [file])
        if (transactional) await client.query("COMMIT")
        console.log(`[migrations] applied ${file}`)
      } catch (err) {
        if (transactional) {
          try { await client.query("ROLLBACK") } catch { /* ignore */ }
        }
        console.error(`[migrations] FAILED at ${file}:`)
        console.error(err instanceof Error ? err.message : err)
        process.exit(1)
      }
    }
    console.log(`[migrations] done — ${pending.length} applied`)
  }
} finally {
  try { await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]) } catch { /* ignore */ }
  await client.end()
}
