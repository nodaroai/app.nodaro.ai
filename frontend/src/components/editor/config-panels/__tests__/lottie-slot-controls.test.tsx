import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LottieSlotControls } from "../lottie-slot-controls"

// ── Shadcn mocks ─────────────────────────────────────────────────────────────
// Keep DOM primitives plain so we can query inputs by role/value and drive them
// with fireEvent (mirrors reduce-configs.test.tsx idioms).

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor, ...props }: any) => (
    <label htmlFor={htmlFor} {...props}>
      {children}
    </label>
  ),
}))

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}))

// ── Test helpers ─────────────────────────────────────────────────────────────

function makePlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planType: "lottie-graphic",
    slots: {
      primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } }, // → #ff0000
      nameText: { p: "John" }, // bare-string raw slot (Amendment 1)
    },
    slotValues: {},
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("LottieSlotControls", () => {
  it("renders a color input + text input with defaults", () => {
    render(<LottieSlotControls plan={makePlan()} onUpdate={vi.fn()} />)

    const color = screen.getByLabelText(/Primary Color/i) as HTMLInputElement
    expect(color.type).toBe("color")
    expect(color.value).toBe("#ff0000")

    const text = screen.getByDisplayValue("John") as HTMLInputElement
    expect(text).toBeInTheDocument()

    // Humanized sid labels.
    expect(screen.getByText(/Primary Color/i)).toBeInTheDocument()
    expect(screen.getByText(/Name Text/i)).toBeInTheDocument()
  })

  it("writes a text change into motionPlan.slotValues without mutating the original plan", () => {
    const onUpdate = vi.fn()
    const plan = makePlan()
    const planSnapshot = structuredClone(plan)

    render(<LottieSlotControls plan={plan} onUpdate={onUpdate} />)

    const text = screen.getByDisplayValue("John")
    fireEvent.change(text, { target: { value: "Jane" } })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const patch = onUpdate.mock.calls[0][0]
    expect(patch.motionPlan.slotValues.nameText).toBe("Jane")
    // planType + other slot values preserved.
    expect(patch.motionPlan.planType).toBe("lottie-graphic")
    // Original plan object is untouched (immutability).
    expect(plan).toEqual(planSnapshot)
  })

  it("writes a color change as an RGBA array", () => {
    const onUpdate = vi.fn()
    render(<LottieSlotControls plan={makePlan()} onUpdate={onUpdate} />)

    const color = screen.getByLabelText(/Primary Color/i)
    fireEvent.change(color, { target: { value: "#00ff00" } })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const patch = onUpdate.mock.calls[0][0]
    expect(patch.motionPlan.slotValues.primaryColor).toEqual([0, 1, 0, 1])
  })

  it("shows a reset affordance only when an override exists, and removes the key", () => {
    const onUpdate = vi.fn()
    const plan = makePlan({ slotValues: { nameText: "Jane" } })

    render(<LottieSlotControls plan={plan} onUpdate={onUpdate} />)

    const reset = screen.getByRole("button", { name: /reset name text/i })
    fireEvent.click(reset)

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const patch = onUpdate.mock.calls[0][0]
    expect(patch.motionPlan.slotValues).not.toHaveProperty("nameText")
  })

  it("renders nothing when there are no slots", () => {
    const { container } = render(
      <LottieSlotControls plan={{ planType: "lottie-graphic", slots: {} }} onUpdate={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
