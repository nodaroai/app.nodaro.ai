// cast-swap's declared budget: a fixed bound per run shape — a full clip, or a
// 4-second preview (`preview: true`). Its handler is a private plugin's, so the
// video worker's heartbeat reads this through the registry (`lib/job-budget.ts`).
import { describe, it, expect } from "vitest"
import {
  CAST_SWAP_FULL_BUDGET_MS,
  CAST_SWAP_PREVIEW_BUDGET_MS,
  castSwapJobBudgetMs,
} from "../cast-swap-budget.js"
import { declaredJobBudgetMs } from "../../../lib/job-budget.js"
import { NODE_TIMEOUT_MS } from "../../../services/workflow-engine/types.js"

const MINUTE = 60_000

describe("cast-swap job budget", () => {
  it("budget is 120 min, 30 min for a preview", () => {
    expect(CAST_SWAP_FULL_BUDGET_MS).toBe(120 * MINUTE)
    expect(CAST_SWAP_PREVIEW_BUDGET_MS).toBe(30 * MINUTE)
    expect(castSwapJobBudgetMs({ videoUrl: "https://x.test/clip.mp4" })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ preview: false })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ preview: true, previewStart: 3 })).toBe(30 * MINUTE)
  })

  it("only `preview === true` is a preview; a non-object payload reads as a full run", () => {
    expect(castSwapJobBudgetMs({ preview: "true" })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ preview: 1 })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs(null)).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs(undefined)).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs("cast-swap")).toBe(120 * MINUTE)
  })

  it("a full clip exceeds the 90-minute default — the reason it declares one at all", () => {
    expect(CAST_SWAP_FULL_BUDGET_MS).toBeGreaterThan(NODE_TIMEOUT_MS)
  })

  it("is registered under its job name", () => {
    expect(declaredJobBudgetMs("cast-swap", {})).toBe(120 * MINUTE)
    expect(declaredJobBudgetMs("cast-swap", { preview: true })).toBe(30 * MINUTE)
  })
})
