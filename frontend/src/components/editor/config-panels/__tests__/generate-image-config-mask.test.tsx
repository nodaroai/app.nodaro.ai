/**
 * GenerateImageConfig — inpaint mask UI.
 *
 * The generate-image config panel doubles as an in-place inpaint editor: when
 * the node has a current result (`data.generatedResults[active].url`) or a
 * connected upstream image, an "Inpainting Mask" section appears. Painting a
 * mask persists BOTH `maskUrl` and `baseImageUrl` (the image the mask applies
 * to) so the worker's inpaint composite knows what to paint over.
 *
 * These tests assert the section's VISIBILITY gate (base image present vs not).
 * The mock setup mirrors provider-snap.test.tsx — every realtime/lazy/UI
 * subcomponent is stubbed so the panel renders deterministically; the mask
 * section is plain JSX (`optimizedImageUrl` is a pure function) so its copy
 * renders even with the modal lazy-stubbed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { GenerateImageConfig } from "../image-configs"

// Realtime stub — frontend vitest has no global @/lib/supabase mock, so any
// component that mounts a realtime hook throws "supabaseUrl is required"
// without this. (Belt-and-suspenders: the subcomponents that mount realtime
// are also stubbed below.)
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

// UI primitives — render to thin DOM so we can focus on the mask section.
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}))
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}))
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))
vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img src={props.src} alt={props.alt} />,
}))

// Editor sub-components — render to nothing.
vi.mock("@/components/editor/config-panels/tag-textarea", () => ({
  TagTextarea: () => <textarea />,
}))
vi.mock("@/components/editor/config-panels/mappable-field", () => ({
  MappableField: ({ children }: any) => <div>{children}</div>,
}))
vi.mock("@/components/editor/config-panels/aspect-ratio-selector", () => ({
  AspectRatioSelector: () => <div data-testid="aspect-ratio-selector" />,
}))
vi.mock("@/components/editor/config-panels/reference-image-list", () => ({
  ReferenceImageList: () => <div />,
}))
vi.mock("@/components/editor/config-panels/injected-reference-list", () => ({
  InjectedReferenceList: () => <div />,
}))
vi.mock("@/components/editor/config-panels/prompt-editor", () => ({
  PromptEditor: () => <div />,
}))
vi.mock("@/components/editor/config-panels/reference-support-warning", () => ({
  ReferenceSupportWarning: () => <div />,
}))
vi.mock("@/components/editor/config-panels/extra-refs-section", () => ({
  ExtraRefsSection: () => <div />,
}))
vi.mock("@/components/editor/config-panels/final-prompt-preview", () => ({
  FinalPromptPreview: () => <div />,
}))
vi.mock("@/components/editor/config-panels/connected-cinematography-sources", () => ({
  ConnectedCinematographySources: () => <div />,
}))
vi.mock("@/components/editor/config-panels/prompt-helper-button", () => ({
  PromptHelperButton: () => null,
}))
vi.mock("@/components/editor/config-panels/model-select-option", () => ({
  ModelSelectOption: ({ value, label }: any) => <option value={value}>{label}</option>,
}))
vi.mock("@/components/editor/config-panels/model-description-hint", () => ({
  ModelDescriptionHint: () => null,
}))
vi.mock("@/components/editor/config-panels/multi-provider-picker", () => ({
  MultiProviderPicker: () => null,
}))
vi.mock("@/components/editor/media-editor", () => ({
  useMediaEditor: () => ({ open: vi.fn(), close: vi.fn() }),
  MediaEditorModal: () => null,
}))

// useWorkflowStore is used BOTH as a hook (selector) AND statically
// (`.getState()`). Provide both APIs on the mock.
vi.mock("@/hooks/use-workflow-store", () => {
  const state = {
    characterDefinitions: [],
    addCharacterDefinition: vi.fn(),
    addNode: vi.fn(),
    selectNode: vi.fn(),
    deleteEdge: vi.fn(),
    nodes: [],
    edges: [],
  }
  const useWorkflowStore: any = (selector: any) => selector(state)
  useWorkflowStore.getState = () => state
  return { useWorkflowStore }
})
vi.mock("@/ee/hooks/use-model-credits", () => ({
  prefetchModelCredits: vi.fn(),
  useModelCredits: () => ({ data: null, isLoading: false }),
}))
vi.mock("@/lib/cinematography-hints", () => ({
  hasConnectedStyleNode: () => false,
}))
vi.mock("@/lib/multi-provider/intersect-model-options", () => ({
  intersectModelOptions: () => ({
    aspectRatios: [],
    resolutions: [],
    qualities: [],
    supportsReferenceImage: false,
  }),
}))
// Lazy modal/asset components → no-op so Suspense doesn't try to fetch a chunk.
vi.mock("@/lib/lazy-with-retry", () => ({
  lazyWithRetry: () => {
    const Comp = () => null
    return Comp as any
  },
}))

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock("lucide-react", () => {
  const iconNames = [
    "X", "FileText", "Plus", "UserPlus", "Loader2", "Upload", "UserCircle",
    "Package", "MapPin", "Paintbrush", "Check", "Wand2", "Sparkles",
  ]
  const out: Record<string, () => null> = {}
  for (const name of iconNames) out[name] = () => null
  return out
})

function commonProps(data: any): any {
  return {
    data,
    onUpdate: vi.fn(),
    sources: [],
    fieldMappings: {},
    onMapField: vi.fn(),
    nodes: [],
    edges: [],
    nodeRefs: [],
    refMap: new Map<string, string>(),
    variableDisplayMode: "names" as const,
    nodeId: "n1",
  }
}

function baseData(overrides: Partial<any> = {}): any {
  return {
    label: "Generate Image",
    prompt: "test",
    provider: "gpt-image-2",
    model: "",
    style: "",
    aspectRatio: "1:1",
    negativePrompt: "",
    fieldMappings: {},
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GenerateImageConfig inpaint", () => {
  it("shows the Inpainting Mask section when a base image is available", () => {
    // generatedResults[active].url is the in-place inpaint base.
    const data = baseData({ generatedResults: [{ url: "https://r2/cur.png" }], activeResultIndex: 0 })
    render(<GenerateImageConfig {...commonProps(data)} />)
    expect(screen.getByText(/Inpainting Mask/i)).toBeInTheDocument()
    expect(screen.getByText(/Paint Mask/i)).toBeInTheDocument()
  })

  it("hides the mask section when there is no base image", () => {
    render(<GenerateImageConfig {...commonProps(baseData())} />)
    expect(screen.queryByText(/Inpainting Mask/i)).not.toBeInTheDocument()
  })
})
