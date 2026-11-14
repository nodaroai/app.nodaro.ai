// @test-watches backend/src/**/*.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { relPath, SCAN_TIMEOUT_MS, sourceFiles } from "../../../lib/__tests__/source-scan.js"
import { chainTable, importedNames, isDeclarationName, literalText, parseWithParents, referencedNames, topLevelFunctions } from "./census-ast.js"

/**
 * Every read of a user's own plan tier answers for a deployment payer
 * (decided 2026-11-08).
 *
 * On a deployment with a payer every user is stored on the free tier while the
 * payer account holds the plan. So a gate, a cap or a reported tier read off the
 * user's own row would treat the whole instance as free tier. A covered user's
 * plan is the payer account's grade (`payerCoverage` / `coverageOf`,
 * lib/deployment-payer.ts), with the deployment grade's terms: no free-tier
 * semantics, no app-credit allowance, no watermark and no daily cap.
 *
 * WHAT IS FLAGGED: a top-level function of a file in `backend/src` (a class
 * method counts as its own) that reads a tier. It either calls a tier
 * derivation (`resolveEffectiveTier`, `resolveStoredTier`, `effectiveTierOf`,
 * `resolveTierFrom`, under any local name) or selects `tier` /
 * `subscription_tier` from `profiles`, an embedded `profiles(…)` included.
 *
 * Each flagged function is listed below with how many tier reads it makes, and
 * the scan holds it to its entry. A route plugin or class method is one
 * function, so the count is what makes a new read inside an already-listed one
 * visible: the count changes, and the read is looked at before the entry is
 * updated. Each entry is one of these:
 *  - `asks`: it asks the payer rule itself: `payerCoverage`, `coverageOf`, or
 *    the predicate both answer from, `deploymentPayerActive`;
 *  - `spend`: it is a spend site, and the spend seam already applies the
 *    deployment grade (`payerProfileId` / `spendGates` /
 *    `applyOrgEntitlements`);
 *  - `exempt`: it is not a plan gate on the user's own behalf, with the reason.
 *    Examples: an admin view of each user's own row, a writer of that row, or
 *    the payer's own grade.
 * A new tier read fails here: in a new function until it is listed, and in a
 * listed one until its count is updated.
 *
 * LIMITS, on purpose: an `asks` or `spend` entry is checked for naming the
 * rule, not for which of its reads the rule guards; the count is what puts a
 * new read in front of a reviewer. A read in a helper that a listed function
 * calls is that helper's own entry, and an RPC that reads a tier is outside the
 * scan.
 */
type Entry =
  | { readonly rule: "asks"; readonly reads: number }
  | { readonly rule: "spend"; readonly reads: number }
  | { readonly rule: "exempt"; readonly reads: number; readonly why: string }

const asks = (reads: number): Entry => ({ rule: "asks", reads })
const spend = (reads: number): Entry => ({ rule: "spend", reads })
const exempt = (reads: number, why: string): Entry => ({ rule: "exempt", reads, why })

const TIER_READS: Readonly<Record<string, Entry>> = {
  // ── What a client is told, and the gates on a user's own behalf: they ask the payer rule ──
  "ee/billing/credits.ts#CreditsService.getBalance": asks(3),
  "ee/billing/credits.ts#CreditsService.checkAppRunEligibility": asks(2),
  "ee/routes/credits-balance.ts#registerCreditsBalanceRoutes": asks(3),
  "ee/routes/billing.ts#billingRoutes": asks(2),
  "routes/me.ts#meRoutes": asks(1),
  "routes/video-director.ts#videoDirectorRoutes": asks(2),
  "ee/pipelines/create-pipeline.ts#createPipeline": asks(2),
  "ee/pipelines/engine.ts#resolveUserTier": asks(2),
  "utils/file-validation.ts#checkStorageQuota": asks(2),
  "ee/billing/cleanup-service.ts#cleanupCanceledUserMedia": asks(1),

  // ── Spend sites: the spend seam applies the deployment grade (applyOrgEntitlements) ──
  "ee/billing/credits.ts#CreditsService.checkCredits": spend(1),
  "ee/billing/credits.ts#CreditsService.checkCreditsWithProfile": spend(1),
  "ee/billing/credits.ts#CreditsService.reserveCredits": spend(2),
  "ee/billing/credits.ts#CreditsService.checkBalanceCovers": spend(2),
  "ee/billing/credits.ts#checkRunSetCredits": spend(2),
  "ee/lib/credit-guard-impl.ts#creditGuardImpl": spend(1),
  "ee/lib/ugc-quote.ts#readCallerGates": spend(2),

  // ── Not a plan gate on the user's own behalf ──
  "ee/billing/org-entitlements.ts#effectiveTierOf": exempt(1, "the derivation itself; each of its callers is classified on its own"),
  "lib/deployment-payer.ts#readPayerTier": exempt(2, "the payer account's own grade: the source of every covered user's plan"),
  "lib/collections-store.ts#ownTier": exempt(2, "asked only by limitsFor, and only when payerCoverage() has no answer"),
  "routes/user-settings.ts#selectProfile": exempt(2, "the settings row read; both callers (GET and PATCH in userSettingsRoutes) answer a covered user's plan from payerCoverage()"),
  "ee/billing/credits.ts#CreditsService.checkStorageLimit": exempt(1, "no production caller; where a storage ceiling is enforced it is skipped under a payer (credit guard `dep`, checkStorageQuota)"),
  "ee/billing/credits.ts#CreditsService.checkStorageLimitWithProfile": exempt(1, "called only by the credit guard, which skips it under a payer (`dep`): no per-user ceiling there"),
  "ee/concurrency-lanes/plan-sizes.ts#readAccountTier": exempt(2, "sizes a concurrency line by the account that pays for it: on a deployment line that is the payer account itself"),
  "workers/orchestrator-worker.ts#processWorkflowExecution": exempt(2, "dispatch width: resolveRunDispatch takes the run's billing context, and a deployment context's grade decides there"),
  "workers/render-worker.ts#createRenderWorker": exempt(1, "the legacy watermark fallback for rows without should_watermark (set at reservation, never watermarked under a payer) and the output-visibility setting; no plan gate"),
  "ee/lib/payg-surface-guard.ts#blockPaygOnConsumerSurface": exempt(2, "the payg web block: under a payer the boot refuses the one combination it would misfire on (payerWebFreeConflict), and a covered user's own row is never payg"),
  "ee/billing/cleanup-service.ts#expireSubscriptions": exempt(1, "the hourly expiry net writes each subscriber's own row (tier, credits, storage floor); under a payer no gate reads that row's tier"),
  "ee/billing/cleanup-service.ts#sendStorageWarnings": exempt(1, "log lines only: no gate, and no client is told"),
  "ee/billing/downgrade-floor.ts#raiseStorageFloorOnActivation": exempt(1, "writes the user's own storage floor after a top-up; storage ceilings are not enforced under a payer"),
  "ee/billing/downgrade-floor.ts#reapplyStorageFloorAfterClawback": exempt(1, "writes the user's own storage floor after a clawback; storage ceilings are not enforced under a payer"),
  "ee/billing/provision-credits.ts#handleSubscriptionCanceled": exempt(1, "the Stripe webhook writing the subscriber's own row on cancellation"),
  "ee/billing/subscription-grant.ts#readPreSubscribeProfile": exempt(1, "the Stripe webhook reading the subscriber's own row before it grants a subscription's plan"),
  "ee/routes/admin-credits.ts#adminCreditsRoutes": exempt(4, "admin views and the admin tier edit: each user's own row (under a payer the admin balance view shows allowances)"),
  "ee/routes/admin-subscription-health.ts#adminSubscriptionHealthRoutes": exempt(1, "the admin Stripe sync check of each subscriber's own row"),
  "ee/concurrency-lanes/live-usage.ts#createProfileLookup": exempt(1, "the admin live-usage view: each account's own plan"),
  "ee/lib/network-blocking.ts#payingAmong": exempt(1, "an admin's collateral count for a network block: whether an account itself ever paid"),
  "lib/access-blocks.ts#readQuietStops": exempt(1, "an admin-applied quiet stop leaves out accounts that themselves pay; not a plan gate"),
}

/** The tier derivations (@nodaro/shared and ee/billing). */
const TIER_DERIVATIONS = new Set(["resolveEffectiveTier", "resolveStoredTier", "effectiveTierOf", "resolveTierFrom"])
/** The payer rule, asked at a site. */
/** The payer rule, asked at a site; the media sweeps ask it through their own entry (payer-media-retention.ts). */
const COVERAGE = new Set(["payerCoverage", "coverageOf", "deploymentPayerActive", "mediaKeptByDeploymentPayer"])
/** The spend seam, which applies the deployment grade itself. */
const SPEND_SEAM = new Set(["payerProfileId", "spendGates", "applyOrgEntitlements"])
/** `tier` / `subscription_tier` as a column of a select list. */
const TIER_COLUMN = /(?:^|[\s,(])(?:tier|subscription_tier)(?=[\s,)]|$)/

/** The file's top-level string constants (`const COLUMNS = "…"`), by name: a select list is often one. */
function stringConstants(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>()
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const d of stmt.declarationList.declarations) {
      const text = ts.isIdentifier(d.name) && d.initializer ? literalText(d.initializer) : null
      if (text !== null && ts.isIdentifier(d.name)) out.set(d.name.text, text)
    }
  }
  return out
}

/** Whether a select list names a tier column of `profiles`: on a `profiles` chain, or inside an embedded `profiles(…)`. */
function selectsProfileTier(call: ts.CallExpression, constants: ReadonlyMap<string, string>): boolean {
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "select") return false
  const first = call.arguments[0]
  const text = !first ? null : ts.isIdentifier(first) ? (constants.get(first.text) ?? null) : literalText(first)
  if (text === null) return false
  const table = chainTable(callee.expression)
  if (table === "profiles" || table === null) return TIER_COLUMN.test(text)
  const embedded = /profiles(?:![a-z_]+)?\s*\(([^)]*)\)/.exec(text)
  return embedded !== null && TIER_COLUMN.test(embedded[1]!)
}

/** What one function reads and asks. */
export interface TierRead {
  /** How many tier reads the function makes: derivation calls and tier selects. */
  readonly reads: number
  readonly asks: boolean
  readonly spend: boolean
}

/** Each top-level function of `text` that reads a tier, with what it asks. */
export function tierReadsIn(file: string, text: string): Map<string, TierRead> {
  const sf = parseWithParents(file, text)
  const aliases = importedNames(sf)
  const canonical = (name: string): string => aliases.get(name) ?? name
  const constants = stringConstants(sf)
  const found = new Map<string, TierRead>()
  for (const [name, fn] of topLevelFunctions(sf)) {
    let reads = 0
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && !isDeclarationName(n) && TIER_DERIVATIONS.has(canonical(n.text))) reads++
      if (ts.isPropertyAccessExpression(n) && TIER_DERIVATIONS.has(n.name.text)) reads++
      if (ts.isCallExpression(n) && selectsProfileTier(n, constants)) reads++
      ts.forEachChild(n, visit)
    }
    if (fn.body) visit(fn.body)
    if (reads === 0) continue
    const used = referencedNames(fn, canonical)
    found.set(name, {
      reads,
      asks: [...COVERAGE].some((c) => used.has(c)),
      spend: [...SPEND_SEAM].some((c) => used.has(c)),
    })
  }
  return found
}

/** Every tier read in backend/src, keyed `<file>#<function>`. */
function census(): Map<string, TierRead> {
  const found = new Map<string, TierRead>()
  for (const file of sourceFiles()) {
    if (file.endsWith(".d.ts")) continue
    const text = readFileSync(file, "utf8")
    // Cheap pre-filter, a superset of the AST match.
    if (!/resolveEffectiveTier|resolveStoredTier|effectiveTierOf|resolveTierFrom|\btier\b/.test(text)) continue
    for (const [name, read] of tierReadsIn(file, text)) found.set(`${relPath(file)}#${name}`, read)
  }
  return found
}

describe("the tier-read scan sees every spelling", () => {
  const reads = (text: string) => tierReadsIn("x.ts", text).get("f")

  it.each([
    ["a derivation call", `export function f(p: P) { return resolveEffectiveTier(p) }`],
    ["an aliased derivation", `import { resolveEffectiveTier as eff } from "@nodaro/shared/credits"\nexport function f(p: P) { return eff(p) }`],
    ["a derivation off a module", `export async function f(p: P) { const m = await import("@nodaro/shared/credits"); return m.resolveStoredTier(p) }`],
    ["a profiles select naming tier", `export async function f() { return supabase.from("profiles").select("id, tier").eq("id", u).single() }`],
    ["a select naming subscription_tier on a chain the scan cannot see", `export async function f() { return q.select("subscription_tier, role") }`],
    ["an embedded profiles(…) naming tier", `export async function f() { return supabase.from("jobs").select("id, profiles!user_id(tier, public_outputs)") }`],
    ["a select list built by concatenation", `export async function f() { return supabase.from("profiles").select("role, " + "tier, credits") }`],
    ["a select list held in a constant", `const COLUMNS = "tier, public_outputs"\nexport async function f() { return supabase.from("profiles").select(COLUMNS).single() }`],
  ])("finds %s", (_name, text) => {
    expect(reads(text)?.reads).toBe(1)
  })

  it.each([
    ["a tier_config read", `export async function f() { return supabase.from("tier_config").select("tier, features") }`],
    ["a word that only contains 'tier'", `export async function f() { return supabase.from("profiles").select("tier_override, frontier") }`],
    ["the name in a comment or a string", `// resolveEffectiveTier(p)\nexport function f() { return "resolveEffectiveTier" }`],
  ])("does not flag %s", (_name, text) => {
    expect(reads(text)).toBeUndefined()
  })

  it("sees what a reader asks", () => {
    expect(reads(`export function f(p: P) { return payerCoverage()?.tier ?? resolveEffectiveTier(p) }`)).toMatchObject({ asks: true, spend: false })
    expect(reads(`export function f(p: P, c: C) { return spendGates(effectiveTierOf(p), { billingContext: c }) }`)).toMatchObject({ asks: false, spend: true })
    expect(reads(`export function f(p: P) { return resolveEffectiveTier(p) }`)).toMatchObject({ asks: false, spend: false })
  })
})

describe("tier-read census: every read of a user's own tier answers for a deployment payer", { timeout: SCAN_TIMEOUT_MS }, () => {
  const found = census()

  it("finds the readers this rule was written for (the scan works)", () => {
    expect([...found.keys()]).toEqual(
      expect.arrayContaining([
        "ee/billing/credits.ts#CreditsService.getBalance",
        "ee/billing/credits.ts#CreditsService.checkAppRunEligibility",
        "routes/me.ts#meRoutes",
        "routes/user-settings.ts#selectProfile",
      ]),
    )
  })

  it("lists every function that reads a user's tier", () => {
    const unlisted = [...found.keys()].filter((key) => !(key in TIER_READS)).sort()
    expect(
      unlisted,
      "ask `payerCoverage()` (or `coverageOf(ctx)` below a resolve point) and list it as \"asks\", go through the spend seam and list it as \"spend\", or list it as \"exempt\" with the reason it is not a plan gate on the user's own behalf",
    ).toEqual([])
  })

  it("lists nothing the scan no longer finds", () => {
    expect(Object.keys(TIER_READS).filter((key) => !found.has(key))).toEqual([])
  })

  it("each listed function makes exactly its listed number of tier reads", () => {
    // A new read inside an already-listed function changes its count, so it is
    // looked at, and covered or reasoned, before the entry is updated.
    const drift = Object.entries(TIER_READS)
      .filter(([key, entry]) => found.has(key) && found.get(key)!.reads !== entry.reads)
      .map(([key, entry]) => `${key}: listed ${entry.reads}, found ${found.get(key)!.reads}`)
    expect(drift).toEqual([])
  })

  it("every `asks` entry asks the payer rule, and every `spend` entry goes through the spend seam", () => {
    const wrong = Object.entries(TIER_READS).flatMap(([key, entry]) => {
      const read = found.get(key)
      if (!read) return []
      if (entry.rule === "asks" && !read.asks) return [`${key}: listed as asking the payer rule, and never names payerCoverage / coverageOf / deploymentPayerActive`]
      if (entry.rule === "spend" && !read.spend) return [`${key}: listed as a spend site, and never names payerProfileId / spendGates / applyOrgEntitlements`]
      return []
    })
    expect(wrong).toEqual([])
  })

  it("every `exempt` entry says why", () => {
    for (const [key, entry] of Object.entries(TIER_READS)) {
      if (entry.rule === "exempt") expect(entry.why.length, key).toBeGreaterThan(20)
    }
  })
})
