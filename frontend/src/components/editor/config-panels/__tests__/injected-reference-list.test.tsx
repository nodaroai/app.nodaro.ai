/**
 * Tests for the unified InjectedReferenceList component.
 *
 * Covers:
 *   - Renders the expected tile count given a fixture.
 *   - Wires the right callback per tile-origin's × button.
 *   - Drag-reorder updates the order via onUpdateReferenceOrder.
 *
 * We mock `@/components/ui/cached-image` because the real one queries an
 * R2-style image proxy and we don't need actual pixels for these assertions.
 */

import { describe, it, expect, vi } from "vitest"
import { render, fireEvent, screen } from "@testing-library/react"
import { InjectedReferenceList } from "../injected-reference-list"
import type { ConnectedReference } from "@nodaro/shared"
import {
  wiredTileId,
  mentionTileId,
  canonicalFallbackTileId,
} from "@/lib/compute-injected-refs"

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: ({ src, alt }: { src: string; alt: string }) => (
    <img data-testid="cached-image" src={src} alt={alt} />
  ),
}))

const wiredUpload: ConnectedReference = {
  id: "node-upload-1",
  defaultName: "Upload 1",
  source: "wired-image",
  url: "https://r2/upload-1.png",
}

const kiraCanonical: ConnectedReference = {
  id: "node-kira",
  defaultName: "Kira",
  source: "wired-character",
  description: "young woman",
  url: "https://r2/kira-portrait.png",
  characterSlug: "kira",
  variantSlug: undefined,
  characterCanonicalDescription: null,
  variantDescription: null,
  variantDisplayName: "canonical",
}

const kiraSmile: ConnectedReference = {
  id: "node-kira_expr_smile",
  defaultName: "Kira / smile",
  source: "wired-character",
  description: "smile",
  url: "https://r2/kira-smile.png",
  characterSlug: "kira",
  variantSlug: "smile",
  characterCanonicalDescription: null,
  variantDescription: "smile variant",
  variantDisplayName: "smile",
}

const adamCanonical: ConnectedReference = {
  id: "node-adam",
  defaultName: "Adam",
  source: "wired-character",
  url: "https://r2/adam-portrait.png",
  characterSlug: "adam",
  variantSlug: undefined,
  variantDisplayName: "canonical",
}

describe("InjectedReferenceList", () => {
  it("renders nothing when there are no tiles and no emptyMessage", () => {
    const { container } = render(
      <InjectedReferenceList
        connectedReferences={[]}
        prompt=""
        onUpdateReferenceOrder={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders empty message when supplied + no tiles", () => {
    render(
      <InjectedReferenceList
        connectedReferences={[]}
        prompt=""
        onUpdateReferenceOrder={() => {}}
        emptyMessage="No refs yet"
        testId="empty-list"
      />,
    )
    expect(screen.getByTestId("empty-list")).toHaveTextContent("No refs yet")
  })

  it("renders one tile per injected ref", () => {
    render(
      <InjectedReferenceList
        connectedReferences={[wiredUpload, kiraCanonical, kiraSmile, adamCanonical]}
        prompt="@kira:1:smile"
        onUpdateReferenceOrder={() => {}}
      />,
    )
    // Tiles: wired-raw upload, mention kira:smile, canonical-fallback adam
    expect(screen.getByTestId(`injected-ref-tile-${wiredTileId("node-upload-1")}`)).toBeInTheDocument()
    expect(screen.getByTestId(`injected-ref-tile-${mentionTileId("kira", "smile")}`)).toBeInTheDocument()
    expect(screen.getByTestId(`injected-ref-tile-${canonicalFallbackTileId("adam")}`)).toBeInTheDocument()
    // No kira-canonical tile because the mention took over.
    expect(screen.queryByTestId(`injected-ref-tile-${canonicalFallbackTileId("kira")}`)).toBeNull()
  })

  it("uses provided primaryLabel + ring on the first tile", () => {
    render(
      <InjectedReferenceList
        connectedReferences={[wiredUpload]}
        prompt=""
        onUpdateReferenceOrder={() => {}}
        primaryLabel="Start frame"
      />,
    )
    expect(screen.getByText("Start frame")).toBeInTheDocument()
  })

  it("× on a wired-raw tile calls onRemoveWiredSource with the node ID", () => {
    const onRemoveWiredSource = vi.fn()
    render(
      <InjectedReferenceList
        connectedReferences={[wiredUpload]}
        prompt=""
        onUpdateReferenceOrder={() => {}}
        onRemoveWiredSource={onRemoveWiredSource}
      />,
    )
    const removeBtn = screen.getByLabelText(/^Remove /)
    fireEvent.click(removeBtn)
    expect(onRemoveWiredSource).toHaveBeenCalledWith("node-upload-1")
  })

  it("× on a mention tile calls onRemoveMention with the token literal", () => {
    const onRemoveMention = vi.fn()
    render(
      <InjectedReferenceList
        connectedReferences={[kiraCanonical, kiraSmile]}
        prompt="@kira:1:smile"
        onUpdateReferenceOrder={() => {}}
        onRemoveMention={onRemoveMention}
      />,
    )
    const removeBtn = screen.getByLabelText(/^Remove /)
    fireEvent.click(removeBtn)
    expect(onRemoveMention).toHaveBeenCalledWith("@kira:1:smile")
  })

  it("× on a canonical-fallback tile calls onSuppressCanonical with the slug", () => {
    const onSuppressCanonical = vi.fn()
    render(
      <InjectedReferenceList
        connectedReferences={[adamCanonical]}
        prompt=""
        onUpdateReferenceOrder={() => {}}
        onSuppressCanonical={onSuppressCanonical}
      />,
    )
    const removeBtn = screen.getByLabelText(/^Remove /)
    fireEvent.click(removeBtn)
    expect(onSuppressCanonical).toHaveBeenCalledWith("adam")
  })

  it("does NOT render × button when the corresponding callback is missing", () => {
    render(
      <InjectedReferenceList
        connectedReferences={[wiredUpload]}
        prompt=""
        onUpdateReferenceOrder={() => {}}
        // omit onRemoveWiredSource
      />,
    )
    expect(screen.queryByLabelText(/^Remove /)).toBeNull()
  })

  it("honors referenceOrder by emitting tiles in that order", () => {
    render(
      <InjectedReferenceList
        connectedReferences={[wiredUpload, kiraCanonical, kiraSmile]}
        prompt="@kira:1:smile"
        referenceOrder={[
          mentionTileId("kira", "smile"),
          wiredTileId("node-upload-1"),
        ]}
        onUpdateReferenceOrder={() => {}}
      />,
    )
    const tiles = screen.getAllByTestId(/^injected-ref-tile-/)
    expect(tiles[0].getAttribute("data-testid")).toBe(
      `injected-ref-tile-${mentionTileId("kira", "smile")}`,
    )
    expect(tiles[1].getAttribute("data-testid")).toBe(
      `injected-ref-tile-${wiredTileId("node-upload-1")}`,
    )
  })

  it("suppresses canonical fallback when slug appears in suppressedCanonicalCharacterIds", () => {
    render(
      <InjectedReferenceList
        connectedReferences={[kiraCanonical, adamCanonical]}
        prompt=""
        suppressedCanonicalCharacterIds={["kira"]}
        onUpdateReferenceOrder={() => {}}
      />,
    )
    expect(
      screen.queryByTestId(`injected-ref-tile-${canonicalFallbackTileId("kira")}`),
    ).toBeNull()
    expect(
      screen.getByTestId(`injected-ref-tile-${canonicalFallbackTileId("adam")}`),
    ).toBeInTheDocument()
  })
})
