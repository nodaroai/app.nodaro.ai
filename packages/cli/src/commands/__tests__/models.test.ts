import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { modelsCommand } from "../models.js"
import { emit, table } from "../../output.js"

const mocks = { list: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({ models: mocks }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), table: vi.fn() }
})

const CATALOG = {
  sections: [
    {
      kind: "image",
      families: [
        {
          family: "Tongyi-MAI",
          models: [
            {
              id: "z-image",
              label: "Z-Image",
              maker: { id: "alibaba", name: "Alibaba" },
              logoUrl: "https://cdn.example.com/brand/makers/alibaba.svg?v=0a1b2c3d4e5f6a7b",
              description: "Cheapest model in catalog.",
              modes: ["t2i"],
              useCases: ["fast"],
              pricing: [{ identifier: "z-image", credits: 10 }],
              doctrineCovered: false,
            },
          ],
        },
        {
          family: "Google",
          models: [
            {
              id: "nano-banana-2",
              label: "Nano Banana 2",
              maker: { id: "google", name: "Google" },
              logoUrl: null,
              description: "Fast realistic generation.",
              modes: ["t2i", "i2i"],
              useCases: ["realistic"],
              featured: true,
              doctrineCovered: true,
            },
          ],
        },
      ],
    },
  ],
  recommendations: [],
  totalModels: 2,
}

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(modelsCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("models command", () => {
  beforeEach(() => {
    mocks.list.mockReset()
    vi.mocked(emit).mockReset()
    vi.mocked(table).mockReset()
  })

  it("list forwards the filters", async () => {
    mocks.list.mockResolvedValueOnce(CATALOG)
    await runCmd("models", "list", "--kind", "image", "--mode", "t2i", "--family", "Google", "--featured")
    expect(mocks.list).toHaveBeenCalledWith({ kind: "image", mode: "t2i", family: "Google", featuredOnly: true })
  })

  it("the table shows each model's maker beside its family", async () => {
    mocks.list.mockResolvedValueOnce(CATALOG)
    await runCmd("models", "list")
    const [rows, columns] = vi.mocked(table).mock.calls[0]!
    expect(columns).toEqual(["id", "kind", "family", "maker", "modes", "credits", "featured", "doctrine"])
    expect(rows.map((r) => [r.id, r.family, r.maker])).toEqual([
      ["z-image", "Tongyi-MAI", "Alibaba"],
      ["nano-banana-2", "Google", "Google"],
    ])
  })

  it("--json passes the catalog through whole, maker and logoUrl included", async () => {
    mocks.list.mockResolvedValueOnce(CATALOG)
    await runCmd("models", "list", "--json")
    expect(table).not.toHaveBeenCalled()
    const [emitted] = vi.mocked(emit).mock.calls[0]!
    expect(emitted).toEqual(CATALOG)
    const model = (emitted as typeof CATALOG).sections[0]!.families[0]!.models[0]!
    expect(model.maker).toEqual({ id: "alibaba", name: "Alibaba" })
    expect(model.logoUrl).toBe("https://cdn.example.com/brand/makers/alibaba.svg?v=0a1b2c3d4e5f6a7b")
  })
})
