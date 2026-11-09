/**
 * The result check (lib/result-check.ts): the second thing loosening a provider
 * filter waits for. The seam is content-free and nothing in this repository
 * registers one. A registered check is a job policy, so it runs in the result
 * funnel every completion already passes, and a check nothing calls cannot
 * unlock anything.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  applyJobResultPolicies,
  clearJobPolicies,
  getRegisteredJobPolicyIds,
  hasJobPolicyFor,
  registerJobPolicy,
  type JobResultContext,
} from "../job-policy.js"
import { clearResultCheck, getResultCheckId, hasResultCheck, registerResultCheck, type ResultCheck } from "../result-check.js"

const blocking: ResultCheck = { id: "deployment-check", checkResult: () => ({ verdict: "block", reason: "placeholder" }) }

const completion: JobResultContext = {
  jobId: "job-1",
  jobType: "generate-image",
  mediaKind: "image",
  userId: "user-1",
  statusToBe: "completed",
  outputData: {},
  outputs: [],
  holdEligible: false,
  funnel: "direct",
}

beforeEach(() => {
  clearResultCheck()
  clearJobPolicies()
})

afterEach(() => {
  clearResultCheck()
  clearJobPolicies()
})

describe("with nothing registered", () => {
  it("no process has a check, and the result funnel has nothing to ask", () => {
    expect(hasResultCheck()).toBe(false)
    expect(getResultCheckId()).toBeNull()
    expect(hasJobPolicyFor("result")).toBe(false)
  })
})

describe("a registered check", () => {
  it("runs in the result funnel: registering it is what wires it", async () => {
    registerResultCheck(blocking)
    expect(hasResultCheck()).toBe(true)
    expect(getResultCheckId()).toBe("deployment-check")
    expect(hasJobPolicyFor("result")).toBe(true)
    expect((await applyJobResultPolicies(completion)).verdict).toBe("block")
  })

  it("registering the same check twice runs it once", () => {
    registerResultCheck(blocking)
    registerResultCheck(blocking)
    expect(getRegisteredJobPolicyIds()).toEqual(["deployment-check"])
  })

  it("a second, different check is refused", () => {
    registerResultCheck(blocking)
    expect(() => registerResultCheck({ ...blocking, id: "another-check" })).toThrow(/already registered/)
  })

  it("a check with no result hook is refused", () => {
    expect(() => registerResultCheck({ id: "no-hook" } as unknown as ResultCheck)).toThrow(/checkResult/)
    expect(hasResultCheck()).toBe(false)
  })

  it("stops counting once it has left the registry: only a check that runs counts", () => {
    registerResultCheck(blocking)
    clearJobPolicies()
    expect(hasResultCheck()).toBe(false)
  })
})

describe("another result policy", () => {
  it("is not the result check: a deployment's other policies vouch for nothing here", () => {
    registerJobPolicy({ id: "other-policy", checkResult: () => ({ verdict: "allow" }) })
    expect(hasJobPolicyFor("result")).toBe(true)
    expect(hasResultCheck()).toBe(false)
  })
})
