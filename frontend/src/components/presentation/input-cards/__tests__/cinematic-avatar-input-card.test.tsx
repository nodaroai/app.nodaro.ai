import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { WorkflowNode } from "@/types/nodes"
import type { InputCardProps } from "../../input-card"

// ---------------------------------------------------------------------------
// Mocks
//
// AvatarPicker is a heavy virtualized component that fetches the HeyGen catalog;
// mock it at the module boundary so we test the input-card wiring without
// standing up a full HTTP environment. The mock renders a minimal interactive
// element that lets us simulate a multi-select toggle by calling `onToggle`.
// ---------------------------------------------------------------------------

vi.mock("@/components/heygen/avatar-picker", () => ({
  AvatarPicker: ({
    selected,
    onToggle,
  }: {
    selected?: readonly string[]
    onToggle?: (a: { avatarId: string; name: string; gender: string; previewImageUrl: string }) => void
  }) => (
    <div data-testid="avatar-picker" data-selected={(selected ?? []).join(",")}>
      <button
        data-testid="toggle-avatar-btn"
        onClick={() =>
          onToggle?.({
            avatarId: "look-abc",
            name: "Test Look",
            gender: "female",
            previewImageUrl: "https://example.com/img.jpg",
          })
        }
      >
        Toggle Avatar
      </button>
    </div>
  ),
}))

// useWorkflowStore: only touched when isFullscreen=false; return a no-op stub.
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ updateNodeData: vi.fn() }),
  },
}))

import { CinematicAvatarInputCard } from "../cinematic-avatar-input-card"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<Record<string, unknown>> = {}): WorkflowNode {
  return {
    id: "node-1",
    type: "cinematic-avatar",
    position: { x: 0, y: 0 },
    data: {
      label: "Cinematic Avatar",
      provider: "heygen",
      prompt: "",
      avatarLooks: [],
      avatarLookNames: [],
      aspectRatio: "16:9",
      resolution: "720p",
      fieldMappings: {},
      ...overrides,
    },
  } as unknown as WorkflowNode
}

function makeProps(
  node: WorkflowNode,
  overrides: Partial<InputCardProps> = {},
): InputCardProps {
  return {
    node,
    isFullscreen: true,
    inputValues: {},
    onUpdateInput: vi.fn(),
    readOnly: false,
    ...overrides,
  }
}

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

// ---------------------------------------------------------------------------

describe("CinematicAvatarInputCard", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders the prompt textarea and avatar picker by default", () => {
    wrap(<CinematicAvatarInputCard {...makeProps(makeNode())} />)
    expect(screen.getByRole("textbox", { name: /cinematic avatar prompt/i })).toBeInTheDocument()
    expect(screen.getByTestId("avatar-picker")).toBeInTheDocument()
  })

  it("editing the prompt calls onUpdateInput(nodeId, 'prompt', value)", () => {
    const onUpdateInput = vi.fn()
    wrap(
      <CinematicAvatarInputCard
        {...makeProps(makeNode(), { onUpdateInput, isFullscreen: true })}
      />,
    )
    const textarea = screen.getByRole("textbox", { name: /cinematic avatar prompt/i })
    fireEvent.change(textarea, { target: { value: "A dramatic close-up" } })
    expect(onUpdateInput).toHaveBeenCalledWith("node-1", "prompt", "A dramatic close-up")
  })

  it("toggling an avatar look updates avatarLooks (and the aligned names)", () => {
    const onUpdateInput = vi.fn()
    wrap(
      <CinematicAvatarInputCard
        {...makeProps(makeNode({ avatarLooks: [], avatarLookNames: [] }), {
          onUpdateInput,
          isFullscreen: true,
        })}
      />,
    )
    fireEvent.click(screen.getByTestId("toggle-avatar-btn"))
    expect(onUpdateInput).toHaveBeenCalledWith("node-1", "avatarLooks", ["look-abc"])
    expect(onUpdateInput).toHaveBeenCalledWith("node-1", "avatarLookNames", ["Test Look"])
  })

  it("reads the current avatarLooks from inputValues in fullscreen mode", () => {
    wrap(
      <CinematicAvatarInputCard
        {...makeProps(makeNode({ avatarLooks: ["data-look"] }), {
          isFullscreen: true,
          inputValues: { "node-1": { avatarLooks: ["override-look"] } },
        })}
      />,
    )
    expect(screen.getByTestId("avatar-picker")).toHaveAttribute("data-selected", "override-look")
  })

  it("hides the avatar picker when appInputFields.avatar is false", () => {
    wrap(
      <CinematicAvatarInputCard
        {...makeProps(makeNode({ appInputFields: { avatar: false } }))}
      />,
    )
    expect(screen.queryByTestId("avatar-picker")).not.toBeInTheDocument()
    // Prompt still shown.
    expect(screen.getByRole("textbox", { name: /cinematic avatar prompt/i })).toBeInTheDocument()
  })

  it("shows the fallback message when every field is hidden", () => {
    wrap(
      <CinematicAvatarInputCard
        {...makeProps(
          makeNode({
            appInputFields: {
              prompt: false,
              avatar: false,
              duration: false,
              aspectRatio: false,
              resolution: false,
              enhancePrompt: false,
            },
          }),
        )}
      />,
    )
    expect(screen.getByText(/no editable fields/i)).toBeInTheDocument()
  })
})
