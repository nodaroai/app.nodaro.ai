import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { execSync } from "child_process"
import path from "path"

// Tier-read guard (design 2026-07-05 §4.2): the payg derivation lives in
// @nodaro/shared's resolveEffectiveTier. Entitlement sites MUST route through
// it; a new raw `profile.tier` read silently deactivates payg for whatever it
// gates. This guard is the enumerator the design asked for — the §4.2 list
// was a floor, this pins the actual current state.

const BACKEND_SRC = path.resolve(__dirname, "../../..")
const read = (rel: string) => readFileSync(path.join(BACKEND_SRC, rel), "utf8")

/** Files allowed to read stored tier raw (billing/provisioning/deliberate). */
const SANCTIONED_RAW_TIER_READERS = new Set([
  "ee/billing/tier-columns.ts", // resolveTierFrom (admin display coalesce)
  "ee/billing/cleanup-service.ts", // downgrade provisioning + DB-side reaper filters (task: retention filter consumes effective helper separately)
  "ee/billing/provision-credits.ts", // subscriptions.tier — different table
  "ee/routes/admin-credits.ts", // resolveTierFrom — admin stored-tier display
  "ee/routes/admin-subscription-health.ts", // stored-vs-subscription mismatch check — payg would create phantom mismatches
  "routes/me.ts", // inline stored coalesce (core cannot import ee; documented)
  "routes/user-settings.ts", // PRIVATE_MODE_TIERS — stored-deliberate (design decision #9)
])

/** Entitlement files that must consume the shared effective-tier helper,
 *  and the SELECT fragment each must fetch (the compile-error mechanism
 *  cannot see untyped supabase selects — this pins them textually). */
const EFFECTIVE_SITES: Array<{ file: string; mustContain: string[] }> = [
  // credits.ts and the UGC quote derive through `effectiveTierOf` (org-entitlements.ts),
  // the adapter over the shared helper that the guard's gates (`spendGates`) sit beside.
  { file: "ee/billing/org-entitlements.ts", mustContain: ["resolveEffectiveTier"] },
  { file: "ee/billing/credits.ts", mustContain: ["effectiveTierOf", "lifetime_topup_credits"] },
  { file: "ee/lib/ugc-quote.ts", mustContain: ["effectiveTierOf", "lifetime_topup_credits"] },
  { file: "ee/lib/credit-guard-impl.ts", mustContain: ["resolveEffectiveTier", "lifetime_topup_credits"] },
  { file: "ee/pipelines/create-pipeline.ts", mustContain: ["resolveEffectiveTier", "lifetime_topup_credits"] },
  { file: "ee/pipelines/engine.ts", mustContain: ["resolveEffectiveTier", "lifetime_topup_credits"] },
  { file: "routes/video-director.ts", mustContain: ["resolveEffectiveTier", "lifetime_topup_credits"] },
  { file: "utils/file-validation.ts", mustContain: ["resolveEffectiveTier", "lifetime_topup_credits"] },
  { file: "workers/orchestrator-worker.ts", mustContain: ["resolveEffectiveTier", "lifetime_topup_credits"] },
  { file: "workers/render-worker.ts", mustContain: ["resolveEffectiveTier", "lifetime_topup_credits"] },
]

describe("payg tier-read guard", () => {
  it("the old private resolveTier helper stays deleted", () => {
    const credits = read("ee/billing/credits.ts")
    expect(credits).not.toMatch(/function resolveTier\(/)
  })

  it("every entitlement site imports the shared helper AND widened its SELECT", () => {
    for (const site of EFFECTIVE_SITES) {
      const src = read(site.file)
      for (const needle of site.mustContain) {
        expect(src, `${site.file} must contain "${needle}"`).toContain(needle)
      }
    }
  })

  it("no NEW raw tier-coalesce reads outside the sanctioned lists", () => {
    // Raw patterns that indicate a stored-tier read on a profiles row.
    const out = execSync(
      `grep -rlE "\\.tier as string\\)? \\?\\? \\"free\\"|profile\\??\\.tier \\?\\? \\"free\\"" ` +
        `--include='*.ts' ee routes workers utils services lib middleware 2>/dev/null || true`,
      { cwd: path.join(BACKEND_SRC), encoding: "utf8" }
    )
    const offenders = out
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.includes("__tests__"))
      .filter((f) => !SANCTIONED_RAW_TIER_READERS.has(f))
      .filter((f) => !EFFECTIVE_SITES.some((s) => s.file === f))
    expect(offenders, `unsanctioned raw tier reads: ${offenders.join(", ")} — route through resolveEffectiveTier (@nodaro/shared) or add to the documented allowlist with a bucket justification`).toEqual([])
  })
})
