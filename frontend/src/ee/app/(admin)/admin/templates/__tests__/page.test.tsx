import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminWorkflowTemplateRow } from "@/lib/api"

const h = vi.hoisted(() => ({
  listAdminWorkflowTemplates: vi.fn(),
  setAdminTemplateListing: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  listAdminWorkflowTemplates: h.listAdminWorkflowTemplates,
  setAdminTemplateListing: h.setAdminTemplateListing,
}))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }))

import AdminTemplatesPage from "../page"
import { applyListingChange } from "@/ee/hooks/queries/use-admin-templates"

function template(overrides: Partial<AdminWorkflowTemplateRow>): AdminWorkflowTemplateRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "mascot-story-studio-50oy83",
    name: "Mascot Story Studio",
    description: null,
    listedIn: ["marketplace"],
    isListed: true,
    isTutorial: false,
    tutorialCategoryId: null,
    tutorialSortOrder: 0,
    isActive: true,
    category: "social-creatives",
    nodeCount: 31,
    complexity: "advanced",
    previewMediaUrl: "https://cdn.example.com/templates/a/preview.png",
    previewMediaType: "image",
    creatorId: "00000000-0000-4000-8000-0000000000c1",
    creatorDisplayName: "Creator",
    cloneCount: 3,
    favoriteCount: 0,
    createdAt: "2026-09-17T10:54:36Z",
    ...overrides,
  }
}

const LISTED = template({})
const TUTORIAL_ONLY = template({
  id: "00000000-0000-4000-8000-000000000002",
  slug: "steal-the-format-x1",
  name: "Steal the Format",
  listedIn: ["tutorial"],
  isListed: false,
  isTutorial: true,
  previewMediaUrl: null,
  previewMediaType: null,
})
const OFF = template({
  id: "00000000-0000-4000-8000-000000000003",
  slug: "old-template-x2",
  name: "Old Template",
  isActive: false,
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AdminTemplatesPage />
    </QueryClientProvider>,
  )
}

function switchFor(label: string): HTMLElement {
  return screen.getByRole("switch", { name: label })
}

beforeEach(() => {
  h.listAdminWorkflowTemplates.mockResolvedValue({ data: [LISTED, TUTORIAL_ONLY, OFF], nextCursor: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Admin → Templates", () => {
  it("lists every template with its two switches as the server has them", async () => {
    renderPage()
    expect(await screen.findByText("Mascot Story Studio")).toBeTruthy()
    expect(switchFor("On: Mascot Story Studio").getAttribute("aria-checked")).toBe("true")
    expect(switchFor("In gallery: Mascot Story Studio").getAttribute("aria-checked")).toBe("true")
    expect(switchFor("In gallery: Steal the Format").getAttribute("aria-checked")).toBe("false")
    expect(switchFor("On: Old Template").getAttribute("aria-checked")).toBe("false")
    expect(screen.getByText("Tutorial")).toBeTruthy()
    expect(screen.getByText("No cover")).toBeTruthy()
  })

  it("turns a template off with the admin route, and says so", async () => {
    h.setAdminTemplateListing.mockResolvedValue({ ...LISTED, isActive: false })
    renderPage()
    await userEvent.click(await screen.findByRole("switch", { name: "On: Mascot Story Studio" }))
    expect(h.setAdminTemplateListing).toHaveBeenCalledWith(LISTED.id, { isActive: false })
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith('"Mascot Story Studio" is off everywhere'))
  })

  it("takes a template out of the gallery without touching its on switch", async () => {
    h.setAdminTemplateListing.mockResolvedValue({ ...LISTED, isListed: false, listedIn: [] })
    renderPage()
    await userEvent.click(await screen.findByRole("switch", { name: "In gallery: Mascot Story Studio" }))
    expect(h.setAdminTemplateListing).toHaveBeenCalledWith(LISTED.id, { isListed: false })
  })

  it("flips the switch at once, and puts it back when the server refuses", async () => {
    let refuse: (error: Error) => void = () => {}
    h.setAdminTemplateListing.mockReturnValue(new Promise((_resolve, reject) => { refuse = reject }))
    renderPage()
    const on = await screen.findByRole("switch", { name: "On: Mascot Story Studio" })
    await userEvent.click(on)
    await waitFor(() => expect(switchFor("On: Mascot Story Studio").getAttribute("aria-checked")).toBe("false"))
    refuse(new Error("Failed to update the template"))
    await waitFor(() => expect(switchFor("On: Mascot Story Studio").getAttribute("aria-checked")).toBe("true"))
    expect(h.toastError).toHaveBeenCalledWith("Failed to update the template")
  })

  it("links to the gallery only templates that open for everyone", async () => {
    renderPage()
    await screen.findByText("Mascot Story Studio")
    const links = screen.getAllByTitle("Open in the gallery").map((a) => a.getAttribute("href"))
    // Listed, and tutorial-only: both open. Off: a "not found" for everyone but its creator.
    expect(links).toEqual([
      "/templates?template=mascot-story-studio-50oy83",
      "/templates?template=steal-the-format-x1",
    ])
  })

  it("loads the next page from the server's cursor", async () => {
    h.listAdminWorkflowTemplates
      .mockResolvedValueOnce({ data: [LISTED], nextCursor: "2026-09-17T10:54:36Z" })
      .mockResolvedValueOnce({ data: [OFF], nextCursor: null })
    renderPage()
    await userEvent.click(await screen.findByRole("button", { name: /Load more/ }))
    expect(await screen.findByText("Old Template")).toBeTruthy()
    expect(h.listAdminWorkflowTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "2026-09-17T10:54:36Z" }),
    )
    expect(screen.queryByRole("button", { name: /Load more/ })).toBeNull()
  })
})

describe("applyListingChange", () => {
  it("keeps the tutorial tag when the template leaves the gallery", () => {
    const both = template({ listedIn: ["marketplace", "tutorial"], isTutorial: true })
    expect(applyListingChange(both, { templateId: both.id, isListed: false })).toMatchObject({
      isListed: false,
      listedIn: ["tutorial"],
      isTutorial: true,
      isActive: true,
    })
  })

  it("leaves other rows and the other switch alone", () => {
    expect(applyListingChange(LISTED, { templateId: OFF.id, isActive: true })).toBe(LISTED)
    expect(applyListingChange(LISTED, { templateId: LISTED.id, isActive: false })).toMatchObject({
      isActive: false,
      isListed: true,
      listedIn: ["marketplace"],
    })
  })
})
