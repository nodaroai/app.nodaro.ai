import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { ModelSearchSelect } from "../model-search-select"

vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 0 }))
vi.mock("@/hooks/use-model-credit-range", () => ({ useModelCreditRange: () => undefined }))

// flux is Black Forest Labs' (a published mark), nano-banana-pro is Google's
// (no mark on this instance), and "no-such-model" has no maker at all.
const BFL_MARK = "https://cdn.example/brand/makers/black-forest-labs.svg?v=1"
vi.mock("@/hooks/use-maker-logos", () => ({
  useMakerLogoUrls: () => new Map([["black-forest-labs", "https://cdn.example/brand/makers/black-forest-labs.svg?v=1"]]),
}))

const OPTIONS = [
  { value: "flux", label: "Flux", desc: "Photorealistic" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Detailed" },
  { value: "no-such-model", label: "Mystery", desc: "Unknown" },
]

function openPicker() {
  render(<ModelSearchSelect value="flux" onChange={() => {}} options={OPTIONS} ariaLabel="Model" open onOpenChange={() => {}} />)
}

/** The marks drawn for one maker: each is named by its tooltip. */
const marksOf = (maker: string) => screen.queryAllByTitle(maker)

describe("ModelSearchSelect maker logos", () => {
  afterEach(cleanup)

  it("shows the maker's published mark on its models' rows, named in a tooltip", () => {
    openPicker()
    const marks = marksOf("Black Forest Labs")
    expect(marks.length).toBeGreaterThan(0)
    expect(marks[0]!.querySelector("img")).toHaveAttribute("src", BFL_MARK)
  })

  it("keeps the mark out of the row's accessible name — the label already names the model", () => {
    openPicker()
    const [mark] = marksOf("Black Forest Labs")
    expect(mark).toHaveAttribute("aria-hidden", "true")
    expect(mark!.querySelector("img")).toHaveAttribute("alt", "")
  })

  it("shows the maker's initial when the instance publishes no mark for it", () => {
    openPicker()
    const [initial] = marksOf("Google")
    expect(initial).toHaveTextContent("G")
    expect(initial!.querySelector("img")).toBeNull()
  })

  it("falls back to the initial when the mark fails to load", () => {
    openPicker()
    // The trigger and the open row each draw the mark; break one of them.
    const before = marksOf("Black Forest Labs")
    fireEvent.error(before[0]!.querySelector("img")!)
    const after = marksOf("Black Forest Labs")
    expect(after).toHaveLength(before.length)
    expect(after.filter((m) => m.querySelector("img") === null).map((m) => m.textContent)).toEqual(["B"])
  })

  it("draws nothing for a model with no known maker", () => {
    openPicker()
    expect(screen.getByText("Mystery")).toBeTruthy()
    expect(screen.queryByText("Mystery")!.parentElement!.querySelector("[title]")).toBeNull()
  })

  it("lines the description up under the label, with or without a mark", () => {
    openPicker()
    const withMark = screen.getByText("Photorealistic")
    const withoutMark = screen.getByText("Unknown")
    expect(withMark.className).toContain("ps-[2.875rem]")
    expect(withoutMark.className).toContain("ps-[1.375rem]")
  })

  it("shows the selected model's mark on the trigger", () => {
    render(<ModelSearchSelect value="flux" onChange={() => {}} options={OPTIONS} ariaLabel="Model" />)
    expect(screen.getByLabelText("Model").querySelector("img")).toHaveAttribute("src", BFL_MARK)
  })
})
