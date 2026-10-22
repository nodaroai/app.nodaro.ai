// cast-swap's declared budget: a fixed bound per run shape — a full clip, or a
// 4-second preview (`preview: true`). Its handler is a private plugin's, so the
// video worker's heartbeat reads this through the registry (`lib/job-budget.ts`).
import { describe, it, expect } from "vitest"
import {
  CAST_SWAP_FULL_BUDGET_MS,
  CAST_SWAP_MASK_ALWAYS_BUDGET_MS,
  CAST_SWAP_MASK_AUTO_BUDGET_MS,
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

  it("face masking off or absent leaves the budget exactly as it was", () => {
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "off" } })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "off" }, preview: true })).toBe(30 * MINUTE)
    expect(castSwapJobBudgetMs({ videoUrl: "https://x.test/clip.mp4" })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ preview: true })).toBe(30 * MINUTE)
  })

  it("face masking \"always\" is 150 min, \"auto\" 240 min", () => {
    expect(CAST_SWAP_MASK_ALWAYS_BUDGET_MS).toBe(150 * MINUTE)
    expect(CAST_SWAP_MASK_AUTO_BUDGET_MS).toBe(240 * MINUTE)
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "always" } })).toBe(150 * MINUTE)
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "auto", padding: 0.2 } })).toBe(240 * MINUTE)
  })

  it("a masked preview takes the masking bound — its mask jobs and retry child run all the same", () => {
    expect(castSwapJobBudgetMs({ preview: true, faceMasking: { mode: "always" } })).toBe(150 * MINUTE)
    expect(castSwapJobBudgetMs({ preview: true, faceMasking: { mode: "auto" } })).toBe(240 * MINUTE)
  })

  it("an unreadable faceMasking reads as off", () => {
    for (const faceMasking of [null, "always", "auto", 1, true, [], {}, { mode: "ALWAYS" }, { mode: 1 }, { mode: null }, { mode: "sometimes" }]) {
      expect(castSwapJobBudgetMs({ faceMasking })).toBe(120 * MINUTE)
      expect(castSwapJobBudgetMs({ faceMasking, preview: true })).toBe(30 * MINUTE)
    }
  })

  it("a trend run's saved input_data (`__faceMasking`) is read when `faceMasking` is absent", () => {
    expect(castSwapJobBudgetMs({ __faceMasking: { mode: "always" } })).toBe(150 * MINUTE)
    expect(castSwapJobBudgetMs({ __faceMasking: { mode: "auto" }, preview: true })).toBe(240 * MINUTE)
    expect(castSwapJobBudgetMs({ __faceMasking: { mode: "off" } })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ __faceMasking: "auto", preview: true })).toBe(30 * MINUTE)
    // `faceMasking` present wins, even when it reads as off.
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "off" }, __faceMasking: { mode: "auto" } })).toBe(120 * MINUTE)
    expect(castSwapJobBudgetMs({ faceMasking: { mode: "always" }, __faceMasking: { mode: "auto" } })).toBe(150 * MINUTE)
    expect(declaredJobBudgetMs("cast-swap", { __faceMasking: { mode: "auto" } })).toBe(240 * MINUTE)
  })

  it("the Full Quality redo and the registry read face masking too", () => {
    expect(declaredJobBudgetMs("cast-swap", { faceMasking: { mode: "always" } })).toBe(150 * MINUTE)
    expect(declaredJobBudgetMs("cast-swap-full-quality", { faceMasking: { mode: "auto" } })).toBe(240 * MINUTE)
  })

  it("a full clip exceeds the 90-minute default — the reason it declares one at all", () => {
    expect(CAST_SWAP_FULL_BUDGET_MS).toBeGreaterThan(NODE_TIMEOUT_MS)
  })

  it("is registered under its job name", () => {
    expect(declaredJobBudgetMs("cast-swap", {})).toBe(120 * MINUTE)
    expect(declaredJobBudgetMs("cast-swap", { preview: true })).toBe(30 * MINUTE)
  })

  it("the Full Quality redo (`cast-swap-full-quality`) declares the same full-clip bound", () => {
    expect(declaredJobBudgetMs("cast-swap-full-quality", {})).toBe(120 * MINUTE)
    expect(declaredJobBudgetMs("cast-swap-full-quality", { fullQualityOf: "job-1" })).toBe(120 * MINUTE)
  })
})
