import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TriggerBadge } from "../TriggerBadge"

describe("TriggerBadge", () => {
  it("renders 'Manual' for manual trigger", () => {
    render(<TriggerBadge triggerType="manual" />)
    expect(screen.getByText("Manual")).toBeInTheDocument()
  })

  it("renders 'Webhook' for webhook trigger", () => {
    render(<TriggerBadge triggerType="webhook" />)
    expect(screen.getByText("Webhook")).toBeInTheDocument()
  })

  it("renders 'Scheduled' for schedule trigger", () => {
    render(<TriggerBadge triggerType="schedule" />)
    expect(screen.getByText("Scheduled")).toBeInTheDocument()
  })

  it("renders 'App run' for app_run trigger", () => {
    render(<TriggerBadge triggerType="app_run" />)
    expect(screen.getByText("App run")).toBeInTheDocument()
  })

  it("renders 'Single node' for single-node trigger", () => {
    render(<TriggerBadge triggerType="single-node" />)
    expect(screen.getByText("Single node")).toBeInTheDocument()
  })

  it("renders 'via Claude' for mcp + mcpClient='Claude'", () => {
    render(<TriggerBadge triggerType="mcp" mcpClient="Claude" />)
    expect(screen.getByText("via Claude")).toBeInTheDocument()
  })

  it("renders 'via Cursor' for mcp + mcpClient='Cursor'", () => {
    render(<TriggerBadge triggerType="mcp" mcpClient="Cursor" />)
    expect(screen.getByText("via Cursor")).toBeInTheDocument()
  })

  it("falls back to 'via MCP' without mcpClient", () => {
    render(<TriggerBadge triggerType="mcp" />)
    expect(screen.getByText("via MCP")).toBeInTheDocument()
  })

  it("falls back to 'via MCP' when mcpClient is null", () => {
    render(<TriggerBadge triggerType="mcp" mcpClient={null} />)
    expect(screen.getByText("via MCP")).toBeInTheDocument()
  })

  it("uses orange color classes for mcp trigger", () => {
    const { container } = render(<TriggerBadge triggerType="mcp" mcpClient="Claude" />)
    const badge = container.querySelector("span")
    expect(badge?.className).toContain("bg-orange-200")
    expect(badge?.className).toContain("text-orange-800")
  })

  it("falls back to raw value for unknown trigger type", () => {
    render(<TriggerBadge triggerType="custom-trigger-xyz" />)
    expect(screen.getByText("custom-trigger-xyz")).toBeInTheDocument()
  })

  it("applies className prop", () => {
    const { container } = render(<TriggerBadge triggerType="manual" className="my-custom-class" />)
    expect(container.querySelector("span")?.className).toContain("my-custom-class")
  })
})
