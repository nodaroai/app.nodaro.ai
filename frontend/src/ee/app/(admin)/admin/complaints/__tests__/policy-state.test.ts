// @test-watches backend/src/lib/repeat-infringer-policy.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MAX_BLOCK_DAYS } from "@/ee/hooks/queries/use-admin-repeat-infringers"
import {
  MAX_POLICY_STEPS,
  MAX_STEP_INFRINGEMENTS,
  MAX_WINDOW_MONTHS,
  fromDraft,
  policyProblem,
  toDraft,
  withNewStep,
  withStep,
  withoutStep,
  type PolicyDraft,
} from "../policy-state"

/**
 * The repeat-infringer policy's editor draft: numbers as typed, read back into
 * a policy only by the server's rules (a window of 1 to 120 months, 1 to 10
 * steps, counts that climb, an import block's days or until lifted, a closure
 * last; the bounds held equal to the server's), and the draft changed without
 * touching the one it came from.
 */

describe("the bounds", () => {
  it("are the server's own (backend lib/repeat-infringer-policy.ts)", () => {
    const source = readFileSync(join(import.meta.dirname, "../../../../../../../../backend/src/lib/repeat-infringer-policy.ts"), "utf8")
    expect(Number(/export const MAX_BLOCK_DAYS = (\d+)/.exec(source)?.[1])).toBe(MAX_BLOCK_DAYS)
    expect(Number(/windowMonths: z\.number\(\)\.int\(\)\.min\(1\)\.max\((\d+)\)/.exec(source)?.[1])).toBe(MAX_WINDOW_MONTHS)
    expect(Number(/infringements: z\.number\(\)\.int\(\)\.min\(1\)\.max\((\d+)\)/.exec(source)?.[1])).toBe(MAX_STEP_INFRINGEMENTS)
    expect(Number(/\.array\(stepSchema\)\s*\.min\(1\)\s*\.max\((\d+)\)/.exec(source)?.[1])).toBe(MAX_POLICY_STEPS)
  })
})

const POLICY = {
  windowMonths: 24,
  steps: [
    { infringements: 1, kind: "warning" as const },
    { infringements: 2, kind: "imports_blocked" as const, days: 30 },
    { infringements: 3, kind: "imports_blocked" as const },
    { infringements: 4, kind: "closed" as const },
  ],
}

describe("toDraft and fromDraft", () => {
  it("round-trips a policy, an import block until lifted included", () => {
    const draft = toDraft(POLICY)
    expect(draft.steps[2]).toEqual({ infringements: "3", kind: "imports_blocked", days: "" })
    expect(fromDraft(draft)).toEqual(POLICY)
  })

  it("drops days from a step that is not an import block, and trims what was typed", () => {
    const draft: PolicyDraft = { windowMonths: " 12 ", steps: [{ infringements: " 1 ", kind: "warning", days: "9" }, { infringements: "2", kind: "imports_blocked", days: " 14 " }] }
    expect(fromDraft(draft)).toEqual({ windowMonths: 12, steps: [{ infringements: 1, kind: "warning" }, { infringements: 2, kind: "imports_blocked", days: 14 }] })
  })
})

describe("policyProblem", () => {
  const base = toDraft(POLICY)
  it("is none for a valid draft", () => {
    expect(policyProblem(base)).toBeNull()
  })

  it("names each rule a draft breaks, and fromDraft answers nothing for it", () => {
    const broken: Array<[PolicyDraft, RegExp]> = [
      [{ ...base, windowMonths: "0" }, /from 1 to 120/],
      [{ ...base, windowMonths: "121" }, /from 1 to 120/],
      [{ ...base, windowMonths: "two" }, /from 1 to 120/],
      [{ ...base, steps: [] }, /from 1 to 10 steps/],
      [{ ...base, steps: Array.from({ length: MAX_POLICY_STEPS + 1 }, (_, i) => ({ infringements: String(i + 1), kind: "warning" as const, days: "" })) }, /from 1 to 10 steps/],
      [withStep(base, 0, { infringements: "0" }), /whole number of infringements/],
      [withStep(base, 1, { infringements: "1" }), /more infringements than the one before/],
      [withStep(base, 1, { days: "0" }), /import block lasts/],
      [withStep(base, 1, { days: "3651" }), /import block lasts/],
      [withStep(base, 0, { kind: "closed" }), /last step/],
    ]
    for (const [draft, problem] of broken) {
      expect(policyProblem(draft)).toMatch(problem)
      expect(fromDraft(draft)).toBeNull()
    }
  })
})

describe("changing the draft", () => {
  it("adds a warning one count above the last, removes a step, and replaces one, never touching the draft it came from", () => {
    const base = toDraft(POLICY)
    const added = withNewStep(base)
    expect(added.steps.at(-1)).toEqual({ infringements: "5", kind: "warning", days: "" })
    expect(base.steps).toHaveLength(4)
    expect(withoutStep(base, 0).steps.map((s) => s.infringements)).toEqual(["2", "3", "4"])
    expect(withStep(base, 1, { days: "7" }).steps[1]).toEqual({ infringements: "2", kind: "imports_blocked", days: "7" })
    expect(base.steps[1]!.days).toBe("30")
    expect(withNewStep({ windowMonths: "24", steps: [] }).steps).toEqual([{ infringements: "1", kind: "warning", days: "" }])
  })
})
