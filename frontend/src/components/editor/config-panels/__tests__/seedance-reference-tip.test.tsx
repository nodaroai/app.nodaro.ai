import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { SeedanceReferenceTip } from "../seedance-reference-tip"

describe("SeedanceReferenceTip", () => {
  it("renders the order-is-priority guidance for seedance-2", () => {
    render(<SeedanceReferenceTip provider="seedance-2" />)
    expect(screen.getByText(/Image 1 carries the most\s+weight/i)).toBeInTheDocument()
    expect(screen.getByText(/headshot \+ one full-body/i)).toBeInTheDocument()
  })

  it("renders for seedance-2-fast and not for other providers", () => {
    const { rerender, container } = render(<SeedanceReferenceTip provider="seedance-2-fast" />)
    expect(screen.getByText(/Image 1 carries the most\s+weight/i)).toBeInTheDocument()
    rerender(<SeedanceReferenceTip provider="veo3.1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing without a provider", () => {
    const { container } = render(<SeedanceReferenceTip provider={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
