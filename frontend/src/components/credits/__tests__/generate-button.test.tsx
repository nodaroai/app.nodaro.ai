import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHasCredits = vi.fn(() => true)
vi.mock("@/lib/edition", () => ({
  hasCredits: () => mockHasCredits(),
}))

const mockCreditCost = vi.fn(() => ({ data: 2 }))
const mockUserCredits = vi.fn(() => ({ data: { total: 100 } }))
vi.mock("@/hooks/queries/use-credits-queries", () => ({
  useModelCreditCost: () => mockCreditCost(),
  useUserCredits: () => mockUserCredits(),
}))

vi.mock("lucide-react", () => ({
  Loader2: (props: Record<string, unknown>) =>
    React.createElement("span", { "data-testid": "loader", ...props }),
}))

// Button renders a real <button>, Tooltip renders children only
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    [k: string]: unknown
  }) =>
    React.createElement(
      "button",
      { onClick, disabled, "data-testid": "generate-button", ...rest },
      children,
    ),
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "tooltip-wrapper" }, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "tooltip-content" }, children),
}))

// ---------------------------------------------------------------------------
// Import component under test (after all mocks)
// ---------------------------------------------------------------------------

import { GenerateButton } from "../GenerateButton"

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const defaultProps = {
  onClick: vi.fn(),
  modelIdentifier: "nano-banana",
  userId: "user-1",
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHasCredits.mockReturnValue(true)
  mockCreditCost.mockReturnValue({ data: 2 })
  mockUserCredits.mockReturnValue({ data: { total: 100 } })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GenerateButton", () => {
  it("renders with default label and credit cost display", () => {
    render(<GenerateButton {...defaultProps} />)
    const button = screen.getByTestId("generate-button")
    expect(button.textContent).toContain("Generate")
    expect(button.textContent).toContain("(2 credits)")
  })

  it("disables when insufficient credits", () => {
    mockUserCredits.mockReturnValue({ data: { total: 1 } })
    render(<GenerateButton {...defaultProps} />)
    const button = screen.getByTestId("generate-button")
    expect(button).toBeDisabled()
  })

  it("shows tooltip with need/have when insufficient", () => {
    mockUserCredits.mockReturnValue({ data: { total: 1 } })
    render(<GenerateButton {...defaultProps} />)
    const tooltip = screen.getByTestId("tooltip-content")
    expect(tooltip.textContent).toContain("need 2")
    expect(tooltip.textContent).toContain("have 1")
  })

  it("disables and shows Processing when isRunning=true", () => {
    render(<GenerateButton {...defaultProps} isRunning />)
    const button = screen.getByTestId("generate-button")
    expect(button).toBeDisabled()
    expect(button.textContent).toContain("Processing...")
    expect(screen.getByTestId("loader")).toBeInTheDocument()
  })

  it("hides credit info in community edition", () => {
    mockHasCredits.mockReturnValue(false)
    render(<GenerateButton {...defaultProps} />)
    const button = screen.getByTestId("generate-button")
    expect(button.textContent).not.toContain("credits")
    expect(button.textContent).toContain("Generate")
  })

  it("calls onClick when clicked and enabled", () => {
    const onClick = vi.fn()
    render(<GenerateButton {...defaultProps} onClick={onClick} />)
    fireEvent.click(screen.getByTestId("generate-button"))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("shows singular 'credit' for cost of 1", () => {
    mockCreditCost.mockReturnValue({ data: 1 })
    render(<GenerateButton {...defaultProps} />)
    const button = screen.getByTestId("generate-button")
    expect(button.textContent).toContain("(1 credit)")
    expect(button.textContent).not.toContain("(1 credits)")
  })

  it("renders custom label", () => {
    render(<GenerateButton {...defaultProps} label="Run Task" />)
    const button = screen.getByTestId("generate-button")
    expect(button.textContent).toContain("Run Task")
  })

  it("children override label", () => {
    render(
      <GenerateButton {...defaultProps} label="Generate">
        Custom Child
      </GenerateButton>,
    )
    const button = screen.getByTestId("generate-button")
    expect(button.textContent).toContain("Custom Child")
    expect(button.textContent).not.toContain("Generate")
  })
})
