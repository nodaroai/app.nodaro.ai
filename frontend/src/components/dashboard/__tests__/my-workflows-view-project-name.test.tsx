import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

vi.mock("lucide-react", () => new Proxy({}, { get: (_t, p) => (typeof p === "string" && p !== "then" ? () => null : undefined), has: () => true }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/hooks/use-demo-seed", () => ({ useDemoSeed: () => ({ isSeeding: false }) }))
vi.mock("@/hooks/use-projects-store", () => ({ useProjectsStore: (sel: (s: { deleteWorkflow: () => Promise<void> }) => unknown) => sel({ deleteWorkflow: async () => {} }) }))
vi.mock("./../workflow-thumbnail", () => ({ WorkflowThumbnail: () => null }))
vi.mock("@/hooks/queries/use-my-workflows-queries", () => ({
  useMyWorkflows: () => ({
    isLoading: false,
    data: [
      { id: "w1", name: "Flow A", projectId: "p1", projectName: "My Recent Flows", projectIsDefault: true, thumbnailUrl: null, nodeTypes: null, updatedAt: "2026-09-01T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" },
      { id: "w2", name: "Flow B", projectId: "p2", projectName: "My Recent Flows", projectIsDefault: false, thumbnailUrl: null, nodeTypes: null, updatedAt: "2026-09-01T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" },
    ],
  }),
}))

import { MyWorkflowsView } from "../my-workflows-view"

afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

describe("MyWorkflowsView project caption", () => {
  it("shows the default project's seeded name in the user's language, a regular project's verbatim", () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    render(<MemoryRouter><MyWorkflowsView onCreateWorkflow={() => {}} onMoveWorkflow={() => {}} /></MemoryRouter>)
    expect(screen.getAllByText(translate("he", "projects.defaultName")).length).toBe(1)
    expect(screen.getAllByText("My Recent Flows").length).toBe(1)
  })
})
