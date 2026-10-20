import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — all declared before component imports
// ---------------------------------------------------------------------------

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Handle: ({ type, position, id, "aria-label": ariaLabel }: any) => (
      <div data-testid={`handle-${id}`} data-type={type} data-position={position} aria-label={ariaLabel} />
    ),
    NodeResizer: () => null,
    NodeToolbar: ({ children }: any) => <div data-testid="node-toolbar">{children}</div>,
    useStore: vi.fn(() => 1),
    useNodeId: vi.fn(() => "test-node"),
    useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
    useUpdateNodeInternals: vi.fn(() => () => {}),
    useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
  }
})

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
      data-is-running={isRunning}
    >
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  return { ...actual }
})

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: any) => (
    <div data-testid="run-node-button" data-credits={props.credits} />
  ),
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        updateNodeData: () => {},
        runSingleNode: () => {},
        selectNode: () => {},
        duplicateNode: () => {},
        newNodeIds: new Set(),
        clearNewNode: () => {},
        nodes: [],
        edges: [],
        characterDefinitions: [],
        addCharacterDefinition: () => {},
        autoOpenEditorNodeId: null,
        setAutoOpenEditorNodeId: () => {},
        videoAutoplay: false,
      }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: () => 1,
  // Video Upscale's Seedance 2.5 HD price (covered by video-upscale-node-seedance-hd.test.tsx).
  useSeedanceHdDraftCredits: () => undefined,
  useSeedanceHdMinimumCredits: () => undefined,
}))
// The speech pills price through the one speech hook (flat row here, like the others).
vi.mock("@/ee/hooks/use-speech-pricing", () => ({
  useSpeechPricing: () => ({ credits: 1, exact: true }),
}))

// The video-utility pills read their one-unit price through the core shim.
vi.mock("@/hooks/use-model-credit-cost", () => ({
  useModelCredits: () => 0,
  useModelCreditCost: () => ({ data: undefined }),
  useSeedanceRefQuote: () => undefined,
}))
vi.mock("@/ee/hooks/use-providers-credits-sum", () => ({
  useProvidersCreditsSum: () => 0,
}))

vi.mock("@/components/editor/media-preview-modal", () => ({
  MediaPreviewModal: () => null,
}))

vi.mock("@/components/ui/delete-confirmation-dialog", () => ({
  DeleteConfirmationDialog: () => null,
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => (
    <img data-testid="cached-image" src={props.src} alt={props.alt} />
  ),
}))

vi.mock("@/components/editor/save-to-library-button", () => ({
  SaveToLibraryButton: () => null,
}))

vi.mock("@/components/editor/canvas-zoom-context", () => ({
  useCanvasZoom: () => ({ zoom: 1 }),
}))

vi.mock("@/components/editor/extract-references-modal", () => ({
  ExtractReferencesModal: () => null,
}))

vi.mock("@/components/editor/scene-editor-modal", () => ({
  SceneEditorModal: () => null,
}))

vi.mock("@/components/editor/kling3-director-modal", () => ({
  Kling3DirectorModal: () => null,
}))

vi.mock("@/lib/tts-voices", () => ({
  getVoiceName: () => "Test Voice",
}))

vi.mock("@/lib/generate-text-templates", () => ({
  getGenerateTextTemplate: () => null,
}))

vi.mock("@/lib/api", () => ({
  generateAIWriterStream: vi.fn(),
  fetchYouTubeOEmbed: vi.fn(),
  startVideoDownload: vi.fn(),
  downloadYouTubeAudio: vi.fn(),
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom")
  return { ...actual, createPortal: (node: any) => node }
})

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}))

// ---------------------------------------------------------------------------
// Component imports (after all mocks)
// ---------------------------------------------------------------------------

import { GenerateImageNode } from "../generate-image-node"
import { EditImageNode } from "../edit-image-node"
import { ImageToImageNode } from "../image-to-image-node"
import { VideoToVideoNode } from "../video-to-video-node"
import { TextToSpeechNode } from "../text-to-speech-node"
import { GenerateMusicNode } from "../generate-music-node"
import { TextToAudioNode } from "../text-to-audio-node"
import { GenerateScriptNode } from "../generate-script-node"
import { SunoGenerateNode } from "../suno-generate-node"
import { SunoCoverNode } from "../suno-cover-node"
import { SunoExtendNode } from "../suno-extend-node"
import { SunoLyricsNode } from "../suno-lyrics-node"
import { SunoSeparateNode } from "../suno-separate-node"
import { SunoMusicVideoNode } from "../suno-music-video-node"
import { LipSyncNode } from "../lip-sync-node"
import { MotionTransferNode } from "../motion-transfer-node"
import { TranscribeNode } from "../transcribe-node"
import { CombineVideosNode } from "../combine-videos-node"
import { MergeVideoAudioNode } from "../merge-video-audio-node"
import { AddCaptionsNode } from "../add-captions-node"
import { ResizeVideoNode } from "../resize-video-node"
import { TrimAudioNode } from "../trim-audio-node"
import { MixAudioNode } from "../mix-audio-node"
import { AdjustVolumeNode } from "../adjust-volume-node"
import { TrimVideoNode } from "../trim-video-node"
import { SpeedRampNode } from "../speed-ramp-node"
import { LoopVideoNode } from "../loop-video-node"
import { FadeVideoNode } from "../fade-video-node"
import { TranscodeVideoNode } from "../transcode-video-node"
import { VideoUpscaleNode } from "../video-upscale-node"
import { VideoComposerNode } from "../video-composer-node"
import { AfterEffectsNode } from "../after-effects-node"
import { LottieOverlayNode } from "../lottie-overlay-node"
import { ThreeDTitleNode } from "../three-d-title-node"
import { MotionGraphicsNode } from "../motion-graphics-node"
import { CompositeNode } from "../composite-node"
import { RenderVideoNode } from "../render-video-node"

// ---------------------------------------------------------------------------
// Test config
// ---------------------------------------------------------------------------

interface NodeTestConfig {
  name: string
  Component: React.ComponentType<any>
  defaultData: Record<string, unknown>
  expectedCategory: string
  skipIdlePlaceholder?: boolean
  skipFailedText?: boolean
}

const NODES: NodeTestConfig[] = [
  { name: "GenerateImageNode", Component: GenerateImageNode, expectedCategory: "ai", defaultData: { label: "Generate Image", provider: "nano-banana-pro", aspectRatio: "1:1" }, skipIdlePlaceholder: true },
  { name: "EditImageNode", Component: EditImageNode, expectedCategory: "ai", defaultData: { label: "Edit Image", provider: "recraft-upscale" }, skipIdlePlaceholder: true, skipFailedText: true },
  { name: "ImageToImageNode", Component: ImageToImageNode, expectedCategory: "ai", defaultData: { label: "Image to Image", provider: "nano-banana" }, skipIdlePlaceholder: true, skipFailedText: true },
  { name: "VideoToVideoNode", Component: VideoToVideoNode, expectedCategory: "ai", defaultData: { label: "Video to Video", provider: "wan" }, skipIdlePlaceholder: true, skipFailedText: true },
  { name: "TextToSpeechNode", Component: TextToSpeechNode, expectedCategory: "ai", defaultData: { label: "Text to Speech", provider: "elevenlabs-turbo", voiceId: "test" } },
  { name: "GenerateMusicNode", Component: GenerateMusicNode, expectedCategory: "ai", defaultData: { label: "Generate Music", provider: "suno" } },
  { name: "TextToAudioNode", Component: TextToAudioNode, expectedCategory: "ai", defaultData: { label: "Text to Audio", provider: "elevenlabs-sfx" } },
  { name: "GenerateScriptNode", Component: GenerateScriptNode, expectedCategory: "script", defaultData: { label: "Generate Script" } },
  { name: "SunoGenerateNode", Component: SunoGenerateNode, expectedCategory: "ai", defaultData: { label: "Suno Create Music" } },
  { name: "SunoCoverNode", Component: SunoCoverNode, expectedCategory: "ai", defaultData: { label: "Suno Cover" } },
  { name: "SunoExtendNode", Component: SunoExtendNode, expectedCategory: "ai", defaultData: { label: "Suno Extend" } },
  { name: "SunoLyricsNode", Component: SunoLyricsNode, expectedCategory: "ai", defaultData: { label: "Suno Lyrics" } },
  { name: "SunoSeparateNode", Component: SunoSeparateNode, expectedCategory: "ai", defaultData: { label: "Suno Separate" } },
  { name: "SunoMusicVideoNode", Component: SunoMusicVideoNode, expectedCategory: "ai", defaultData: { label: "Music Video" } },
  { name: "LipSyncNode", Component: LipSyncNode, expectedCategory: "ai", defaultData: { label: "Lip Sync", provider: "kling-avatar" }, skipIdlePlaceholder: true, skipFailedText: true },
  { name: "MotionTransferNode", Component: MotionTransferNode, expectedCategory: "ai", defaultData: { label: "Motion Transfer" }, skipIdlePlaceholder: true, skipFailedText: true },
  { name: "TranscribeNode", Component: TranscribeNode, expectedCategory: "ai", defaultData: { label: "Transcribe", provider: "whisper" }, skipIdlePlaceholder: true },
  { name: "CombineVideosNode", Component: CombineVideosNode, expectedCategory: "processing", defaultData: { label: "Combine Videos" } },
  { name: "MergeVideoAudioNode", Component: MergeVideoAudioNode, expectedCategory: "processing", defaultData: { label: "Merge Video Audio" } },
  { name: "AddCaptionsNode", Component: AddCaptionsNode, expectedCategory: "processing", defaultData: { label: "Add Captions" } },
  { name: "ResizeVideoNode", Component: ResizeVideoNode, expectedCategory: "processing", defaultData: { label: "Resize Video" } },
  { name: "TrimAudioNode", Component: TrimAudioNode, expectedCategory: "processing", defaultData: { label: "Trim Audio" } },
  { name: "MixAudioNode", Component: MixAudioNode, expectedCategory: "processing", defaultData: { label: "Mix Audio" } },
  { name: "AdjustVolumeNode", Component: AdjustVolumeNode, expectedCategory: "processing", defaultData: { label: "Adjust Volume" } },
  { name: "TrimVideoNode", Component: TrimVideoNode, expectedCategory: "processing", defaultData: { label: "Trim Video" } },
  { name: "SpeedRampNode", Component: SpeedRampNode, expectedCategory: "processing", defaultData: { label: "Speed Ramp" } },
  { name: "LoopVideoNode", Component: LoopVideoNode, expectedCategory: "processing", defaultData: { label: "Loop Video" } },
  { name: "FadeVideoNode", Component: FadeVideoNode, expectedCategory: "processing", defaultData: { label: "Fade Video" } },
  { name: "TranscodeVideoNode", Component: TranscodeVideoNode, expectedCategory: "processing", defaultData: { label: "Transcode Video" } },
  { name: "VideoUpscaleNode", Component: VideoUpscaleNode, expectedCategory: "processing", defaultData: { label: "Upscale Video" } },
  { name: "VideoComposerNode", Component: VideoComposerNode, expectedCategory: "processing", defaultData: { label: "Video Composer" } },
  { name: "AfterEffectsNode", Component: AfterEffectsNode, expectedCategory: "processing", defaultData: { label: "After Effects" } },
  { name: "LottieOverlayNode", Component: LottieOverlayNode, expectedCategory: "processing", defaultData: { label: "Lottie Overlay" } },
  { name: "ThreeDTitleNode", Component: ThreeDTitleNode, expectedCategory: "ai", defaultData: { label: "3D Title" } },
  { name: "MotionGraphicsNode", Component: MotionGraphicsNode, expectedCategory: "ai", defaultData: { label: "Motion Graphics" } },
  { name: "CompositeNode", Component: CompositeNode, expectedCategory: "processing", defaultData: { label: "Composite", layers: [] } },
  { name: "RenderVideoNode", Component: RenderVideoNode, expectedCategory: "processing", defaultData: { label: "Render Video" } },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNode(
  Component: React.ComponentType<any>,
  data: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return render(
    <Component id="node-1" data={data} selected={false} {...overrides} />,
  )
}

// ---------------------------------------------------------------------------
// Data-driven tests
// ---------------------------------------------------------------------------

describe.each(NODES)(
  "$name",
  ({ Component, defaultData, expectedCategory, skipIdlePlaceholder, skipFailedText }) => {
    it("renders without crashing", () => {
      renderNode(Component, { ...defaultData, executionStatus: "idle" })
      expect(screen.getByTestId("base-node")).toBeInTheDocument()
    })

    it("passes correct label to BaseNode", () => {
      renderNode(Component, defaultData)
      expect(screen.getByTestId("base-node")).toHaveAttribute(
        "data-label",
        defaultData.label as string,
      )
    })

    it("passes correct category to BaseNode", () => {
      renderNode(Component, defaultData)
      expect(screen.getByTestId("base-node")).toHaveAttribute(
        "data-category",
        expectedCategory,
      )
    })

    if (!skipIdlePlaceholder) {
    it("shows idle placeholder", () => {
      renderNode(Component, defaultData)
      const baseNode = screen.getByTestId("base-node")
      const dashed = baseNode.querySelector(".border-dashed")
      expect(dashed).toBeInTheDocument()
    })
    }

    it("shows spinner when running", () => {
      renderNode(Component, { ...defaultData, executionStatus: "running" })
      const baseNode = screen.getByTestId("base-node")
      const spinner = baseNode.querySelector(".animate-spin")
      expect(spinner).toBeInTheDocument()
    })

    if (!skipFailedText) {
    it("shows Failed text when failed", () => {
      renderNode(Component, { ...defaultData, executionStatus: "failed" })
      expect(screen.getByText("Failed")).toBeInTheDocument()
    })
    }

    it("shows error message when failed", () => {
      renderNode(Component, {
        ...defaultData,
        executionStatus: "failed",
        errorMessage: "Test error",
      })
      expect(screen.getByText("Test error")).toBeInTheDocument()
    })
  },
)

// ---------------------------------------------------------------------------
// Suno Separate — the pips a mode does not fill are muted (never removed, so
// a wired edge stays drawn), the lane the run takes, and a Demucs fallback.
// ---------------------------------------------------------------------------

describe("SunoSeparateNode — mode pips, lane hint, Demucs note", () => {
  const MUTED = /not used by current model/
  const pip = (label: string) => screen.getByTestId(`handle-${label.toLowerCase()}`)
  const base = { label: "Suno Separate", taskId: "", audioId: "" }

  it("one-instrument mode mutes vocals/instrumental pips and lights isolated/without", () => {
    renderNode(SunoSeparateNode, { ...base, type: "split_stem_advanced" })
    expect(pip("Vocals").getAttribute("aria-label")).toMatch(MUTED)
    expect(pip("Instrumental").getAttribute("aria-label")).toMatch(MUTED)
    expect(pip("Isolated").getAttribute("aria-label")).not.toMatch(MUTED)
    expect(pip("Without").getAttribute("aria-label")).not.toMatch(MUTED)
  })

  it("vocals + instrumental mode (and an unset mode) mutes isolated/without", () => {
    for (const type of ["separate_vocal", undefined]) {
      const { unmount } = renderNode(SunoSeparateNode, { ...base, type })
      expect(pip("Vocals").getAttribute("aria-label")).not.toMatch(MUTED)
      expect(pip("Instrumental").getAttribute("aria-label")).not.toMatch(MUTED)
      expect(pip("Isolated").getAttribute("aria-label")).toMatch(MUTED)
      expect(pip("Without").getAttribute("aria-label")).toMatch(MUTED)
      unmount()
    }
  })

  it("full-stems mutes instrumental until an instrumentalUrl exists", () => {
    const { unmount } = renderNode(SunoSeparateNode, { ...base, type: "split_stem" })
    expect(pip("Vocals").getAttribute("aria-label")).not.toMatch(MUTED)
    expect(pip("Instrumental").getAttribute("aria-label")).toMatch(MUTED)
    expect(pip("Isolated").getAttribute("aria-label")).toMatch(MUTED)
    unmount()
    renderNode(SunoSeparateNode, { ...base, type: "split_stem", instrumentalUrl: "https://cdn.test/inst.mp3" })
    expect(pip("Instrumental").getAttribute("aria-label")).not.toMatch(MUTED)
  })

  it("names the Suno lane on a typed task id, and no lane when nothing is wired", () => {
    const { unmount } = renderNode(SunoSeparateNode, { ...base, type: "separate_vocal", taskId: "task-1" })
    expect(screen.getByText("Suno track")).toBeInTheDocument()
    unmount()
    renderNode(SunoSeparateNode, { ...base, type: "separate_vocal" })
    expect(screen.queryByText("Suno track")).toBeNull()
    expect(screen.queryByText("Uploaded audio")).toBeNull()
  })

  it("says a run fell back to Demucs, and why", () => {
    const { unmount } = renderNode(SunoSeparateNode, { ...base, type: "separate_vocal", engineUsed: "demucs", sunoRefused: true, fallbackReason: "catalog" })
    expect(screen.getByText("Suno refused this audio — separated with Demucs")).toBeInTheDocument()
    unmount()
    const r = renderNode(SunoSeparateNode, { ...base, type: "split_stem", engineUsed: "demucs", fallbackReason: "too_large" })
    expect(screen.getByText("Too large for Suno — separated with Demucs")).toBeInTheDocument()
    r.unmount()
    renderNode(SunoSeparateNode, { ...base, type: "separate_vocal", engineUsed: "suno" })
    expect(screen.queryByText(/separated with Demucs/)).toBeNull()
  })

  it("one-instrument mode names its instrument on the card", () => {
    renderNode(SunoSeparateNode, { ...base, type: "split_stem_advanced", stemName: "Bass" })
    expect(screen.getByText(/Bass/)).toBeInTheDocument()
  })
})
