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

// Track A — "does this DEPLOYMENT have a payer": the fact that decides whether
// a null allowance may be gated on. Mocked rather than provided, because the
// hook is a react-query call and this file renders without a QueryClient.
const mockDeploymentPayer = vi.fn(() => false)
vi.mock("@/hooks/use-billing-surface", () => ({
  useBillingSurface: () => ({
    surface: { deploymentPayer: mockDeploymentPayer() },
    isLoading: false,
  }),
}))

const mockCreditCost = vi.fn(() => ({ data: 2 }))
type TestBalance = {
  total: number
  allowance?: { granted: number; remaining: number; enforced?: boolean } | null
}
const mockUserCredits = vi.fn<() => { data: TestBalance }>(() => ({ data: { total: 100 } }))
vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({
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
  // Mainline unless the case says otherwise.
  mockDeploymentPayer.mockReturnValue(false)
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

  it("applies multiplier to the looked-up cost (e.g. repeatCount)", () => {
    render(<GenerateButton {...defaultProps} multiplier={3} />)
    // base 2 × 3 = 6
    const button = screen.getByTestId("generate-button")
    expect(button.textContent).toContain("(6 credits)")
  })

  it("multiplier compounds with creditOverride (e.g. multi-provider sum × repeats)", () => {
    render(<GenerateButton {...defaultProps} creditOverride={11} multiplier={2} />)
    // 11 (sum) × 2 (repeats) = 22
    const button = screen.getByTestId("generate-button")
    expect(button.textContent).toContain("(22 credits)")
  })

  it("multiplier=1 (default) preserves original cost display", () => {
    render(<GenerateButton {...defaultProps} multiplier={1} />)
    const button = screen.getByTestId("generate-button")
    expect(button.textContent).toContain("(2 credits)")
  })
})

/**
 * Track A (D12, ruling R-A) — the per-node Generate button under a deployment
 * payer.
 *
 * This is the MAIN generate action on a payer instance (config-panel wires it
 * for every generative node) and it was the one client gate Track A's first
 * pass missed: it compared the cost against `total`, which under a payer is a
 * FROZEN signup grant — nothing debits it, nothing tops it up, and the billing
 * account's own top-up lever cannot move it. So the payer could grant a user
 * 10,000 credits, the sidebar would show them, and this button would stay
 * disabled with a tooltip quoting the grant. There is no other gate on that
 * lane: `handleRunSingleNode` has no balance pre-check, so the disabled button
 * IS the refusal.
 *
 * It takes the GATE figure (`spendableCredits().figure`), so the allowance
 * binds only once the server says `enforced` — a button disabled by a
 * visible-but-unenforced allowance would refuse runs the payer's pool pays for.
 * The tooltip quotes the same number the gate used: a tooltip that names a
 * different balance than the one that disabled the button teaches the user to
 * trust neither.
 *
 * And in the pre-flip window it does not compare at ALL (`gateApplies`). The
 * superseded rule fell back to `total` there, which is the frozen grant: a
 * payer granting 10,000 credits would watch this button stay disabled for a
 * 4,000-credit node, over a 1,500 it cannot move, with a tooltip quoting that
 * 1,500 as the balance. A user provisioned before any signup grant landed
 * (`total: 0`) got a permanently dead button on the same reasoning.
 */
describe("GenerateButton and the per-user allowance", () => {
  it("stays ENABLED on an enforced allowance the frozen grant would have refused", () => {
    mockCreditCost.mockReturnValue({ data: 4000 })
    mockUserCredits.mockReturnValue({
      data: { total: 1500, allowance: { granted: 20_000, remaining: 20_000, enforced: true } },
    })
    render(<GenerateButton {...defaultProps} />)
    expect(screen.getByTestId("generate-button")).not.toBeDisabled()
  })

  it("disables on an exhausted ENFORCED allowance even when the grant looks healthy", () => {
    mockCreditCost.mockReturnValue({ data: 2 })
    mockUserCredits.mockReturnValue({
      data: { total: 100_000, allowance: { granted: 400_000, remaining: 1, enforced: true } },
    })
    render(<GenerateButton {...defaultProps} />)
    expect(screen.getByTestId("generate-button")).toBeDisabled()
  })

  it("quotes the gate's own figure in the tooltip, not the frozen grant", () => {
    mockCreditCost.mockReturnValue({ data: 2 })
    mockUserCredits.mockReturnValue({
      data: { total: 100_000, allowance: { granted: 400_000, remaining: 1, enforced: true } },
    })
    render(<GenerateButton {...defaultProps} />)
    const tooltip = screen.getByTestId("tooltip-content")
    expect(tooltip.textContent).toContain("have 1")
    expect(tooltip.textContent).not.toContain("have 100,000")
  })

  it("does NOT gate at all while the allowance is VISIBLE but not enforced", () => {
    // The exact reported consequence: the payer grants 10,000, the sidebar
    // shows 10,000, and the superseded fallback compared this 4,000-credit
    // node against the 1,500 frozen grant and disabled the button.
    mockCreditCost.mockReturnValue({ data: 4000 })
    mockUserCredits.mockReturnValue({
      data: { total: 1500, allowance: { granted: 10_000, remaining: 10_000, enforced: false } },
    })
    render(<GenerateButton {...defaultProps} />)
    expect(screen.getByTestId("generate-button")).not.toBeDisabled()
    // ...and no tooltip quoting a balance nothing debits.
    expect(screen.queryByTestId("tooltip-content")).toBeNull()
  })

  it("leaves a WITHHELD user's button alive: `total: 0` under a payer is not a refusal", () => {
    // A user provisioned before any signup grant landed reads `total: 0`. The
    // superseded rule read that as "broke" and the button died — on an
    // instance where every run is paid for out of the payer's pool.
    mockCreditCost.mockReturnValue({ data: 2 })
    mockUserCredits.mockReturnValue({
      data: { total: 0, allowance: { granted: 10_000, remaining: 10_000, enforced: false } },
    })
    render(<GenerateButton {...defaultProps} />)
    expect(screen.getByTestId("generate-button")).not.toBeDisabled()
  })

  it("does not gate on an allowance with no enforcement flag either", () => {
    // A backend older than the flag is not "assume enforced" — and on a payer
    // instance it is not licence to refuse on the frozen grant.
    mockCreditCost.mockReturnValue({ data: 4000 })
    mockUserCredits.mockReturnValue({
      data: { total: 1500, allowance: { granted: 10_000, remaining: 10_000 } },
    })
    render(<GenerateButton {...defaultProps} />)
    expect(screen.getByTestId("generate-button")).not.toBeDisabled()
  })

  it("MAINLINE still gates on `total`, which is the wallet the run debits", () => {
    // No allowance key at all: the pre-Track-A behaviour must not have moved.
    mockCreditCost.mockReturnValue({ data: 4000 })
    mockUserCredits.mockReturnValue({ data: { total: 1500 } })
    render(<GenerateButton {...defaultProps} />)
    expect(screen.getByTestId("generate-button")).toBeDisabled()
  })

  it("reads an explicit null allowance as 'none applies', never as remaining 0", () => {
    // The payer's own runs: answering 0 would disable every node for the
    // account that owns the pool.
    mockCreditCost.mockReturnValue({ data: 2 })
    mockUserCredits.mockReturnValue({ data: { total: 100_000, allowance: null } })
    render(<GenerateButton {...defaultProps} />)
    expect(screen.getByTestId("generate-button")).not.toBeDisabled()
  })

  it("stays ALIVE on a payer instance when the allowance is null and the grant is short", () => {
    // The unavailable case: on a payer instance `allowance: null` is either the
    // payer's own exemption (D13) or a figure the server could not read, and
    // the body cannot tell them apart. The superseded rule gated on `total` for
    // both, so ONE failed allowance read killed this button for a whole
    // deployment — held there by the server's 15 s balance cache — over a
    // frozen grant the billing account cannot even top up.
    mockDeploymentPayer.mockReturnValue(true)
    mockCreditCost.mockReturnValue({ data: 4000 })
    mockUserCredits.mockReturnValue({ data: { total: 1500, allowance: null } })
    render(<GenerateButton {...defaultProps} />)
    expect(screen.getByTestId("generate-button")).not.toBeDisabled()
    expect(screen.queryByTestId("tooltip-content")).toBeNull()
  })

  it("MAINLINE with a null allowance still gates on `total`", () => {
    // Same body, no payer: `total` is the wallet the run debits and the
    // refusal is honest. The surface flag is what separates the two.
    mockDeploymentPayer.mockReturnValue(false)
    mockCreditCost.mockReturnValue({ data: 4000 })
    mockUserCredits.mockReturnValue({ data: { total: 1500, allowance: null } })
    render(<GenerateButton {...defaultProps} />)
    expect(screen.getByTestId("generate-button")).toBeDisabled()
  })
})
