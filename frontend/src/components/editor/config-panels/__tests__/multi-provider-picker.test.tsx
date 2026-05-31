import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MultiProviderPicker } from "../multi-provider-picker"

// ModelSearchSelect calls useModelCredits inside each (closed) row; stub it.
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 0 }))

const options = [
  { value: "nano-banana", label: "Nano Banana", desc: "" },
  { value: "gpt-image-2", label: "GPT Image 2", desc: "" },
  { value: "flux", label: "Flux", desc: "" },
] as const

const baseProps = { options }

describe("MultiProviderPicker", () => {
  it("renders one card per selected provider with an X for each", () => {
    render(
      <MultiProviderPicker {...baseProps} providers={["nano-banana", "gpt-image-2"]} onChange={() => {}} />,
    )
    expect(screen.getByRole("button", { name: /remove nano banana/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /remove gpt image 2/i })).toBeInTheDocument()
  })

  it("disables the X on the only card when there's just one provider", () => {
    render(<MultiProviderPicker {...baseProps} providers={["nano-banana"]} onChange={() => {}} />)
    expect(screen.getByRole("button", { name: /remove nano banana/i })).toBeDisabled()
  })

  it("calls onChange with the provider removed when X is clicked", () => {
    const onChange = vi.fn()
    render(
      <MultiProviderPicker {...baseProps} providers={["nano-banana", "gpt-image-2"]} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /remove gpt image 2/i }))
    expect(onChange).toHaveBeenCalledWith(["nano-banana"])
  })

  it("appends the first un-picked option when 'Add another model' is clicked", () => {
    const onChange = vi.fn()
    render(<MultiProviderPicker {...baseProps} providers={["nano-banana"]} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: /add another model/i }))
    expect(onChange).toHaveBeenCalledWith(["nano-banana", "gpt-image-2"])
  })

  it("disables 'Add another model' when all options are already selected", () => {
    render(
      <MultiProviderPicker {...baseProps} providers={["nano-banana", "gpt-image-2", "flux"]} onChange={() => {}} />,
    )
    expect(screen.getByRole("button", { name: /add another model/i })).toBeDisabled()
  })

  it("renders a hint inside each card via renderHint", () => {
    render(
      <MultiProviderPicker
        {...baseProps}
        providers={["nano-banana", "gpt-image-2"]}
        onChange={() => {}}
        renderHint={(p) => <p data-testid={`hint-${p}`}>desc-{p}</p>}
      />,
    )
    expect(screen.getByTestId("hint-nano-banana")).toBeInTheDocument()
    expect(screen.getByTestId("hint-gpt-image-2")).toBeInTheDocument()
  })
})
