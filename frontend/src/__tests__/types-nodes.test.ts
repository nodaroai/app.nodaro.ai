import { describe, expect, it } from "vitest"
import type { CollectNodeData, SceneNodeData, SceneNodeType } from "../types/nodes"
import { NODE_DEFINITIONS } from "../types/nodes"

describe("CollectNodeData", () => {
  it("CollectNodeData is part of SceneNodeData union", () => {
    const data: SceneNodeData = {
      label: "Collect",
      strategyId: "concat",
      strategyConfig: { separator: "-" },
    } as CollectNodeData
    expect((data as CollectNodeData).strategyId).toBe("concat")
  })

  it("'collect' is in SceneNodeType", () => {
    const t: SceneNodeType = "collect"
    expect(t).toBe("collect")
  })

  it("NODE_DEFINITIONS has an entry for 'collect'", () => {
    expect(NODE_DEFINITIONS.find((n) => n.type === "collect")).toBeTruthy()
  })

  it("NODE_DEFINITIONS 'collect' entry has the expected default strategy", () => {
    const def = NODE_DEFINITIONS.find((n) => n.type === "collect")
    expect(def).toBeDefined()
    const data = def!.defaultData as CollectNodeData
    expect(data.strategyId).toBe("concat")
    expect(data.strategyConfig).toBeDefined()
    expect((data.strategyConfig as { separator?: string }).separator).toBe("\n\n")
  })
})
