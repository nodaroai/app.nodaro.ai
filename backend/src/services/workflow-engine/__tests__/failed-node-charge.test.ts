import { describe, expect, it } from "vitest"
import { DrainAbortError } from "../../../lib/worker-drain.js"
import { chargedCreditsOfRejection, withChargedCredits } from "../failed-node-output.js"

describe("what a failed node already charged", () => {
  it("is read off the rejection: a positive number of credits, else nothing", () => {
    expect(chargedCreditsOfRejection(Object.assign(new Error("x"), { creditsUsed: 48 }))).toBe(48)
    expect(chargedCreditsOfRejection(Object.assign(new Error("x"), { creditsUsed: 0 }))).toBeUndefined()
    expect(chargedCreditsOfRejection(Object.assign(new Error("x"), { creditsUsed: "48" }))).toBeUndefined()
    expect(chargedCreditsOfRejection(new Error("x"))).toBeUndefined()
    expect(chargedCreditsOfRejection(undefined)).toBeUndefined()
  })
  it("rides a copy of the rejection: its message, code, hint and retained output kept, the original left as it was", () => {
    const original = Object.assign(new Error("refused"), { errorCode: "budget_exceeded", errorHint: { kind: "safety-block" }, output: { ugcCandidates: [] } })
    const charged = withChargedCredits(original, 48) as Error & Record<string, unknown>
    expect(charged).not.toBe(original)
    expect(charged).toBeInstanceOf(Error)
    expect(charged).toMatchObject({ message: "refused", errorCode: "budget_exceeded", errorHint: { kind: "safety-block" }, output: { ugcCandidates: [] }, creditsUsed: 48 })
    expect((original as unknown as Record<string, unknown>).creditsUsed).toBeUndefined()
  })
  it("nothing charged, or a drain (the run resumes and counts it then): the rejection as it came", () => {
    const err = new Error("x")
    expect(withChargedCredits(err, 0)).toBe(err)
    const drained = new DrainAbortError()
    expect(withChargedCredits(drained, 48)).toBe(drained)
  })
  it("a rejection that is not an Error becomes one that carries the charge", () => {
    expect(withChargedCredits("boom", 5)).toMatchObject({ message: "boom", creditsUsed: 5 })
  })
})
