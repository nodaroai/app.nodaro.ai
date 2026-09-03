import { translate } from "@/lib/i18n"
import { describe, it, expect, vi, afterEach } from "vitest"
import { act, render, screen, fireEvent } from "@testing-library/react"
import { Position } from "@xyflow/react"
import { useLocaleStore } from "@/lib/locale-store"

/**
 * The React Flow canvas is pinned `direction: ltr` (globals.css), so a node
 * CARD keeps its LTR geometry in every locale — handles, corner controls and
 * the header's [icon][title][chips] row must not mirror. What DOES have to
 * follow the user's language is the TEXT inside the card: a Hebrew title laid
 * out as an LTR run reorders its punctuation and hugs the wrong edge.
 *
 * So `dir` lands on text LEAVES only (`useNodeTextDir`). Putting it on a
 * layout container would inherit into every flex/grid row beneath it and
 * mirror the card — the guards below pin that boundary.
 */

// BaseNode + EditableNodeLabel import only these from @xyflow/react.
vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ id, type }: any) => <div data-testid={`handle-${id}`} data-type={type} />,
  NodeToolbar: ({ children }: any) => <div>{children}</div>,
  NodeResizeControl: ({ position }: any) => <div data-testid="resize-control" data-position={position} />,
  useStore: (sel: any) => sel({ transform: [0, 0, 1], elementsSelectable: true }),
  useUpdateNodeInternals: () => () => {},
  useNodeId: () => "n1",
}))

vi.mock("../custom-handle", () => ({
  CustomHandle: ({ position }: any) => <div data-testid="zoom-handle" data-position={position} />,
}))

vi.mock("@/components/editor/mobile-canvas-context", () => ({
  useMobileCanvas: () => ({ isMobile: false }),
}))

vi.mock("@/hooks/use-alt-key", () => ({
  useAltKeyStore: (selector: any) => selector({ pressed: false }),
}))

vi.mock("@/components/editor/workflow-editor/use-node-insert-animation", () => ({
  useNodeInsertAnimation: () => undefined,
}))

vi.mock("lucide-react", () => new Proxy({} as Record<PropertyKey, unknown>, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? (p: Record<string, unknown>) => <span {...p} /> : undefined),
  has: () => true,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        nodes: [],
        updateNodeWithData: () => {},
        newNodeIds: new Set(),
        clearNewNode: () => {},
        selectedNodeId: null,
        openFullscreenSettings: () => {},
      }),
    { getState: () => ({ nodes: [] }), setState: () => {} },
  ),
}))

import { BaseNode } from "../base-node"
import { EditableNodeLabel } from "../editable-node-label"
import { NodeJobProgress } from "../node-job-progress"

const setLocale = (l: "he" | "en") => act(() => { useLocaleStore.getState().setLocale(l) })
afterEach(() => setLocale("en"))

// Labels with no catalog entry pass through the localizers untranslated, so
// the same query works in both locales.
const CARD = "Zeta Card"
const PORT = "Zeta Port"

function renderCard(props: Record<string, unknown> = {}) {
  return render(
    <BaseNode id="n1" label={CARD} icon={<span />} category="ai" handles={[]} {...(props as any)}>
      <p>Body prose</p>
    </BaseNode>,
  )
}

describe("BaseNode text direction", () => {
  it("lays the header title out RTL under a Hebrew locale", () => {
    setLocale("he")
    renderCard()
    expect(screen.getByText(CARD)).toHaveAttribute("dir", "rtl")
  })

  it("lays the header title out LTR under English", () => {
    setLocale("en")
    renderCard()
    expect(screen.getByText(CARD)).toHaveAttribute("dir", "ltr")
  })

  it("gives handle labels the text direction", () => {
    setLocale("he")
    renderCard({ handles: [{ id: "zeta", type: "target", position: Position.Left, label: PORT, top: "40%" }] })
    expect(screen.getByText(PORT)).toHaveAttribute("dir", "rtl")
  })

  it("gives the list-progress status line the text direction", () => {
    setLocale("he")
    renderCard({ listProgressPercent: 42 })
    expect(screen.getByText(translate("he", "node.processingList"))).toHaveAttribute("dir", "rtl")
  })

  it("leaves the card frame LTR (no dir on the frame)", () => {
    setLocale("he")
    const { container } = renderCard()
    const frame = container.querySelector("div.rounded-xl")
    expect(frame).not.toBeNull()
    expect(frame).not.toHaveAttribute("dir")
  })

  it("leaves the handle wrapper LTR (no dir on the wrapper)", () => {
    setLocale("he")
    renderCard({ handles: [{ id: "zeta", type: "target", position: Position.Left, label: PORT, top: "40%" }] })
    expect(screen.getByTestId("handle-zeta").parentElement).not.toHaveAttribute("dir")
  })

  it("leaves the header ROW undirected so [icon][title][chips] never mirrors", () => {
    setLocale("he")
    renderCard()
    expect(screen.getByText(CARD).parentElement).not.toHaveAttribute("dir")
  })

  it("leaves the card BODY undirected — `direction` inherits into every flex row a card renders, so dir here would mirror ~150 card layouts while their absolutely-positioned overlays stayed put", () => {
    setLocale("he")
    renderCard()
    expect(screen.getByText("Body prose").parentElement).not.toHaveAttribute("dir")
  })
})

describe("EditableNodeLabel text direction", () => {
  const renderLabel = () =>
    render(<EditableNodeLabel label="Zeta Label" icon={<span />} onSave={() => {}} />)

  it("lays the floating title out RTL under a Hebrew locale", () => {
    setLocale("he")
    renderLabel()
    expect(screen.getByText("Zeta Label")).toHaveAttribute("dir", "rtl")
  })

  it("lays the floating title out LTR under English", () => {
    setLocale("en")
    renderLabel()
    expect(screen.getByText("Zeta Label")).toHaveAttribute("dir", "ltr")
  })

  it("gives the rename input the text direction", () => {
    setLocale("he")
    const { container } = renderLabel()
    fireEvent.click(screen.getByText("Zeta Label"))
    expect(container.querySelector("input")).toHaveAttribute("dir", "rtl")
  })

  it("leaves the [icon][title] row undirected so the icon stays on the LTR canvas side", () => {
    setLocale("he")
    renderLabel()
    expect(screen.getByText("Zeta Label").parentElement).not.toHaveAttribute("dir")
  })
})

describe("NodeJobProgress text direction", () => {
  it("gives the recovering status line the text direction", () => {
    setLocale("he")
    render(<NodeJobProgress progress={40} recovering />)
    expect(screen.getByText(translate("he", "node.recovering"))).toHaveAttribute("dir", "rtl")
  })

  it("leaves the progress column undirected (bar geometry stays with the canvas)", () => {
    setLocale("he")
    const { container } = render(<NodeJobProgress progress={40} recovering />)
    expect(container.querySelector("div.flex.flex-col")).not.toHaveAttribute("dir")
  })
})
