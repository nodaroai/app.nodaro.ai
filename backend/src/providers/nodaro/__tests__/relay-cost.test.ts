import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Relay provenance (spec 2026-09-04-sai-local-development §8.2, migration 383).
 *
 * Two columns, four lanes, one helper. What these tests pin:
 *   - a missing far-end `credits` becomes NULL, never 0 ("the authority could
 *     not say" — the same contract toUnits already keeps);
 *   - the write never throws into a finished, already-paid generation;
 *   - `relayFieldsFrom` is `{}` for every non-relay ProviderResult, which is
 *     what makes the router lane byte-inert off a relay.
 */

const update = vi.fn()
const eq = vi.fn()
const from = vi.fn()

vi.mock("../../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => from(t) },
}))

const { recordRelayCost, relayResultFields, relayFieldsFrom } = await import("../relay-cost.js")
type ProviderResult = import("../../provider.interface.js").ProviderResult

beforeEach(() => {
  eq.mockReset().mockResolvedValue({ error: null })
  update.mockReset().mockReturnValue({ eq })
  from.mockReset().mockReturnValue({ update })
})

describe("recordRelayCost", () => {
  it("writes both columns onto the near-end row", async () => {
    await recordRelayCost("local-1", { id: "cloud-9", status: "completed", credits: 24 })
    expect(from).toHaveBeenCalledWith("jobs")
    expect(update).toHaveBeenCalledWith({ relay_job_id: "cloud-9", relay_credits: 24 })
    expect(eq).toHaveBeenCalledWith("id", "local-1")
  })

  it("writes NULL — never 0 — when the far end withheld `credits`", async () => {
    await recordRelayCost("local-1", { id: "cloud-9", status: "completed" })
    expect(update).toHaveBeenCalledWith({ relay_job_id: "cloud-9", relay_credits: null })
  })

  it("writes NULL for an explicit null and for a non-finite number", async () => {
    await recordRelayCost("local-1", { id: "c1", status: "completed", credits: null })
    expect(update).toHaveBeenLastCalledWith({ relay_job_id: "c1", relay_credits: null })
    await recordRelayCost("local-2", { id: "c2", status: "completed", credits: Number.NaN })
    expect(update).toHaveBeenLastCalledWith({ relay_job_id: "c2", relay_credits: null })
  })

  it("never throws into the generation path — a provenance write is not worth failing a paid job for", async () => {
    eq.mockResolvedValue({ error: { message: "column does not exist" } })
    await expect(recordRelayCost("local-1", { id: "c1", status: "completed", credits: 3 })).resolves.toBeUndefined()
    eq.mockRejectedValue(new Error("connection reset"))
    await expect(recordRelayCost("local-1", { id: "c1", status: "completed", credits: 3 })).resolves.toBeUndefined()
  })

  it("does nothing without a local job id — there is no row to stamp", async () => {
    await recordRelayCost("", { id: "c1", status: "completed", credits: 3 })
    expect(from).not.toHaveBeenCalled()
  })
})

describe("relayResultFields", () => {
  it("hands the ProviderResult carrier the far id and a null-safe cost", () => {
    expect(relayResultFields({ id: "cloud-9", status: "completed", credits: 24 })).toEqual({
      relayJobId: "cloud-9",
      relayCredits: 24,
    })
    expect(relayResultFields({ id: "cloud-9", status: "completed" })).toEqual({
      relayJobId: "cloud-9",
      relayCredits: null,
    })
  })
})

describe("relayFieldsFrom", () => {
  it("is {} for a result no nodaro provider produced — the router lane stays byte-inert", () => {
    const kieResult: ProviderResult = { url: "https://x/a.png", cost: 0.004, kieTaskId: "kie-1" }
    expect(relayFieldsFrom(kieResult)).toEqual({})
    expect(relayFieldsFrom(undefined)).toEqual({})
    expect(relayFieldsFrom(null)).toEqual({})
  })

  it("maps the two ProviderResult fields onto the two columns", () => {
    const relayed: ProviderResult = { url: "u", cost: null, relayJobId: "cloud-9", relayCredits: 24 }
    expect(relayFieldsFrom(relayed)).toEqual({ relay_job_id: "cloud-9", relay_credits: 24 })

    const costWithheld: ProviderResult = { url: "u", cost: null, relayJobId: "cloud-9" }
    expect(relayFieldsFrom(costWithheld)).toEqual({ relay_job_id: "cloud-9", relay_credits: null })
  })
})
