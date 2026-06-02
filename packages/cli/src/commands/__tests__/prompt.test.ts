import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { promptCommand } from "../prompt.js"

const mocks = { analyze: vi.fn(), generate: vi.fn(), enhance: vi.fn() }

vi.mock("../../client.js", () => ({
  buildClient: () => ({
    promptHelper: { analyze: mocks.analyze, generate: mocks.generate, enhance: mocks.enhance },
  }),
  handleError: (err: unknown) => { throw err },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), info: vi.fn(), dim: vi.fn(), warn: vi.fn(), table: vi.fn() }
})

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(promptCommand())
  await program.parseAsync(["node", "test", ...args])
}

describe("prompt command", () => {
  beforeEach(() => { for (const m of Object.values(mocks)) m.mockReset() })

  it("analyze forwards node-type + prompt", async () => {
    mocks.analyze.mockResolvedValueOnce({ jobId: "j", questions: [] })
    await runCmd("prompt", "analyze", "--node-type", "generate-image", "--prompt", "a cat", "--json")
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ nodeType: "generate-image", prompt: "a cat" }))
  })

  it("generate maps repeated --selection into WizardSelection[]", async () => {
    mocks.generate.mockResolvedValueOnce({ jobId: "j", prompt: "x" })
    await runCmd("prompt", "generate", "--node-type", "generate-image", "--selection", "subject=cat", "--selection", "lighting=golden hour", "--json")
    const arg = mocks.generate.mock.calls[0][0] as Record<string, unknown>
    expect(arg.selections).toEqual([
      { category: "subject", value: "cat", isCustom: false },
      { category: "lighting", value: "golden hour", isCustom: false },
    ])
  })

  it("generate errors when no --selection given", async () => {
    await expect(runCmd("prompt", "generate", "--node-type", "generate-image", "--json")).rejects.toThrow()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it("enhance forwards node-type + prompt one-shot", async () => {
    mocks.enhance.mockResolvedValueOnce({ jobId: "j", prompt: "cinematic snow leopard" })
    await runCmd("prompt", "enhance", "--node-type", "generate-image", "--prompt", "snow leopard", "--json")
    expect(mocks.enhance).toHaveBeenCalledWith(expect.objectContaining({ nodeType: "generate-image", prompt: "snow leopard" }))
  })
})
