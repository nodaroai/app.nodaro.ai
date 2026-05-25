import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import type { PipelineEntity } from "@/hooks/use-pipeline-entities"

// ─── Mocks (hoisted) ────────────────────────────────────────────────────────

const { mockEntities } = vi.hoisted(() => ({
  mockEntities: { current: [] as PipelineEntity[] },
}))

vi.mock("@/hooks/use-pipeline-entities", () => ({
  usePipelineEntities: () => ({
    data: mockEntities.current,
    isLoading: false,
    refetch: vi.fn(),
  }),
}))

vi.mock("@/lib/pipelines-api", () => ({
  pipelinesApi: {
    approveEntity: vi.fn(),
    rejectEntity: vi.fn(),
    forceApproveImageCriticFailure: vi.fn(),
    retryImageGeneration: vi.fn(),
  },
}))

import { EntityGrid } from "../entity-grid"

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function buildEntity(overrides: Partial<PipelineEntity> = {}): PipelineEntity {
  return {
    id: "e1",
    entity_type: "character",
    entity_key: "hero",
    status: "awaiting_approval",
    main_asset_id: "asset-1",
    main_asset_url: "https://example.com/hero.png",
    metadata: { name: "Hero" },
    variants: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEntities.current = []
})

describe("EntityGrid — Your-Turn banner", () => {
  it("shows banner when manual mode + at least one entity awaiting_approval", () => {
    mockEntities.current = [
      buildEntity({ id: "e1", entity_key: "hero", status: "awaiting_approval" }),
      buildEntity({ id: "e2", entity_key: "sidekick", status: "awaiting_approval" }),
      buildEntity({ id: "e3", entity_key: "villain", status: "approved" }),
    ]
    renderWithClient(
      <EntityGrid
        pipelineId="p1"
        entityType="character"
        title="2. Characters"
        mode="manual"
      />,
    )
    const banner = screen.getByTestId("your-turn-banner")
    expect(banner).toBeInTheDocument()
    // Says "review 2 characters" (plural for 2).
    expect(banner.textContent).toMatch(/review\s+2\s+characters/)
  })

  it("uses singular 'character' for count=1", () => {
    mockEntities.current = [
      buildEntity({ id: "e1", entity_key: "hero", status: "awaiting_approval" }),
    ]
    renderWithClient(
      <EntityGrid
        pipelineId="p1"
        entityType="character"
        title="2. Characters"
        mode="manual"
      />,
    )
    expect(screen.getByTestId("your-turn-banner").textContent).toMatch(
      /review\s+1\s+character\s+below/,
    )
  })

  it("uses the entityType for locations / objects too", () => {
    mockEntities.current = [
      buildEntity({
        id: "e1",
        entity_type: "location",
        entity_key: "study",
        status: "awaiting_approval",
      }),
    ]
    renderWithClient(
      <EntityGrid
        pipelineId="p1"
        entityType="location"
        title="4. Locations"
        mode="manual"
      />,
    )
    expect(screen.getByTestId("your-turn-banner").textContent).toMatch(
      /review\s+1\s+location\s+below/,
    )
  })

  it("hides banner in auto mode (orchestrator owns approvals)", () => {
    mockEntities.current = [
      buildEntity({ id: "e1", entity_key: "hero", status: "awaiting_approval" }),
    ]
    renderWithClient(
      <EntityGrid
        pipelineId="p1"
        entityType="character"
        title="2. Characters"
        mode="auto"
      />,
    )
    expect(screen.queryByTestId("your-turn-banner")).not.toBeInTheDocument()
  })

  it("hides banner when no entity is awaiting_approval", () => {
    mockEntities.current = [
      buildEntity({ id: "e1", entity_key: "hero", status: "generating" }),
      buildEntity({ id: "e2", entity_key: "sidekick", status: "approved" }),
      buildEntity({ id: "e3", entity_key: "villain", status: "failed" }),
    ]
    renderWithClient(
      <EntityGrid
        pipelineId="p1"
        entityType="character"
        title="2. Characters"
        mode="manual"
      />,
    )
    expect(screen.queryByTestId("your-turn-banner")).not.toBeInTheDocument()
  })

  it("shows banner in guided mode (same as manual)", () => {
    mockEntities.current = [
      buildEntity({ id: "e1", entity_key: "hero", status: "awaiting_approval" }),
    ]
    renderWithClient(
      <EntityGrid
        pipelineId="p1"
        entityType="character"
        title="2. Characters"
        mode="guided"
      />,
    )
    expect(screen.getByTestId("your-turn-banner")).toBeInTheDocument()
  })
})
