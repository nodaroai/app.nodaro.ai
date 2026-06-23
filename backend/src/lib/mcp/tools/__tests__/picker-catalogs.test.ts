import { describe, it, expect } from "vitest"
import { registerPickerCatalogs } from "../picker-catalogs.js"

interface Captured {
  name: string
  handler: (args: Record<string, unknown>) => Promise<{
    isError?: boolean
    content: { type: string; text: string }[]
  }>
}

function fakeServer() {
  const tools: Captured[] = []
  const server = {
    registerTool(name: string, _cfg: unknown, handler: Captured["handler"]) {
      tools.push({ name, handler })
    },
  }
  return { server, tools }
}

const session = { userId: "u1", scopes: [] } as never

describe("get_picker_catalog", () => {
  it("registers exactly one tool named get_picker_catalog", () => {
    const { server, tools } = fakeServer()
    registerPickerCatalogs(server as never, session)
    expect(tools.map((t) => t.name)).toEqual(["get_picker_catalog"])
  })

  it("no node_type returns the directory of pickers", async () => {
    const { server, tools } = fakeServer()
    registerPickerCatalogs(server as never, session)
    const res = await tools[0].handler({})
    const body = JSON.parse(res.content[0].text)
    expect(Array.isArray(body.pickers)).toBe(true)
    expect(body.pickers.find((p: { nodeType: string }) => p.nodeType === "setting")).toBeTruthy()
  })

  it("known node_type returns a compact projection by default", async () => {
    const { server, tools } = fakeServer()
    registerPickerCatalogs(server as never, session)
    const res = await tools[0].handler({ node_type: "setting" })
    const body = JSON.parse(res.content[0].text)
    expect(body.nodeType).toBe("setting")
    expect(body.detail).toBe("compact")
    expect(body.options[0].promptHint).toBeUndefined()
  })

  it("unknown node_type returns isError + valid list", async () => {
    const { server, tools } = fakeServer()
    registerPickerCatalogs(server as never, session)
    const res = await tools[0].handler({ node_type: "not-a-picker" })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("setting")
  })
})
