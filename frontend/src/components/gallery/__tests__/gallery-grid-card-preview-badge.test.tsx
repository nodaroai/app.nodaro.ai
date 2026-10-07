/**
 * The owner's own gallery view lists Apply EDL renders (decided 2026-10-06): a
 * card for a render made at proxy quality says so. The server marks it
 * (`preview: true`); the card shows the badge, always — not only on hover — and a
 * card with no marker shows none.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("@/components/ui/cached-image", () => ({ CachedImage: () => null }))
vi.mock("@/components/audio-player", () => ({ WaveformAudioPlayer: () => null }))
vi.mock("../gallery-media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gallery-media")>()
  return { ...actual, VideoCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, AudioCard: () => null }
})

import { GalleryGridCard } from "../gallery-grid-card"
import type { GalleryItem } from "@/hooks/queries/use-gallery-queries"
import { translate } from "@/lib/i18n"

afterEach(cleanup)

const LABEL = translate("en", "node.renderPreviewBadge")

const item = (over: Partial<GalleryItem> = {}): GalleryItem => ({
  id: "j1",
  type: "video",
  jobName: "apply-edl",
  outputUrl: "https://media.test/cut.mp4",
  thumbnailUrl: null,
  createdAt: "2026-10-06T10:00:00Z",
  prompt: null,
  model: null,
  ...over,
})

function show(it: GalleryItem) {
  render(
    <GalleryGridCard
      item={it}
      index={0}
      isFavorited={false}
      showFavorite={false}
      isAdmin={false}
      selecting={false}
      selected={false}
      onSelect={() => {}}
      onToggleSelected={() => {}}
      onToggleFavorite={() => {}}
      onReport={() => {}}
      onDelete={() => {}}
    />,
  )
}

describe("GalleryGridCard — the Preview label", () => {
  it("a card the server marked a Preview shows the badge", () => {
    show(item({ preview: true }))
    expect(screen.getByText(LABEL)).toBeTruthy()
  })

  it("a final render, and any other card, shows none", () => {
    show(item())
    expect(screen.queryByText(LABEL)).toBeNull()
    cleanup()
    show(item({ type: "image", jobName: "generate-image" }))
    expect(screen.queryByText(LABEL)).toBeNull()
  })
})
