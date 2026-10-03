import { describe, it, expect, vi, beforeEach } from "vitest"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"
import { postFromJson, savedPostsCommand } from "../saved-posts.js"

const mocks = {
  list: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({ savedPosts: mocks }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), table: vi.fn() }
})

const POST = {
  id: "x:1",
  platform: "x",
  url: "https://x.com/maker/status/1",
  text: "a thread opener",
  author: { handle: "maker", name: "Maker" },
  metrics: { likes: 10 },
  media: { kind: "text" },
  hashtags: [],
  extra: {},
}

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(savedPostsCommand())
  await program.parseAsync(["node", "test", ...args])
}

function tempJson(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "saved-posts-"))
  const path = join(dir, "post.json")
  writeFileSync(path, JSON.stringify(value))
  return path
}

describe("saved-posts command", () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset()
  })

  it("list forwards the filters", async () => {
    mocks.list.mockResolvedValueOnce({ data: [], nextCursor: null })
    await runCmd("saved-posts", "list", "--platform", "x", "--tag", "hooks", "--limit", "5", "--json")
    expect(mocks.list).toHaveBeenCalledWith({ platform: "x", tag: "hooks", q: undefined, limit: 5, cursor: undefined })
  })

  it("list refuses an unknown platform before calling the API", async () => {
    await expect(runCmd("saved-posts", "list", "--platform", "myspace")).rejects.toThrow("--platform must be one of")
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it("save reads one post from a list, with a note and repeated tags", async () => {
    mocks.save.mockResolvedValueOnce({ id: "s1", url: POST.url })
    const file = tempJson([{ ...POST, id: "x:0" }, POST])
    await runCmd("saved-posts", "save", "--file", file, "--index", "1", "--note", "good", "--tag", "hooks", "--tag", "threads")
    expect(mocks.save).toHaveBeenCalledWith({ post: POST, note: "good", tags: ["hooks", "threads"], source: "manual" })
  })

  it("update needs something to change, and --clear-tags sends no tags", async () => {
    await expect(runCmd("saved-posts", "update", "s1")).rejects.toThrow("nothing to change")
    mocks.update.mockResolvedValueOnce({ id: "s1" })
    await runCmd("saved-posts", "update", "s1", "--clear-tags")
    expect(mocks.update).toHaveBeenCalledWith("s1", { note: undefined, tags: [] })
  })

  it("delete removes by id", async () => {
    mocks.delete.mockResolvedValueOnce(undefined)
    await runCmd("saved-posts", "delete", "s1")
    expect(mocks.delete).toHaveBeenCalledWith("s1")
  })
})

describe("postFromJson", () => {
  it("takes a single post, or one item of a list", () => {
    expect(postFromJson(POST)).toEqual(POST)
    expect(postFromJson([POST], 0)).toEqual(POST)
  })

  it("says plainly what is wrong with the file", () => {
    expect(() => postFromJson({ id: "nope" })).toThrow("not a Social Search post")
    expect(() => postFromJson([POST], 3)).toThrow("item 3 of the file")
  })
})
