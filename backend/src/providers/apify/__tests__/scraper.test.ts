/**
 * Apify scraper tests.
 *
 * runScraper() ties together three pieces:
 *   - getApifyClient() → SDK client
 *   - ACTORS[args.actor] → actor definition with apifyActorId + timeoutSecs
 *   - buildActorInput(args) → request input
 *   - extractActorOutput(actor, items) → caller-friendly output shape
 *   - sanitizeApifyError(err, actor) → wraps any thrown error
 *
 * The function itself is small but it's the single entry point for every
 * scraper run — getting actor lookup, dataset retrieval, or error wrapping
 * wrong silently breaks every Apify-backed feature.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const datasetListItems = vi.fn()
  const actorCall = vi.fn()
  const datasetFn = vi.fn()
  const actorFn = vi.fn()
  const getApifyClient = vi.fn()
  const sanitizeApifyError = vi.fn()
  const buildActorInput = vi.fn()
  const extractActorOutput = vi.fn()
  return {
    datasetListItems, actorCall, datasetFn, actorFn,
    getApifyClient, sanitizeApifyError,
    buildActorInput, extractActorOutput,
  }
})

vi.mock("../client.js", () => ({
  getApifyClient: mocks.getApifyClient,
  sanitizeApifyError: mocks.sanitizeApifyError,
}))

vi.mock("../actors.js", () => ({
  ACTORS: {
    "test-actor": {
      apifyActorId: "test-org/test-actor",
      timeoutSecs: 60,
    },
    "slow-actor": {
      apifyActorId: "slow/actor",
      timeoutSecs: 300,
    },
  },
  buildActorInput: mocks.buildActorInput,
  extractActorOutput: mocks.extractActorOutput,
}))

import { runScraper } from "../scraper.js"

beforeEach(() => {
  vi.clearAllMocks()

  // Wire up the chained API: client.actor(id).call(input, opts)
  mocks.actorCall.mockResolvedValue({ defaultDatasetId: "ds-1" })
  mocks.actorFn.mockReturnValue({ call: mocks.actorCall })

  // client.dataset(id).listItems()
  mocks.datasetListItems.mockResolvedValue({
    items: [{ url: "https://example.com", title: "Example" }],
  })
  mocks.datasetFn.mockReturnValue({ listItems: mocks.datasetListItems })

  mocks.getApifyClient.mockReturnValue({
    actor: mocks.actorFn,
    dataset: mocks.datasetFn,
  })

  mocks.buildActorInput.mockReturnValue({ input: "built" })
  mocks.extractActorOutput.mockReturnValue({ extracted: "result" })
  mocks.sanitizeApifyError.mockImplementation((err: unknown, actor: string) =>
    new Error(`[apify:${actor}] ${err instanceof Error ? err.message : String(err)}`),
  )
})

describe("runScraper", () => {
  it("looks up the actor definition and forwards apifyActorId to client.actor()", async () => {
    await runScraper({ actor: "test-actor" } as never)

    expect(mocks.actorFn).toHaveBeenCalledWith("test-org/test-actor")
  })

  it("calls actor with buildActorInput() result + waitSecs from definition", async () => {
    mocks.buildActorInput.mockReturnValueOnce({ url: "https://target.com", maxPages: 5 })

    await runScraper({ actor: "test-actor", url: "https://target.com" } as never)

    expect(mocks.actorCall).toHaveBeenCalledWith(
      { url: "https://target.com", maxPages: 5 },
      { waitSecs: 60 },
    )
  })

  it("uses per-actor waitSecs (slow-actor → 300)", async () => {
    await runScraper({ actor: "slow-actor" } as never)

    expect(mocks.actorCall).toHaveBeenCalledWith(
      expect.anything(),
      { waitSecs: 300 },
    )
  })

  it("fetches dataset items by defaultDatasetId from the actor run result", async () => {
    mocks.actorCall.mockResolvedValueOnce({ defaultDatasetId: "ds-abc-123" })

    await runScraper({ actor: "test-actor" } as never)

    expect(mocks.datasetFn).toHaveBeenCalledWith("ds-abc-123")
    expect(mocks.datasetListItems).toHaveBeenCalledOnce()
  })

  it("passes the items array to extractActorOutput along with the actor name", async () => {
    const items = [{ id: 1 }, { id: 2 }]
    mocks.datasetListItems.mockResolvedValueOnce({ items })

    await runScraper({ actor: "test-actor" } as never)

    expect(mocks.extractActorOutput).toHaveBeenCalledWith("test-actor", items)
  })

  it("returns the extracted output from extractActorOutput", async () => {
    mocks.extractActorOutput.mockReturnValueOnce({ extracted: "magic-result" })

    const result = await runScraper({ actor: "test-actor" } as never)

    expect(result).toEqual({ extracted: "magic-result" })
  })

  it("calls buildActorInput with the original args (not just args.actor)", async () => {
    const args = { actor: "test-actor", url: "https://x.com", maxPages: 10 }

    await runScraper(args as never)

    expect(mocks.buildActorInput).toHaveBeenCalledWith(args)
  })

  it("wraps actor.call errors via sanitizeApifyError with the actor name", async () => {
    mocks.actorCall.mockRejectedValueOnce(new Error("apify quota exceeded"))

    await expect(runScraper({ actor: "test-actor" } as never)).rejects.toThrow(
      /\[apify:test-actor\] apify quota exceeded/,
    )
    expect(mocks.sanitizeApifyError).toHaveBeenCalledWith(
      expect.any(Error),
      "test-actor",
    )
  })

  it("wraps dataset listItems errors via sanitizeApifyError", async () => {
    mocks.datasetListItems.mockRejectedValueOnce(new Error("dataset 404"))

    await expect(runScraper({ actor: "test-actor" } as never)).rejects.toThrow(
      /\[apify:test-actor\] dataset 404/,
    )
  })

  it("wraps getApifyClient errors", async () => {
    mocks.getApifyClient.mockImplementationOnce(() => {
      throw new Error("APIFY_API_TOKEN not set")
    })

    await expect(runScraper({ actor: "test-actor" } as never)).rejects.toThrow(
      /\[apify:test-actor\] APIFY_API_TOKEN not set/,
    )
  })

  it("does NOT call extractActorOutput when actor.call rejects", async () => {
    mocks.actorCall.mockRejectedValueOnce(new Error("boom"))

    await expect(runScraper({ actor: "test-actor" } as never)).rejects.toThrow()
    expect(mocks.extractActorOutput).not.toHaveBeenCalled()
  })

  it("does NOT call extractActorOutput when dataset.listItems rejects", async () => {
    mocks.datasetListItems.mockRejectedValueOnce(new Error("ds err"))

    await expect(runScraper({ actor: "test-actor" } as never)).rejects.toThrow()
    expect(mocks.extractActorOutput).not.toHaveBeenCalled()
  })
})
