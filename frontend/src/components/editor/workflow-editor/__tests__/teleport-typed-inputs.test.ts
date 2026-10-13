import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import { getListFanOutForNode, resolveNodeInputs } from "../node-input-resolver"

// The canvas now lets a Teleport Receive feed typed inputs (audio, image) by
// what its Send carries. A wire that connects must also RUN: through the pair,
// the consumer resolves exactly the inputs the direct wire gives it.

function node(id: string, type: string, data: Record<string, unknown> = {}): any {
  return { id, type, data: { label: id, ...data }, position: { x: 0, y: 0 } }
}

function edge(source: string, sourceHandle: string, target: string, targetHandle: string, data?: Record<string, unknown>): any {
  return { id: `${source}->${target}`, source, sourceHandle, target, targetHandle, data }
}

const LIST = node("o", "list", {
  columns: [{ id: "c1", handleId: "col_c1", type: "text", label: "Items" }],
  rows: [["a red fox"], ["a blue whale"], ["a green frog"]],
})

const CASES = [
  { origin: node("o", "upload-video", { url: "https://cdn.example/v.mp4" }), handle: "video", consumer: "trim-video", input: "in" },
  { origin: node("o", "text-prompt", { text: "a quiet harbour at dawn" }), handle: "text", consumer: "generate-image", input: "prompt" },
  { origin: LIST, handle: "col_c1", consumer: "generate-image", input: "prompt" },
  { origin: node("o", "upload-audio", { url: "https://cdn.example/a.mp3" }), handle: "audio", consumer: "lip-sync", input: "audio" },
  { origin: node("o", "upload-audio", { url: "https://cdn.example/a.mp3" }), handle: "audio", consumer: "mix-audio", input: "in" },
  { origin: node("o", "upload-image", { url: "https://cdn.example/i.png" }), handle: "image", consumer: "generate-image", input: "references" },
  { origin: node("o", "upload-image", { url: "https://cdn.example/i.png" }), handle: "image", consumer: "lip-sync", input: "image" },
]

describe("resolveNodeInputs through a Teleport pair (frontend engine)", () => {
  for (const c of CASES) {
    it(`${c.origin.type} → ${c.consumer}.${c.input} resolves as the direct wire does`, () => {
      const consumer = node("c", c.consumer)
      const direct = resolveNodeInputs(consumer, [c.origin, consumer], [edge("o", c.handle, "c", c.input)])

      const send = node("s", "teleport-send")
      const recv = node("r", "teleport-receive")
      const teleported = resolveNodeInputs(consumer, [c.origin, send, recv, consumer], [
        edge("o", c.handle, "s", "in"),
        edge("s", "out", "r", "in", { teleporter: true }),
        edge("r", "out", "c", c.input),
      ])

      expect(Object.keys(direct).length).toBeGreaterThan(0)
      expect(teleported).toEqual(direct)
    })
  }
})

describe("fan-out through a Teleport pair (frontend engine)", () => {
  it("a list fans the consumer out through the pair, row for row, as it does directly", () => {
    const consumer = node("c", "generate-image")
    const direct = getListFanOutForNode(consumer, [LIST, consumer], [edge("o", "col_c1", "c", "prompt")])
    const send = node("s", "teleport-send")
    const recv = node("r", "teleport-receive")
    const through = getListFanOutForNode(consumer, [LIST, send, recv, consumer], [
      edge("o", "col_c1", "s", "in"),
      edge("s", "out", "r", "in", { teleporter: true }),
      { ...edge("r", "out", "c", "prompt"), id: "o->c" },
    ])
    expect(direct?.items).toEqual(["a red fox", "a blue whale", "a green frog"])
    expect(through).toEqual(direct)
  })
})

describe("the price counts a fan-out through a Teleport pair as the run does", () => {
  it("getFanOutMultiplier through the pair equals the direct wire (3 rows → 3 runs)", async () => {
    const { getFanOutMultiplier } = await import("../types")
    const consumer = node("c", "generate-image")
    const direct = getFanOutMultiplier(consumer, [LIST, consumer], [edge("o", "col_c1", "c", "prompt")])
    const send = node("s", "teleport-send")
    const recv = node("r", "teleport-receive")
    const through = getFanOutMultiplier(consumer, [LIST, send, recv, consumer], [
      edge("o", "col_c1", "s", "in"),
      edge("s", "out", "r", "in", { teleporter: true }),
      { ...edge("r", "out", "c", "prompt"), id: "o->c" },
    ])
    expect(direct).toBe(3)
    expect(through).toBe(direct)
  })
})

describe("the price reads a Settings input through a Teleport pair as the run does", () => {
  it("a Provider sent through the pair prices the same model as a direct wire", async () => {
    const { estimateRunCreditLines } = await import("../estimate-run-credits")
    const image = node("i", "generate-image", { provider: "nano-banana-pro" })
    const provider = node("p", "provider", { category: "image", provider: "seedream" })
    const asked = (nodes: any[], edges: any[]): string[] => {
      const ids: string[] = []
      estimateRunCreditLines([image], nodes, edges, (id) => { ids.push(id); return 10 })
      return ids
    }
    const direct = asked([provider, image], [edge("p", "out", "i", "settings")])
    const through = asked([provider, node("s", "teleport-send"), node("r", "teleport-receive"), image], [
      edge("p", "out", "s", "in"),
      edge("s", "out", "r", "in", { teleporter: true }),
      { ...edge("r", "out", "i", "settings"), id: "p->i" },
    ])
    expect(direct.some((id) => id.startsWith("seedream"))).toBe(true)
    expect(through).toEqual(direct)
  })
})
