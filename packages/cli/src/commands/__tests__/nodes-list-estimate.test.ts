import { describe, it, expect, vi, beforeEach } from "vitest"
import { Command } from "commander"
import { nodeCreditsLabel, nodesCommand } from "../nodes.js"

const nodes = { list: vi.fn() }
const output = vi.hoisted(() => ({ table: vi.fn() }))

vi.mock("../../client.js", () => ({
  buildClient: () => ({ nodes }),
  handleError: (err: unknown) => {
    throw err
  },
}))

vi.mock("../../output.js", async () => {
  const actual = await vi.importActual<typeof import("../../output.js")>("../../output.js")
  return { ...actual, emit: vi.fn(), success: vi.fn(), table: output.table, dim: vi.fn(), detail: vi.fn() }
})

async function runCmd(...args: string[]): Promise<void> {
  const program = new Command().exitOverride()
  program.addCommand(nodesCommand())
  await program.parseAsync(["node", "test", ...args])
}

beforeEach(() => {
  nodes.list.mockReset()
  output.table.mockReset()
})

describe("nodes list", () => {
  it("shows a metered LLM node's estimate as ≈N, and a fixed price as it was", async () => {
    nodes.list.mockResolvedValueOnce({
      data: [
        { type: "llm-chat", label: "Generate Text", category: "ai-text", outputType: "text", creditCost: 3, estimate: true },
        { type: "extract-audio", label: "Extract Audio", category: "processing", outputType: "audio", creditCost: 11 },
        { type: "text-prompt", label: "Text", category: "input", outputType: "text" },
      ],
    })
    await runCmd("nodes", "list")
    const rows = output.table.mock.calls[0]![0] as Array<{ type: string; credits: unknown }>
    expect(rows.map((r) => [r.type, r.credits])).toEqual([["llm-chat", "≈3"], ["extract-audio", 11], ["text-prompt", ""]])
  })

  it("a metered node whose default model has no price shows `unpriced`, never a unit after it", async () => {
    nodes.list.mockResolvedValueOnce({
      data: [{ type: "llm-chat", label: "Generate Text", category: "ai-text", outputType: "text", creditCost: "unpriced" }],
    })
    await runCmd("nodes", "list")
    const rows = output.table.mock.calls[0]![0] as Array<{ type: string; credits: unknown }>
    expect(rows[0]!.credits).toBe("unpriced")
  })
})

describe("nodeCreditsLabel (the node picker)", () => {
  it("≈N cr for an estimate, N cr for a fixed price, unpriced for a model with no price", () => {
    expect(nodeCreditsLabel({ creditCost: 3, estimate: true })).toBe("≈3 cr")
    expect(nodeCreditsLabel({ creditCost: 11 })).toBe("11 cr")
    expect(nodeCreditsLabel({ creditCost: "1-5" })).toBe("1-5 cr")
    expect(nodeCreditsLabel({ creditCost: "unpriced" })).toBe("unpriced")
  })
})
