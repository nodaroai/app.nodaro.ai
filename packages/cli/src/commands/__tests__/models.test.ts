import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { costRows, modelsCommand } from "../models.js"
import { emit, table } from "../../output.js"

const mocks = { list: vi.fn() }
const credits = { modelCosts: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({ models: mocks, credits }),
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

describe("models cost", () => {
  beforeEach(() => {
    credits.modelCosts.mockReset()
    vi.mocked(emit).mockReset()
    vi.mocked(table).mockReset()
  })

  const RESULT = {
    data: { "nano-banana-pro": 33, "llm-chat:gemini-3.6-flash": 3 },
    missing: ["mystery-model"],
    errors: ["llm-chat:unpriced-model"],
    errorCodes: { "llm-chat:unpriced-model": { code: "llm_model_unpriced", message: "This model has no price yet." } },
    estimates: ["llm-chat:gemini-3.6-flash"],
  }

  it("asks the batch endpoint for every id and prints an estimate as ≈N", async () => {
    credits.modelCosts.mockResolvedValueOnce(RESULT)
    await runCmd("models", "cost", "nano-banana-pro", "llm-chat:gemini-3.6-flash", "mystery-model", "llm-chat:unpriced-model")
    expect(credits.modelCosts).toHaveBeenCalledWith(["nano-banana-pro", "llm-chat:gemini-3.6-flash", "mystery-model", "llm-chat:unpriced-model"])
    const [rows, columns] = vi.mocked(table).mock.calls[0]!
    expect(columns).toEqual(["id", "credits", "note"])
    expect(rows).toEqual([
      { id: "nano-banana-pro", credits: "33", note: "" },
      { id: "llm-chat:gemini-3.6-flash", credits: "≈3", note: "estimate: charged per token used" },
      { id: "mystery-model", credits: "-", note: "no price on this server" },
      { id: "llm-chat:unpriced-model", credits: "-", note: "This model has no price yet." },
    ])
  })

  it("an older server that sends no estimates prints every figure as fixed", () => {
    expect(costRows(["seedance-2-fast"], { data: { "seedance-2-fast": 40 }, missing: [], errors: [] })).toEqual([
      { id: "seedance-2-fast", credits: "40", note: "" },
    ])
  })

  it("--json passes the server's answer through whole", async () => {
    credits.modelCosts.mockResolvedValueOnce(RESULT)
    await runCmd("models", "cost", "llm-chat:gemini-3.6-flash", "--json")
    expect(table).not.toHaveBeenCalled()
    expect(vi.mocked(emit).mock.calls[0]![0]).toEqual(RESULT)
  })
})
