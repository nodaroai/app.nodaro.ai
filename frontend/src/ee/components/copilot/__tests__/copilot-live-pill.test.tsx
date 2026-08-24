/**
 * The "is it broken?" fix.
 *
 * What is pinned here is the gap the user actually complained about: between
 * pressing send and the first token the panel used to show nothing at all. Each
 * test below is one thing that must be on screen during that gap, or must stop
 * being on screen the moment the turn ends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { CopilotAnswerSkeleton, CopilotLivePill } from "../copilot-live-pill"
import type { CopilotActivity } from "@/ee/lib/copilot/types"

const T0 = 1_700_000_000_000

const activity = (label: string, status: CopilotActivity["status"] = "started"): CopilotActivity => ({
  id: label,
  label,
  note: "",
  status,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

describe("the live pill", () => {
  it("names a step before any tool call has reported one", () => {
    render(<CopilotLivePill activities={[]} startedAt={T0} />)
    expect(screen.getByText("Reading the workflow")).toBeInTheDocument()
  })

  it("follows the newest activity", () => {
    const { rerender } = render(<CopilotLivePill activities={[activity("Reading node docs")]} startedAt={T0} />)
    expect(screen.getByText("Reading node docs")).toBeInTheDocument()

    rerender(
      <CopilotLivePill
        activities={[activity("Reading node docs", "finished"), activity("Wiring connections")]}
        startedAt={T0}
      />,
    )
    expect(screen.getByText("Wiring connections")).toBeInTheDocument()
    expect(screen.queryByText("Reading node docs")).toBeNull()
  })

  it("counts up while the turn runs", () => {
    render(<CopilotLivePill activities={[]} startedAt={T0} />)
    expect(screen.getByText("0:00")).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(screen.getByText("0:05")).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText("1:05")).toBeInTheDocument()
  })

  it("stops counting when it unmounts, leaving no interval behind", () => {
    const { unmount } = render(<CopilotLivePill activities={[]} startedAt={T0} />)
    unmount()
    // A leaked interval is a wake-up every second for the rest of the session.
    expect(vi.getTimerCount()).toBe(0)
  })

  it("hides the clock from screen readers without hiding the step", () => {
    const { container } = render(<CopilotLivePill activities={[activity("Added 3 nodes")]} startedAt={T0} />)
    // The list region announces politely; a clock ticking once a second in it
    // would talk over everything else.
    expect(screen.getByText("0:00")).toHaveAttribute("aria-hidden")
    expect(container.querySelector("[aria-hidden]")).toBeTruthy()
    expect(screen.getByText("Added 3 nodes")).not.toHaveAttribute("aria-hidden")
  })

  it("drops the clock when there is no start time rather than showing a wrong one", () => {
    render(<CopilotLivePill activities={[]} startedAt={null} />)
    expect(screen.getByText("Reading the workflow")).toBeInTheDocument()
    expect(screen.queryByText("0:00")).toBeNull()
  })
})

describe("the answer skeleton", () => {
  it("is decorative, not something a screen reader reads out", () => {
    const { container } = render(<CopilotAnswerSkeleton />)
    expect(container.firstChild).toHaveAttribute("aria-hidden")
  })
})
