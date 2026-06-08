import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { communityCommand } from "../community.js"

/**
 * Mocked SDK shape — every method the community command touches needs an
 * impl. The `mocks` constant lives in module scope so each test can reach
 * into it via `mocks.<method>` and assert the calls without threading mocks
 * through commander.
 *
 * Note on `process.exit`: the CLI's `handleError` calls `process.exit(1)` on
 * any thrown error, and we don't want that mid-test. We mock it to throw
 * instead so vitest sees a normal rejection and the test can assert on it.
 */
const mocks = {
  browse: vi.fn(),
  get: vi.fn(),
  favorites: vi.fn(),
  clone: vi.fn(),
  favorite: vi.fn(),
  report: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  sharedListing: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    community: {
      browse: mocks.browse,
      get: mocks.get,
      favorites: mocks.favorites,
      clone: mocks.clone,
      favorite: mocks.favorite,
      report: mocks.report,
      publish: mocks.publish,
      unpublish: mocks.unpublish,
      sharedListing: mocks.sharedListing,
    },
  }),
  handleError: (err: unknown) => {
    // Surface the underlying error to vitest instead of process.exiting.
    throw err
  },
}))

// Don't print anything from `success`/`emit`/etc during the tests.
vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return {
    ...actual,
    emit: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    dim: vi.fn(),
    warn: vi.fn(),
    detail: vi.fn(),
    table: vi.fn(),
  }
})

/**
 * Build a fresh `community` command tree, attach it to a Command program, and
 * dispatch the given argv. Commander parses the first two argv elements as
 * `[node, script]`, so each test's args go AFTER those two placeholders.
 */
async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(communityCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("community command", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
  })

  it("browse with no filters forwards an all-undefined params object", async () => {
    mocks.browse.mockResolvedValueOnce({ data: [], nextCursor: null })
    await runCmd("community", "browse", "--json")
    expect(mocks.browse).toHaveBeenCalledTimes(1)
    expect(mocks.browse).toHaveBeenCalledWith({
      entityType: undefined,
      q: undefined,
      category: undefined,
      sort: undefined,
      limit: undefined,
      cursor: undefined,
    })
  })

  it("browse --entity-type character forwards entityType", async () => {
    mocks.browse.mockResolvedValueOnce({ data: [], nextCursor: null })
    await runCmd("community", "browse", "--entity-type", "character", "--json")
    expect(mocks.browse).toHaveBeenCalledTimes(1)
    expect(mocks.browse.mock.calls[0][0]).toMatchObject({ entityType: "character" })
  })

  it("browse forwards every supplied filter + parses --limit as an int", async () => {
    mocks.browse.mockResolvedValueOnce({ data: [], nextCursor: "tok-2" })
    await runCmd(
      "community",
      "browse",
      "--entity-type",
      "location",
      "--q",
      "forest",
      "--category",
      "nature",
      "--sort",
      "popular",
      "--limit",
      "25",
      "--cursor",
      "tok-1",
      "--json",
    )
    expect(mocks.browse).toHaveBeenCalledWith({
      entityType: "location",
      q: "forest",
      category: "nature",
      sort: "popular",
      limit: 25,
      cursor: "tok-1",
    })
  })

  it("browse rejects an invalid --entity-type", async () => {
    await expect(
      runCmd("community", "browse", "--entity-type", "bogus", "--json"),
    ).rejects.toThrow(/invalid --type/)
    expect(mocks.browse).not.toHaveBeenCalled()
  })

  it("browse rejects an invalid --sort", async () => {
    await expect(
      runCmd("community", "browse", "--sort", "trending", "--json"),
    ).rejects.toThrow(/invalid --sort/)
    expect(mocks.browse).not.toHaveBeenCalled()
  })

  it("get <slug> calls community.get with the slug", async () => {
    mocks.get.mockResolvedValueOnce({ data: { slug: "my-slug" } })
    await runCmd("community", "get", "my-slug", "--json")
    expect(mocks.get).toHaveBeenCalledWith("my-slug")
  })

  it("favorites calls community.favorites with no args", async () => {
    mocks.favorites.mockResolvedValueOnce({ data: [] })
    await runCmd("community", "favorites", "--json")
    expect(mocks.favorites).toHaveBeenCalledTimes(1)
    expect(mocks.favorites).toHaveBeenCalledWith()
  })

  it("clone <id> --type forwards (id, entityType) per the SDK signature", async () => {
    mocks.clone.mockResolvedValueOnce({ entityType: "character", id: "new-id" })
    await runCmd("community", "clone", "abc", "--type", "character", "--json")
    expect(mocks.clone).toHaveBeenCalledWith("abc", "character")
  })

  it("clone rejects an invalid --type", async () => {
    await expect(
      runCmd("community", "clone", "abc", "--type", "bogus", "--json"),
    ).rejects.toThrow(/invalid --type/)
    expect(mocks.clone).not.toHaveBeenCalled()
  })

  it("clone without --type triggers commander's requiredOption error", async () => {
    await expect(runCmd("community", "clone", "abc", "--json")).rejects.toThrow()
    expect(mocks.clone).not.toHaveBeenCalled()
  })

  it("favorite <id> toggles via community.favorite", async () => {
    mocks.favorite.mockResolvedValueOnce({ favorited: true })
    await runCmd("community", "favorite", "abc", "--json")
    expect(mocks.favorite).toHaveBeenCalledWith("abc")
  })

  it("report <id> --reason forwards (id, reason)", async () => {
    mocks.report.mockResolvedValueOnce({ ok: true })
    await runCmd("community", "report", "abc", "--reason", "inappropriate", "--json")
    expect(mocks.report).toHaveBeenCalledWith("abc", "inappropriate")
  })

  it("report rejects an invalid --reason", async () => {
    await expect(
      runCmd("community", "report", "abc", "--reason", "bogus", "--json"),
    ).rejects.toThrow(/invalid --reason/)
    expect(mocks.report).not.toHaveBeenCalled()
  })

  it("report without --reason triggers commander's requiredOption error", async () => {
    await expect(runCmd("community", "report", "abc", "--json")).rejects.toThrow()
    expect(mocks.report).not.toHaveBeenCalled()
  })

  it("publish character with --consent + --likeness-consent forwards attestations", async () => {
    mocks.publish.mockResolvedValueOnce({ slug: "my-char", id: "L1" })
    await runCmd(
      "community",
      "publish",
      "character",
      "c1",
      "--title",
      "T",
      "--consent",
      "--likeness-consent",
      "--json",
    )
    expect(mocks.publish).toHaveBeenCalledTimes(1)
    expect(mocks.publish).toHaveBeenCalledWith(
      "character",
      "c1",
      expect.objectContaining({
        title: "T",
        attestation: true,
        likenessAttestation: true,
      }),
    )
  })

  it("publish character without --likeness-consent rejects", async () => {
    await expect(
      runCmd("community", "publish", "character", "c1", "--title", "T", "--consent"),
    ).rejects.toThrow(/likeness-consent/)
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it("publish without --consent rejects", async () => {
    await expect(
      runCmd("community", "publish", "object", "o1", "--title", "T"),
    ).rejects.toThrow(/--consent/)
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it("publish a non-character needs no --likeness-consent", async () => {
    mocks.publish.mockResolvedValueOnce({ slug: "my-loc", id: "L2" })
    await runCmd(
      "community",
      "publish",
      "location",
      "l1",
      "--title",
      "T",
      "--consent",
      "--json",
    )
    expect(mocks.publish).toHaveBeenCalledTimes(1)
    expect(mocks.publish).toHaveBeenCalledWith(
      "location",
      "l1",
      expect.objectContaining({ title: "T", attestation: true }),
    )
  })

  it("publish rejects an invalid entityType", async () => {
    await expect(
      runCmd("community", "publish", "bogus", "x1", "--title", "T", "--consent"),
    ).rejects.toThrow(/invalid --type/)
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it("publish without --title triggers commander's requiredOption error", async () => {
    await expect(
      runCmd("community", "publish", "location", "l1", "--consent", "--json"),
    ).rejects.toThrow()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it("unpublish <listingId> forwards the listing id", async () => {
    mocks.unpublish.mockResolvedValueOnce({ ok: true })
    await runCmd("community", "unpublish", "L1", "--json")
    expect(mocks.unpublish).toHaveBeenCalledWith("L1")
  })

  it("shared-status <entityType> <sourceId> forwards (entityType, sourceId)", async () => {
    mocks.sharedListing.mockResolvedValueOnce({ data: null })
    await runCmd("community", "shared-status", "character", "c1", "--json")
    expect(mocks.sharedListing).toHaveBeenCalledWith("character", "c1")
  })

  it("shared-status rejects an invalid entityType", async () => {
    await expect(
      runCmd("community", "shared-status", "bogus", "c1", "--json"),
    ).rejects.toThrow(/invalid --type/)
    expect(mocks.sharedListing).not.toHaveBeenCalled()
  })
})
