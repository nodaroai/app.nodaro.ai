import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ModelSearchSelect } from "../model-search-select"

// Hook is gated behind hasCredits(); stub it so the closed-state render is pure.
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 0 }))

const OPTIONS = [
  { value: "flux", label: "Flux", desc: "Photorealistic" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Detailed" },
]

describe("ModelSearchSelect", () => {
  it("shows the selected option's label on the trigger", () => {
    render(
      <ModelSearchSelect value="nano-banana-pro" onChange={() => {}} options={OPTIONS} ariaLabel="Model" />,
    )
    expect(screen.getByLabelText("Model")).toHaveTextContent("Nano Banana Pro")
  })

  it("prefers an explicit triggerLabel override", () => {
    render(
      <ModelSearchSelect value="" onChange={() => {}} options={OPTIONS} triggerLabel="3 models" ariaLabel="Model" />,
    )
    expect(screen.getByLabelText("Model")).toHaveTextContent("3 models")
  })
})
