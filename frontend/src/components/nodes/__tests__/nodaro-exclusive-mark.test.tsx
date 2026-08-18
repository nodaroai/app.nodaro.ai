/**
 * The NODARO provenance mark (4b). What must hold on a SELF-HOST build:
 *   - the five exclusive types wear the mark, ordinary nodes don't;
 *   - the node-card header chip resolves its type from the store by id and
 *     renders the quiet pill while connected / still checking, and the
 *     CONNECT CTA (→ /integrations) when the install is not connected.
 * On cloud nothing renders anywhere (exclusives are native there).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"

const editionMock = vi.hoisted(() => ({ hasCredits: vi.fn(() => false) }))
vi.mock("@/lib/edition", () => ({ hasCredits: editionMock.hasCredits, isCloud: () => false }))

const connMock = vi.hoisted(() => ({
  useNodaroConnection: vi.fn(() => ({ connected: true, checked: true })),
}))
vi.mock("@/hooks/use-nodaro-connection", () => ({
  useNodaroConnection: connMock.useNodaroConnection,
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  isNodaroExclusiveType,
  showNodaroMark,
  NodaroMark,
  NodaroHeaderChipForNode,
} from "../nodaro-exclusive-mark"

beforeEach(() => {
  editionMock.hasCredits.mockReturnValue(false)
  connMock.useNodaroConnection.mockReturnValue({ connected: true, checked: true })
})

afterEach(() => {
  cleanup()
  act(() => {
    useWorkflowStore.setState({ nodes: [] })
  })
})

describe("membership", () => {
  it("marks exactly the exclusive types", () => {
    for (const t of ["voice-changer-pro", "generate-video-pro", "edit-video-pro", "video-analysis", "video-audit"]) {
      expect(isNodaroExclusiveType(t), t).toBe(true)
      expect(showNodaroMark(t), t).toBe(true)
    }
    expect(showNodaroMark("generate-image")).toBe(false)
    expect(showNodaroMark("generative-pipeline")).toBe(false)
    expect(showNodaroMark(undefined)).toBe(false)
  })

  it("never marks anything on cloud — the nodes are native there", () => {
    editionMock.hasCredits.mockReturnValue(true)
    expect(showNodaroMark("voice-changer-pro")).toBe(false)
  })
})

describe("NodaroMark pill", () => {
  it("renders the brand pill with the provenance tooltip", () => {
    render(<NodaroMark />)
    const pill = screen.getByTitle("Runs on nodaro.ai")
    expect(pill.textContent).toBe("NODARO")
  })
})

describe("NodaroHeaderChipForNode", () => {
  const seed = (type: string) =>
    act(() => {
      useWorkflowStore.setState({
        nodes: [{ id: "n1", type, position: { x: 0, y: 0 }, data: {} } as never],
      })
    })

  it("renders nothing for an ordinary node", () => {
    seed("generate-image")
    const { container } = render(<NodaroHeaderChipForNode nodeId="n1" />)
    expect(container.innerHTML).toBe("")
  })

  it("connected exclusive: the quiet provenance pill", () => {
    seed("generate-video-pro")
    render(<NodaroHeaderChipForNode nodeId="n1" />)
    expect(screen.getByTitle("Runs on nodaro.ai").textContent).toBe("NODARO")
  })

  it("unconnected exclusive: the pill becomes the connect CTA linking to Integrations", () => {
    connMock.useNodaroConnection.mockReturnValue({ connected: false, checked: true })
    seed("voice-changer-pro")
    render(<NodaroHeaderChipForNode nodeId="n1" />)
    const cta = screen.getByText("CONNECT NODARO") as HTMLAnchorElement
    expect(cta.getAttribute("href")).toBe("/integrations")
    expect(cta.title).toContain("Requires nodaro.ai")
  })

  it("still checking: renders the neutral pill, never a premature CTA", () => {
    connMock.useNodaroConnection.mockReturnValue({ connected: false, checked: false })
    seed("video-audit")
    render(<NodaroHeaderChipForNode nodeId="n1" />)
    expect(screen.getByTitle("Runs on nodaro.ai").textContent).toBe("NODARO")
  })
})
