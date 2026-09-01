/**
 * WHICH ADMIN ROUTES SPEND MONEY — a build-enforced classification.
 *
 * `requirePlatformOperator` only protects the routes it is actually attached
 * to, and the failure mode is silent: a new admin route that grants credits
 * or edits pricing ships with the ordinary `requireAdmin` and is, on a
 * customer-federated deployment, a mint the customer can reach. Nobody
 * reviewing that PR would see the gap, because the gate lives in a different
 * file.
 *
 * So the classification is data here, not judgement at review time. This test
 * walks the admin route files, finds every MUTATING registration whose body
 * touches a money-moving symbol, and requires each one to be either gated by
 * `requirePlatformOperator` or listed in EXCLUDED with a written reason. A new
 * money route fails the build until someone classifies it on purpose.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
/** Everything under backend/src — the scan discovers admin routes by the PATH
 *  LITERAL they register, not by living in a blessed directory. A money route
 *  in a new file (ee/routes/billing-admin.ts, routes/anything.ts) is caught. */
const SRC_DIR = join(HERE, "..", "..", "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

/** Symbols whose presence in a mutating route body means that route can move
 *  money: grant credits, change a tier (which resets the balance), change what
 *  a model costs, change the markup/margin settings, raise a storage cap, or
 *  promote an account (the master key to all of the above). */
const MONEY_MARKERS: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /adminAdjustCredits/, what: "grants credits" },
  { re: /tierColumns\(/, what: "writes a tier (resets subscription_credits)" },
  { re: /from\("model_pricing"\)/, what: "writes model pricing" },
  { re: /from\("app_settings"\)/, what: "writes settings (markup / service margin)" },
  { re: /storage_limit_bytes/, what: "writes a storage quota" },
  { re: /invalidateAdminCache/, what: "changes a role" },
  { re: /rpc\("reserve_credits"|from\("credit_transactions"\)\s*\n?\s*\.insert/, what: "writes the credit ledger" },
  // Restores a withheld signup grant: 'withheld' → 'granted' plus a top-up to
  // TIER_CREDITS.free through the activate_signup_grant RPC.
  { re: /activateSignupGrant\(/, what: "grants credits (signup grant restore)" },
]

/**
 * Mutating admin routes that touch a money marker but are DELIBERATELY left on
 * the ordinary admin gate. Each entry is a decision with a reason, not a
 * to-do.
 */
const EXCLUDED: Record<string, string> = {
  // Nothing today. Kept as the documented escape hatch: an entry here is a
  // conscious statement that the customer's own admins may perform this
  // action on their own instance.
}

/**
 * The availability routes (`PUT /v1/admin/availability`) deliberately do NOT
 * appear here and are NOT money: they enable/disable node types and models
 * the deployment already pays for, and handing that control to the customer's
 * admins is the whole point of the availability feature. Enabling an
 * expensive model spends the payer's credits, but it spends them on work the
 * customer's own users asked for — that is a policy choice, not a mint.
 */

type Route = { file: string; method: string; path: string; gates: string[]; markers: string[] }

function scan(): Route[] {
  const out: Route[] = []
  // Any file that registers an /v1/admin path is in scope, wherever it lives.
  const files = walk(SRC_DIR).filter((f) => readFileSync(f, "utf8").includes('"/v1/admin'))
  expect(files.length, "admin route files must be discoverable").toBeGreaterThan(15)

  for (const full of files) {
    const file = relative(SRC_DIR, full)
    const src = readFileSync(full, "utf8")
    // `app.route(` too, and a relaxed receiver (`app` may be named anything).
    const starts = [...src.matchAll(/\b\w+\.(get|post|put|patch|delete|route)\b/g)]
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i].index ?? 0
      const to = i + 1 < starts.length ? (starts[i + 1].index ?? src.length) : src.length
      const block = src.slice(from, to)
      const method = starts[i][1]
      if (!["post", "put", "patch", "delete", "route"].includes(method)) continue
      const path = /"(\/v1\/[^"]+)"/.exec(block)?.[1]
      if (!path) continue // not a route registration (e.g. `array.delete`)
      // The gate is whatever preHandler the REGISTRATION names — read only the
      // options object, so a mention deeper in the handler body cannot
      // masquerade as a gate. Accepts both `preHandler: fn` and the array form
      // `preHandler: [a, b]`, which is a correctly-gated shape the first
      // version of this scan would have failed.
      const head = block.slice(0, 600)
      const raw = /preHandler:\s*(\[[^\]]*\]|[\w.]+)/.exec(head)?.[1] ?? null
      const gates = raw ? (raw.match(/[\w]+/g) ?? []) : []
      const markers = MONEY_MARKERS.filter((m) => m.re.test(block)).map((m) => m.what)
      out.push({ file, method: method.toUpperCase(), path, gates, markers })
    }
  }
  return out
}

describe("money-route totality", () => {
  const routes = scan()

  it("every mutating admin route that moves money is gated by requirePlatformOperator", () => {
    const money = routes.filter((r) => r.markers.length > 0)
    expect(money.length, "the scan found no money routes at all — the markers must have rotted").toBeGreaterThan(5)

    const ungated = money
      .filter((r) => !r.gates.includes("requirePlatformOperator"))
      .filter((r) => !(`${r.method} ${r.path}` in EXCLUDED))
      .map((r) => `${r.method} ${r.path} (${r.file}, gates=${r.gates.join("+") || "NONE"}) — ${r.markers.join("; ")}`)

    expect(
      ungated,
      "these routes move money but do not carry requirePlatformOperator. Add the gate, or add an " +
        "entry to EXCLUDED with the reason the customer's own admins may do this:\n" +
        ungated.join("\n"),
    ).toEqual([])
  })

  it("every route the gate IS on still moves money (no cargo-culting the gate onto read paths)", () => {
    const gated = routes.filter((r) => r.gates.includes("requirePlatformOperator"))
    const pointless = gated.filter((r) => r.markers.length === 0).map((r) => `${r.method} ${r.path} (${r.file})`)
    expect(
      pointless,
      "these carry the operator gate but touch no money marker — either the marker list is incomplete " +
        "(fix it, do not remove the gate) or the gate does not belong here:\n" + pointless.join("\n"),
    ).toEqual([])
  })

  it("the gate is attached to at least the known money surface", () => {
    const gatedPaths = new Set(routes.filter((r) => r.gates.includes("requirePlatformOperator")).map((r) => `${r.method} ${r.path}`))
    // The floor, verified by reading each handler. Shrinking this set is a
    // deliberate act that must be argued for in review.
    for (const expected of [
      "POST /v1/admin/users/:id/credits",
      "PUT /v1/admin/users/:id/tier",
      "PUT /v1/admin/users/:id/storage",
      "PUT /v1/admin/users/:id/role",
      "PUT /v1/admin/models/:identifier/pricing",
      "POST /v1/admin/model-pricing",
      "DELETE /v1/admin/model-pricing/:id",
      // Every write to model_pricing is operator-only, including the two that
      // look like mere availability toggles: the LLM one upserts the row with
      // a hardcoded `credit_cost: 0`, so "toggling a model" also writes a
      // zero price for that identifier.
      "PUT /v1/admin/model-pricing/:id/toggle",
      "PATCH /v1/admin/llm-models/:modelId",
      "PUT /v1/admin/settings/:key",
    ]) {
      expect(gatedPaths, `${expected} must carry requirePlatformOperator`).toContain(expected)
    }
  })

  it("no /v1/admin route is registered without SOME gate", () => {
    // Scoped to admin PATHS, not to files: the scan pulls in whole files by the
    // presence of an /v1/admin literal, and those files also hold ordinary user
    // routes (POST /v1/templates/publish and friends) whose authorization is the
    // global auth hook, not a route preHandler.
    const naked = routes
      .filter((r) => r.path.startsWith("/v1/admin"))
      .filter((r) => r.gates.length === 0)
      .map((r) => `${r.method} ${r.path} (${r.file})`)
    expect(naked, `ungated admin routes:\n${naked.join("\n")}`).toEqual([])
  })
})
