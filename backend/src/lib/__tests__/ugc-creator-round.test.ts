/**
 * UGC Creator's round (`@nodaro/render-rules`), the one implementation the
 * orchestrator and the canvas both run: what is drawn where a person picks and
 * where nobody does, and what happens when an option is blocked, fails, misses
 * the gender check or meets an insufficient-credits refusal.
 */
import { UGC_NEWER_APP_MESSAGE } from "@nodaro/shared"
import { UGC_CREATOR_NO_IMAGE_MESSAGE, UGC_SPEND_REFUSAL_CODES, UgcCreatorRoundStopped, isUgcModerationBlock, runUgcCreatorRound, type UgcCreatorRoundDeps } from "@nodaro/render-rules"
import { RESERVE_STATUS_BY_CODE } from "../reserve-errors.js"
import { describe, expect, it, vi } from "vitest"

const img = (m: string) => ({ tool: "generate_image", args: { prompt: "p", model: m, aspect_ratio: "3:4" } })
const [A, B, C] = [img("image-model-a"), img("image-model-b"), img("image-model-c")]
const CHECK = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
const answer = (seed: number, traits: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
  kind: "sampled", seed, gender: "woman", traits, identityImages: [], promptsVersion: "1.0.0", productCategory: "saas",
  image: { ...A, fallback: C }, candidates: [{ model: "image-model-a", ...A }, { model: "image-model-b", ...B }], fallback: C, pick: { how: "user" },
  realismPass: null, secondFrame: null, photoCheck: null, genderCheck: CHECK, ...more,
})
const REQUEST = { seed: 7, source: { kind: "sampled", gender: "woman", productCategory: "saas" } }
const blocked = () => Object.assign(new Error("blocked"), { errorHint: { kind: "safety-block", class: "content", retried: false } })
const noCredits = () => Object.assign(new Error("Insufficient credits"), { status: 402 })

/** Image calls answer by model, in order (an Error = that job failed); a reading passes unless its image is in `misses`, or answers with `readError`. */
function harness(draws: Record<string, Array<string | Error>>, misses: string[] = [], answers: Record<string, unknown>[] = [], readError?: Error) {
  const log: string[] = []
  const steps: string[] = []
  const left = Object.fromEntries(Object.entries(draws).map(([k, v]) => [k, [...v]]))
  const deps: UgcCreatorRoundDeps = {
    child: vi.fn(async (call, image, step) => {
      if (step) steps.push(step)
      if (call.tool === "image_to_text") {
        log.push(`read ${image}`)
        if (readError) throw readError
        return { text: misses.includes(image!) ? "FAIL" : "PASS" }
      }
      const model = String(call.args.model)
      log.push(`draw ${model}`)
      const next = left[model]?.shift()
      if (next === undefined) throw new Error(`unexpected ${model}`)
      if (next instanceof Error) throw next
      return { imageUrl: next }
    }),
    builder: vi.fn(async () => { log.push("builder"); const a = answers.shift(); if (!a) throw new Error("unexpected builder"); return a }),
    isInsufficientCredits: (err) => (err as { status?: unknown }).status === 402,
  }
  return { deps, log, steps }
}
const u = (s: string) => `https://cdn.example/${s}.png`

describe("the creator round: every option drawn where a person picks, the primary alone elsewhere", () => {
  it("a person picks: both draw, both pass → the pair, each its own record", async () => {
    const { deps } = harness({ "image-model-a": [u("a")], "image-model-b": [u("b")] })
    const r = await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })
    expect(r).toMatchObject({ kind: "pick", optionFailed: false })
    expect(r.kind === "pick" && r.candidates.map((c) => [c.imageUrl, (c.record as { identityImages: string[] }).identityImages])).toEqual([[u("a"), [u("a")]], [u("b"), [u("b")]]])
  })
  it("nobody picks: the primary alone is drawn and checked", async () => {
    const { deps, log } = harness({ "image-model-a": [u("a")] })
    expect(await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: false })).toMatchObject({ kind: "one", images: [u("a")], optionFailed: false })
    expect(log).toEqual(["draw image-model-a", `read ${u("a")}`])
  })
  it("a blocked option is dropped silently and the other is handed on, with no note", async () => {
    const { deps, log } = harness({ "image-model-a": [blocked()], "image-model-b": [u("b")] })
    expect(await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })).toMatchObject({ kind: "one", images: [u("b")], optionFailed: false })
    expect(log).not.toContain("draw image-model-c")
  })
  it("every option blocked → the round's fallback once; its image is the one option", async () => {
    const { deps, log } = harness({ "image-model-a": [blocked()], "image-model-b": [blocked()], "image-model-c": [u("c")] })
    expect(await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })).toMatchObject({ kind: "one", images: [u("c")] })
    expect(log.filter((l) => l === "draw image-model-c")).toHaveLength(1)
  })
  it("the fallback blocked too → the image route's own error; nothing is retried", async () => {
    const { deps, log } = harness({ "image-model-a": [blocked()], "image-model-b": [blocked()], "image-model-c": [blocked()] })
    await expect(runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })).rejects.toThrow("blocked")
    expect(log).toEqual(["draw image-model-a", "draw image-model-b", "draw image-model-c"])
  })
  it("another failure beside a survivor → the survivor, with the note", async () => {
    const { deps } = harness({ "image-model-a": [new Error("provider down")], "image-model-b": [u("b")] })
    expect(await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })).toMatchObject({ kind: "one", images: [u("b")], optionFailed: true })
  })
  it("another failure and no survivor, nothing checked → that failure; the fallback never runs for it", async () => {
    const { deps, log } = harness({ "image-model-a": [new Error("provider down")], "image-model-b": [blocked()] })
    await expect(runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })).rejects.toThrow("provider down")
    expect(log).not.toContain("draw image-model-c")
  })
  it("mixed: one option failed, the other was checked and missed → the silent re-roll still runs", async () => {
    const { deps } = harness({ "image-model-a": [new Error("provider down"), u("a2")], "image-model-b": [u("b1"), u("b2")] }, [u("b1")], [answer(8, { t: 2 })])
    const r = await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })
    expect(deps.builder).toHaveBeenCalledTimes(1)
    expect(r.kind === "pick" && r.candidates.map((c) => c.imageUrl)).toEqual([u("a2"), u("b2")])
  })
  it("an insufficient-credits refusal on any option stops the round; the options already checked are kept", async () => {
    const { deps, log } = harness({ "image-model-a": [u("a")], "image-model-b": [noCredits()] })
    const err = await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UgcCreatorRoundStopped)
    expect((err as UgcCreatorRoundStopped).refusal).toMatchObject({ status: 402 })
    expect((err as UgcCreatorRoundStopped).candidates.map((c) => c.imageUrl)).toEqual([u("a")])
    expect(log).not.toContain("builder")
    expect(log).not.toContain("draw image-model-c")
  })
  it("an insufficient-credits refusal on a reading keeps no unchecked option", async () => {
    const { deps } = harness({ "image-model-a": [u("a")], "image-model-b": [u("b")] }, [], [], noCredits())
    const err = await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true }).catch((e: unknown) => e)
    expect((err as UgcCreatorRoundStopped).candidates).toEqual([])
  })
  it("a gender miss is dropped silently", async () => {
    const { deps } = harness({ "image-model-a": [u("a")], "image-model-b": [u("b")] }, [u("b")])
    expect(await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })).toMatchObject({ kind: "one", images: [u("a")], optionFailed: false })
  })
  it("none passes → one silent re-call with the next seed and this round's traits, then its pair", async () => {
    const { deps } = harness({ "image-model-a": [u("a1"), u("a2")], "image-model-b": [u("b1"), u("b2")] }, [u("a1"), u("b1")], [answer(8, { t: 2 })])
    const r = await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })
    expect(deps.builder).toHaveBeenCalledWith({ seed: 8, source: { kind: "sampled", gender: "woman", productCategory: "saas", previous: { t: 1 } } })
    expect(r.kind === "pick" && r.candidates.map((c) => c.imageUrl)).toEqual([u("a2"), u("b2")])
  })
  it("none passes twice → the check's refusal, verbatim", async () => {
    const { deps } = harness({ "image-model-a": [u("a1"), u("a2")], "image-model-b": [u("b1"), u("b2")] }, [u("a1"), u("b1"), u("a2"), u("b2")], [answer(8, { t: 2 })])
    await expect(runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })).rejects.toThrow("R")
    expect(deps.builder).toHaveBeenCalledTimes(1)
  })
  it("a call the app cannot run → the newer-app message before any job", async () => {
    const { deps } = harness({})
    await expect(runUgcCreatorRound(answer(7, { t: 1 }, { candidates: [{ tool: "teleport", args: {} }, B] }), REQUEST, deps, { personPicks: true })).rejects.toThrow(UGC_NEWER_APP_MESSAGE)
    expect(deps.child).not.toHaveBeenCalled()
  })
  it("an answer from before candidates draws `image` alone, whoever runs it", async () => {
    const { candidates: _c, fallback: _f, pick: _p, ...older } = answer(7, { t: 1 })
    const { deps, log } = harness({ "image-model-a": [u("a")] })
    expect(await runUgcCreatorRound(older, REQUEST, deps, { personPicks: true })).toMatchObject({ kind: "one", images: [u("a")] })
    expect(log).toEqual(["draw image-model-a", `read ${u("a")}`])
  })
})

describe("the creator round: the remaining rules", () => {
  it("a run that stops (a cancel, a drain) ends the round at once: its own error goes on, nothing else starts", async () => {
    const drained = new Error("drain")
    const { deps, log } = harness({ "image-model-a": [drained], "image-model-b": [u("b")] })
    const err = await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, { ...deps, isAbort: (e) => e === drained }, { personPicks: true }).catch((e: unknown) => e)
    expect(err).toBe(drained)
    expect(log).not.toContain("builder")
    expect(log).not.toContain("draw image-model-c")
  })
  it("a stopping run is never an option that failed: even beside a survivor, the round ends", async () => {
    const cancelled = new Error("Execution cancelled")
    const { deps } = harness({ "image-model-a": [u("a")], "image-model-b": [cancelled] })
    await expect(runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, { ...deps, isAbort: (e) => e === cancelled }, { personPicks: true })).rejects.toBe(cancelled)
  })
  it("each call names its round, its option and its step; a re-roll's calls get new names", async () => {
    const { deps, steps } = harness({ "image-model-a": [u("a1"), u("a2")], "image-model-b": [u("b1"), u("b2")] }, [u("a1"), u("b1")], [answer(8, { t: 2 })])
    await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })
    expect([...steps].sort()).toEqual(["r0-c0-check", "r0-c0-image", "r0-c1-check", "r0-c1-image", "r1-c0-check", "r1-c0-image", "r1-c1-check", "r1-c1-image"])
  })
  it("the fallback's calls are named apart from the options'", async () => {
    const { deps, steps } = harness({ "image-model-a": [blocked()], "image-model-b": [blocked()], "image-model-c": [u("c")] })
    await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })
    expect(steps).toEqual(expect.arrayContaining(["r0-fallback-image", "r0-fallback-check"]))
    expect(new Set(steps).size).toBe(steps.length)
  })
  it("a check the app cannot run, or one that names no pass token, is refused before any job", async () => {
    for (const genderCheck of [{ ...CHECK, tool: "teleport" }, { ...CHECK, passToken: "" }, { ...CHECK, refusal: undefined }]) {
      const { deps } = harness({ "image-model-a": [u("a")], "image-model-b": [u("b")] })
      await expect(runUgcCreatorRound(answer(7, { t: 1 }, { genderCheck }), REQUEST, deps, { personPicks: true })).rejects.toThrow(UGC_NEWER_APP_MESSAGE)
      expect(deps.child).not.toHaveBeenCalled()
    }
  })
  it("no gender check: every drawn option passes", async () => {
    const { deps, log } = harness({ "image-model-a": [u("a")], "image-model-b": [u("b")] })
    expect(await runUgcCreatorRound(answer(7, { t: 1 }, { genderCheck: null }), REQUEST, deps, { personPicks: true })).toMatchObject({ kind: "pick" })
    expect(log.some((l) => l.startsWith("read"))).toBe(false)
  })
  it("an image job that finishes without an image is an option that failed", async () => {
    const { deps } = harness({ "image-model-a": [""], "image-model-b": [u("b")] })
    expect(await runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, deps, { personPicks: true })).toMatchObject({ kind: "one", images: [u("b")], optionFailed: true })
    const alone = harness({ "image-model-a": [""] })
    await expect(runUgcCreatorRound(answer(7, { t: 1 }), REQUEST, alone.deps, { personPicks: false })).rejects.toThrow(UGC_CREATOR_NO_IMAGE_MESSAGE)
  })
  it("an answer whose seed is not a number re-calls without one", async () => {
    const { deps } = harness({ "image-model-a": [u("a1"), u("a2")] }, [u("a1")], [answer(8, { t: 2 })])
    await runUgcCreatorRound({ ...answer(7, { t: 1 }), seed: undefined }, REQUEST, deps, { personPicks: false })
    expect(deps.builder).toHaveBeenCalledWith({ source: { kind: "sampled", gender: "woman", productCategory: "saas", previous: { t: 1 } } })
  })
  it("a moderation block is read from the job's classified hint, never from its message", () => {
    expect(isUgcModerationBlock(blocked())).toBe(true)
    expect(isUgcModerationBlock(new Error("blocked by safety system"))).toBe(false)
    expect(isUgcModerationBlock(Object.assign(new Error("x"), { errorHint: { kind: "policy-block" } }))).toBe(false)
    expect(isUgcModerationBlock(undefined)).toBe(false)
  })
})

describe("the refusals that stop the round: the run cannot pay", () => {
  it("are the credit guard's and the reservation's payment refusals, and nothing else", () => {
    expect([...UGC_SPEND_REFUSAL_CODES].sort()).toEqual([
      "budget_exceeded", "external_wallet_denied", "instance_cap_reached", "insufficient_app_credits",
      "insufficient_credits", "member_cap_exceeded", "subscription_required", "user_allowance_exceeded",
    ])
  })
  it("every reservation refusal answered with a 402 is one of them (a new one cannot slip in as a failed option)", () => {
    const paymentRefusals = Object.entries(RESERVE_STATUS_BY_CODE).filter(([, status]) => status === 402).map(([code]) => code)
    expect(paymentRefusals.length).toBeGreaterThan(0)
    for (const code of paymentRefusals) expect(UGC_SPEND_REFUSAL_CODES.has(code), code).toBe(true)
  })
  it("a reservation refusal that is not about paying (a block, a membership, a fault) is not", () => {
    for (const code of ["access_blocked", "member_suspended", "not_a_member", "workspace_archived", "workspace_not_found", "external_wallet_unavailable", "allowance_unconfigured"]) {
      expect(UGC_SPEND_REFUSAL_CODES.has(code), code).toBe(false)
    }
  })
})
