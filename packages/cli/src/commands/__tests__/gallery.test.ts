import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Command } from "commander"
import { galleryCommand } from "../gallery.js"

const mocks = { browse: vi.fn(), toggleFavorite: vi.fn(), favorites: vi.fn() }
const me = vi.fn()
vi.mock("../../client.js", () => ({
  buildClient: () => ({ gallery: mocks, me }),
  handleError: (err: unknown) => {
    throw err
  },
}))

let printed: string[]
beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  me.mockReset()
  printed = []
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    printed.push(String(line))
  })
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    printed.push(String(chunk))
    return true
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

const run = (argv: string[]) => new Command().addCommand(galleryCommand()).parseAsync(["node", "nodaro", ...argv])

describe("nodaro gallery favorite", () => {
  it("toggles the favorite and says which way it went", async () => {
    mocks.toggleFavorite.mockResolvedValueOnce({ favorited: true })
    await run(["gallery", "favorite", "j1"])
    expect(mocks.toggleFavorite).toHaveBeenCalledWith("j1")
    expect(printed.join("\n")).toContain("favorited job j1")

    mocks.toggleFavorite.mockResolvedValueOnce({ favorited: false })
    await run(["gallery", "favorite", "j1"])
    expect(printed.join("\n")).toContain("removed job j1 from your favorites")
  })

  it("prints the result in --json mode", async () => {
    mocks.toggleFavorite.mockResolvedValueOnce({ favorited: true })
    await run(["gallery", "favorite", "j1", "--json"])
    expect(JSON.parse(printed.join("\n"))).toEqual({ favorited: true })
  })
})

describe("nodaro gallery favorites", () => {
  it("lists the favorited job ids, newest first", async () => {
    mocks.favorites.mockResolvedValueOnce(["j2", "j1"])
    await run(["gallery", "favorites"])
    expect(printed).toEqual(["j2", "j1"])
  })

  it("prints the ids as JSON with --json", async () => {
    mocks.favorites.mockResolvedValueOnce(["j2", "j1"])
    await run(["gallery", "favorites", "--json"])
    expect(JSON.parse(printed.join("\n"))).toEqual(["j2", "j1"])
  })
})

describe("nodaro gallery browse", () => {
  it("forwards the filters", async () => {
    mocks.browse.mockResolvedValueOnce({ data: [], nextCursor: null })
    await run(["gallery", "browse", "--type", "video", "--user", "u1", "--limit", "5", "--cursor", "c1", "--json"])
    expect(mocks.browse).toHaveBeenCalledWith({ type: "video", userId: "u1", favoritesOnly: undefined, limit: 5, cursor: "c1" })
    expect(me).not.toHaveBeenCalled()
  })

  it("--favorites lists YOUR favorites: it asks who you are and sends your own id", async () => {
    me.mockResolvedValueOnce({ id: "me-1" })
    mocks.browse.mockResolvedValueOnce({ data: [], nextCursor: null })
    await run(["gallery", "browse", "--favorites", "--json"])
    expect(me).toHaveBeenCalledTimes(1)
    expect(mocks.browse).toHaveBeenCalledWith({ type: undefined, userId: "me-1", favoritesOnly: true, limit: undefined, cursor: undefined })
  })

  it("--favorites cannot be combined with --user (only your own favorites are listed)", async () => {
    await expect(run(["gallery", "browse", "--favorites", "--user", "u1"])).rejects.toThrow(/--favorites/)
    expect(mocks.browse).not.toHaveBeenCalled()
  })

  it("prints a table and the next cursor", async () => {
    mocks.browse.mockResolvedValueOnce({
      data: [{ id: "j1", type: "image", jobName: "generate-image", outputUrl: "https://cdn.example/j1.png", thumbnailUrl: null, createdAt: "2026-10-15T00:00:00Z", prompt: "a red fox", model: null }],
      nextCursor: "2026-10-15T00:00:00Z",
    })
    await run(["gallery", "browse"])
    const out = printed.join("\n")
    expect(out).toContain("https://cdn.example/j1.png")
    expect(out).toContain("--cursor 2026-10-15T00:00:00Z")
  })

  it("refuses an unknown --type before calling the API", async () => {
    await expect(run(["gallery", "browse", "--type", "gif"])).rejects.toThrow(/--type/)
    expect(mocks.browse).not.toHaveBeenCalled()
  })
})
