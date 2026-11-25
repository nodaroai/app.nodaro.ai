import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const edition = vi.hoisted(() => ({ credits: true, payerTier: null as string | null }))
vi.mock("../../../lib/config.js", () => ({ hasCredits: () => edition.credits }))
vi.mock("../../../lib/deployment-payer.js", () => ({
  payerCoverage: () => (edition.payerTier ? { payerId: "payer", tier: edition.payerTier, storedTier: edition.payerTier } : null),
}))

import { tierColumns, resolveTierFrom } from "../tier-columns.js"

beforeEach(() => {
  edition.credits = true
  edition.payerTier = null
})

// Tier lives in two columns on `profiles` (`tier` + `subscription_tier`) and
// nothing in the schema keeps them in step. Every Stripe path wrote only
// `tier` while the admin list and GET /v1/me read only `subscription_tier`, so
// a paying Basic customer displayed as "free" — indistinguishable, at a glance,
// from a free user who had blown through the 50/day cap (2026-07-28).
//
// The convergence is only as durable as the next person who writes a tier
// update, so this asserts the invariant against the source itself rather than
// trusting a convention.

const SRC = join(import.meta.dirname, "../../..")

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) tsFiles(full, out)
    else if (entry.endsWith(".ts")) out.push(full)
  }
  return out
}

/**
 * Body of every `.from("profiles")...update({ ... })` call in a file.
 * Brace-balanced from the `update(` so nested objects don't truncate it.
 */
function profilesUpdateBodies(source: string): string[] {
  const bodies: string[] = []
  const marker = /\.from\(\s*["']profiles["']\s*\)/g
  let m: RegExpExecArray | null
  while ((m = marker.exec(source)) !== null) {
    // Look ahead a bounded window for the chained .update({...}).
    const window = source.slice(m.index, m.index + 2000)
    const upd = window.indexOf(".update(")
    if (upd === -1) continue
    const open = window.indexOf("{", upd)
    if (open === -1) continue
    let depth = 0
    for (let i = open; i < window.length; i++) {
      if (window[i] === "{") depth++
      else if (window[i] === "}") {
        depth--
        if (depth === 0) {
          bodies.push(window.slice(open, i + 1))
          break
        }
      }
    }
  }
  return bodies
}

describe("tierColumns / resolveTierFrom", () => {
  it("writes both columns from one value", () => {
    expect(tierColumns("pro", "basic")).toEqual({ tier: "pro", subscription_tier: "pro" })
  })

  // A DROP from a plan with private outputs to one without returns the setting
  // to public in the same write (lib/private-outputs-plan.ts); any other move
  // leaves the person's choice alone.
  it.each([
    ["standard", "basic"],
    ["pro", "free"],
    ["business", "basic"],
  ])("a drop from %s to %s also returns outputs to public", (from, to) => {
    expect(tierColumns(to, from)).toEqual({ tier: to, subscription_tier: to, public_outputs: true })
  })

  it.each([
    ["an upgrade", "basic", "pro"],
    ["a change between plans that both include it", "pro", "standard"],
    ["the same paid plan again", "pro", "pro"],
    // Already on a plan without private outputs (downgraded before this rule):
    // a renewal, a repeated cancellation or a free → basic grant never resets it in passing.
    ["Basic rewritten as Basic", "basic", "basic"],
    ["Free rewritten as Free", "free", "free"],
    ["Basic to Free", "basic", "free"],
    ["Free to Basic", "free", "basic"],
  ])("%s leaves the outputs setting alone", (_label, from, to) => {
    expect(tierColumns(to, from)).toEqual({ tier: to, subscription_tier: to })
  })

  it("an unknown plan before writes nothing about outputs", () => {
    expect(tierColumns("free", null)).toEqual({ tier: "free", subscription_tier: "free" })
  })

  it("leaves the setting alone in an edition without credits (any plan may be private there)", () => {
    edition.credits = false
    expect(tierColumns("free", "pro")).toEqual({ tier: "free", subscription_tier: "free" })
  })

  it("under a deployment payer, asks the payer's plan, not the person's own", () => {
    edition.payerTier = "pro"
    expect(tierColumns("free", "pro")).toEqual({ tier: "free", subscription_tier: "free" })
    edition.payerTier = "basic"
    expect(tierColumns("free", "pro")).toEqual({ tier: "free", subscription_tier: "free" })
  })

  it("resolves tier first — it is the column the Stripe paths write", () => {
    expect(resolveTierFrom({ tier: "basic", subscription_tier: "free" })).toBe("basic")
  })

  it("falls back to subscription_tier for rows predating tier", () => {
    expect(resolveTierFrom({ tier: null, subscription_tier: "pro" })).toBe("pro")
  })

  it("defaults to free when neither is set", () => {
    expect(resolveTierFrom({})).toBe("free")
  })
})

describe("no profiles update may set one tier column without the other", () => {
  it("every tier-touching profiles update goes through tierColumns()", () => {
    const offenders: string[] = []

    for (const file of tsFiles(SRC)) {
      const source = readFileSync(file, "utf8")
      if (!source.includes('from("profiles")') && !source.includes("from('profiles')")) continue

      for (const body of profilesUpdateBodies(source)) {
        const usesHelper = body.includes("tierColumns(")
        // `tier:` / bare `tier,` shorthand, but not `subscription_tier:` and not
        // unrelated columns that merely end in "tier".
        const setsTier = /(^|[{,\s])tier\s*[:,}]/.test(body)
        const setsSubTier = /(^|[{,\s])subscription_tier\s*[:,}]/.test(body)

        if (usesHelper) continue
        if (setsTier || setsSubTier) {
          offenders.push(`${relative(SRC, file)}: ${body.replace(/\s+/g, " ").slice(0, 120)}`)
        }
      }
    }

    expect(
      offenders,
      `These profiles updates set a tier column directly. Use tierColumns(tier) from ` +
        `ee/billing/tier-columns.ts so tier and subscription_tier can never diverge ` +
        `again:\n  ${offenders.join("\n  ")}`,
    ).toEqual([])
  })
})
