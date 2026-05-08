/**
 * L1#2 — STATIC_CREDIT_COSTS × model_pricing migration sync.
 *
 * Per CLAUDE.md "Provider Enum Sync" step 9: every model added to
 * `STATIC_CREDIT_COSTS` must also have an `INSERT INTO model_pricing`
 * statement in `supabase/migrations/`. Without that, the model is INVISIBLE
 * in `/admin/models` and `/admin/llm-models` — admins cannot see or override
 * the price. The static fallback still charges correctly at runtime, but
 * the admin contract is broken.
 *
 * Bug class: developer adds a new provider, updates STATIC_CREDIT_COSTS, but
 * forgets to write the migration row. Today this is caught only by the
 * `audit-credits` skill at human review time. This test makes it CI-enforced.
 *
 * Composite identifiers count: `flux:2K`, `gpt-image:high`, `kling:5s:audio`
 * are separate keys that each need their own migration row (or a single
 * multi-row INSERT). The walk treats them as distinct.
 *
 * REVERSE direction (ghosts in migrations missing from STATIC_CREDIT_COSTS)
 * is checked separately and reports a soft warning — those are dead-code
 * remnants of disabled providers (runway/pika/old-Sora variants). Tracking
 * cleanup is a separate spec.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"

// REPO_ROOT: backend/src/ee/billing/__tests__/ → up 5 → repo root
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations")

/**
 * Extract every model_identifier inserted into model_pricing across the full
 * migration history. Matches both `INSERT INTO model_pricing` and `INSERT
 * INTO public.model_pricing` forms. Each row's first quoted string is the
 * identifier; subsequent columns (credit_cost, is_enabled, category) are
 * ignored here — this is a presence check only.
 *
 * Migrations are append-only and ON CONFLICT DO NOTHING is the convention,
 * so reading from any migration that ever inserted the identifier counts
 * (admins can override the price in DB after that, which is the point).
 */
function extractInsertedIdentifiers(): Set<string> {
  const identifiers = new Set<string>()
  const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) =>
    f.endsWith(".sql"),
  )
  for (const file of migrationFiles) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    // Match: INSERT INTO (public.)?model_pricing ... VALUES (... ROWS ...)
    // Allow either `ON CONFLICT` clause or a bare `;` to terminate.
    const inserts = sql.matchAll(
      /INSERT\s+INTO\s+(?:public\.)?model_pricing[\s\S]*?VALUES([\s\S]*?)(?:ON\s+CONFLICT|;\s*$)/gim,
    )
    for (const match of inserts) {
      const valuesBlock = match[1] ?? ""
      // Each row of the form `( '<identifier>', ... )`. First quoted string
      // is the identifier.
      const rowMatches = valuesBlock.matchAll(/\(\s*'([^']+)'/g)
      for (const m of rowMatches) {
        identifiers.add(m[1])
      }
    }
  }
  return identifiers
}

const INSERTED_IDENTIFIERS = extractInsertedIdentifiers()

// ---------------------------------------------------------------------------
// Sanity check on the migration walk itself.
// ---------------------------------------------------------------------------

describe("model_pricing migration extraction sanity", () => {
  it("extracted a non-trivial number of inserted identifiers (>= 100)", () => {
    expect(INSERTED_IDENTIFIERS.size).toBeGreaterThanOrEqual(100)
  })

  it("contains baseline identifiers known to be inserted", () => {
    expect(INSERTED_IDENTIFIERS.has("nano-banana")).toBe(true)
    expect(INSERTED_IDENTIFIERS.has("kling")).toBe(true)
    expect(INSERTED_IDENTIFIERS.has("veo3")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 1 — every STATIC_CREDIT_COSTS key has at least one matching INSERT
// somewhere in the migration history.
// ---------------------------------------------------------------------------

describe("STATIC_CREDIT_COSTS keys have model_pricing migrations", () => {
  const staticKeys = Object.keys(STATIC_CREDIT_COSTS).sort()

  it.each(staticKeys)(
    'STATIC_CREDIT_COSTS["%s"] has a corresponding INSERT INTO model_pricing in supabase/migrations/',
    (key) => {
      expect(
        INSERTED_IDENTIFIERS.has(key),
        `Model "${key}" is in STATIC_CREDIT_COSTS (backend/src/ee/billing/credits.ts) but no \`INSERT INTO model_pricing\` row exists for it in supabase/migrations/. The runtime fallback will still charge the static cost correctly, but the admin UI (/admin/models, /admin/llm-models) reads from the DB only — admins cannot see or override this model's price. Add a migration:\n\n  INSERT INTO public.model_pricing (model_identifier, credit_cost, is_enabled, category)\n  VALUES ('${key}', ${STATIC_CREDIT_COSTS[key]}, true, '<category>')\n  ON CONFLICT (model_identifier) DO NOTHING;\n\nSee CLAUDE.md "Provider Enum Sync" step 9.`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 2 — REVERSE direction. Migrations that insert identifiers no longer
// in STATIC_CREDIT_COSTS are dead weight ("ghosts"). Not a hard failure
// because some are intentional dead-code (runway/pika replicate disabled,
// old Sora variants migrated to v2). Allowlist documents them so future
// drift surfaces.
// ---------------------------------------------------------------------------

const KNOWN_GHOST_IDENTIFIERS: ReadonlySet<string> = new Set([
  // ── Replicate providers — disabled in current build, kept as historical ──
  "runway",
  "pika",
  // ── Old Sora variants — superseded by sora2/sora2-pro ──
  "sora",
  "sora-watermark-remove",
  "sora-storyboard",
  "sora-storyboard:15",
  "sora-storyboard:25",
  // ── Sora2 family — still appears in migrations but moved to dynamic
  //    routing (some variants reachable, some not). Tracked for cleanup. ──
  "sora2",
  "sora2-pro",
  "sora2:5s",
  "sora2:10s",
  "sora2-pro:5s",
  "sora2-pro:10s",
  "sora2-pro:5s:high",
  "sora2-pro:10s:high",
  // ── Old ideogram entries (replaced by ideogram-v3 family) ──
  "ideogram",
  "ideogram:TURBO",
  "ideogram:QUALITY",
  // ── Disabled / experimental providers ──
  "tangoflux",
  "musicgen",
  "lyria",
  "bark",
  "whisper",
  "incredibly-fast-whisper",
  // ── Old node-type aliases ──
  "extract-audio",
])

describe("model_pricing migrations have no undocumented ghosts", () => {
  it("every migration-only identifier is either in STATIC_CREDIT_COSTS or in KNOWN_GHOST_IDENTIFIERS", () => {
    const staticKeys = new Set(Object.keys(STATIC_CREDIT_COSTS))
    const ghosts = [...INSERTED_IDENTIFIERS].filter(
      (k) => !staticKeys.has(k) && !KNOWN_GHOST_IDENTIFIERS.has(k),
    )
    expect(
      ghosts,
      `These identifiers are inserted into model_pricing in supabase/migrations/ but have no entry in STATIC_CREDIT_COSTS. Either:\n  (a) Add them to STATIC_CREDIT_COSTS in backend/src/ee/billing/credits.ts (if they're real, currently-supported models), OR\n  (b) Add them to KNOWN_GHOST_IDENTIFIERS in this test file with a comment noting why they're dead (e.g., "deprecated provider", "renamed to X"), OR\n  (c) Reverse the migration if the model was never shipped.\nGhosts: ${ghosts.join(", ")}`,
    ).toEqual([])
  })

  it("every entry in KNOWN_GHOST_IDENTIFIERS is genuinely absent from STATIC_CREDIT_COSTS", () => {
    const staticKeys = new Set(Object.keys(STATIC_CREDIT_COSTS))
    const stale = [...KNOWN_GHOST_IDENTIFIERS].filter((k) => staticKeys.has(k))
    expect(
      stale,
      `These KNOWN_GHOST_IDENTIFIERS entries are in STATIC_CREDIT_COSTS now — remove them from the ghost list (they're not ghosts anymore): ${stale.join(", ")}`,
    ).toEqual([])
  })

  it("every entry in KNOWN_GHOST_IDENTIFIERS is still in some migration", () => {
    const stale = [...KNOWN_GHOST_IDENTIFIERS].filter(
      (k) => !INSERTED_IDENTIFIERS.has(k),
    )
    expect(
      stale,
      `These KNOWN_GHOST_IDENTIFIERS entries are no longer in any migration — remove them from the ghost list (the migration has been cleaned up): ${stale.join(", ")}`,
    ).toEqual([])
  })
})
