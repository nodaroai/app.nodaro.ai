import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { palettesCommand } from "../palettes.js"
import { moodboardsCommand } from "../moodboards.js"

const palettes = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }
const moodboards = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({ palettes, moodboards }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), table: vi.fn(), dim: vi.fn(), detail: vi.fn() }
})

const PALETTE = { id: "p1", name: "Harbour", colors: ["#0F4C5C", "#E3B23C"], description: null, createdAt: "", updatedAt: "" }
const BOARD = { id: "m1", name: "Nordic", description: null, images: [{ url: "https://cdn.test/a.png" }], createdAt: "", updatedAt: "" }

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(palettesCommand())
  program.addCommand(moodboardsCommand())
  await program.parseAsync(["node", "test", ...args])
}

beforeEach(() => {
  for (const m of [...Object.values(palettes), ...Object.values(moodboards)]) m.mockReset()
})

describe("palettes command", () => {
  it("list forwards the page options", async () => {
    palettes.list.mockResolvedValueOnce({ data: [PALETTE], nextCursor: null })
    await runCmd("palettes", "list", "--limit", "5", "--cursor", "c1", "--json")
    expect(palettes.list).toHaveBeenCalledWith({ limit: 5, cursor: "c1" })
  })

  it("create splits the colours on commas and spaces", async () => {
    palettes.create.mockResolvedValueOnce(PALETTE)
    await runCmd("palettes", "create", "--name", "Harbour", "--colors", "#0F4C5C, #e3b23c", "--description", "Summer")
    expect(palettes.create).toHaveBeenCalledWith({ name: "Harbour", colors: ["#0F4C5C", "#e3b23c"], description: "Summer" })
  })

  it("update sends only what it was given, and clears the description on request", async () => {
    palettes.update.mockResolvedValue(PALETTE)
    await runCmd("palettes", "update", "p1", "--name", "Dusk")
    expect(palettes.update).toHaveBeenLastCalledWith("p1", { name: "Dusk" })
    await runCmd("palettes", "update", "p1", "--clear-description")
    expect(palettes.update).toHaveBeenLastCalledWith("p1", { description: null })
  })

  it("update with nothing to change refuses without calling the API", async () => {
    await expect(runCmd("palettes", "update", "p1")).rejects.toThrow(/nothing to update/)
    expect(palettes.update).not.toHaveBeenCalled()
  })

  it("get and delete call the API with the id", async () => {
    palettes.get.mockResolvedValueOnce(PALETTE)
    palettes.delete.mockResolvedValueOnce(undefined)
    await runCmd("palettes", "get", "p1", "--json")
    await runCmd("palettes", "delete", "p1")
    expect(palettes.get).toHaveBeenCalledWith("p1")
    expect(palettes.delete).toHaveBeenCalledWith("p1")
  })
})

describe("moodboards command", () => {
  it("create takes repeated --image, with an optional |caption", async () => {
    moodboards.create.mockResolvedValueOnce(BOARD)
    await runCmd(
      "moodboards", "create", "--name", "Nordic", "--description", "Moody interiors",
      "--image", "https://cdn.test/a.png|soft daylight", "--image", "https://cdn.test/b.png",
    )
    expect(moodboards.create).toHaveBeenCalledWith({
      name: "Nordic",
      description: "Moody interiors",
      images: [{ url: "https://cdn.test/a.png", caption: "soft daylight" }, { url: "https://cdn.test/b.png" }],
    })
  })

  it("create needs at least one image", async () => {
    await expect(runCmd("moodboards", "create", "--name", "Nordic")).rejects.toThrow(/--image/)
    expect(moodboards.create).not.toHaveBeenCalled()
  })

  it("update replaces the images it is given", async () => {
    moodboards.update.mockResolvedValueOnce(BOARD)
    await runCmd("moodboards", "update", "m1", "--image", "https://cdn.test/c.png")
    expect(moodboards.update).toHaveBeenCalledWith("m1", { images: [{ url: "https://cdn.test/c.png" }] })
  })

  it("list, get and delete call the API", async () => {
    moodboards.list.mockResolvedValueOnce({ data: [BOARD], nextCursor: null })
    moodboards.get.mockResolvedValueOnce(BOARD)
    moodboards.delete.mockResolvedValueOnce(undefined)
    await runCmd("moodboards", "list")
    await runCmd("moodboards", "get", "m1")
    await runCmd("moodboards", "delete", "m1", "--json")
    expect(moodboards.list).toHaveBeenCalledWith({ limit: undefined, cursor: undefined })
    expect(moodboards.get).toHaveBeenCalledWith("m1")
    expect(moodboards.delete).toHaveBeenCalledWith("m1")
  })
})
