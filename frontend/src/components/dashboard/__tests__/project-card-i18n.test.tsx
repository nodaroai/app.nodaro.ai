import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

vi.mock("lucide-react", () => new Proxy({}, { get: (_t, p) => (typeof p === "string" && p !== "then" ? () => null : undefined), has: () => true }))

import { ProjectCard } from "../project-card"

const base = { id: "p1", description: "", createdAt: "", updatedAt: "", settings: {} }
const render_ = (project: { name: string; isDefault: boolean }) =>
  render(<MemoryRouter><ProjectCard project={{ ...base, ...project }} onDelete={() => {}} onRename={async () => {}} /></MemoryRouter>)

afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

describe("ProjectCard in Hebrew", () => {
  it("shows the default project's seeded name in the user's language", () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    render_({ name: "My Recent Flows", isDefault: true })
    expect(screen.getByRole("heading", { name: translate("he", "projects.defaultName") })).toBeTruthy()
    expect(screen.queryByText("My Recent Flows")).toBeNull()
    // The star icon is mocked away; its wrapping span carries the localized title.
    expect(screen.getByTitle(translate("he", "project.autoCreated"))).toBeTruthy()
    expect(screen.getByRole("button", { name: translate("he", "project.optionsFor", { name: translate("he", "projects.defaultName") }) })).toBeTruthy()
  })
  it("keeps a regular project's name verbatim", () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    render_({ name: "My Recent Flows", isDefault: false })
    expect(screen.getByRole("heading", { name: "My Recent Flows" })).toBeTruthy()
  })
})
