// @test-watches backend/src/**/*.ts
/**
 * TOTALITY: the only code that lists a customer's Stripe subscriptions to
 * repair our records is subscription-self-heal.ts, and nothing upserts a
 * subscriptions row. A row is created, claimed and granted only by the Stripe
 * webhook (subscription-grant.ts); an upsert elsewhere would create one that
 * defaults to granted with no credits behind it, or mark an ungranted one
 * active.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(__dirname, "../../..")

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name === "test") continue
      out.push(...sources(full))
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full)
    }
  }
  return out
}

const files = sources(SRC).map((f) => ({ path: relative(SRC, f), text: readFileSync(f, "utf8") }))

describe("subscription self-heal funnel", () => {
  it("lists Stripe subscriptions for a repair only in subscription-self-heal.ts", () => {
    const listers = files.filter((f) => /subscriptions\s*\.list\(/.test(f.text)).map((f) => f.path)
    expect(listers).toEqual(["ee/billing/subscription-self-heal.ts"])
  })

  it("never upserts a subscriptions row", () => {
    const upserters = files
      .filter((f) => /from\(\s*["']subscriptions["']\s*\)\s*\.upsert\(/.test(f.text))
      .map((f) => f.path)
    expect(upserters).toEqual([])
  })
})
