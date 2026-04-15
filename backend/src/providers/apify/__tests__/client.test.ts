import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ApifyClient is called with `new`, so the mock must be a regular function (not
// arrow) for Vitest to correctly attach `this` in the constructor role.
vi.mock("apify-client", () => ({
  ApifyClient: vi.fn().mockImplementation(function (this: any) {
    this.actor = vi.fn()
    this.dataset = vi.fn()
  }),
}))

describe("apify client", () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => {
    delete process.env.APIFY_API_TOKEN
  })

  it("ApifyError carries context + internalDetails", async () => {
    const { ApifyError } = await import("../client.js")
    const e = new ApifyError("Failed to scrape", "HTTP 500 from actor", "google-search")
    expect(e.message).toBe("Failed to scrape")
    expect(e.internalDetails).toBe("HTTP 500 from actor")
    expect(e.context).toBe("google-search")
    expect(e.getFullMessage()).toContain("google-search")
    expect(e.getFullMessage()).toContain("HTTP 500 from actor")
  })

  describe("sanitizeApifyError maps raw errors to user-friendly messages", () => {
    it.each([
      ["Rate limit exceeded", /too many requests/i],
      ["HTTP 429 Too Many Requests", /too many requests/i],
      ["Actor timeout after 300s", /took too long/i],
      ["HTTP 404 Not Found", /could not be found|private/i],
      ["Page not found on example.com", /could not be found|private/i],
      ["401 Unauthorized", /access denied/i],
      ["403 Forbidden by target", /access denied/i],
      ["Memory limit exceeded", /blocked the scrape|different url/i],
      ["Request blocked by anti-bot system", /blocked the scrape|different url/i],
      ["Captcha challenge detected", /blocked the scrape|different url/i],
      ["Monthly usage limit exceeded", /temporarily unavailable|contact support/i],
      ["Apify quota reached", /temporarily unavailable|contact support/i],
      ["Random connection reset", /check the url/i],
    ])("%s → matches %s", async (input, pattern) => {
      const { sanitizeApifyError } = await import("../client.js")
      const out = sanitizeApifyError(new Error(input), "test-ctx")
      expect(out.message).toMatch(pattern)
      expect(out.context).toBe("test-ctx")
      expect(out.internalDetails).toBe(input)
    })

    it("accepts non-Error values and stringifies them", async () => {
      const { sanitizeApifyError } = await import("../client.js")
      const out = sanitizeApifyError("plain string error", "ctx")
      expect(out.internalDetails).toBe("plain string error")
    })
  })

  it("getApifyClient lazily initializes the SDK", async () => {
    process.env.APIFY_API_TOKEN = "test-token"
    const { getApifyClient } = await import("../client.js")
    const { ApifyClient } = await import("apify-client")
    getApifyClient()
    getApifyClient()
    expect(vi.mocked(ApifyClient)).toHaveBeenCalledTimes(1)
  })

  it("getApifyClient throws when token is not configured", async () => {
    // No process.env.APIFY_API_TOKEN set (afterEach clears it)
    const { getApifyClient } = await import("../client.js")
    expect(() => getApifyClient()).toThrow(/not configured/i)
  })
})

describe("runScraper", () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => {
    delete process.env.APIFY_API_TOKEN
  })

  it("calls actor, reads dataset, extracts output", async () => {
    const mockListItems = vi.fn().mockResolvedValue({
      items: [{ organicResults: [{ title: "T", url: "u", description: "d" }] }],
    })
    const mockActorCall = vi.fn().mockResolvedValue({ defaultDatasetId: "ds-1" })
    const mockActor = vi.fn().mockReturnValue({ call: mockActorCall })
    const mockDataset = vi.fn().mockReturnValue({ listItems: mockListItems })

    const { ApifyClient } = await import("apify-client")
    vi.mocked(ApifyClient).mockImplementation(function (this: any) {
      this.actor = mockActor
      this.dataset = mockDataset
    } as unknown as new () => InstanceType<typeof ApifyClient>)

    process.env.APIFY_API_TOKEN = "test-token"
    const { resetApifyClientForTests } = await import("../client.js")
    resetApifyClientForTests()
    const { runScraper } = await import("../scraper.js")

    const result = await runScraper({ actor: "google-search", query: "ai" })
    expect(mockActor).toHaveBeenCalledWith("apify/google-search-scraper")
    expect(mockActorCall).toHaveBeenCalledWith(
      expect.objectContaining({ queries: "ai" }),
      expect.objectContaining({ waitSecs: 180 }),
    )
    expect(mockDataset).toHaveBeenCalledWith("ds-1")
    expect(JSON.parse(result.text)).toHaveLength(1)
  })

  it("wraps SDK errors via sanitizeApifyError", async () => {
    const mockActor = vi.fn().mockReturnValue({
      call: vi.fn().mockRejectedValue(new Error("Rate limit exceeded (429)")),
    })
    const mockDataset = vi.fn()
    const { ApifyClient } = await import("apify-client")
    vi.mocked(ApifyClient).mockImplementation(function (this: any) {
      this.actor = mockActor
      this.dataset = mockDataset
    } as unknown as new () => InstanceType<typeof ApifyClient>)

    process.env.APIFY_API_TOKEN = "test-token"
    const { resetApifyClientForTests } = await import("../client.js")
    resetApifyClientForTests()
    const { runScraper } = await import("../scraper.js")

    await expect(runScraper({ actor: "google-search", query: "ai" })).rejects.toMatchObject({
      name: "ApifyError",
      context: "google-search",
    })
  })
})
