import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { accountsFromFlags, competitorsCommand, mergeAccounts, parseAbout, parseClear, parseSchedule } from "../competitors.js"

const mocks = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  discover: vi.fn(),
  scan: vi.fn(),
  cards: vi.fn(),
  lessons: vi.fn(),
  jobsGet: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    competitors: {
      list: mocks.list,
      get: mocks.get,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.delete,
      discover: mocks.discover,
      scan: mocks.scan,
      cards: mocks.cards,
      lessons: mocks.lessons,
    },
    jobs: { get: mocks.jobsGet },
  }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), info: vi.fn(), dim: vi.fn(), table: vi.fn(), detail: vi.fn() }
})

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(competitorsCommand())
  await program.parseAsync(["node", "test", ...args])
}

const CREATED = { id: "c1", brand: "Acme Paint", searches: 3, schedule: "weekly" }

describe("competitors command", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
  })

  it("add with only a website finds the accounts first, then tracks the brand", async () => {
    mocks.discover.mockResolvedValueOnce({
      brand: "Acme Paint",
      website: "https://acme.example/",
      accounts: { tiktok: { value: "acmepaint", from: "site" }, x: { value: "acmepaint", from: "guess" } },
    })
    mocks.create.mockResolvedValueOnce(CREATED)
    await runCmd("competitors", "add", "--website", "acme.example", "--about", "reddit,x", "--schedule", "daily")
    expect(mocks.discover).toHaveBeenCalledWith("acme.example")
    expect(mocks.create).toHaveBeenCalledWith({
      brand: "Acme Paint",
      website: "acme.example",
      accounts: { tiktok: "acmepaint", x: "acmepaint" },
      aboutPlatforms: ["reddit", "x"],
      schedule: "daily",
    })
  })

  it("add with account flags skips the lookup", async () => {
    mocks.create.mockResolvedValueOnce(CREATED)
    await runCmd("competitors", "add", "--brand", "Acme Paint", "--tiktok", "acmepaint", "--meta-ads", "Acme Paint", "--own")
    expect(mocks.discover).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledWith({ brand: "Acme Paint", accounts: { tiktok: "acmepaint", meta_ads: "Acme Paint" }, isOwn: true })
  })

  it("lessons prints what works per platform, with the posts each lesson rests on", async () => {
    const { info } = await import("../../output.js")
    mocks.lessons.mockResolvedValueOnce({
      lessons: {
        subjectId: "c1",
        isOwn: true,
        minPosts: 6,
        platforms: [
          {
            platform: "tiktok",
            posts: 12,
            usual: 1150,
            unit: "views",
            winners: ["tiktok:1"],
            misses: [],
            lessons: [{ id: "tiktok:short_videos:short", kind: "short_videos", platform: "tiktok", params: {}, evidence: ["tiktok:1"], strength: 2.4, text: "On TikTok, videos of 15 seconds or less got 2.4x your usual views (4 posts, 3 of the best)." }],
          },
          { platform: "instagram", posts: 3, usual: null, unit: "views", winners: [], misses: [], lessons: [] },
        ],
      },
      posts: { "tiktok:1": { url: "https://www.tiktok.com/@acme/video/1" } },
    })
    await runCmd("competitors", "lessons", "c1")
    expect(mocks.lessons).toHaveBeenCalledWith("c1")
    const lines = vi.mocked(info).mock.calls.map((c) => String(c[0]))
    expect(lines).toContain("tiktok: 12 posts, usually 1150 views")
    expect(lines).toContain("   • On TikTok, videos of 15 seconds or less got 2.4x your usual views (4 posts, 3 of the best).")
    expect(lines).toContain("     https://www.tiktok.com/@acme/video/1")
    expect(lines).toContain("instagram: 3 posts — needs 6 to tell what works")
  })

  it("scan queues a job", async () => {
    mocks.scan.mockResolvedValueOnce({ jobId: "job-1" })
    await runCmd("competitors", "scan", "c1")
    expect(mocks.scan).toHaveBeenCalledWith("c1")
  })

  it("update changes one account and keeps the others, and --clear removes one", async () => {
    mocks.get.mockResolvedValue({ id: "c1", accounts: { tiktok: "acmepaint", instagram: "acme", youtube: "@acme" } })
    mocks.update.mockResolvedValue({ id: "c1", brand: "Acme Paint" })
    await runCmd("competitors", "update", "c1", "--x", "acmex", "--clear", "youtube")
    expect(mocks.update).toHaveBeenCalledWith("c1", { accounts: { tiktok: "acmepaint", instagram: "acme", x: "acmex" } })

    mocks.update.mockClear()
    mocks.get.mockClear()
    await runCmd("competitors", "update", "c1", "--schedule", "daily")
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith("c1", { schedule: "daily" })
  })

  it("update refuses an empty change, remove deletes by id", async () => {
    await expect(runCmd("competitors", "update", "c1")).rejects.toThrow("nothing to change")
    mocks.delete.mockResolvedValueOnce(undefined)
    await runCmd("competitors", "remove", "c1")
    expect(mocks.delete).toHaveBeenCalledWith("c1")
  })
})

describe("flag parsing", () => {
  it("keeps only the account flags given", () => {
    expect(accountsFromFlags({ tiktok: "a", x: " ", metaAds: "Brand" })).toEqual({ tiktok: "a", meta_ads: "Brand" })
  })

  it("merges accounts: set, keep, clear; a platform cannot be set and cleared at once", () => {
    expect(mergeAccounts({ tiktok: "a", x: "b" }, { x: "c" }, ["tiktok"])).toEqual({ x: "c" })
    expect(() => mergeAccounts({}, { x: "c" }, ["x"])).toThrow("cannot both set and clear x")
    expect(parseClear("youtube, meta-ads")).toEqual(["youtube", "meta_ads"])
    expect(() => parseClear("myspace")).toThrow("--clear")
  })

  it("names a platform or schedule it does not take", () => {
    expect(parseAbout("reddit, x")).toEqual(["reddit", "x"])
    expect(() => parseAbout("reddit,myspace")).toThrow("myspace")
    expect(parseSchedule("off")).toBe("off")
    expect(() => parseSchedule("hourly")).toThrow("--schedule")
  })
})
