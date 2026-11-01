import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { JobsFilterBar } from "../jobs-filter-bar"
import { DEFAULT_JOB_FILTERS, type AdminJobFilters } from "../jobs-filters"

type OnChange = Parameters<typeof JobsFilterBar>[0]["onChange"]

const SOURCES = [
  { key: "web:studio", label: "studio", count: 40 },
  { key: "api", label: "api", count: 12 },
]

/** The bar is controlled: hold its filters the way the page does, and record every change. */
function Harness({ initial, onChange }: { initial: AdminJobFilters; onChange: OnChange }) {
  const [filters, setFilters] = useState(initial)
  return (
    <JobsFilterBar
      filters={filters}
      sources={SOURCES}
      onChange={(...args) => {
        onChange(...args)
        setFilters(args[0])
      }}
    />
  )
}

function renderBar(initial: Partial<AdminJobFilters> = {}) {
  const onChange = vi.fn<OnChange>()
  const filters = { ...DEFAULT_JOB_FILTERS, ...initial }
  render(<Harness initial={filters} onChange={onChange} />)
  return { onChange, filters }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("JobsFilterBar", () => {
  it("choosing Video then lip-sync calls onChange with kind+types", async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    await user.click(screen.getByRole("combobox", { name: "Type" }))
    await user.click(screen.getByRole("option", { name: "Video" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, kind: "video", types: [] })

    await user.click(screen.getByRole("button", { name: "Exact types" }))
    await user.click(screen.getByRole("option", { name: "lip-sync" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, kind: "video", types: ["lip-sync"] })
  })

  it("a new kind clears the exact types of the old one", async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar({ kind: "video", types: ["lip-sync"] })
    await user.click(screen.getByRole("combobox", { name: "Type" }))
    await user.click(screen.getByRole("option", { name: "Other" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, kind: "other", types: [] })
  })

  it("a typed exact type is accepted with no kind chosen, lower-cased", async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    await user.click(screen.getByRole("button", { name: "Exact types" }))
    await user.type(screen.getByPlaceholderText("Search or type a type"), "Plugin-Lane")
    await user.click(screen.getByRole("option", { name: 'Use "plugin-lane"' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, types: ["plugin-lane"] })
  })

  it("typed model id is accepted", async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    await user.click(screen.getByRole("button", { name: "Models" }))
    await user.type(screen.getByPlaceholderText("Search or type a model id"), "my-custom-model")
    await user.click(screen.getByRole("option", { name: 'Use "my-custom-model"' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, models: ["my-custom-model"] })
  })

  it("a typed value the server would refuse is not offered", async () => {
    const user = userEvent.setup()
    renderBar()
    await user.click(screen.getByRole("button", { name: "Models" }))
    await user.type(screen.getByPlaceholderText("Search or type a model id"), "bad id!")
    expect(screen.queryByRole("option", { name: /^Use / })).toBeNull()
  })

  it("chip ✕ clears only its filter", async () => {
    const user = userEvent.setup()
    const { onChange, filters } = renderBar({
      status: "failed",
      kind: "video",
      minCredits: 10,
      sources: ["api"],
      q: "cats",
      from: "2026-10-01",
    })
    await user.click(screen.getByRole("button", { name: "Clear Credits ≥ 10" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, minCredits: undefined })
    await user.click(screen.getByRole("button", { name: "Clear Source: api" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, minCredits: undefined, sources: [] })
  })

  it("Clear all keeps view", async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar({ view: "gallery", status: "failed", excludeAdmins: true, line: "Kling", q: "cats" })
    await user.click(screen.getByRole("button", { name: "Clear all" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, view: "gallery" })
  })

  it("credits apply on Enter, and 0 means no filter", async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    const box = screen.getByRole("spinbutton", { name: "Minimum credits" })
    await user.type(box, "25")
    expect(onChange).not.toHaveBeenCalled()
    await user.keyboard("{Enter}")
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, minCredits: 25 })
    await user.clear(box)
    await user.type(box, "0")
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, minCredits: undefined })
  })

  it("search waits 300 ms and ignores 2 chars", () => {
    vi.useFakeTimers()
    const { onChange } = renderBar()
    const box = screen.getByRole("searchbox", { name: "Search" })
    fireEvent.change(box, { target: { value: "ca" } })
    act(() => vi.advanceTimersByTime(1000))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: "cat" } })
    act(() => vi.advanceTimersByTime(299))
    expect(onChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, q: "cat" }, { replace: true })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("cutting an applied search below 3 characters clears it, after the same wait", () => {
    vi.useFakeTimers()
    const { onChange } = renderBar({ q: "cats" })
    const box = screen.getByRole("searchbox", { name: "Search" })
    fireEvent.change(box, { target: { value: "ca" } })
    act(() => vi.advanceTimersByTime(299))
    expect(onChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, q: undefined }, { replace: true })
    // The box keeps what was typed.
    expect((box as HTMLInputElement).value).toBe("ca")
    fireEvent.change(box, { target: { value: "c" } })
    act(() => vi.advanceTimersByTime(1000))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("a short search from the link is kept until the box is edited", () => {
    vi.useFakeTimers()
    const { onChange } = renderBar({ q: "ab" })
    act(() => vi.advanceTimersByTime(1000))
    expect(onChange).not.toHaveBeenCalled()
  })

  it("a job id searches at once-typed length, and emptying the box clears the search", () => {
    vi.useFakeTimers()
    const { onChange } = renderBar()
    const box = screen.getByRole("searchbox", { name: "Search" })
    const id = "0f2459bc-ab25-456a-a80b-96ca9b402722"
    fireEvent.change(box, { target: { value: id } })
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, q: id }, { replace: true })
    fireEvent.change(box, { target: { value: "" } })
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, q: undefined }, { replace: true })
  })

  it("a search keeps a filter changed while it waited", () => {
    vi.useFakeTimers()
    const { onChange } = renderBar({ status: "failed" })
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "cats" } })
    fireEvent.click(screen.getByRole("button", { name: "Clear Status: failed" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, status: undefined })
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, q: "cats" }, { replace: true })
  })

  it("q without from fills the 7-day range", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"))
    renderBar({ q: "cats" })
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-10-25")
    cleanup()
    renderBar({ q: "cats", to: "2026-10-20" })
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-10-13")
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("2026-10-20")
  })

  it("a job id search shows no default range", () => {
    renderBar({ q: "0f2459bc-ab25-456a-a80b-96ca9b402722" })
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("")
  })

  it("picking a source adds its key", async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()
    await user.click(screen.getByRole("button", { name: "Source" }))
    await user.click(screen.getByRole("option", { name: /studio/ }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_JOB_FILTERS, sources: ["web:studio"] })
  })
})
