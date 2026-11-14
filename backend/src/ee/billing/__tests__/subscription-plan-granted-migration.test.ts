// @test-watches supabase/migrations/650_subscription_plan_granted.sql
/**
 * Text guards on migration 650 (a subscription grants its plan only once it
 * is paid for).
 *
 *   1. `subscriptions.plan_granted` exists, NOT NULL, and its default means
 *      GRANTED: every row from before the column, and every insert by a writer
 *      that does not name it (the webhook for a paid subscription, the
 *      self-heal and admin-repair upserts, the code still running before this
 *      deploys) was granted at creation. Only the created handler's insert of
 *      an unpaid subscription writes false.
 *   2. No backfill UPDATE: re-applying the migration must never mark a row
 *      the webhook left ungranted as granted.
 *   3. The status CHECK keeps every status it allowed and adds Stripe's
 *      `incomplete_expired`, re-created idempotently.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { migrationColumnsOf, migrationNotNullColumnsOf } from "../../../test/migration-columns.js"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations")
const sql = readFileSync(join(MIGRATIONS_DIR, "650_subscription_plan_granted.sql"), "utf8")
  .replace(/\r/g, "")
  .replace(/--[^\n]*/g, "")

describe("650 — subscriptions.plan_granted", () => {
  it("is a NOT NULL boolean whose default is granted, added idempotently", () => {
    expect(sql).toMatch(/ALTER TABLE public\.subscriptions\s+ADD COLUMN IF NOT EXISTS plan_granted BOOLEAN NOT NULL DEFAULT true;/i)
    // The column the provisioning code reads and claims is the one the migrations leave.
    expect(migrationColumnsOf("subscriptions")).toContain("plan_granted")
    expect(migrationNotNullColumnsOf("subscriptions")).toContain("plan_granted")
    // Self-check: the reader finds a known column and not a made-up one.
    expect(migrationColumnsOf("subscriptions")).toContain("stripe_subscription_id")
    expect(migrationColumnsOf("subscriptions")).not.toContain("plan_granted_at")
  })

  it("backfills nothing: the default alone marks the rows that predate it", () => {
    expect(sql).not.toMatch(/UPDATE\s+(public\.)?subscriptions/i)
  })
})

describe("650 — subscriptions.status accepts incomplete_expired", () => {
  it("drops and re-adds the CHECK with every status it allowed, plus incomplete_expired", () => {
    expect(sql).toMatch(/ALTER TABLE public\.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;/)
    const check = /ADD CONSTRAINT subscriptions_status_check\s+CHECK \(status IN \(([^)]*)\)\);/.exec(sql)
    expect(check, "the status CHECK is re-added").not.toBeNull()
    const statuses = check![1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, ""))
    expect(new Set(statuses)).toEqual(
      new Set(["active", "trialing", "past_due", "paused", "canceled", "incomplete", "incomplete_expired", "expired"]),
    )
  })
})
