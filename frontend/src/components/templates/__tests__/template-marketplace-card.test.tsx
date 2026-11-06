import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { TemplateBrowseCard } from "@/lib/api"
import { TemplateMarketplaceCard } from "../template-marketplace-card"

const NOW = Date.parse("2026-09-14T12:00:00Z")

const card: TemplateBrowseCard = {
  id: "t1",
  slug: "product-photoshoot",
  name: "Product photoshoot",
  description: "Turns one product photo into a set of studio shots.",
  nodeTypesUsed: ["upload-image", "generate-image"],
  providersUsed: ["flux", "some-new-model"],
  nodeCount: 7,
  estimatedCredits: 120,
  complexity: "simple",
  category: "image-generation",
  outputTypes: ["image"],
  tags: [],
  previewMediaUrl: null,
  previewMediaType: null,
  creatorId: "c",
  creatorDisplayName: "Nodaro",
  cloneCount: 0,
  createdAt: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString(),
  favoriteCount: 0,
}

function renderCard(overrides: Partial<TemplateBrowseCard> = {}) {
  const props = { template: { ...card, ...overrides }, isFavorited: false, onToggleFavorite: vi.fn(), onOpen: vi.fn(), now: NOW }
  render(<TemplateMarketplaceCard {...props} />)
  return props
}

describe("TemplateMarketplaceCard", () => {
  it("opens the template from its name", () => {
    const props = renderCard()
    fireEvent.click(screen.getByRole("button", { name: "Product photoshoot" }))
    expect(props.onOpen).toHaveBeenCalledWith(props.template)
  })

  it("names the models it runs, catalogued ones by their label", () => {
    renderCard()
    expect(screen.getByText("Flux 2 Pro")).toBeInTheDocument()
    expect(screen.getByText("some-new-model")).toBeInTheDocument()
  })

  it("names an image-to-image model by the model alone", () => {
    renderCard({ providersUsed: ["gpt-image-2-i2i"] })
    expect(screen.getByText("GPT Image 2")).toBeInTheDocument()
  })

  it("wears the New badge inside the window and no badge outside it", () => {
    renderCard()
    expect(screen.getByText("New")).toBeInTheDocument()
    render(<TemplateMarketplaceCard template={{ ...card, id: "t2", createdAt: "2025-01-01T00:00:00Z" }} isFavorited={false} onToggleFavorite={vi.fn()} onOpen={vi.fn()} now={NOW} />)
    expect(screen.getAllByText("New")).toHaveLength(1)
  })

  it("shows the node count in the meta line", () => {
    renderCard()
    expect(screen.getByText("7 nodes")).toBeInTheDocument()
  })

  it("toggles the favorite without opening the template", () => {
    const props = renderCard()
    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }))
    expect(props.onToggleFavorite).toHaveBeenCalledWith("t1")
    expect(props.onOpen).not.toHaveBeenCalled()
  })
})
