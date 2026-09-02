import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"

// Deliberately NOT mocking @/lib/generate-text-templates here (the sibling
// llm-chat-node.test.tsx does): the whole point is that the real getter
// resolves its labels through the live locale, so the memo()-wrapped node needs
// its own locale subscription to follow a language switch. The workflow-store
// mock below is a plain selector call with no subscription — exactly like React
// Flow's own `data` prop, nothing here re-renders the node on its own.

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  NodeResizer: () => null,
  NodeToolbar: ({ children }: any) => <div>{children}</div>,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children, rawToolbarContent, bottomToolbarContent }: any) => (
    <div data-testid="base-node">
      {rawToolbarContent}
      {bottomToolbarContent}
      {children}
    </div>
  ),
}))

vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HandleWithPopover: () => null,
}))

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

vi.mock("../llm-output-view", () => ({ LlmOutputView: ({ text }: any) => <div>{text}</div> }))
vi.mock("../llm-chat-quick-toolbar", () => ({ LlmChatQuickToolbar: () => null }))
vi.mock("../results-thumbnails-panel", () => ({ ResultsThumbnailsPanel: () => null }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 3 }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))

// One stable state object, as zustand hands out — a fresh object per call would
// give every slice a new identity each render and mask memoization bugs.
const store = vi.hoisted(() => ({
  state: {
    updateNodeData: () => {},
    runSingleNode: () => {},
    userTextTemplates: [] as unknown[],
    nodes: [] as unknown[],
    edges: [] as unknown[],
    selectedNodeId: null as string | null,
  },
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) => selector(store.state),
    { getState: () => store.state },
  ),
}))

vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom")
  return { ...actual, createPortal: (node: any) => node }
})

import { LLMChatNode } from "../llm-chat-node"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

describe("LLMChatNode template badge locale", () => {
  afterEach(() => {
    cleanup()
    act(() => useLocaleStore.getState().setLocale("en"))
  })

  it("follows a language switch even though the node is memo()-wrapped", () => {
    render(
      <LLMChatNode
        {...({ id: "node-1", data: { label: "Generate Text", templateId: "photo-shoot" }, selected: false } as any)}
      />,
    )
    expect(screen.getByText(translate("en", "txtcfg.tplPhotoShootLabel"))).toBeInTheDocument()
    act(() => useLocaleStore.getState().setLocale("he"))
    expect(screen.getByText(translate("he", "txtcfg.tplPhotoShootLabel"))).toBeInTheDocument()
    expect(screen.queryByText(translate("en", "txtcfg.tplPhotoShootLabel"))).not.toBeInTheDocument()
  })
})
