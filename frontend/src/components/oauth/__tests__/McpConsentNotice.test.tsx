import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { McpConsentNotice } from "../McpConsentNotice"

describe("McpConsentNotice", () => {
  it("warns about self-claimed name when kind=dynamic_mcp", () => {
    render(<McpConsentNotice kind="dynamic_mcp" clientName="Claude" />)
    expect(screen.getByText(/claimed via MCP/i)).toBeInTheDocument()
  })

  it("renders nothing for kind=user", () => {
    const { container } = render(<McpConsentNotice kind="user" clientName="My App" />)
    expect(container.firstChild).toBeNull()
  })

  it("links to docs/mcp", () => {
    render(<McpConsentNotice kind="dynamic_mcp" clientName="Claude" />)
    const link = screen.getByRole("link", { name: /learn more/i })
    expect(link.getAttribute("href")).toMatch(/\/docs\/mcp/)
  })
})
