import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { renderNodeRefs } from "../render-node-refs"

describe("renderNodeRefs with fallback", () => {
  it("renders the node value when present (over the fallback)", () => {
    const { container } = render(<>{renderNodeRefs("a {person || man} b", new Map([["person", "dog"]]), "resolved")}</>)
    expect(container.textContent).toBe("a dog b")
  })
  it("renders the fallback when the ref is absent", () => {
    const { container } = render(<>{renderNodeRefs("a {person || man} b", new Map(), "resolved")}</>)
    expect(container.textContent).toBe("a man b")
  })
  it("renders the literal {name} for a no-fallback unresolved ref", () => {
    const { container } = render(<>{renderNodeRefs("a {person} b", new Map(), "resolved")}</>)
    expect(container.textContent).toBe("a {person} b")
  })
})
