/**
 * The timezone picker: shows the zone with its current offset, flags a zone
 * the runtime cannot read (an old free-text value) instead of pretending it
 * is UTC, and lets a person search and pick from every zone.
 */
import { describe, it, expect, vi } from "vitest"
import { scaledTimeout } from "../../../../../../tools/vitest/ci-limits.mjs"
import { render, screen, fireEvent } from "@testing-library/react"

import { TimezoneSelect, allTimezones, timezoneOffsetLabel } from "../timezone-select"

describe("TimezoneSelect", () => {
  it("shows the zone and its offset; UTC is always offered", () => {
    render(<TimezoneSelect value="UTC" onChange={vi.fn()} />)
    const trigger = screen.getByRole("combobox", { name: "Timezone" })
    expect(trigger).toHaveTextContent("UTC")
    expect(trigger).toHaveAttribute("aria-invalid", "false")
    expect(allTimezones()[0]).toBe("UTC")
    expect(timezoneOffsetLabel("UTC")).toBe("UTC+0")
    expect(timezoneOffsetLabel("Asia/Kolkata")).toBe("UTC+5:30")
  })

  it("flags a zone the runtime cannot read rather than reading it as UTC", () => {
    render(<TimezoneSelect value="Israel Time" onChange={vi.fn()} />)
    const trigger = screen.getByRole("combobox", { name: "Timezone" })
    expect(trigger).toHaveAttribute("aria-invalid", "true")
    expect(trigger).toHaveTextContent("Israel Time")
    expect(trigger).toHaveTextContent("?")
  })

  it("searching narrows the list and picking a zone reports it", () => {
    // A short list: rendering every zone the browser knows (400+) is slow in
    // jsdom and timed out on CI; the search + pick path is the same.
    const onChange = vi.fn()
    render(<TimezoneSelect value="UTC" onChange={onChange} zones={["UTC", "Asia/Jerusalem", "Europe/London", "America/New_York"]} />)
    fireEvent.click(screen.getByRole("combobox", { name: "Timezone" }))
    const search = screen.getByPlaceholderText("Search timezone…")
    fireEvent.change(search, { target: { value: "jerus" } })
    expect(screen.queryByText("Europe/London")).toBeNull()
    fireEvent.click(screen.getByText("Asia/Jerusalem"))
    expect(onChange).toHaveBeenCalledWith("Asia/Jerusalem")
  }, scaledTimeout(20_000))
})
