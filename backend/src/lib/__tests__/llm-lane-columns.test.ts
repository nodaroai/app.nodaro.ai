/**
 * The writers name the column `lane` (call-llm.ts, copilot store) and every
 * test of theirs mocks supabase, so only the migrations can prove the column
 * exists.
 */
import { describe, expect, it } from "vitest"
import { migrationColumnsOf } from "../../test/migration-columns.js"

describe("lane columns", () => {
  it("the reader finds known columns and no made-up one", () => {
    expect(migrationColumnsOf("llm_calls").has("model_id")).toBe(true)
    expect(migrationColumnsOf("copilot_turns").has("cost_usd")).toBe(true)
    expect(migrationColumnsOf("llm_calls").has("not_a_column")).toBe(false)
  })

  it.each(["llm_calls", "copilot_turns"])("%s has a lane column", (table) => {
    expect(migrationColumnsOf(table).has("lane")).toBe(true)
  })
})
