import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SpeakerEmphasisPicker, speakerEmphasisAtoms, toggleSpeakerEmphasis } from "../speaker-emphasis-picker"

const OPTIONS = [
  { id: "scale", label: "Scale" },
  { id: "border", label: "Border" },
  { id: "dim", label: "Dim" },
]

describe("emphasis value helpers", () => {
  it("reads the +-joined set, none being empty", () => {
    expect([...speakerEmphasisAtoms("scale+border")]).toEqual(["scale", "border"])
    expect([...speakerEmphasisAtoms("none")]).toEqual([])
    expect([...speakerEmphasisAtoms(undefined)]).toEqual([])
  })

  it("writes the atoms in the options' order, and none when all are off", () => {
    const order = ["scale", "border", "dim"]
    expect(toggleSpeakerEmphasis("scale", "dim", true, order)).toBe("scale+dim")
    expect(toggleSpeakerEmphasis("dim", "scale", true, order)).toBe("scale+dim")
    expect(toggleSpeakerEmphasis("scale+border", "scale", false, order)).toBe("border")
    expect(toggleSpeakerEmphasis("scale", "scale", false, order)).toBe("none")
    expect(toggleSpeakerEmphasis("none", "border", true, order)).toBe("border")
  })
})

describe("SpeakerEmphasisPicker", () => {
  it("is a group of toggles, the set's atoms pressed", () => {
    render(<SpeakerEmphasisPicker options={OPTIONS} value="scale+dim" onChange={() => {}} ariaLabel="Emphasis" />)
    expect(screen.getByRole("group", { name: "Emphasis" })).toBeTruthy()
    expect(screen.getByRole("checkbox", { name: /Scale/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("checkbox", { name: /Border/ })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("checkbox", { name: /Dim/ })).toHaveAttribute("aria-checked", "true")
  })

  it("toggling writes the +-joined set; all off is none", () => {
    const onChange = vi.fn()
    const { rerender } = render(<SpeakerEmphasisPicker options={OPTIONS} value="scale" onChange={onChange} ariaLabel="Emphasis" />)
    fireEvent.click(screen.getByRole("checkbox", { name: /Border/ }))
    expect(onChange).toHaveBeenLastCalledWith("scale+border")
    fireEvent.click(screen.getByRole("checkbox", { name: /Scale/ }))
    expect(onChange).toHaveBeenLastCalledWith("none")
    rerender(<SpeakerEmphasisPicker options={OPTIONS} value="none" onChange={onChange} ariaLabel="Emphasis" />)
    fireEvent.click(screen.getByRole("checkbox", { name: /Dim/ }))
    expect(onChange).toHaveBeenLastCalledWith("dim")
  })

  it("a ruled-out atom says why, is announced as disabled and cannot be toggled", () => {
    const onChange = vi.fn()
    const options = [{ id: "scale", label: "Scale", disabled: true, reason: "In picture-in-picture the swap itself is the emphasis." }, ...OPTIONS.slice(1)]
    render(<SpeakerEmphasisPicker options={options} value="none" onChange={onChange} ariaLabel="Emphasis" />)
    const scale = screen.getByRole("checkbox", { name: /Scale/ })
    expect(scale).toHaveAttribute("aria-disabled", "true")
    expect(scale).toHaveAttribute("title", "In picture-in-picture the swap itself is the emphasis.")
    fireEvent.click(scale)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("checkbox", { name: /Dim/ }))
    expect(onChange).toHaveBeenCalledWith("dim")
  })

  it("a disabled atom that is on can still be turned off", () => {
    const onChange = vi.fn()
    const options = [{ id: "scale", label: "Scale", disabled: true, reason: "x" }, ...OPTIONS.slice(1)]
    render(<SpeakerEmphasisPicker options={options} value="scale" onChange={onChange} ariaLabel="Emphasis" />)
    fireEvent.click(screen.getByRole("checkbox", { name: /Scale/ }))
    expect(onChange).toHaveBeenCalledWith("none")
  })
})
