// @test-watches backend/src/**/*.ts supabase/migrations/*.sql
/**
 * `profiles.public_outputs` has exactly three writes, in two files:
 *
 *  - `false` only through `makeOutputsPrivate` (lib/gallery-removal.ts →
 *    `make_outputs_private`, migration 706), called by the user settings
 *    route, which hides the person's existing gallery items in the same
 *    transaction. A plain write of `false` anywhere else (an admin tool, a
 *    plan change) would leave their items public while telling them
 *    "private".
 *  - `true` as a plain preference write in the settings route, which
 *    republishes nothing.
 *  - `true` when a plan change drops the person from a plan with private
 *    outputs to one without (lib/private-outputs-plan.ts
 *    `outputsColumnsForPlanChange`, spread by `tierColumns`, which every tier
 *    write goes through): their NEW results are public again, and it touches
 *    no job row, so nothing made while private is republished. It fires only
 *    on that drop, never on a rewrite of a plan without private outputs, so
 *    an account already on Free or Basic with private outputs is not reset in
 *    passing.
 *
 * A writer that also flipped `jobs.is_public` back on would break "switching
 * back to public does not republish old items"; a second place deciding which
 * plans may be private would drift from the settings route's rule.
 *
 * The guarantee for old items is the database's, not these writers': every
 * false → true write of `public_outputs`, by either writer, is stamped in the
 * same update as `profiles.outputs_public_since` (trigger, migration 713), and
 * the jobs trigger never writes public a row created before that stamp (a row
 * completed while private, a job still running at the switch) nor one the
 * private switch hid. Proven in supabase/tests/private-outputs-hide-existing
 * .behavior.sql (P11, P12). No application code writes the stamp.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const SRC = join(REPO, "backend", "src")
const MIGRATIONS = join(REPO, "supabase", "migrations")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(path))
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** `public_outputs: …` in an object literal, `.public_outputs = …`, or a SQL `public_outputs = …` in an update. */
const WRITE = /\bpublic_outputs\s*(?::(?!\s*boolean)|=(?!=))/

function writesIn(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => WRITE.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .map((line) => line.trim())
}

describe("profiles.public_outputs has one writer", () => {
  it("only the settings route and the plan-change reset write it, and only `true` directly", () => {
    const writers = sourceFiles(SRC)
      .filter((path) => writesIn(readFileSync(path, "utf8")).length > 0)
      .map((path) => relative(SRC, path))
      .sort()
    expect(writers).toEqual(["lib/private-outputs-plan.ts", "routes/user-settings.ts"])

    const route = readFileSync(join(SRC, "routes", "user-settings.ts"), "utf8")
    expect(writesIn(route)).toEqual(["updates.public_outputs = true"])
    expect(route).toContain("makeOutputsPrivate(userId)")
    // The route asks the same rule the plan-change reset asks; it keeps no tier list of its own.
    expect(route).toContain("planAllowsPrivateOutputs(profile.tier)")
    expect(route).not.toMatch(/"standard",\s*"pro"/)

    // The plan-change reset: only `true`, only on a drop out of a plan with private outputs.
    const plan = readFileSync(join(SRC, "lib", "private-outputs-plan.ts"), "utf8")
    expect(writesIn(plan)).toEqual(["return drops ? { public_outputs: true } : {}"])
    expect(plan).toContain(
      "const drops = fromTier !== null && planAllowsPrivateOutputs(fromTier) && !planAllowsPrivateOutputs(toTier)",
    )
    // ...and it reaches every tier write through tierColumns.
    expect(readFileSync(join(SRC, "ee", "billing", "tier-columns.ts"), "utf8")).toContain(
      "return { tier, subscription_tier: tier, ...outputsColumnsForPlanChange(fromTier, tier) }",
    )
  })

  it("the switch back to public is stamped by the database, and no application code writes the stamp", () => {
    const sql = readFileSync(join(MIGRATIONS, "713_outputs_public_since.sql"), "utf8")
    expect(sql).toMatch(/CREATE TRIGGER trg_stamp_outputs_public_since\s+BEFORE UPDATE ON public\.profiles/)
    expect(sql).toMatch(/\(OLD\.public_outputs IS FALSE AND NEW\.public_outputs IS TRUE\)/)
    expect(sql).toMatch(/NEW\.created_at < p\.outputs_public_since/)
    // Why it went public (plan / owner) is the trigger's too, and only a plan reset enqueues the one email.
    expect(sql).toMatch(/CASE WHEN NEW\.tier IS DISTINCT FROM OLD\.tier THEN 'plan' ELSE 'owner' END/)
    expect(sql).toMatch(/NEW\.outputs_public_reason = 'plan'\)\s*EXECUTE FUNCTION public\.enqueue_outputs_public_notice/)
    const stampWriters = sourceFiles(SRC).filter((path) =>
      readFileSync(path, "utf8").split("\n").some((line) => /\boutputs_public_(since|reason)\s*(?::(?!\s*string)|=(?!=))/.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")),
    )
    expect(stampWriters).toEqual([])
  })

  it("no migration after 706 sets it outside make_outputs_private", () => {
    const later = readdirSync(MIGRATIONS)
      .filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) > 706)
      .filter((name) => {
        // A later redefinition of make_outputs_private itself is the one allowed place.
        const sql = readFileSync(join(MIGRATIONS, name), "utf8").replace(
          /CREATE OR REPLACE FUNCTION public\.make_outputs_private[\s\S]*?\$\$[\s\S]*?\$\$/gi,
          "",
        )
        return /\bSET\s+public_outputs\b/i.test(sql)
      })
    expect(later).toEqual([])
  })
})
