import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { accountsFromFlags, competitorsCommand, mergeAccounts, outcomeLine, parseAbout, parseClear, parseSchedule, recordLines } from "../competitors.js"
import { info, success } from "../../output.js"

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
  tried: vi.fn(),
  markDone: vi.fn(),
  linkPost: vi.fn(),
  unmark: vi.fn(),
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
      tried: mocks.tried,
      markDone: mocks.markDone,
      linkPost: mocks.linkPost,
      unmark: mocks.unmark,
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

describe("did it work", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
    vi.mocked(info).mockClear()
    vi.mocked(success).mockClear()
  })

  const action = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    cardId: "sound:c1:7",
    actedAt: "2026-10-04T00:00:00Z",
    onWall: true,
    postUrl: null,
    card: { title: "Sound in 3 of Acme's new videos" },
    outcome: { state: "no_posts_yet" },
    ...over,
  })

  it("done marks a card, with the post's link when given", async () => {
    mocks.markDone.mockResolvedValueOnce({ action: action(), posts: {}, created: true })
    await runCmd("competitors", "done", "sound:c1:7", "--link", "https://www.tiktok.com/@me/video/1")
    expect(mocks.markDone).toHaveBeenCalledWith("sound:c1:7", { postUrl: "https://www.tiktok.com/@me/video/1" })
    expect(vi.mocked(success).mock.calls[0]![0]).toContain("marked (m1)")
  })

  it("tried lists the marks with how each went, and the track record", async () => {
    mocks.tried.mockResolvedValueOnce({
      actions: [action({ outcome: { state: "worked", ratio: 2.1, reach: 8400, usual: 4000, unit: "views", platform: "tiktok" }, postUrl: "https://www.tiktok.com/@me/video/1" })],
      record: [{ family: "sound", tried: 4, worked: 3, flat: 1, missed: 0, avgRatio: 2.1, shown: true, tier: "proven" }],
      posts: {},
    })
    await runCmd("competitors", "tried")
    const lines = vi.mocked(info).mock.calls.map((c) => String(c[0]))
    expect(lines).toContain("Sound advice: 3 of 4 worked for you (on average 2.1x your usual)")
    expect(lines.some((l) => l.includes("worked: 2.1x your usual"))).toBe(true)
    expect(lines.some((l) => l.includes("mark: m1"))).toBe(true)
  })

  it("link links or removes the post, and undo removes the mark", async () => {
    mocks.linkPost.mockResolvedValue({ action: action(), posts: {} })
    await runCmd("competitors", "link", "m1", "https://www.tiktok.com/@me/video/2")
    await runCmd("competitors", "link", "m1", "--remove")
    expect(mocks.linkPost.mock.calls).toEqual([
      ["m1", "https://www.tiktok.com/@me/video/2"],
      ["m1", null],
    ])
    await expect(runCmd("competitors", "link", "m1")).rejects.toThrow(/--remove/)
    mocks.unmark.mockResolvedValueOnce(undefined)
    await runCmd("competitors", "undo", "m1")
    expect(mocks.unmark).toHaveBeenCalledWith("m1")
  })

  it("cards offers done on the cards whose advice is a post of yours", async () => {
    mocks.cards.mockResolvedValueOnce({
      cards: [
        { id: "sound:c1:7", kind: "sound", priority: 2, params: {}, evidence: [], title: "t", why: "w", action: "a" },
        { id: "pace:c1:tiktok", kind: "pace", priority: 3, params: {}, evidence: [], title: "t", why: "w", action: "a" },
      ],
      posts: {},
      record: [],
    })
    await runCmd("competitors", "cards")
    const lines = vi.mocked(info).mock.calls.map((c) => String(c[0]))
    expect(lines.filter((l) => l.includes("nodaro competitors done"))).toEqual(["   did it? nodaro competitors done sound:c1:7 [--link <your post>]"])
  })

  it("phrases every outcome, and only the families with enough verdicts", () => {
    for (const state of ["worked", "flat", "missed", "waiting", "not_found", "older_than_advice", "no_baseline", "posts_since", "no_posts_yet", "no_brand"] as const) {
      expect(outcomeLine({ state, ratio: 1.2 }).length).toBeGreaterThan(5)
    }
    expect(recordLines([{ family: "launch", tried: 1, worked: 1, flat: 0, missed: 0, avgRatio: 3, shown: false, tier: "neutral" }])).toEqual([])
  })
})

describe("post links", () => {
  it("takes a full http(s) link and refuses anything else before calling the server", async () => {
    const { checkPostLink } = await import("../competitors.js")
    expect(checkPostLink(" https://www.tiktok.com/@me/video/1 ")).toBe("https://www.tiktok.com/@me/video/1")
    expect(() => checkPostLink("javascript:alert(1)")).toThrow(/full link/)
    expect(() => checkPostLink("www.tiktok.com/@me/video/1")).toThrow(/full link/)
    mocks.markDone.mockReset()
    await expect(runCmd("competitors", "done", "sound:c1:7", "--link", "not a link")).rejects.toThrow(/full link/)
    expect(mocks.markDone).not.toHaveBeenCalled()
  })
})
