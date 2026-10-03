import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ReferencePhotosBlock } from "../reference-photos-block"

// Each slot is named by its label ("Face", "3/4 L") — never by the internal
// kind id ("frontFace"), which used to reach screen readers and alt text.
describe("ReferencePhotosBlock", () => {
  it("renders 7 named slots", () => {
    render(<ReferencePhotosBlock photos={[]} onChange={() => {}} />)
    for (const label of [
      "Face",
      "Profile L",
      "Profile R",
      "3/4 L",
      "3/4 R",
      "Body",
      "other",
    ]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${label} slot$`, "i") }),
      ).toBeInTheDocument()
    }
    expect(screen.queryByRole("button", { name: /frontFace/ })).not.toBeInTheDocument()
  })

  it("shows the thumbnail when a slot is filled", () => {
    const photos = [{ url: "https://example.com/a.png", kind: "frontFace" as const }]
    render(<ReferencePhotosBlock photos={photos} onChange={() => {}} />)
    const img = screen.getByAltText("Face") as HTMLImageElement
    expect(img.src).toBe("https://example.com/a.png")
  })

  it("calls onChange with the photo removed when delete is clicked", async () => {
    const onChange = vi.fn()
    const photos = [{ url: "x.png", kind: "frontFace" as const }]
    render(<ReferencePhotosBlock photos={photos} onChange={onChange} />)
    await userEvent.click(screen.getByRole("button", { name: /remove face/i }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
