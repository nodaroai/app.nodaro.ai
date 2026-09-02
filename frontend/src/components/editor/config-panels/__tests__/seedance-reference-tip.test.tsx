import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { SeedanceReferenceTip } from "../seedance-reference-tip"
import { translate } from "@/lib/i18n"

describe("SeedanceReferenceTip", () => {
  it("renders the order-is-priority guidance for seedance-2", () => {
    render(<SeedanceReferenceTip provider="seedance-2" />)
    expect(screen.getByText(translate("en", "cfgext.seedTipEmph"))).toBeInTheDocument()
    expect(document.body.textContent).toContain(translate("en", "cfgext.seedTipRest"))
  })

  it("renders for seedance-2-fast and not for other providers", () => {
    const { rerender, container } = render(<SeedanceReferenceTip provider="seedance-2-fast" />)
    expect(screen.getByText(translate("en", "cfgext.seedTipEmph"))).toBeInTheDocument()
    rerender(<SeedanceReferenceTip provider="veo3.1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing without a provider", () => {
    const { container } = render(<SeedanceReferenceTip provider={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
