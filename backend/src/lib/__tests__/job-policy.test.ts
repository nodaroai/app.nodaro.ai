/**
 * The job-policy registry (spec 2026-09-03-job-policy-hook-design §5.1, D1-D3,
 * D20-D23).
 *
 * The assertion this suite exists for is the FIRST one: with nothing
 * registered, both funnels allow and NOTHING is written. That is the
 * byte-identity claim the whole seam rests on — a registry that cost one audit
 * INSERT per generation on a deployment that registered no policy would be a
 * behaviour change shipped to every self-hoster.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock("../supabase.js", () => ({ supabase: { from: fromMock } }))

import {
  registerJobPolicy,
  clearJobPolicies,
  getRegisteredJobPolicyIds,
  hasJobPolicies,
  hasJobPolicyFor,
  applyJobRequestPolicies,
  applyJobResultPolicies,
  jobBlockedBody,
  jobBlockOf,
  JobBlockedError,
  RESERVED_POLICY_IDS,
  POLICY_UNAVAILABLE_REASON,
  POLICY_UNAVAILABLE_MESSAGE,
  HOLD_DOWNGRADED_MESSAGE,
  DEFAULT_REQUEST_BLOCK_MESSAGE,
  DEFAULT_RESULT_BLOCK_MESSAGE,
  HELD_COMMIT_REPLAY_KEYS,
  splitHeldCompletionFields,
  type JobRequestContext,
  type JobResultContext,
} from "../job-policy.js"

const req = (over: Partial<JobRequestContext> = {}): JobRequestContext => ({
  jobType: "generate-image",
  userId: "u1",
  source: "web",
  sourceDetail: null,
  inputData: { prompt: "a cat" },
  rowCount: 1,
  ...over,
})

const res = (over: Partial<JobResultContext> = {}): JobResultContext => ({
  jobId: "j1",
  jobType: "generate-image",
  mediaKind: "image",
  userId: "u1",
  statusToBe: "completed",
  outputData: { imageUrl: "https://cdn.example.com/images/j1.png" },
  outputs: [],
  holdEligible: true,
  funnel: "finalize",
  ...over,
})

describe("job-policy registry", () => {
  beforeEach(() => {
    clearJobPolicies()
    fromMock.mockClear()
  })
  afterEach(() => clearJobPolicies())

  it("with NOTHING registered: no policies, no gate, and no write of any kind", async () => {
    expect(hasJobPolicies()).toBe(false)
    expect(hasJobPolicyFor("request")).toBe(false)
    expect(hasJobPolicyFor("result")).toBe(false)
    expect(await applyJobRequestPolicies(req())).toEqual({ verdict: "allow" })
    expect(await applyJobResultPolicies(res())).toEqual({ verdict: "allow" })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it("hasJobPolicyFor is per hook point — a result-only policy does not gate requests", () => {
    registerJobPolicy({ id: "result-only", checkResult: () => ({ verdict: "allow" }) })
    expect(hasJobPolicies()).toBe(true)
    expect(hasJobPolicyFor("result")).toBe(true)
    expect(hasJobPolicyFor("request")).toBe(false)
    expect(getRegisteredJobPolicyIds()).toEqual(["result-only"])
  })

  it("refuses a reserved policy id at registration", () => {
    for (const id of RESERVED_POLICY_IDS) {
      expect(() => registerJobPolicy({ id, checkResult: () => ({ verdict: "allow" }) })).toThrow(/reserved/i)
    }
    expect(getRegisteredJobPolicyIds()).toEqual([])
  })

  describe("request gate", () => {
    it("first block wins, in registration order", async () => {
      registerJobPolicy({ id: "a", checkRequest: () => ({ verdict: "allow" }) })
      registerJobPolicy({ id: "b", checkRequest: () => ({ verdict: "block", reason: "nope-b" }) })
      registerJobPolicy({ id: "c", checkRequest: () => ({ verdict: "block", reason: "nope-c" }) })
      const d = await applyJobRequestPolicies(req())
      expect(d).toMatchObject({ verdict: "block", reason: "nope-b", policyId: "b" })
    })

    it("userMessage is what the user sees; reason stays the machine text", async () => {
      registerJobPolicy({
        id: "a",
        checkRequest: () => ({ verdict: "block", reason: "nsfw_score=0.98", userMessage: "לא ניתן" }),
      })
      const d = await applyJobRequestPolicies(req())
      expect(d.reason).toBe("nsfw_score=0.98")
      expect(d.userMessage).toBe("לא ניתן")
    })

    it("a block with NO userMessage shows the PLATFORM's sentence, never the reason (D13)", async () => {
      // The leak this test exists for: `reason` is the classifier's own text and
      // it lands on the 422 body verbatim if the platform defaults to it.
      registerJobPolicy({
        id: "a",
        checkRequest: () => ({ verdict: "block", reason: "nsfw_score=0.98 label=explicit" }),
      })
      const d = await applyJobRequestPolicies(req())
      // The machine reason still reaches the audit row untouched...
      expect(d.reason).toBe("nsfw_score=0.98 label=explicit")
      // ...and the user is shown the platform's words instead.
      expect(d.userMessage).toBe(DEFAULT_REQUEST_BLOCK_MESSAGE)
      expect(d.userMessage).not.toContain("nsfw_score")
    })

    it("a policy that throws BLOCKS (fail-closed) with the platform's own words", async () => {
      registerJobPolicy({ id: "boom", checkRequest: () => { throw new Error("service down") } })
      const d = await applyJobRequestPolicies(req())
      expect(d).toMatchObject({
        verdict: "block",
        policyId: "platform",
        reason: POLICY_UNAVAILABLE_REASON,
        userMessage: POLICY_UNAVAILABLE_MESSAGE,
      })
    })

    it("skips a policy with no checkRequest", async () => {
      const checkResult = vi.fn(() => ({ verdict: "allow" }) as const)
      registerJobPolicy({ id: "result-only", checkResult })
      expect(await applyJobRequestPolicies(req())).toEqual({ verdict: "allow" })
      expect(checkResult).not.toHaveBeenCalled()
    })
  })

  describe("result gate", () => {
    it("severity order: a later flag never softens an earlier hold", async () => {
      registerJobPolicy({ id: "h", checkResult: () => ({ verdict: "hold", reason: "look at this" }) })
      registerJobPolicy({ id: "f", checkResult: () => ({ verdict: "flag", reason: "meh" }) })
      expect(await applyJobResultPolicies(res())).toMatchObject({ verdict: "hold", policyId: "h" })
    })

    it("severity order: a hold after a flag wins", async () => {
      registerJobPolicy({ id: "f", checkResult: () => ({ verdict: "flag", reason: "meh", labels: ["x"] }) })
      registerJobPolicy({ id: "h", checkResult: () => ({ verdict: "hold", reason: "look" }) })
      expect(await applyJobResultPolicies(res())).toMatchObject({ verdict: "hold", policyId: "h" })
    })

    it("block short-circuits — later policies are not asked", async () => {
      const later = vi.fn(() => ({ verdict: "allow" }) as const)
      registerJobPolicy({ id: "b", checkResult: () => ({ verdict: "block", reason: "explicit" }) })
      registerJobPolicy({ id: "later", checkResult: later })
      expect(await applyJobResultPolicies(res())).toMatchObject({ verdict: "block", policyId: "b" })
      expect(later).not.toHaveBeenCalled()
    })

    it("a block with NO userMessage shows the PLATFORM's sentence, never the reason (D13)", async () => {
      registerJobPolicy({
        id: "b",
        checkResult: () => ({ verdict: "block", reason: "nsfw_score=0.98 label=explicit" }),
      })
      const d = await applyJobResultPolicies(res())
      expect(d.reason).toBe("nsfw_score=0.98 label=explicit")
      expect(d.userMessage).toBe(DEFAULT_RESULT_BLOCK_MESSAGE)
      expect(d.userMessage).not.toContain("nsfw_score")
    })

    it("a flag and a hold carry NO userMessage at all — nothing about them is shown", async () => {
      // Neither verdict has a user-visible sentence: a flag publishes and a hold
      // parks behind "Awaiting review". Copying their machine `reason` into
      // `userMessage` made a string that is not user-safe look like one, one
      // downstream `??` away from a canvas.
      registerJobPolicy({ id: "f", checkResult: () => ({ verdict: "flag", reason: "nsfw_score=0.41" }) })
      expect((await applyJobResultPolicies(res())).userMessage).toBeUndefined()
      clearJobPolicies()
      registerJobPolicy({ id: "h", checkResult: () => ({ verdict: "hold", reason: "nsfw_score=0.71" }) })
      const held = await applyJobResultPolicies(res({ holdEligible: true }))
      expect(held.verdict).toBe("hold")
      expect(held.userMessage).toBeUndefined()
      expect(held.reason).toBe("nsfw_score=0.71")
    })

    it("flag carries its labels", async () => {
      registerJobPolicy({ id: "f", checkResult: () => ({ verdict: "flag", reason: "r", labels: ["nudity"] }) })
      expect(await applyJobResultPolicies(res())).toMatchObject({ verdict: "flag", labels: ["nudity"] })
    })

    it("hold on a hold-INELIGIBLE job downgrades to block and says so in the audit", async () => {
      registerJobPolicy({ id: "h", checkResult: () => ({ verdict: "hold", reason: "nsfw_score=0.71 label=suggestive" }) })
      const d = await applyJobResultPolicies(res({ holdEligible: false }))
      expect(d).toMatchObject({ verdict: "block", holdDowngraded: true, policyId: "h" })
      // The machine reason survives for the audit...
      expect(d.reason).toBe("nsfw_score=0.71 label=suggestive")
      // ...but a hold carries no userMessage, so the downgrade must NOT promote
      // its reason into the user-visible sentence (D13).
      expect(d.userMessage).toBe(HOLD_DOWNGRADED_MESSAGE)
    })

    it("a policy that throws fails closed to HOLD when the job is eligible (recoverable direction)", async () => {
      registerJobPolicy({ id: "boom", checkResult: () => { throw new Error("timeout") } })
      const d = await applyJobResultPolicies(res({ holdEligible: true }))
      expect(d).toMatchObject({ verdict: "hold", policyId: "platform", reason: POLICY_UNAVAILABLE_REASON })
    })

    it("a policy that throws fails closed to BLOCK when the job cannot be held", async () => {
      registerJobPolicy({ id: "boom", checkResult: () => { throw new Error("timeout") } })
      const d = await applyJobResultPolicies(res({ holdEligible: false }))
      expect(d).toMatchObject({
        verdict: "block",
        policyId: "platform",
        reason: POLICY_UNAVAILABLE_REASON,
        userMessage: POLICY_UNAVAILABLE_MESSAGE,
      })
    })

    it("skips a policy with no checkResult", async () => {
      const checkRequest = vi.fn(() => ({ verdict: "allow" }) as const)
      registerJobPolicy({ id: "request-only", checkRequest })
      expect(await applyJobResultPolicies(res())).toEqual({ verdict: "allow" })
      expect(checkRequest).not.toHaveBeenCalled()
    })

    it("a check that HANGS resolves to the fail-closed path instead of wedging the finalize claim", async () => {
      vi.useFakeTimers()
      try {
        registerJobPolicy({ id: "hang", checkResult: () => new Promise(() => {}) })
        const p = applyJobResultPolicies(res({ holdEligible: true }))
        await vi.advanceTimersByTimeAsync(121_000)
        await expect(p).resolves.toMatchObject({ verdict: "hold", policyId: "platform" })
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe("the block carrier", () => {
    it("jobBlockedBody is the one 422 shape every lane sends", () => {
      expect(jobBlockedBody({ userMessage: "not allowed here" })).toEqual({
        error: { code: "job_blocked", message: "not allowed here" },
      })
      // No `reason` arm at all: the machine text is not a candidate for the
      // 422 body, so the signature does not accept it and the empty case falls
      // to the platform's own sentence.
      expect(jobBlockedBody({}).error.message).toBe(DEFAULT_REQUEST_BLOCK_MESSAGE)
      expect(jobBlockedBody({ userMessage: "" }).error.message).toBe(DEFAULT_REQUEST_BLOCK_MESSAGE)
    })

    it("jobBlockOf recognises both carriers and nothing else", () => {
      const block = { code: "job_blocked", policyId: "p", message: "no" } as const
      expect(jobBlockOf(new JobBlockedError(block))).toEqual(block)
      expect(jobBlockOf({ message: "no", blocked: block })).toEqual(block)
      expect(jobBlockOf(new Error("ordinary"))).toBeNull()
      expect(jobBlockOf({ blocked: { code: "something_else" } })).toBeNull()
      expect(jobBlockOf(null)).toBeNull()
    })

    it("JobBlockedError carries the policy's user-safe text as its message", () => {
      const err = new JobBlockedError({ code: "job_blocked", policyId: "p", message: "Blocked by policy" })
      expect(err.message).toBe("Blocked by policy")
      expect(err.name).toBe("JobBlockedError")
      expect(err.code).toBe("job_blocked")
      expect(err.statusCode).toBe(422)
    })
  })
})

/**
 * `held_completion_fields` is a jsonb the approve path spreads onto the `jobs`
 * row, so every settlement input stored in it MUST be routed to `commit` — a
 * key that is not a `jobs` column would make the approve UPDATE fail outright.
 * F7 adds the loop-trim addon refund to that set.
 */
describe("splitHeldCompletionFields", () => {
  it("routes the loop-trim addon refund to commit, never to the jobs columns", () => {
    const { columns, commit } = splitHeldCompletionFields({
      output_data: { videoUrl: "https://r2/x.mp4" },
      provider: "minimax",
      metered: false,
      extraNonProviderCredits: 0,
      meteredCost: 0.5,
      loopTrimAddonRefundCredits: 3,
    })
    expect(commit.loopTrimAddonRefundCredits).toBe(3)
    expect(columns).not.toHaveProperty("loopTrimAddonRefundCredits")
    expect(columns).toEqual({ output_data: { videoUrl: "https://r2/x.mp4" }, provider: "minimax" })
  })

  it("HELD_COMMIT_REPLAY_KEYS names every settlement input approve replays", () => {
    expect([...HELD_COMMIT_REPLAY_KEYS]).toEqual([
      "metered", "extraNonProviderCredits", "meteredCost", "loopTrimAddonRefundCredits",
    ])
  })

  it("null / empty held fields split into two empty objects", () => {
    expect(splitHeldCompletionFields(null)).toEqual({ columns: {}, commit: {} })
  })
})
