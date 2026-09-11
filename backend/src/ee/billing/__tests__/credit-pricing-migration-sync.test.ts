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
 *
 * ONLY a literal `VALUES` list is read. An `INSERT … SELECT` writes identifiers
 * that do not exist as literals anywhere — they are BUILT at migration time by
 * concatenating onto rows the database already holds (migration 419's derived
 * Pro per-frame tiers) — so there is nothing there to compare against
 * `STATIC_CREDIT_COSTS`. Before this was excluded, the non-greedy `…VALUES`
 * reach walked straight past the `SELECT` into the row-constructor of a
 * `CROSS JOIN (VALUES ('large', 1.5), …)` and reported `large` / `xlarge` as
 * ghost model identifiers. Derived inserts get their own, stricter guard below
 * (`derived inserts build their ids from an existing model_identifier`) rather
 * than an allowlist entry, because the risk they carry is different in kind:
 * not "an id with no price" but "an id nobody can predict".
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
      /INSERT\s+INTO\s+(?:public\.)?model_pricing(?:(?!\bSELECT\b)[\s\S])*?VALUES([\s\S]*?)(?:ON\s+CONFLICT|;\s*$)/gim,
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

/**
 * Same walk, but keeping the credit_cost column too (LAST seeded value wins,
 * mirroring the append-only migration order).
 *
 * The presence check above cannot see a transposed digit, and a wrong DB row
 * OUTRANKS STATIC_CREDIT_COSTS at reservation time (`getModelCreditBaseCost`
 * reads model_pricing first) — so the static table would be right and every
 * charge wrong, with nothing red. Scoped to the families listed in
 * VALUE_SYNCED_FAMILIES rather than applied globally, because the legacy
 * migrations carry pre-re-denomination values they never corrected (167's
 * image-to-video rows, for one).
 */
function extractInsertedValues(): Map<string, number> {
  const values = new Map<string, number>()
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
  for (const file of migrationFiles) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    const inserts = sql.matchAll(
      /INSERT\s+INTO\s+(?:public\.)?model_pricing(?:(?!\bSELECT\b)[\s\S])*?VALUES([\s\S]*?)(?:ON\s+CONFLICT|;\s*$)/gim,
    )
    for (const match of inserts) {
      const rowMatches = (match[1] ?? "").matchAll(/\(\s*'([^']+)'\s*,\s*(\d+)/g)
      for (const m of rowMatches) values.set(m[1]!, Number(m[2]))
    }
  }
  return values
}

const INSERTED_VALUES = extractInsertedValues()

/**
 * Families whose migration VALUES are held byte-identical to
 * STATIC_CREDIT_COSTS. Add a family here when you seed it fresh — it is the
 * only thing standing between a mistyped migration row and a wrong charge.
 * (`wan-3` is matched with an explicit `:` / end-of-string boundary so it does
 * NOT swallow `wan-3-prime`'s rows into the wrong bucket, and `wan-i2v` /
 * `wan-2.7-t2v` are untouched.)
 */
const VALUE_SYNCED_FAMILIES = ["wan-3", "wan-3-prime", "gemini-omni-flash"] as const
const VALUE_SYNCED_ROW_COUNT = 187 // 88 wan-3 + 88 wan-3-prime + 11 gemini-omni-flash

function familyOf(key: string): string | undefined {
  return VALUE_SYNCED_FAMILIES.find((f) => key === f || key.startsWith(`${f}:`))
}

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
  // ── voice-recast renamed → voice-changer-pro. Migration 233 historically
  //    seeded 'voice-recast'; migration 234 renames that row to
  //    'voice-changer-pro' (the live id, now in STATIC_CREDIT_COSTS). 233's
  //    INSERT remains in the file, so the old id is a documented ghost. ──
  "voice-recast",
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
  // ── Collect → Reduce rename (migration 151). The collect:* rows are
  //    inserted by migration 149 and then REPLACE()d to reduce:* by 151.
  //    Both migrations stay on disk forever (Supabase append-only), so the
  //    migration scanner still sees the literal collect:* INSERTs even
  //    though no row with those keys exists at runtime. ──
  "collect:pick-best-llm",
  "collect:concat",
  "collect:first-non-empty",
  "collect:count",
  "collect:vote",
  "collect:merge-json",
  // ── flux-2-max old resolution-less format (migration 129) — superseded by
  //    per-MP×ref format in migration 183 (`flux-2-max:<mp>MP:<n>ref`).
  //    Migration 183 DELETEs these rows, but the scanner sees the legacy INSERTs
  //    from migration 129. They are no longer in STATIC_CREDIT_COSTS. ──
  "flux-2-max:1ref",
  "flux-2-max:2ref",
  "flux-2-max:3ref",
  "flux-2-max:4ref",
  "flux-2-max:5ref",
  "flux-2-max:6ref",
  "flux-2-max:7ref",
  "flux-2-max:8ref",
  // ── seedance-2-fast phantom 1080p (migration 133) — KIE has NO 1080p SKU for
  //    the fast model (480p/720p only, verified KIE pricing page 2026-06-25).
  //    Migration 133 seeded these guessed (1.5×-of-720p) rows; migration 239
  //    DELETEs them. Removed from STATIC_CREDIT_COSTS — 133's literal INSERTs
  //    stay on disk (append-only), so the scanner still sees them as ghosts. ──
  "seedance-2-fast:4s:1080p",
  "seedance-2-fast:8s:1080p",
  "seedance-2-fast:12s:1080p",
  "seedance-2-fast:15s:1080p",
  "seedance-2-fast:4s:1080p-ref",
  "seedance-2-fast:8s:1080p-ref",
  "seedance-2-fast:12s:1080p-ref",
  "seedance-2-fast:15s:1080p-ref",
  // ── Beeble SwitchX coarse provisional tiers (migration 240) — re-anchored to
  //    30-frame block tiers (30..240) in migration 241, which DELETEs these rows
  //    and removes them from STATIC_CREDIT_COSTS. 240's literal INSERTs stay on
  //    disk (append-only), so the scanner still sees them as ghosts. ──
  "beeble-switchx:48f:1080p",
  "beeble-switchx:48f:720p",
  "beeble-switchx:96f:1080p",
  "beeble-switchx:96f:720p",
  "beeble-switchx:144f:1080p",
  "beeble-switchx:144f:720p",
  "beeble-switchx:192f:1080p",
  "beeble-switchx:192f:720p",
])

/**
 * The suffixes a derived insert is allowed to append.
 *
 * Migration 419's tiers are the only derived rows today. They are declared here
 * rather than in `KNOWN_GHOST_IDENTIFIERS` because they are not ghosts: they
 * DO have a price, read at migration time from the operator-seeded base row
 * each one is a multiple of. What has to be pinned about them is the opposite
 * property — that a derived insert cannot invent an identifier shape nobody
 * predicted.
 */
const DERIVED_ROW_SUFFIXES: ReadonlySet<string> = new Set([":large", ":xlarge"])

/** The base ids a derived insert may build FROM, as `LIKE` prefixes. */
const DERIVED_ROW_BASE_PREFIXES: readonly string[] = ["pro-3d-render:render-frame:"]

describe("derived model_pricing inserts", () => {
  /**
   * Every `INSERT INTO model_pricing … SELECT …` STATEMENT in the history.
   *
   * Statement-scoped on purpose: a reach for `SELECT` from the table name
   * across the rest of the file finds unrelated ones (a later migration's
   * `SELECT 1 FROM pg_policies`, for instance) and reports a plain VALUES
   * insert as derived. So the file is split into statements first, and a
   * statement counts as derived only when its own `SELECT` comes before any
   * `VALUES` of its own.
   */
  function derivedInserts(): Array<{ file: string; sql: string }> {
    const out: Array<{ file: string; sql: string }> = []
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
      for (const statement of readFileSync(join(MIGRATIONS_DIR, file), "utf8").split(";")) {
        const head = /INSERT\s+INTO\s+(?:public\.)?model_pricing/i.exec(statement)
        if (!head) continue
        const body = statement.slice(head.index)
        const selectAt = body.search(/\bSELECT\b/i)
        const valuesAt = body.search(/\bVALUES\b/i)
        if (selectAt < 0) continue
        if (valuesAt >= 0 && valuesAt < selectAt) continue
        out.push({ file, sql: body })
      }
    }
    return out
  }

  it("build their ids from an existing model_identifier, never from a literal", () => {
    // This is what makes it safe for `extractInsertedIdentifiers` to skip these
    // statements: the id is a function of a row that already exists, so it
    // already has a configured price by construction. A derived insert whose
    // first selected column were a literal would be a NEW identifier with no
    // price and no static entry — a ghost hiding from the scan above.
    for (const { file, sql } of derivedInserts()) {
      expect(sql, `${file}: a derived model_pricing insert must build its id by concatenating onto an existing model_identifier`)
        .toMatch(/model_identifier\s*\|\|/)
    }
  })

  it("append only declared suffixes, onto a declared base prefix", () => {
    for (const { file, sql } of derivedInserts()) {
      // A suffix arrives one of two ways: spelled whole in a concatenated
      // literal (`|| ':large'`), or as a bare `:` separator concatenated with a
      // name a row-constructor supplies (`|| ':' || tier.name`, the shape 419
      // uses so the ladder is written once). Collect both, and drop the bare
      // separator itself — it is punctuation, not a suffix.
      const literals = [...sql.matchAll(/\|\|\s*'([^']*)'/g)].map((m) => m[1])
      const separatorOnly = literals.filter((x) => x === ":")
      const spelled = literals.filter((x) => x.startsWith(":") && x !== ":")
      const fromRowConstructor = separatorOnly.length > 0
        ? [...sql.matchAll(/\(\s*'([a-z][a-z0-9-]*)'\s*,/g)].map((m) => `:${m[1]}`)
        : []
      const declared = [...spelled, ...fromRowConstructor]
      expect(declared.length, `${file}: found no declared suffix on a derived insert`).toBeGreaterThan(0)
      for (const suffix of declared) {
        expect(DERIVED_ROW_SUFFIXES.has(suffix), `${file}: derived row suffix "${suffix}" is not in DERIVED_ROW_SUFFIXES — add it with a reason, or stop deriving it`).toBe(true)
      }
      expect(
        DERIVED_ROW_BASE_PREFIXES.some((prefix) => sql.includes(prefix)),
        `${file}: a derived insert must select FROM one of the declared base prefixes (${DERIVED_ROW_BASE_PREFIXES.join(", ")})`,
      ).toBe(true)
    }
  })

  it("never rewrite or delete the base rows they derive from", () => {
    for (const { file, sql } of derivedInserts()) {
      expect(sql, `${file}: a derived insert must preserve operator overrides`).toMatch(/ON\s+CONFLICT[\s\S]*?DO\s+NOTHING/i)
      expect(sql, `${file}: a derived insert must not UPDATE`).not.toMatch(/DO\s+UPDATE/i)
    }
  })

  it("is not a vacuous suite — the derived inserts exist", () => {
    // 419 is the first. If this ever reads 0, the three cases above stopped
    // proving anything and the parser exclusion lost its justification.
    expect(derivedInserts().length).toBeGreaterThan(0)
  })
})

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

// ---------------------------------------------------------------------------
// Test 3 — VALUE equality for freshly seeded families. Presence is not enough:
// the DB row wins over STATIC_CREDIT_COSTS at reservation time.
// ---------------------------------------------------------------------------

describe("freshly seeded families are value-synced with their migration rows", () => {
  const scopedStaticKeys = Object.keys(STATIC_CREDIT_COSTS)
    .filter((k) => familyOf(k) !== undefined)
    .sort()

  it("the scope is non-empty (the family list did not silently stop matching)", () => {
    expect(scopedStaticKeys.length).toBe(VALUE_SYNCED_ROW_COUNT)
  })

  it.each(scopedStaticKeys)(
    'model_pricing row for "%s" carries the STATIC_CREDIT_COSTS value',
    (key) => {
      const migrationValue = INSERTED_VALUES.get(key)
      expect(
        migrationValue,
        `"${key}" is in STATIC_CREDIT_COSTS but no model_pricing INSERT in supabase/migrations/ carries a credit_cost for it.`,
      ).toBeDefined()
      expect(
        migrationValue,
        `model_pricing seeds ${migrationValue} for "${key}" but STATIC_CREDIT_COSTS says ${STATIC_CREDIT_COSTS[key]}. The DB row WINS at reservation time (getModelCreditBaseCost reads model_pricing first), so this charges the wrong amount while the static table looks correct.`,
      ).toBe(STATIC_CREDIT_COSTS[key])
    },
  )

  it("the migrations seed no EXTRA row in these families", () => {
    const staticKeys = new Set(scopedStaticKeys)
    const extra = [...INSERTED_VALUES.keys()].filter(
      (k) => familyOf(k) !== undefined && !staticKeys.has(k),
    )
    expect(
      extra,
      `These identifiers are seeded into model_pricing but have no STATIC_CREDIT_COSTS entry — a truncated or over-eager copy-paste: ${extra.join(", ")}`,
    ).toEqual([])
  })
})
