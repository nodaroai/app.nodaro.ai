/**
 * Prices that must rise with what the person picks.
 *
 * Two slips reached production through the static table: Image Critic's
 * economy tier cost more than its standard tier, and VEO 3.1 Quality at 4K (a
 * 1080p generation plus an upscale) cost less than at 1080p. Both read as
 * "the better option is cheaper" — a person picking by price gets the worse
 * result, or pays more for less. This keeps every ladder in the table ordered.
 */
import { describe, expect, it } from "vitest"
import { STATIC_CREDIT_COSTS } from "../credits.js"

const table = STATIC_CREDIT_COSTS as Record<string, number>

/** Families whose ladder is known not to rise, each with the reason. */
const LADDER_EXEMPT: Readonly<Record<string, string>> = {
  "ai-writer": "premium sits below standard; awaiting the owner's call (raised 2026-10-04)",
  "lottie-overlay": "economy sits above standard; awaiting the owner's call (raised 2026-10-04)",
}

describe("LLM tier ladders", () => {
  const families = Object.keys(table)
    .filter((id) => id.endsWith(":economy"))
    .map((id) => id.slice(0, -":economy".length))
    .filter((family) => table[family] !== undefined && table[`${family}:premium`] !== undefined)

  it("scans real families (guard against a vacuous pass)", () => {
    expect(families).toEqual(expect.arrayContaining(["qa-check", "image-critic", "llm-chat"]))
  })

  it.each(families.filter((f) => !(f in LADDER_EXEMPT)))("%s: economy ≤ standard ≤ premium", (family) => {
    const economy = table[`${family}:economy`]
    const standard = table[family]
    const premium = table[`${family}:premium`]
    expect(economy, `${family}: economy above standard`).toBeLessThanOrEqual(standard)
    expect(standard, `${family}: standard above premium`).toBeLessThanOrEqual(premium)
  })
})

describe("4K rows", () => {
  const fourK = Object.keys(table).filter((id) => id.endsWith(":4k") && table[id.slice(0, -":4k".length)] !== undefined)

  it("scans real rows (guard against a vacuous pass)", () => {
    expect(fourK).toContain("veo3:4k")
  })

  it.each(fourK)("%s costs at least the model's own base price", (id) => {
    expect(table[id]).toBeGreaterThanOrEqual(table[id.slice(0, -":4k".length)])
  })
})

describe("the prices the owner confirmed", () => {
  it.each([
    ["qa-check:economy", 10],
    ["qa-check", 20],
    ["qa-check:premium", 40],
    ["image-critic:economy", 10],
    ["image-critic", 20],
    ["image-critic:premium", 40],
    ["veo3", 1000],
    ["veo3:4k", 1300],
  ])("%s lists %i", (id, credits) => {
    expect(table[id]).toBe(credits)
  })
})
