import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — all declared before component imports
// ---------------------------------------------------------------------------

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => vi.fn()),
  // HandleWithPopover (rendered for camera-motion's startState/endState typed
  // pips via extraHandleIcons) calls useConnection() to drive the per-pip
  // valid-candidate visual during drag-to-connect.
  useConnection: vi.fn(() => ({ inProgress: false })),
}))

vi.mock("../editable-node-label", () => ({
  EditableNodeLabel: ({ label }: any) => <div data-testid="editable-node-label">{label}</div>,
}))

vi.mock("../handle-icon", () => ({
  HandleIcon: () => <div data-testid="handle-icon" />,
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
    >
      {children}
    </div>
  ),
}))

// Partial mock: stub the icons this test cares about, but fall back to the real
// exports for everything else (e.g. the bottom-strip icons Languages/Pencil/
// Paintbrush/Settings2 pulled in via NodeQuickStrip) so adding an icon to the
// strip can never crash this test at import.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return {
    ...actual,
    List: I, Palette: I, Brush: I, Cpu: I, Hash: I, Clock: I,
    RectangleHorizontal: I, Activity: I, Video: I, ShieldCheck: I,
    Rss: I, Webhook: I, HardDrive: I, Scissors: I, FileText: I,
    Type: I, ImageIcon: I, Check: I, X: I, Frame: I, Aperture: I, Film: I, Lightbulb: I, SwatchBook: I, CloudFog: I, Sparkles: I,
    Eye: I, Layers: I, Play: I, Square: I, FastForward: I,
    // picker-handles registry icons (transitively loaded via parameter-node-shell)
    Music: I, Mic: I, Wind: I, Camera: I, Box: I, Car: I, Crosshair: I,
    Bot: I, Sofa: I, Hand: I, Repeat: I, Zap: I, Cloud: I, Shirt: I,
    PersonStanding: I, MapPin: I, Sparkle: I,
  }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  EXECUTION_DATA_KEYS: new Set(["executionStatus"]),
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        updateNodeData: () => {},
        runSingleNode: () => {},
        runFromHere: () => {},
        selectNode: () => {},
        duplicateNode: () => {},
        newNodeIds: new Set(),
        clearNewNode: () => {},
        nodes: [],
        edges: [],
        loadGeneration: 0,
      }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: any) => (
    <div data-testid="run-node-button" data-credits={props.credits} />
  ),
}))

vi.mock("@/lib/providers-config", () => ({
  getProviderLabel: (_cat: string, provider: string) => provider,
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: () => 1,
}))

vi.mock("@nodaro/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/shared")>()
  return {
    ...actual,
    buildLlmCreditIdentifier: () => "qa-check",
    LLM_FEATURE_DEFAULTS: { "qa-check": "gemini-3-flash" },
  }
})

// ---------------------------------------------------------------------------
// Component imports (after all mocks)
// ---------------------------------------------------------------------------

import { ToneNode } from "../tone-node"
import { StyleGuideNode } from "../style-guide-node"
import { ProviderNode } from "../provider-node"
import { SceneCountNode } from "../scene-count-node"
import { DurationNode } from "../duration-node"
import { AspectRatioNode } from "../aspect-ratio-node"
import { MotionNode } from "../motion-node"
import { CameraMotionNode } from "../camera-motion-node"
import { FramingNode } from "../framing-node"
import { LensNode } from "../lens-node"
import { CameraFormatNode } from "../camera-format-node"
import { LightingNode } from "../lighting-node"
import { ColorLookNode } from "../color-look-node"
import { AtmosphereNode } from "../atmosphere-node"
import { TemporalNode } from "../temporal-node"
import { QACheckNode } from "../qa-check-node"
import { RSSFeedNode } from "../rss-feed-node"
import { WebhookOutputNode } from "../webhook-output-node"
import { SaveToStorageNode } from "../save-to-storage-node"
import { SplitTextNode } from "../split-text-node"

// ---------------------------------------------------------------------------
// Test config
// ---------------------------------------------------------------------------

interface SimpleNodeTestConfig {
  name: string
  Component: React.ComponentType<any>
  defaultData: Record<string, unknown>
  expectedCategory: string
  expectedCredits: number
  contentAssertion?: { text: string }
  placeholderAssertion?: { text: string }
}

const SIMPLE_NODES: SimpleNodeTestConfig[] = [
  {
    name: "ToneNode",
    Component: ToneNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Tone", tone: "cinematic" },
    contentAssertion: { text: "cinematic" },
    placeholderAssertion: { text: "Set tone..." },
  },
  {
    name: "StyleGuideNode",
    Component: StyleGuideNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Style Guide", text: "dark moody" },
    contentAssertion: { text: "dark moody" },
    placeholderAssertion: { text: "Set style guide..." },
  },
  {
    name: "ProviderNode",
    Component: ProviderNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Provider", provider: "openai", model: "gpt-4", category: "text" },
    placeholderAssertion: { text: "Select provider..." },
  },
  {
    name: "SceneCountNode",
    Component: SceneCountNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Scene Count", count: 5 },
    contentAssertion: { text: "5 scenes" },
  },
  {
    name: "DurationNode",
    Component: DurationNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Duration", seconds: 30 },
    contentAssertion: { text: "30s" },
  },
  {
    name: "AspectRatioNode",
    Component: AspectRatioNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Aspect Ratio", ratio: "16:9" },
    contentAssertion: { text: "16:9" },
  },
  {
    name: "MotionNode",
    Component: MotionNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Motion", motion: "smooth" },
    contentAssertion: { text: "smooth" },
  },
  {
    name: "CameraMotionNode",
    Component: CameraMotionNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Camera Motion", cameraMotion: "pan-left" },
    contentAssertion: { text: "Pan Left" },
  },
  {
    name: "FramingNode",
    Component: FramingNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Framing", shotSize: "medium-shot" },
    contentAssertion: { text: "Medium Shot" },
  },
  {
    name: "LensNode",
    Component: LensNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Lens", lens: "normal-50mm" },
    contentAssertion: { text: "Normal (50mm)" },
  },
  {
    name: "CameraFormatNode",
    Component: CameraFormatNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Camera / Film Stock", cameraFormat: "35mm-film" },
    contentAssertion: { text: "35mm Film" },
  },
  {
    name: "LightingNode",
    Component: LightingNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Lighting", timeOfDay: "noon" },
    contentAssertion: { text: "Noon" },
  },
  {
    name: "ColorLookNode",
    Component: ColorLookNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Color / Look", colorLook: "warm" },
    contentAssertion: { text: "Warm" },
  },
  {
    name: "AtmosphereNode",
    Component: AtmosphereNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Atmosphere", atmosphere: "clear" },
    contentAssertion: { text: "Clear" },
  },
  {
    name: "TemporalNode",
    Component: TemporalNode,
    expectedCategory: "parameter",
    expectedCredits: 0,
    defaultData: { label: "Temporal", temporalSpeed: "real-time" },
    contentAssertion: { text: "Real-time" },
  },
  {
    name: "QACheckNode",
    Component: QACheckNode,
    expectedCategory: "ai",
    expectedCredits: 1,
    defaultData: { label: "QA Check", checkType: "quality", provider: "claude" },
    contentAssertion: { text: "quality (claude)" },
  },
  {
    name: "RSSFeedNode",
    Component: RSSFeedNode,
    expectedCategory: "input",
    expectedCredits: 0,
    defaultData: { label: "RSS Feed", feedUrl: "https://example.com/feed" },
    contentAssertion: { text: "https://example.com/feed" },
    placeholderAssertion: { text: "Enter feed URL..." },
  },
  {
    name: "WebhookOutputNode",
    Component: WebhookOutputNode,
    expectedCategory: "output",
    expectedCredits: 0,
    defaultData: { label: "Webhook Output", url: "https://example.com/hook", params: [] },
    contentAssertion: { text: "https://example.com/hook" },
    placeholderAssertion: { text: "Set webhook URL..." },
  },
  {
    name: "SaveToStorageNode",
    Component: SaveToStorageNode,
    expectedCategory: "output",
    expectedCredits: 0,
    defaultData: { label: "Save to Storage", format: "mp4", quality: "high" },
    contentAssertion: { text: "mp4 (high)" },
  },
  {
    name: "SplitTextNode",
    Component: SplitTextNode,
    expectedCategory: "processing",
    expectedCredits: 0,
    defaultData: { label: "Split Text" },
  },
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

describe.each(SIMPLE_NODES)(
  "$name",
  ({ Component, defaultData, expectedCategory, expectedCredits, contentAssertion, placeholderAssertion }) => {
    it("renders without crashing", () => {
      renderNode(Component, defaultData)
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

    it("passes correct credits to BaseNode", () => {
      renderNode(Component, defaultData)
      expect(screen.getByTestId("base-node")).toHaveAttribute(
        "data-credits",
        String(expectedCredits),
      )
    })

    if (contentAssertion) {
      it("shows expected content", () => {
        renderNode(Component, defaultData)
        expect(screen.getByText(contentAssertion.text)).toBeInTheDocument()
      })
    }

    if (placeholderAssertion) {
      it("shows placeholder when value is empty", () => {
        // Create data with empty/missing values to trigger placeholder
        const emptyData: Record<string, unknown> = { label: defaultData.label }
        renderNode(Component, emptyData)
        expect(screen.getByText(placeholderAssertion.text)).toBeInTheDocument()
      })
    }
  },
)
