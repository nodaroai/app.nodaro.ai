/**
 * The config panel's Latest Results label a Preview (decided 2026-10-05): each
 * tile and the header read the take's OWN stamped quality, never the node's
 * Quality setting; a take with no stamp is not labelled.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, within } from "@testing-library/react"

vi.mock("@/components/presentation/output-cards/shared", () => ({ downloadFile: vi.fn() }))
vi.mock("@/hooks/use-workflow-store", () => {
  const state = { setWorkflowThumbnail: () => {} }
  return { useWorkflowStore: (select: (s: typeof state) => unknown) => select(state) }
})
vi.mock("@/components/editor/save-to-library-button", () => ({ SaveToLibraryButton: () => null }))
vi.mock("@/components/ui/cached-image", () => ({ CachedImage: () => null }))
vi.mock("../job-config-display", () => ({ JobConfigDisplay: () => null }))

import { ResultsGallery } from "../results-gallery"
import { translate } from "@/lib/i18n"

afterEach(cleanup)

const LABEL = translate("en", "node.renderPreviewBadge")
const take = (n: number, quality?: "proxy" | "final") => ({
  url: `https://media.test/take-${n}.mp4`, jobId: `job-${n}`, timestamp: "t", ...(quality ? { quality } : {}),
})

function show(data: Record<string, unknown>) {
  render(<ResultsGallery nodeId="n1" nodeType="apply-edl" nodeData={{ quality: "final", ...data }} onUpdate={() => {}} />)
}

describe("ResultsGallery — the Preview label", () => {
  it("labels the tile of a take stamped as a Preview, and only that tile", () => {
    show({ generatedResults: [take(1, "proxy"), take(2, "final"), take(3)], activeResultIndex: 1 })
    expect(within(screen.getByRole("button", { name: new RegExp(`^Result 1`) })).getByText(LABEL)).toBeTruthy()
    expect(within(screen.getByRole("button", { name: "Result 2" })).queryByText(LABEL)).toBeNull()
    expect(within(screen.getByRole("button", { name: "Result 3" })).queryByText(LABEL)).toBeNull()
  })

  it("names the Preview in the tile's accessible name (an icon-only tile otherwise hides it)", () => {
    show({ generatedResults: [take(1, "proxy"), take(2, "final")], activeResultIndex: 1 })
    expect(screen.getByRole("button", { name: `Result 1 ${LABEL}` })).toBeTruthy()
  })

  it("labels a single take (no tile grid) beside the title", () => {
    show({ generatedResults: [take(1, "proxy")] })
    expect(screen.getAllByText(LABEL)).toHaveLength(1)
  })

  it("the header follows the take on show, not the node's Quality setting", () => {
    show({ quality: "proxy", generatedResults: [take(1, "proxy"), take(2, "final")], activeResultIndex: 1 })
    const header = screen.getByText(translate("en", "cfgshared.latestResults"))
    expect(within(header).queryByText(LABEL)).toBeNull()
  })

  it("never labels a take with no stamp, whatever the node's setting says", () => {
    show({ quality: "proxy", generatedResults: [take(1), take(2)] })
    expect(screen.queryByText(LABEL)).toBeNull()
  })

  it("never labels another node type's `quality`", () => {
    render(
      <ResultsGallery
        nodeId="n1"
        nodeType="generate-video"
        nodeData={{ generatedResults: [{ url: "https://media.test/a.mp4", quality: "proxy" }, { url: "https://media.test/b.mp4" }] }}
        onUpdate={() => {}}
      />,
    )
    expect(screen.queryByText(LABEL)).toBeNull()
  })
})
