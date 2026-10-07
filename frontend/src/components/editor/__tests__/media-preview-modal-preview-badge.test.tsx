/**
 * The fullscreen media preview labels a Preview (decided 2026-10-05): the take
 * on show, by the quality its caller read from that take's own stamp.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("@/components/ui/cached-image", () => ({ CachedImage: () => null }))
vi.mock("@/components/audio-player", () => ({ WaveformAudioPlayer: () => null }))

import { MediaPreviewModal } from "../media-preview-modal"
import { translate } from "@/lib/i18n"

beforeEach(() => {
  // jsdom implements neither playback nor its promise.
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve())
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const LABEL = translate("en", "node.renderPreviewBadge")

describe("MediaPreviewModal — the Preview label", () => {
  it("labels one take stamped as a Preview", () => {
    render(<MediaPreviewModal isOpen onClose={() => {}} type="video" url="https://m/a.mp4" quality="proxy" />)
    expect(screen.getByText(LABEL)).toBeTruthy()
  })

  it("does not label a final, or a take with no stamp", () => {
    render(<MediaPreviewModal isOpen onClose={() => {}} type="video" url="https://m/a.mp4" quality="final" />)
    expect(screen.queryByText(LABEL)).toBeNull()
    cleanup()
    render(<MediaPreviewModal isOpen onClose={() => {}} type="video" url="https://m/a.mp4" />)
    expect(screen.queryByText(LABEL)).toBeNull()
  })
})
