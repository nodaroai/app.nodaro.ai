import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { WorkflowNode } from "@/types/nodes"
import type { InputCardProps } from "../../input-card"

// ---------------------------------------------------------------------------
// Mocks
//
// The pickers themselves (AvatarPicker, VoicePicker) are heavy components that
// make fetch calls; mock them at the module boundary so we test the input-card
// wiring without standing up a full HTTP environment.
//
// Each mock renders a minimal interactive element that lets us simulate
// selection by calling the `onSelect` prop.
// ---------------------------------------------------------------------------

vi.mock("@/components/heygen/avatar-picker", () => ({
  AvatarPicker: ({
    value,
    onSelect,
  }: {
    value?: string
    onSelect: (a: { avatarId: string; name: string; gender: string; previewImageUrl: string; defaultVoiceId?: string }) => void
  }) => (
    <div data-testid="avatar-picker" data-value={value ?? ""}>
      <button
        data-testid="select-avatar-btn"
        onClick={() =>
          onSelect({
            avatarId: "avatar-abc",
            name: "Test Avatar",
            gender: "female",
            previewImageUrl: "https://example.com/img.jpg",
            defaultVoiceId: "voice-default",
          })
        }
      >
        Select Avatar
      </button>
    </div>
  ),
}))

vi.mock("@/components/heygen/voice-picker", () => ({
  VoicePicker: ({
    value,
    onSelect,
  }: {
    value?: string
    onSelect: (v: { voiceId: string; name: string; language: string; gender: string; previewAudio: string; supportPause: boolean; emotionSupport: boolean; supportLocale: boolean }) => void
  }) => (
    <div data-testid="voice-picker" data-value={value ?? ""}>
      <button
        data-testid="select-voice-btn"
        onClick={() =>
          onSelect({
            voiceId: "voice-xyz",
            name: "Test Voice",
            language: "English",
            gender: "female",
            previewAudio: "https://example.com/audio.mp3",
            supportPause: false,
            emotionSupport: false,
            supportLocale: false,
          })
        }
      >
        Select Voice
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

// useFileUpload: image-source mode wires the upload control to this hook.
const mockUpload = vi.fn(async () => ({ url: "https://example.com/uploaded.png" }))
vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ upload: mockUpload, isUploading: false }),
}))

// optimizedImageUrl: pass-through so we can assert the rendered <img src>.
vi.mock("@/lib/image", () => ({
  optimizedImageUrl: (url: string) => url,
}))

import { AiAvatarInputCard } from "../ai-avatar-input-card"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<Record<string, unknown>> = {}): WorkflowNode {
  return {
    id: "node-1",
    type: "ai-avatar",
    position: { x: 0, y: 0 },
    data: {
      label: "AI Avatar",
      provider: "heygen",
      speechMode: "text",
      avatarId: "",
      voiceId: "",
      script: "",
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

describe("AiAvatarInputCard", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders the avatar picker", () => {
    wrap(<AiAvatarInputCard {...makeProps(makeNode())} />)
    expect(screen.getByTestId("avatar-picker")).toBeInTheDocument()
  })

  it("renders voice picker and script textarea in text mode", () => {
    wrap(<AiAvatarInputCard {...makeProps(makeNode({ speechMode: "text" }))} />)
    expect(screen.getByTestId("avatar-picker")).toBeInTheDocument()
    expect(screen.getByTestId("voice-picker")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /avatar script/i })).toBeInTheDocument()
  })

  it("does NOT render voice picker or script textarea in audio mode", () => {
    wrap(<AiAvatarInputCard {...makeProps(makeNode({ speechMode: "audio" }))} />)
    expect(screen.getByTestId("avatar-picker")).toBeInTheDocument()
    expect(screen.queryByTestId("voice-picker")).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: /avatar script/i })).not.toBeInTheDocument()
  })

  it("editing the script calls onUpdateInput(nodeId, 'script', value)", () => {
    const onUpdateInput = vi.fn()
    wrap(
      <AiAvatarInputCard
        {...makeProps(makeNode(), { onUpdateInput, isFullscreen: true })}
      />,
    )
    const textarea = screen.getByRole("textbox", { name: /avatar script/i })
    fireEvent.change(textarea, { target: { value: "Hello, world!" } })
    expect(onUpdateInput).toHaveBeenCalledWith("node-1", "script", "Hello, world!")
  })

  it("selecting an avatar calls onUpdateInput for avatarId and pre-fills voiceId from defaultVoiceId", () => {
    const onUpdateInput = vi.fn()
    // No current voiceId — so the defaultVoiceId should be pre-filled.
    wrap(
      <AiAvatarInputCard
        {...makeProps(makeNode({ voiceId: "" }), { onUpdateInput, isFullscreen: true })}
      />,
    )
    fireEvent.click(screen.getByTestId("select-avatar-btn"))
    expect(onUpdateInput).toHaveBeenCalledWith("node-1", "avatarId", "avatar-abc")
    expect(onUpdateInput).toHaveBeenCalledWith("node-1", "voiceId", "voice-default")
  })

  it("selecting an avatar does NOT overwrite an existing voiceId", () => {
    const onUpdateInput = vi.fn()
    // Pre-existing voiceId — avatar selection must not clobber it.
    wrap(
      <AiAvatarInputCard
        {...makeProps(makeNode({ voiceId: "my-existing-voice" }), {
          onUpdateInput,
          isFullscreen: true,
          inputValues: { "node-1": { voiceId: "my-existing-voice" } },
        })}
      />,
    )
    fireEvent.click(screen.getByTestId("select-avatar-btn"))
    expect(onUpdateInput).toHaveBeenCalledWith("node-1", "avatarId", "avatar-abc")
    // Should NOT call with "voice-default" because a voiceId already exists.
    expect(onUpdateInput).not.toHaveBeenCalledWith("node-1", "voiceId", "voice-default")
  })

  it("selecting a voice calls onUpdateInput(nodeId, 'voiceId', voiceId)", () => {
    const onUpdateInput = vi.fn()
    wrap(
      <AiAvatarInputCard
        {...makeProps(makeNode(), { onUpdateInput, isFullscreen: true })}
      />,
    )
    fireEvent.click(screen.getByTestId("select-voice-btn"))
    expect(onUpdateInput).toHaveBeenCalledWith("node-1", "voiceId", "voice-xyz")
  })

  it("hides avatar picker when appInputFields.avatar is false", () => {
    wrap(
      <AiAvatarInputCard
        {...makeProps(makeNode({ appInputFields: { avatar: false, voice: true, script: true } }))}
      />,
    )
    expect(screen.queryByTestId("avatar-picker")).not.toBeInTheDocument()
    expect(screen.getByTestId("voice-picker")).toBeInTheDocument()
  })

  it("hides voice picker when appInputFields.voice is false (text mode)", () => {
    wrap(
      <AiAvatarInputCard
        {...makeProps(makeNode({ appInputFields: { avatar: true, voice: false, script: true } }))}
      />,
    )
    expect(screen.getByTestId("avatar-picker")).toBeInTheDocument()
    expect(screen.queryByTestId("voice-picker")).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /avatar script/i })).toBeInTheDocument()
  })

  it("shows all three controls by default when appInputFields is absent", () => {
    // No appInputFields set — all default to true.
    wrap(<AiAvatarInputCard {...makeProps(makeNode())} />)
    expect(screen.getByTestId("avatar-picker")).toBeInTheDocument()
    expect(screen.getByTestId("voice-picker")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /avatar script/i })).toBeInTheDocument()
  })

  it("reads current avatarId and voiceId from inputValues in fullscreen mode", () => {
    wrap(
      <AiAvatarInputCard
        {...makeProps(makeNode({ avatarId: "data-avatar", voiceId: "data-voice" }), {
          isFullscreen: true,
          inputValues: {
            "node-1": { avatarId: "override-avatar", voiceId: "override-voice" },
          },
        })}
      />,
    )
    // The pickers receive the override values (via data-value).
    expect(screen.getByTestId("avatar-picker")).toHaveAttribute("data-value", "override-avatar")
    expect(screen.getByTestId("voice-picker")).toHaveAttribute("data-value", "override-voice")
  })

  it("shows fallback message when all fields are hidden by appInputFields", () => {
    wrap(
      <AiAvatarInputCard
        {...makeProps(
          makeNode({ appInputFields: { avatar: false, voice: false, script: false } }),
        )}
      />,
    )
    expect(screen.getByText(/no editable fields/i)).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Image source mode (avatarSource === "image")
  // -------------------------------------------------------------------------

  it("renders the image upload + URL control (not the avatar picker) in image source mode", () => {
    wrap(<AiAvatarInputCard {...makeProps(makeNode({ avatarSource: "image" }))} />)
    expect(screen.queryByTestId("avatar-picker")).not.toBeInTheDocument()
    expect(screen.getByText(/upload image/i)).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /source image url/i })).toBeInTheDocument()
  })

  it("still shows voice + script in image source + text mode", () => {
    wrap(<AiAvatarInputCard {...makeProps(makeNode({ avatarSource: "image", speechMode: "text" }))} />)
    expect(screen.getByTestId("voice-picker")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /avatar script/i })).toBeInTheDocument()
  })

  it("typing an image URL calls onUpdateInput(nodeId, 'imageUrl', value)", () => {
    const onUpdateInput = vi.fn()
    wrap(
      <AiAvatarInputCard
        {...makeProps(makeNode({ avatarSource: "image" }), { onUpdateInput, isFullscreen: true })}
      />,
    )
    const urlInput = screen.getByRole("textbox", { name: /source image url/i })
    fireEvent.change(urlInput, { target: { value: "https://example.com/face.png" } })
    expect(onUpdateInput).toHaveBeenCalledWith("node-1", "imageUrl", "https://example.com/face.png")
  })

  it("renders the existing image preview (from inputValues override) instead of the upload control", () => {
    wrap(
      <AiAvatarInputCard
        {...makeProps(makeNode({ avatarSource: "image", imageUrl: "https://example.com/data.png" }), {
          isFullscreen: true,
          inputValues: { "node-1": { imageUrl: "https://example.com/override.png" } },
        })}
      />,
    )
    const img = screen.getByRole("img", { name: /source/i })
    expect(img).toHaveAttribute("src", "https://example.com/override.png")
    // Upload control is replaced by the preview.
    expect(screen.queryByText(/upload image/i)).not.toBeInTheDocument()
  })

  it("clicking remove on the image preview clears imageUrl", () => {
    const onUpdateInput = vi.fn()
    wrap(
      <AiAvatarInputCard
        {...makeProps(makeNode({ avatarSource: "image", imageUrl: "https://example.com/data.png" }), {
          onUpdateInput,
          isFullscreen: true,
        })}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /remove image/i }))
    expect(onUpdateInput).toHaveBeenCalledWith("node-1", "imageUrl", "")
  })

  it("hides the image control when appInputFields.avatar is false (image source)", () => {
    wrap(
      <AiAvatarInputCard
        {...makeProps(
          makeNode({ avatarSource: "image", appInputFields: { avatar: false, voice: true, script: true } }),
        )}
      />,
    )
    expect(screen.queryByText(/upload image/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: /source image url/i })).not.toBeInTheDocument()
    // Voice/script still shown.
    expect(screen.getByTestId("voice-picker")).toBeInTheDocument()
  })
})
