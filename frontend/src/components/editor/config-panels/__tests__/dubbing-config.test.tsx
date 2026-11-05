// The Dubbing node's settings panel: the content rights box under its Source
// link. The box is the session's (`node-link-rights.ts`), keyed by node and
// link; the declaration it shows is the shared box's own (stubbed here).
import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

vi.mock("@/components/content-rights/rights-declaration-box", () => ({
  RightsDeclarationBox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input type="checkbox" aria-label="rights" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}))

import { DubbingConfig } from "../dubbing-config"
import { clearNodeLinkRights, isNodeLinkRightsTicked, tickNodeLinkRights } from "@/lib/node-link-rights"

const LINK = "https://example.com/talks/keynote"

function renderPanel(data: Record<string, unknown>, nodeId: string | null = "d1") {
  return render(
    <DubbingConfig
      data={{ label: "Dubbing", targetLanguage: "fr", ...data } as never}
      onUpdate={vi.fn()}
      sources={[]}
      fieldMappings={{}}
      onMapField={vi.fn()}
      nodes={[]}
      nodeId={nodeId}
    />,
  )
}

const rightsBox = () => screen.getByRole("checkbox", { name: "rights" }) as HTMLInputElement

afterEach(() => clearNodeLinkRights())

describe("DubbingConfig — the content rights box of the Source link", () => {
  it("shows under a Source link, unticked; ticking it ticks the box for that link on this node, and unticking clears it", () => {
    renderPanel({ sourceUrl: LINK })
    expect(rightsBox().checked).toBe(false)
    fireEvent.click(rightsBox())
    expect(isNodeLinkRightsTicked("d1", LINK)).toBe(true)
    expect(rightsBox().checked).toBe(true)
    fireEvent.click(rightsBox())
    expect(isNodeLinkRightsTicked("d1", LINK)).toBe(false)
  })

  it("a box ticked for another link shows unticked for this one", () => {
    tickNodeLinkRights("d1", "https://example.com/old")
    renderPanel({ sourceUrl: LINK })
    expect(rightsBox().checked).toBe(false)
  })

  it("no Source link, or no node to hold the box: no box", () => {
    renderPanel({})
    expect(screen.queryByRole("checkbox", { name: "rights" })).toBeNull()
    renderPanel({ sourceUrl: LINK }, null)
    expect(screen.queryByRole("checkbox", { name: "rights" })).toBeNull()
  })
})
