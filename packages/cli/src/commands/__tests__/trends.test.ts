import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { info, success, dim, emit, detail } from "../../output.js"
import { trendsCommand } from "../trends.js"

const mocks = {
  list: vi.fn(),
  get: vi.fn(),
  estimate: vi.fn(),
  run: vi.fn(),
  runs: vi.fn(),
  favorite: vi.fn(),
  unfavorite: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({ trends: mocks }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), table: vi.fn(), dim: vi.fn(), detail: vi.fn(), info: vi.fn() }
})

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(trendsCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("trends command", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
    vi.mocked(info).mockReset()
    vi.mocked(success).mockReset()
    vi.mocked(dim).mockReset()
    vi.mocked(emit).mockReset()
  })

  it("list forwards the filters", async () => {
    mocks.list.mockResolvedValueOnce({ data: [], next: null })
    await runCmd("trends", "list", "--search", "dance", "--tag", "fun", "--favorites", "--locale", "he", "--limit", "5", "--cursor", "c1", "--json")
    expect(mocks.list).toHaveBeenCalledWith({ q: "dance", tag: "fun", favorites: true, locale: "he", limit: 5, cursor: "c1" })
  })

  it("list prints the next-page hint", async () => {
    mocks.list.mockResolvedValueOnce({ data: [], next: "n2" })
    await runCmd("trends", "list")
    expect(dim).toHaveBeenCalledWith("next: --cursor n2")
  })

  it("get reads one trend by slug", async () => {
    mocks.get.mockResolvedValueOnce({ slug: "dance" })
    await runCmd("trends", "get", "dance", "--locale", "he", "--json")
    expect(mocks.get).toHaveBeenCalledWith("dance", { locale: "he" })
    expect(emit).toHaveBeenCalledWith({ slug: "dance" }, expect.objectContaining({ json: true }))
  })

  it("get prints the whole page, the original included", async () => {
    const page = { slug: "dance", original: { videoUrl: "https://cdn/o.mp4", width: 720, height: 1280, durationSec: 8 }, examples: [] }
    mocks.get.mockResolvedValueOnce(page)
    await runCmd("trends", "get", "dance")
    expect(detail).toHaveBeenCalledWith(page)
  })

  it("the help says what get shows and what --example does on a trend with no example", () => {
    const cmd = trendsCommand()
    const sub = (name: string) => cmd.commands.find((c) => c.name() === name)!
    expect(sub("get").description()).toMatch(/original/)
    for (const name of ["estimate", "run"]) {
      const example = sub(name).options.find((o) => o.long === "--example")!
      expect(example.description).toMatch(/no example/)
    }
  })

  it("estimate lists the quote's parts by their labels, never a vendor name", async () => {
    mocks.estimate.mockResolvedValueOnce({ expectedCredits: 31, holdCredits: 40, breakdown: { castSwap: 5, seedance: 32, seedanceExpected: 23, references: 3, other: 1 } })
    await runCmd("trends", "estimate", "dance", "--slot", "person=https://a")
    const out = vi.mocked(dim).mock.calls.flat().join("\n")
    expect(out).toContain("Nodaro Motion: 5")
    expect(out).toContain("video: 32")
    expect(out).toContain("video, expected: 23")
    expect(out).toContain("reference pictures: 3")
    expect(out).toContain("other: 1")
    expect(out).not.toMatch(/seedance|kling/i)
  })

  it("estimate --json answers privacyCredits and the neutral part names, reading an older server's old ones", async () => {
    mocks.estimate.mockResolvedValueOnce({ expectedCredits: 40, holdCredits: 40, breakdown: { castSwap: 5, seedance: 35, masking: 6 }, maskingCredits: 6 })
    await runCmd("trends", "estimate", "dance", "--slot", "person=https://a", "--json")
    expect(emit).toHaveBeenCalledWith(
      { expectedCredits: 40, holdCredits: 40, breakdown: { castSwap: 5, motion: 35, privacy: 6 }, privacyCredits: 6 },
      expect.objectContaining({ json: true }),
    )
  })

  it("--slot key=url,url parses into the slot's images", async () => {
    mocks.estimate.mockResolvedValueOnce({ expectedCredits: 40, holdCredits: 40, breakdown: {} })
    await runCmd("trends", "estimate", "dance", "--slot", "person=https://a,https://b")
    expect(mocks.estimate).toHaveBeenCalledWith("dance", { slots: { person: { images: ["https://a", "https://b"] } } })
  })

  it("--slot repeats: several slots, and the same key twice appends", async () => {
    mocks.estimate.mockResolvedValueOnce({ expectedCredits: 40, holdCredits: 40, breakdown: {} })
    await runCmd(
      "trends", "estimate", "dance",
      "--slot", "person=https://a",
      "--slot", "pet=https://p",
      "--slot", "person=https://b",
    )
    expect(mocks.estimate).toHaveBeenCalledWith("dance", {
      slots: { person: { images: ["https://a", "https://b"] }, pet: { images: ["https://p"] } },
    })
  })

  it("--choice sets a chip, also on a slot given no pictures", async () => {
    mocks.estimate.mockResolvedValueOnce({ expectedCredits: 40, holdCredits: 40, breakdown: {} })
    await runCmd(
      "trends", "estimate", "dance",
      "--slot", "person=https://a",
      "--choice", "person.outfit=original",
      "--choice", "dog.coat=new",
    )
    expect(mocks.estimate).toHaveBeenCalledWith("dance", {
      slots: { person: { images: ["https://a"], outfit: "original" }, dog: { coat: "new" } },
    })
  })

  it("a bad --choice value is refused without calling the API", async () => {
    await expect(runCmd("trends", "run", "dance", "--choice", "person.outfit=maybe")).rejects.toThrow(/new or original/)
    await expect(runCmd("trends", "run", "dance", "--choice", "person.wings=new")).rejects.toThrow(/body, outfit, hair, coat, shape or finish/)
    await expect(runCmd("trends", "run", "dance", "--choice", "outfit=new")).rejects.toThrow(/--choice/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("a malformed --slot is refused without calling the API", async () => {
    await expect(runCmd("trends", "run", "dance", "--slot", "https://a")).rejects.toThrow(/--slot/)
    await expect(runCmd("trends", "run", "dance", "--slot", "person=")).rejects.toThrow(/--slot/)
    await expect(runCmd("trends", "run", "dance", "--slot", "=https://a")).rejects.toThrow(/--slot/)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("a slot key that is not one (a-z, 0-9, _; up to 32) is refused locally, __proto__ included", async () => {
    await expect(runCmd("trends", "run", "dance", "--slot", "__proto__=https://x")).rejects.toThrow(/slot key/)
    await expect(runCmd("trends", "run", "dance", "--slot", "Person=https://x")).rejects.toThrow(/slot key/)
    await expect(runCmd("trends", "run", "dance", "--choice", "__proto__.outfit=new")).rejects.toThrow(/slot key/)
    await expect(runCmd("trends", "estimate", "dance", "--slot", "a-b=https://x")).rejects.toThrow(/slot key/)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.estimate).not.toHaveBeenCalled()
    expect(({} as Record<string, unknown>).images).toBeUndefined()
  })

  it("--slot splits only where a new URL starts, so a URL with commas survives", async () => {
    mocks.estimate.mockResolvedValueOnce({ expectedCredits: 40, holdCredits: 40, breakdown: {} })
    await runCmd("trends", "estimate", "dance", "--slot", "person=https://cdn/x/w_100,h_100/a.jpg,https://b/c.png")
    expect(mocks.estimate).toHaveBeenCalledWith("dance", {
      slots: { person: { images: ["https://cdn/x/w_100,h_100/a.jpg", "https://b/c.png"] } },
    })
  })

  it("a --limit outside 1-60 is refused locally on list and runs", async () => {
    for (const bad of ["0", "61", "2.5", "ten"]) {
      await expect(runCmd("trends", "list", "--limit", bad)).rejects.toThrow(/--limit/)
      await expect(runCmd("trends", "runs", "--limit", bad)).rejects.toThrow(/--limit/)
    }
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.runs).not.toHaveBeenCalled()
  })

  it("a bad --example is refused without calling the API", async () => {
    await expect(runCmd("trends", "estimate", "dance", "--example", "0")).rejects.toThrow(/--example/)
    await expect(runCmd("trends", "estimate", "dance", "--example", "two")).rejects.toThrow(/--example/)
    expect(mocks.estimate).not.toHaveBeenCalled()
  })

  it("run sends the parsed body and prints the job id", async () => {
    mocks.run.mockResolvedValueOnce({ jobId: "j1" })
    await runCmd(
      "trends", "run", "dance",
      "--slot", "person=https://a",
      "--example", "2",
      "--details", "{slot:person} waves",
      "--preview",
      "--resolution", "480p",
      "--no-draft",
      "--session", "s1",
      "--idempotency-key", "key-12345",
    )
    expect(mocks.run).toHaveBeenCalledWith(
      "dance",
      {
        slots: { person: { images: ["https://a"] } },
        example: 2,
        details: "{slot:person} waves",
        preview: true,
        resolution: "480p",
        draft: false,
        sessionId: "s1",
      },
      { idempotencyKey: "key-12345" },
    )
    expect(vi.mocked(success).mock.calls[0]![0]).toContain("j1")
  })

  it("run without --no-draft sends no draft (so 720p is not sent as a draft)", async () => {
    mocks.run.mockResolvedValueOnce({ jobId: "j1" })
    await runCmd("trends", "run", "dance", "--slot", "p=https://u", "--resolution", "720p")
    const body = mocks.run.mock.calls[0]![1] as Record<string, unknown>
    expect(body).toEqual({ slots: { p: { images: ["https://u"] } }, resolution: "720p" })
    expect("draft" in body).toBe(false)
    expect("preview" in body).toBe(false)
  })

  it("run --json prints the raw result", async () => {
    mocks.run.mockResolvedValueOnce({ jobId: "j1" })
    await runCmd("trends", "run", "dance", "--json")
    expect(mocks.run).toHaveBeenCalledWith("dance", { slots: {} }, {})
    expect(emit).toHaveBeenCalledWith({ jobId: "j1" }, expect.objectContaining({ json: true }))
  })

  it("an unknown --resolution is refused by the parser", async () => {
    await expect(runCmd("trends", "run", "dance", "--resolution", "4k")).rejects.toThrow()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("estimate prints about N credits, and the hold only when it differs", async () => {
    mocks.estimate.mockResolvedValueOnce({ expectedCredits: 40, holdCredits: 40, breakdown: {} })
    await runCmd("trends", "estimate", "dance")
    expect(info).toHaveBeenLastCalledWith("about 40 credits")

    mocks.estimate.mockResolvedValueOnce({ expectedCredits: 40, holdCredits: 65, breakdown: {} })
    await runCmd("trends", "estimate", "dance")
    expect(info).toHaveBeenLastCalledWith("about 40 credits (up to 65 held while it runs)")
  })

  it("runs --trend x passes { trend: x }", async () => {
    mocks.runs.mockResolvedValueOnce({ data: [], next: null })
    await runCmd("trends", "runs", "--trend", "x", "--json")
    expect(mocks.runs).toHaveBeenCalledWith({ trend: "x", cursor: undefined, limit: undefined })
  })

  it("favorite and unfavorite call the API with the slug", async () => {
    mocks.favorite.mockResolvedValueOnce(undefined)
    mocks.unfavorite.mockResolvedValueOnce(undefined)
    await runCmd("trends", "favorite", "dance")
    await runCmd("trends", "unfavorite", "dance")
    expect(mocks.favorite).toHaveBeenCalledWith("dance")
    expect(mocks.unfavorite).toHaveBeenCalledWith("dance")
  })
})
