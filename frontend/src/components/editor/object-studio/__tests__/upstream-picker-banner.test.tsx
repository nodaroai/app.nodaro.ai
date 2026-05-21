import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Mock the catalog getters so the banner's label-resolution path is testable
// regardless of the actual catalog contents in @nodaro/shared. We assert the
// banner falls back to the raw id when a getter returns undefined.
vi.mock("@nodaro/shared", async () => {
  const actual = await vi.importActual<typeof import("@nodaro/shared")>("@nodaro/shared")
  return {
    ...actual,
    getAnimal: (id: string) =>
      id === "wolf" ? { id, label: "Wolf", category: "wild", description: "", promptHint: "" } : undefined,
    getVehicle: (id: string) =>
      id === "muscle-car" ? { id, label: "Muscle Car", category: "ground", description: "", promptHint: "" } : undefined,
    getFurniture: (id: string) =>
      id === "chesterfield-sofa" ? { id, label: "Chesterfield Sofa", category: "seating", description: "", promptHint: "" } : undefined,
    getWeapon: (id: string) =>
      id === "longsword" ? { id, label: "Longsword", category: "melee", description: "", promptHint: "" } : undefined,
  }
})

import { UpstreamPickerBanner } from "../upstream-picker-banner"

describe("UpstreamPickerBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders the 'Legacy picker selection detected' heading", () => {
    render(
      <UpstreamPickerBanner
        selection={{ kind: "furniture", id: "chesterfield-sofa" }}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText(/legacy picker selection detected/i)).toBeInTheDocument()
  })

  it("renders 'Furniture' kind label + 'Chesterfield Sofa' catalog label", () => {
    render(
      <UpstreamPickerBanner
        selection={{ kind: "furniture", id: "chesterfield-sofa" }}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText(/chesterfield sofa/i)).toBeInTheDocument()
    expect(screen.getByText(/furniture picker node/i)).toBeInTheDocument()
  })

  it("renders 'Animal' kind label + 'Wolf' catalog label", () => {
    render(
      <UpstreamPickerBanner
        selection={{ kind: "animal", id: "wolf" }}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText(/^Wolf$/)).toBeInTheDocument()
    expect(screen.getByText(/animal picker node/i)).toBeInTheDocument()
  })

  it("renders 'Vehicle' kind label + 'Muscle Car' catalog label", () => {
    render(
      <UpstreamPickerBanner
        selection={{ kind: "vehicle", id: "muscle-car" }}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText(/muscle car/i)).toBeInTheDocument()
    expect(screen.getByText(/vehicle picker node/i)).toBeInTheDocument()
  })

  it("renders 'Weapon' kind label + 'Longsword' catalog label", () => {
    render(
      <UpstreamPickerBanner
        selection={{ kind: "weapon", id: "longsword" }}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText(/longsword/i)).toBeInTheDocument()
    expect(screen.getByText(/weapon picker node/i)).toBeInTheDocument()
  })

  it("falls back to the raw id when the catalog getter returns undefined", () => {
    render(
      <UpstreamPickerBanner
        selection={{ kind: "animal", id: "nonexistent-creature" }}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText(/nonexistent-creature/)).toBeInTheDocument()
  })

  it("calls onDismiss when the Dismiss button is clicked", () => {
    const onDismiss = vi.fn()
    render(
      <UpstreamPickerBanner
        selection={{ kind: "furniture", id: "chesterfield-sofa" }}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
