import { describe, it, expect } from "vitest"
import { toElkLayoutNode, NODE_LABEL_RESERVE_PX } from "@/hooks/use-elk-layout"

describe("toElkLayoutNode", () => {
  it("reserves vertical room for the floating node label in the height", () => {
    const n = toElkLayoutNode({ id: "a", measured: { width: 300, height: 200 } })
    expect(n.width).toBe(300)
    // The label (absolute -top-6, outside measured height) gets reserved so ELK
    // doesn't pack the node below it into the gap.
    expect(n.height).toBe(200 + NODE_LABEL_RESERVE_PX)
  })

  it("still reserves label room when the node hasn't been measured yet", () => {
    const n = toElkLayoutNode({ id: "b" })
    expect(n.width).toBe(200)
    expect(n.height).toBe(120 + NODE_LABEL_RESERVE_PX)
  })
})
