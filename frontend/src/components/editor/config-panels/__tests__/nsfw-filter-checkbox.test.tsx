import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

const forced = vi.hoisted(() => ({ value: false }))
vi.mock("@/hooks/queries/use-provider-safety-locks", () => ({ useFilterForcedOn: () => forced.value }))
vi.mock("@/lib/i18n", () => ({ useT: () => (key: string) => key }))

import { NsfwFilterCheckbox } from "../nsfw-filter-checkbox"

describe("NsfwFilterCheckbox", () => {
  it("is the node's own choice when no admin forced it", () => {
    forced.value = false
    const onChange = vi.fn()
    render(<NsfwFilterCheckbox id="x" provider="seedance-2" checked={false} onChange={onChange} />)
    const box = screen.getByRole("checkbox") as HTMLInputElement
    expect(box.checked).toBe(false)
    expect(box.disabled).toBe(false)
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(screen.queryByText("vidcfg.nsfwFilterForced")).toBeNull()
  })

  it("shows on and locked when an admin forced the filter, whatever the node has saved", () => {
    forced.value = true
    const onChange = vi.fn()
    render(<NsfwFilterCheckbox id="x" provider="seedance-2" checked={false} onChange={onChange} />)
    const box = screen.getByRole("checkbox") as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
    expect(screen.getByText("vidcfg.nsfwFilterForced")).toBeTruthy()
  })
})
