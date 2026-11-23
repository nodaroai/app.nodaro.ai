/**
 * The direction Suno Add Vocals / Add Instrumental share: the lyrics field only
 * on Add Vocals, and each 0–1 weight unset ("Auto", Suno decides) until moved,
 * with a way back to unset.
 */
import { createContext } from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("@/components/ui/select", () => ({
  MappableFieldCtx: createContext<unknown>(null),
  Select: ({ children, value }: any) => <div data-testid="select" data-value={value}>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SelectValue: () => <span />,
}))
vi.mock("../tag-textarea", () => ({
  TagTextarea: ({ value, onChange, placeholder }: any) => (
    <textarea value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import { SunoAddTrackFields } from "../suno-add-track-fields"

const base = { model: "V6" } as const

describe("SunoAddTrackFields", () => {
  it("shows the lyrics field on Add Vocals only", () => {
    const { container, rerender } = render(<SunoAddTrackFields data={base} onUpdate={() => {}} withPrompt />)
    expect(container.querySelectorAll("textarea")).toHaveLength(2)
    rerender(<SunoAddTrackFields data={base} onUpdate={() => {}} withPrompt={false} />)
    expect(container.querySelectorAll("textarea")).toHaveLength(1)
  })

  it("an unset weight reads Auto and moving it writes a number", () => {
    const onUpdate = vi.fn()
    render(<SunoAddTrackFields data={base} onUpdate={onUpdate} withPrompt={false} />)
    expect(screen.queryByText("Back to Auto")).toBeNull()
    fireEvent.change(screen.getByLabelText("Style Weight"), { target: { value: "0.2" } })
    expect(onUpdate).toHaveBeenCalledWith({ styleWeight: 0.2 })
  })

  it("a set weight, even 0, can go back to Auto (unset)", () => {
    const onUpdate = vi.fn()
    render(<SunoAddTrackFields data={{ ...base, weirdnessConstraint: 0 }} onUpdate={onUpdate} withPrompt={false} />)
    fireEvent.click(screen.getByText("Back to Auto"))
    expect(onUpdate).toHaveBeenCalledWith({ weirdnessConstraint: undefined })
  })

  it("the voice select clears to unset on Auto", () => {
    const { getAllByTestId } = render(<SunoAddTrackFields data={{ ...base, vocalGender: "male" }} onUpdate={() => {}} withPrompt={false} />)
    expect(getAllByTestId("select")[0]!.getAttribute("data-value")).toBe("male")
  })
})
