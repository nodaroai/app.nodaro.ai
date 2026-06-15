import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"

// handle-popover pulls in ReactFlow + dnd-kit at module load; none of it runs
// for NodeMetaLine, but stub the heaviest leaf hooks so the import is cheap.
vi.mock("@xyflow/react", () => ({ useReactFlow: () => ({}) }))

import { NodeMetaLine } from "../handle-popover"

describe("NodeMetaLine — popover secondary line", () => {
  it("shows the node type plus its config summary, joined with ·", () => {
    const { container } = render(
      <NodeMetaLine
        nodeType="mood"
        configSummary={[{ key: "a", value: "Calm" }, { key: "b", value: "Serene" }]}
      />,
    )
    expect(container.textContent).toBe("mood · Calm · Serene")
  })

  it("shows just the type when there is no config", () => {
    const { container } = render(<NodeMetaLine nodeType="generate-image" configSummary={[]} />)
    expect(container.textContent).toBe("generate-image")
  })
})
