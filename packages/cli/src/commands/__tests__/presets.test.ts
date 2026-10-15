import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"
import { presetsCommand } from "../presets.js"

const mocks = {
  list: vi.fn(),
  listFactory: vi.fn(),
  listGroups: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  import: vi.fn(),
  favorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
}

vi.mock("../../client.js", () => ({
  buildClient: () => ({ presets: mocks }),
  handleError: (err: unknown) => {
    throw err
  },
}))

const out = vi.hoisted(() => ({ emit: vi.fn(), table: vi.fn(), success: vi.fn(), detail: vi.fn() }))
vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, ...out }
})

const DIR = mkdtempSync(join(tmpdir(), "nodaro-presets-cli-"))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))

function file(name: string, content: unknown): string {
  const path = join(DIR, name)
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content))
  return path
}

const PRESET = {
  id: "p1",
  nodeType: "generate-image",
  name: "Mine",
  data: { prompt: "x" },
  tags: [],
  sortOrder: 0,
  minReferences: 1,
  needsImage: true,
  previewUrl: null,
  createdAt: "",
  updatedAt: "2026-10-15T10:00:00Z",
}
const GROUP = { id: "g1", nodeType: "generate-image", name: "Looks", kind: "folder", sortOrder: 0, createdAt: "", updatedAt: "" }

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(presetsCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("presets command", () => {
  beforeEach(() => {
    for (const m of [...Object.values(mocks), ...Object.values(out)]) m.mockReset()
  })

  it("list --factory shows how many photos each preset needs and whether it has a preview", async () => {
    mocks.listFactory.mockResolvedValueOnce({
      data: [
        { id: "generate-image/character-board", name: "Character Board", group: "Reference Sheet", data: {}, minReferences: 1, needsImage: true, previewUrl: "https://x/p.webp" },
        { id: "generate-image/cinematic-portrait", name: "Cinematic Portrait", data: {}, minReferences: 0, needsImage: false, previewUrl: null },
      ],
    })
    await runCmd("presets", "list", "--factory", "--node-type", "generate-image")
    expect(mocks.listFactory).toHaveBeenCalledWith("generate-image")
    expect(out.table).toHaveBeenCalledWith(
      [
        { id: "generate-image/character-board", name: "Character Board", group: "Reference Sheet", photos: 1, preview: "yes" },
        { id: "generate-image/cinematic-portrait", name: "Cinematic Portrait", group: "", photos: "", preview: "" },
      ],
      ["id", "name", "group", "photos", "preview"],
    )
  })

  it("list shows your presets", async () => {
    mocks.list.mockResolvedValueOnce([PRESET])
    await runCmd("presets", "list", "--json")
    expect(mocks.list).toHaveBeenCalledWith(undefined)
    expect(out.emit).toHaveBeenCalledWith([PRESET], expect.anything())
  })

  it("create sends the preset, data inline", async () => {
    mocks.create.mockResolvedValueOnce(PRESET)
    await runCmd(
      "presets", "create", "--node-type", "generate-image", "--name", "Mine", "--data", '{"prompt":"x"}',
      "--description", "d", "--group", "g1", "--tag", "a", "--tag", "b", "--preview-url", "https://cdn.example.com/images/j.png",
    )
    expect(mocks.create).toHaveBeenCalledWith({
      nodeType: "generate-image",
      name: "Mine",
      data: { prompt: "x" },
      description: "d",
      groupId: "g1",
      tags: ["a", "b"],
      previewUrl: "https://cdn.example.com/images/j.png",
    })
    expect(out.success).toHaveBeenCalledWith("created preset Mine (p1)")
  })

  it("create reads the data from a file", async () => {
    mocks.create.mockResolvedValueOnce(PRESET)
    await runCmd("presets", "create", "--node-type", "generate-image", "--name", "Mine", "--data-file", file("data.json", { prompt: "from file" }), "--json")
    expect(mocks.create).toHaveBeenCalledWith({ nodeType: "generate-image", name: "Mine", data: { prompt: "from file" } })
    expect(out.emit).toHaveBeenCalledWith(PRESET, expect.anything())
  })

  it("create refuses data that is not a JSON object, without calling the API", async () => {
    await expect(runCmd("presets", "create", "--node-type", "t", "--name", "n", "--data", "[1,2]")).rejects.toThrow(/JSON object/)
    await expect(runCmd("presets", "create", "--node-type", "t", "--name", "n", "--data", "{oops")).rejects.toThrow(/not valid JSON/)
    await expect(runCmd("presets", "create", "--node-type", "t", "--name", "n")).rejects.toThrow(/--data or --data-file/)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("update sends only what changed, with the revision when given", async () => {
    mocks.update.mockResolvedValue(PRESET)
    await runCmd("presets", "update", "p1", "--name", "Renamed", "--expected-updated-at", "2026-10-15T10:00:00Z")
    expect(mocks.update).toHaveBeenLastCalledWith("p1", { name: "Renamed" }, { expectedUpdatedAt: "2026-10-15T10:00:00Z" })
    await runCmd("presets", "update", "p1", "--no-preview-url", "--no-group")
    expect(mocks.update).toHaveBeenLastCalledWith("p1", { previewUrl: null, groupId: null }, {})
    await runCmd("presets", "update", "p1", "--data", '{"prompt":"y"}', "--preview-url", "https://cdn.example.com/images/k.png")
    expect(mocks.update).toHaveBeenLastCalledWith("p1", { data: { prompt: "y" }, previewUrl: "https://cdn.example.com/images/k.png" }, {})
  })

  it("update with nothing to change refuses without calling the API", async () => {
    await expect(runCmd("presets", "update", "p1")).rejects.toThrow(/nothing to update/)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("delete passes the revision when given", async () => {
    mocks.delete.mockResolvedValue({ success: true })
    await runCmd("presets", "delete", "p1")
    expect(mocks.delete).toHaveBeenLastCalledWith("p1", {})
    await runCmd("presets", "delete", "p1", "--expected-updated-at", "2026-10-15T10:00:00Z")
    expect(mocks.delete).toHaveBeenLastCalledWith("p1", { expectedUpdatedAt: "2026-10-15T10:00:00Z" })
  })

  it("import reads the envelope `presets export` writes (runtime keys stripped)", async () => {
    mocks.import.mockResolvedValueOnce({ imported: 1 })
    const path = file("export.json", {
      kind: "nodaro.node-presets",
      version: 1,
      exportedAt: "2026-10-15T10:00:00Z",
      presets: [{ nodeType: "generate-image", name: "A", data: { prompt: "a", generatedResults: [1] } }],
    })
    await runCmd("presets", "import", path)
    expect(mocks.import).toHaveBeenCalledWith([{ nodeType: "generate-image", name: "A", data: { prompt: "a" } }])
    expect(out.success).toHaveBeenCalledWith("imported 1 preset")
  })

  it("import also takes a bare list of presets", async () => {
    mocks.import.mockResolvedValueOnce({ imported: 2 })
    const presets = [
      { nodeType: "generate-image", name: "A", data: { prompt: "a" } },
      { nodeType: "generate-image", name: "B", data: { prompt: "b" }, previewUrl: "https://cdn.example.com/images/b.png" },
    ]
    await runCmd("presets", "import", file("list.json", presets), "--json")
    expect(mocks.import).toHaveBeenCalledWith(presets)
    expect(out.emit).toHaveBeenCalledWith({ imported: 2 }, expect.anything())
  })

  it("import refuses a file that is neither, without calling the API", async () => {
    await expect(runCmd("presets", "import", file("bad.json", { kind: "something-else" }))).rejects.toThrow()
    expect(mocks.import).not.toHaveBeenCalled()
  })

  it("favorites lists; favorite / unfavorite add and remove", async () => {
    mocks.favorites.mockResolvedValueOnce(["generate-image/character-board"])
    mocks.addFavorite.mockResolvedValueOnce({ success: true })
    mocks.removeFavorite.mockResolvedValueOnce({ success: true })
    await runCmd("presets", "favorites", "--node-type", "generate-image", "--json")
    expect(mocks.favorites).toHaveBeenCalledWith("generate-image")
    expect(out.emit).toHaveBeenCalledWith(["generate-image/character-board"], expect.anything())
    await runCmd("presets", "favorite", "generate-image/character-board", "--node-type", "generate-image")
    expect(mocks.addFavorite).toHaveBeenCalledWith({ nodeType: "generate-image", presetId: "generate-image/character-board" })
    await runCmd("presets", "unfavorite", "generate-image/character-board", "--node-type", "generate-image")
    expect(mocks.removeFavorite).toHaveBeenCalledWith({ nodeType: "generate-image", presetId: "generate-image/character-board" })
  })

  it("groups still lists, bare or as `groups list`", async () => {
    mocks.listGroups.mockResolvedValue([GROUP])
    await runCmd("presets", "groups")
    expect(mocks.listGroups).toHaveBeenLastCalledWith(undefined)
    await runCmd("presets", "groups", "--node-type", "generate-image", "--json")
    expect(mocks.listGroups).toHaveBeenLastCalledWith("generate-image")
    expect(out.emit).toHaveBeenLastCalledWith([GROUP], expect.anything())
    await runCmd("presets", "groups", "list", "--node-type", "generate-image")
    expect(mocks.listGroups).toHaveBeenLastCalledWith("generate-image")
  })

  it("groups create / update / delete", async () => {
    mocks.createGroup.mockResolvedValueOnce(GROUP)
    mocks.updateGroup.mockResolvedValueOnce({ ...GROUP, name: "N" })
    mocks.deleteGroup.mockResolvedValueOnce({ success: true })
    await runCmd("presets", "groups", "create", "--node-type", "generate-image", "--name", "Looks", "--kind", "section")
    expect(mocks.createGroup).toHaveBeenCalledWith({ nodeType: "generate-image", name: "Looks", kind: "section" })
    await runCmd("presets", "groups", "update", "g1", "--name", "N", "--sort-order", "2")
    expect(mocks.updateGroup).toHaveBeenCalledWith("g1", { name: "N", sortOrder: 2 })
    await runCmd("presets", "groups", "delete", "g1")
    expect(mocks.deleteGroup).toHaveBeenCalledWith("g1")
  })

  it("groups refuses a bad --kind or --sort-order without calling the API", async () => {
    await expect(runCmd("presets", "groups", "create", "--node-type", "t", "--name", "n", "--kind", "shelf")).rejects.toThrow(/--kind/)
    await expect(runCmd("presets", "groups", "update", "g1", "--sort-order", "two")).rejects.toThrow(/--sort-order/)
    expect(mocks.createGroup).not.toHaveBeenCalled()
    expect(mocks.updateGroup).not.toHaveBeenCalled()
  })
})
