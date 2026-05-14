import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ReferencePhotosBlock } from "../reference-photos-block"

describe("ReferencePhotosBlock", () => {
  it("renders 7 named slots", () => {
    render(<ReferencePhotosBlock photos={[]} onChange={() => {}} />)
    for (const label of [
      "frontFace",
      "sideLeft",
      "sideRight",
      "threeQuarterLeft",
      "threeQuarterRight",
      "frontBody",
      "other",
    ]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${label} slot$`, "i") }),
      ).toBeInTheDocument()
    }
  })

  it("shows the thumbnail when a slot is filled", () => {
    const photos = [{ url: "https://example.com/a.png", kind: "frontFace" as const }]
    render(<ReferencePhotosBlock photos={photos} onChange={() => {}} />)
    const img = screen.getByAltText("frontFace") as HTMLImageElement
    expect(img.src).toBe("https://example.com/a.png")
  })

  it("calls onChange with the photo removed when delete is clicked", async () => {
    const onChange = vi.fn()
    const photos = [{ url: "x.png", kind: "frontFace" as const }]
    render(<ReferencePhotosBlock photos={photos} onChange={onChange} />)
    await userEvent.click(screen.getByRole("button", { name: /remove frontFace/i }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
