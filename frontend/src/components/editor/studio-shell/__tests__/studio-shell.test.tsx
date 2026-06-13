import { useContext } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { StudioShell, StudioNavContext } from "../studio-shell"
import type { StudioNavConfig } from "../types"

function makeConfig(): StudioNavConfig<{ n: number }> {
  return {
    groups: [
      { label: "Group A", pages: [
        { key: "p1", label: "Page One", icon: "1", Component: () => <div>page-one-body</div>, badge: (s) => ({ kind: "count", value: s.n }) },
      ] },
      { label: "Group B", pages: [
        { key: "p2", label: "Page Two", icon: "2", Component: () => <div>page-two-body</div> },
        { key: "secret", label: "Secret", icon: "x", Component: () => <div>secret-body</div>, visible: (c) => c.hasCredits },
      ] },
    ],
  }
}

describe("StudioShell", () => {
  it("renders group labels, the first page by default, and switches pages on click", () => {
    render(<StudioShell config={makeConfig()} state={{ n: 3 }} jobs={{}} hasCredits={false} />)
    expect(screen.getByText("Group A")).toBeTruthy()
    expect(screen.getByText("page-one-body")).toBeTruthy()       // first page active
    expect(screen.getByText("3")).toBeTruthy()                    // count badge
    expect(screen.queryByText("Secret")).toBeNull()               // hidden when !hasCredits
    fireEvent.click(screen.getByText("Page Two"))
    expect(screen.getByText("page-two-body")).toBeTruthy()
  })

  it("shows hasCredits-gated pages when hasCredits is true", () => {
    render(<StudioShell config={makeConfig()} state={{ n: 0 }} jobs={{}} hasCredits />)
    expect(screen.getByText("Secret")).toBeTruthy()
  })

  it("renders a check-kind badge as ✓", () => {
    const config: StudioNavConfig<Record<string, never>> = {
      groups: [
        { label: "G", pages: [
          { key: "p1", label: "Voice", icon: "v", Component: () => <div>voice-body</div>, badge: () => ({ kind: "check" }) },
        ] },
      ],
    }
    render(<StudioShell config={config} state={{}} jobs={{}} hasCredits={false} />)
    expect(screen.getByText("✓")).toBeTruthy()
  })

  it("hides a count badge at 0 and shows it at N", () => {
    const { rerender } = render(<StudioShell config={makeConfig()} state={{ n: 0 }} jobs={{}} hasCredits={false} />)
    // n=0 with no showZero — badge hidden (no "0" rendered)
    expect(screen.queryByText("0")).toBeNull()
    rerender(<StudioShell config={makeConfig()} state={{ n: 5 }} jobs={{}} hasCredits={false} />)
    expect(screen.getByText("5")).toBeTruthy()
  })

  it("lets a page navigate via StudioNavContext", () => {
    const config: StudioNavConfig<Record<string, never>> = {
      groups: [
        { label: "G", pages: [
          {
            key: "p1",
            label: "Page One",
            icon: "1",
            Component: () => {
              const navigate = useContext(StudioNavContext)
              return (
                <button type="button" onClick={() => navigate("p2")}>
                  go-to-two
                </button>
              )
            },
          },
          { key: "p2", label: "Page Two", icon: "2", Component: () => <div>page-two-body</div> },
        ] },
      ],
    }
    render(<StudioShell config={config} state={{}} jobs={{}} hasCredits={false} />)
    expect(screen.getByText("go-to-two")).toBeTruthy()      // first page active
    expect(screen.queryByText("page-two-body")).toBeNull()
    fireEvent.click(screen.getByText("go-to-two"))           // page-driven navigation
    expect(screen.getByText("page-two-body")).toBeTruthy()
  })

  it("opens on the page named by defaultActiveKey", () => {
    render(<StudioShell config={makeConfig()} state={{ n: 0 }} jobs={{}} hasCredits={false} defaultActiveKey="p2" />)
    expect(screen.getByText("page-two-body")).toBeTruthy()   // not the first page
  })

  it("falls back to the first visible page when defaultActiveKey is unknown", () => {
    render(<StudioShell config={makeConfig()} state={{ n: 0 }} jobs={{}} hasCredits={false} defaultActiveKey="nope" />)
    expect(screen.getByText("page-one-body")).toBeTruthy()
  })
})
