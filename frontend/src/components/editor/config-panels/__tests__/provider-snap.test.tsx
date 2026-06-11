/**
 * Provider-snap useEffect tests.
 *
 * Each provider-aware config panel has a fail-safe `useEffect([currentProvider])`
 * (CLAUDE.md "Provider Enum Sync" step 12b) that:
 *   - SNAPS `data.<field>` to the first valid option when the cached value
 *     isn't in the new provider's option set.
 *   - CLEARS `data.<field>` (sets undefined) when the new provider doesn't
 *     expose the lever at all.
 *
 * Without this, persisted workflow data or admin defaults carry stale values
 * across provider switches, the dropdown silently hides them, and the
 * backend route's Zod enum rejects the request at generate-time.
 *
 * These tests render with deliberately mismatched (provider, value) pairs and
 * assert `onUpdate` was called with the expected snap or clear.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { GenerateImageConfig, ModifyImageConfig } from "../image-configs"
import { ImageToVideoConfig, TextToVideoConfig, GenerateVideoConfig } from "../video-configs"
import { LipSyncConfig } from "../audio-configs"

// =============================================================================
// Module-level mocks — keep these as thin as possible. We only care about the
// useEffect firing; rendered UI is incidental.
// =============================================================================

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
vi.mock("@/components/ui/slider", () => ({
  Slider: () => <div data-testid="slider" />,
}))
vi.mock("@/components/ui/switch", () => ({
  Switch: () => <input type="checkbox" />,
}))
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: () => <input type="checkbox" />,
}))
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <div>{children}</div>,
}))
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
}))

// Editor sub-components — render to nothing so we can focus on the effect.
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
vi.mock("@/components/editor/config-panels/connected-media-list", () => ({
  ConnectedMediaList: () => <div />,
  getSourceThumbnail: () => undefined,
}))
// Legacy block still used by video-configs (Task 4 migrates those) — stub it.
vi.mock("@/components/editor/config-panels/final-prompt-preview", () => ({
  FinalPromptPreview: () => <div />,
}))
// Inline final-view (image-configs): mock ONLY the assembly hook so the real
// cinematography walkers aren't pulled in under the partial cinematography-hints
// mock above. prompt-field-final-view is left UNMOCKED — the still-legacy
// video-configs FinalPromptPreview stub doesn't need it, and the toggle
// (label-row → not mounted via the mocked MappableField) / final-view (edit is
// the default) never render in these provider-snap cases anyway, so its lucide
// Pencil import is never exercised.
vi.mock("@/components/editor/config-panels/use-final-prompt-segments", () => ({
  useFinalPromptSegments: () => ({
    promptSegments: [], negativeSegments: [], promptText: "", negativeText: "",
    copyText: "", negativeRouting: null, cineHints: [], refBlock: "",
  }),
  negativeRoutingCaption: () => undefined,
}))
vi.mock("@/components/editor/config-panels/connected-cinematography-sources", () => ({
  ConnectedCinematographySources: () => <div />,
}))
vi.mock("@/components/editor/config-panels/final-audio-prompt-preview", () => ({
  FinalAudioPromptPreview: () => <div />,
}))
vi.mock("@/components/editor/config-panels/connected-audio-sources", () => ({
  ConnectedAudioSources: () => <div />,
}))
vi.mock("@/components/editor/config-panels/prompt-helper-button", () => ({
  PromptHelperButton: () => null,
}))
vi.mock("@/components/editor/config-panels/snippet-menu-button", () => ({
  SnippetMenuButton: () => null,
}))
vi.mock("@/hooks/queries/use-prompt-snippets-queries", () => ({
  useSnippetPool: () => [],
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
vi.mock("@/components/editor/config-panels/camera-motion-picker", () => ({
  CameraMotionPicker: () => null,
}))
vi.mock("@/components/editor/media-editor", () => ({
  useMediaEditor: () => ({ open: vi.fn(), close: vi.fn() }),
  MediaEditorModal: () => null,
}))

// Hooks / stores — useWorkflowStore is used BOTH as a hook (selector) AND
// statically (`.getState()`). Provide both APIs on the mock.
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
vi.mock("@/lib/lazy-with-retry", () => ({
  lazyWithRetry: (loader: any) => {
    // Return a no-op component that won't crash Suspense
    const Comp = () => null
    return Comp as any
  },
}))

// Misc
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock("lucide-react", () => {
  // Build a generous icon-name list to cover all imports across the configs.
  const iconNames = [
    "X", "FileText", "Plus", "UserPlus", "Loader2", "Upload", "UserCircle",
    "Package", "MapPin", "Paintbrush", "Check", "Download", "AlertCircle",
    "Sparkles", "Film", "Music", "Link", "GripVertical", "Scissors", "Trash",
    "Trash2", "Edit", "Edit2", "Edit3", "Copy", "Eye", "EyeOff", "Settings",
    "ChevronDown", "ChevronUp", "ChevronLeft", "ChevronRight", "ArrowLeft",
    "ArrowRight", "ArrowUp", "ArrowDown", "Image", "ImageIcon", "Video",
    "Mic", "MicOff", "Volume", "Volume1", "Volume2", "VolumeX", "Play",
    "Pause", "Stop", "Square", "Circle", "Triangle", "Star", "Heart",
    "Lock", "Unlock", "User", "Users", "Folder", "FolderOpen", "File",
    "Search", "RefreshCw", "RotateCw", "RotateCcw", "Maximize", "Minimize",
    "Maximize2", "Minimize2", "Wand", "Wand2", "Camera", "CameraOff",
    "Globe", "Wifi", "WifiOff", "AlertTriangle", "Info", "HelpCircle",
    "ChevronsUpDown", "ChevronsDown", "ChevronsUp",
  ]
  const out: Record<string, () => null> = {}
  for (const name of iconNames) {
    out[name] = () => null
  }
  return out
})

// =============================================================================
// Helpers
// =============================================================================

function baseGenerateImageData(overrides: Partial<any> = {}): any {
  return {
    label: "Generate Image",
    prompt: "test",
    provider: "nano-banana-pro",
    model: "",
    style: "",
    aspectRatio: "1:1",
    negativePrompt: "",
    fieldMappings: {},
    ...overrides,
  }
}

function baseModifyImageData(overrides: Partial<any> = {}): any {
  return {
    label: "Modify Image",
    prompt: "test",
    provider: "nano-banana",
    style: "",
    fieldMappings: {},
    ...overrides,
  }
}

function baseImageToVideoData(overrides: Partial<any> = {}): any {
  return {
    label: "Image to Video",
    prompt: "test",
    provider: "seedance-2-fast",
    duration: 5,
    fieldMappings: {},
    ...overrides,
  }
}

function baseTextToVideoData(overrides: Partial<any> = {}): any {
  return {
    label: "Text to Video",
    prompt: "test",
    provider: "seedance-2-fast",
    duration: 5,
    fieldMappings: {},
    ...overrides,
  }
}

function baseGenerateVideoData(overrides: Partial<any> = {}): any {
  return {
    label: "Generate Video",
    prompt: "test",
    provider: "seedance-2-fast",
    duration: 5,
    fieldMappings: {},
    ...overrides,
  }
}

function baseLipSyncData(overrides: Partial<any> = {}): any {
  return {
    label: "Lip Sync",
    provider: "kling-avatar",
    fieldMappings: {},
    ...overrides,
  }
}

function commonProps(onUpdate: any, data: any): any {
  return {
    data,
    onUpdate,
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

beforeEach(() => {
  vi.clearAllMocks()
})

// =============================================================================
// GenerateImageConfig
// =============================================================================

describe("GenerateImageConfig — provider-snap useEffect", () => {
  it("clears resolution when provider has no resolution lever", () => {
    // nano-banana (v1) has no entry in IMAGE_RESOLUTION_OPTIONS — the lever
    // doesn't exist. A persisted "1K" must be cleared so the route Zod doesn't
    // see a stale value.
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "nano-banana", resolution: "1K" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).toHaveBeenCalled()
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBeUndefined()
    expect("resolution" in merged).toBe(true)
  })

  it("snaps resolution to first valid value when current value is invalid for new provider", () => {
    // flux supports 1K, 2K only. Stale "4K" must snap to "1K" (first).
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "flux", resolution: "4K" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("1K")
  })

  it("preserves resolution when current value is valid for new provider", () => {
    // nano-banana-pro supports 1K, 2K, 4K. data.resolution = "2K" is valid.
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "nano-banana-pro", resolution: "2K" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    // No resolution-related update should happen.
    for (const [u] of onUpdate.mock.calls) {
      expect("resolution" in u).toBe(false)
    }
  })

  it("clears quality when provider has no quality lever", () => {
    // nano-banana-pro has no quality lever; gpt-image does.
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "nano-banana-pro", quality: "high" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.quality).toBeUndefined()
    expect("quality" in merged).toBe(true)
  })

  it("snaps quality to first valid when invalid for new provider", () => {
    // gpt-image supports medium, high. Stale "premium" snaps to "medium".
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({
      provider: "gpt-image",
      quality: "premium",
      aspectRatio: "1:1", // gpt-image supports 1:1, 3:2, 2:3
    })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.quality).toBe("medium")
  })

  it("snaps aspect ratio to first valid when invalid for new provider", () => {
    // gpt-image supports 1:1, 3:2, 2:3 — "21:9" is invalid.
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "gpt-image", aspectRatio: "21:9" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.aspectRatio).toBe("1:1")
  })

  it("forces resolution=1K for gpt-image-2 when aspectRatio=auto", () => {
    // KIE constraint: gpt-image-2 + aspect=auto requires resolution=1K.
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({
      provider: "gpt-image-2",
      aspectRatio: "auto",
      resolution: "2K",
    })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("1K")
  })

  it("downgrades resolution=4K to 2K for gpt-image-2 when aspectRatio=1:1", () => {
    // KIE constraint: gpt-image-2 + aspect=1:1 cannot use 4K.
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({
      provider: "gpt-image-2",
      aspectRatio: "1:1",
      resolution: "4K",
    })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("2K")
  })

  it("does not snap when stable provider state is consistent", () => {
    // nano-banana-pro + 2K + 16:9 — all valid. No effect-driven onUpdate calls.
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({
      provider: "nano-banana-pro",
      resolution: "2K",
      aspectRatio: "16:9",
    })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    // We expect NO calls, but accept that the legacy referenceImageUrl→urls
    // migration may fire. Assert no resolution/quality/aspectRatio churn:
    for (const [u] of onUpdate.mock.calls) {
      expect("resolution" in u).toBe(false)
      expect("quality" in u).toBe(false)
      expect("aspectRatio" in u).toBe(false)
    }
  })

  it("flux-2-max with no resolution → snaps to '2 MP' (not 0.5 MP options[0])", () => {
    // flux-2-max options are ["0.5 MP","1 MP","2 MP","4 MP"]. Without the
    // flux-2-aware override, options[0] = "0.5 MP". We want "2 MP".
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "flux-2-max" }) // no resolution field
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("2 MP")
  })

  it("flux-2-max with stale '2K' resolution → snaps to '2 MP'", () => {
    // Switching from a provider that had "2K" (e.g. nano-banana-pro) to
    // flux-2-max; "2K" is invalid for flux-2-max, must snap to "2 MP".
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "flux-2-max", resolution: "2K" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("2 MP")
  })

  it("flux-2-pro with no resolution → snaps to '2 MP'", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "flux-2-pro" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("2 MP")
  })

  it("flux-2-klein with no resolution → snaps to '1 MP'", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "flux-2-klein" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("1 MP")
  })

  it("flux-2-max with valid '4 MP' → preserves it", () => {
    // User explicitly picked "4 MP" — do not overwrite.
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "flux-2-max", resolution: "4 MP" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    for (const [u] of onUpdate.mock.calls) {
      expect("resolution" in u).toBe(false)
    }
  })
})

// =============================================================================
// ModifyImageConfig
// =============================================================================

describe("ModifyImageConfig — provider-snap useEffect", () => {
  it("clears resolution when nano-banana-edit (no resolution lever)", () => {
    // nano-banana-edit explicitly forces resolutionOptions to undefined.
    const onUpdate = vi.fn()
    const data = baseModifyImageData({ provider: "nano-banana-edit", resolution: "2K" })
    render(<ModifyImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBeUndefined()
    expect("resolution" in merged).toBe(true)
  })

  it("clears quality when nano-banana-edit (no quality lever)", () => {
    const onUpdate = vi.fn()
    const data = baseModifyImageData({ provider: "nano-banana-edit", quality: "high" })
    render(<ModifyImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.quality).toBeUndefined()
    expect("quality" in merged).toBe(true)
  })

  it("snaps invalid resolution to first valid for flux-i2i", () => {
    // flux-i2i supports 1K, 2K only.
    const onUpdate = vi.fn()
    const data = baseModifyImageData({ provider: "flux-i2i", resolution: "4K" })
    render(<ModifyImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("1K")
  })

  it("forces resolution=1K for gpt-image-2-i2i when aspectRatio=auto", () => {
    const onUpdate = vi.fn()
    const data = baseModifyImageData({
      provider: "gpt-image-2-i2i",
      aspectRatio: "auto",
      resolution: "4K",
    })
    render(<ModifyImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("1K")
  })

  it("clears maskUrl when provider does not support mask", () => {
    // nano-banana (default) is not in I2I_MASK_SUPPORT.
    const onUpdate = vi.fn()
    const data = baseModifyImageData({
      provider: "nano-banana",
      maskUrl: "https://example.com/mask.png",
    })
    render(<ModifyImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.maskUrl).toBeUndefined()
    expect("maskUrl" in merged).toBe(true)
  })

  it("flux-2-pro (modify-image) with stale '2K' → snaps to '2 MP'", () => {
    // flux-2-pro is a valid modify-image provider. Stale "2K" must snap to
    // "2 MP" (the provider default), not options[0] = "0.5 MP".
    const onUpdate = vi.fn()
    const data = baseModifyImageData({ provider: "flux-2-pro", resolution: "2K" })
    render(<ModifyImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("2 MP")
  })

  it("flux-2-max (modify-image) with no resolution → snaps to '2 MP'", () => {
    const onUpdate = vi.fn()
    const data = baseModifyImageData({ provider: "flux-2-max" })
    render(<ModifyImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("2 MP")
  })

  it("flux-2-max (modify-image) with valid '1 MP' → preserves it", () => {
    // "1 MP" is valid for flux-2-max — do not overwrite with the default.
    const onUpdate = vi.fn()
    const data = baseModifyImageData({ provider: "flux-2-max", resolution: "1 MP" })
    render(<ModifyImageConfig {...commonProps(onUpdate, data)} />)
    for (const [u] of onUpdate.mock.calls) {
      expect("resolution" in u).toBe(false)
    }
  })
})

// =============================================================================
// ImageToVideoConfig
// =============================================================================

describe("ImageToVideoConfig — provider-snap useEffect", () => {
  // Regression: previously the Duration <Select> displayed
  // `allowedDurations[0]` when `data.duration` was invalid for the new
  // provider, but `data.duration` itself was NEVER snapped — the user saw
  // "5s" while state held "10". The stale value flowed into
  // buildVideoCreditModelIdentifier (overcharge) and into the provider API
  // (provider rejection or silent fallback).
  it("snaps duration when invalid for new provider", () => {
    // kling supports [5, 10]; minimax supports [5] only. Stale duration=10 on
    // minimax is invalid — must be snapped to 5.
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "minimax", duration: 10 })
    render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.duration).toBe(5)
  })

  it("snaps invalid resolution to first valid for the current provider", () => {
    // veo3 supports 720p, 1080p. Stale "480p" snaps to "720p".
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "veo3", resolution: "480p" })
    render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ resolution: "720p" }))
  })

  it("clears resolution when provider has no resolution lever", () => {
    // minimax has no entry in VIDEO_RESOLUTION_OPTIONS — clear stale value.
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "minimax", resolution: "1080p" })
    render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ resolution: undefined }))
  })

  it("preserves resolution when valid for the current provider", () => {
    // veo3 supports 720p, 1080p. data.resolution = "1080p" is valid.
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "veo3", resolution: "1080p" })
    render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ resolution: expect.anything() }),
    )
  })

  it("preserves resolution as undefined when provider has no lever and value already absent", () => {
    // minimax + no resolution = no-op.
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "minimax" })
    render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ resolution: expect.anything() }),
    )
  })
})

describe("ImageToVideoConfig — Seedance 2 input mode toggle", () => {
  it("renders the Input Mode segmented control for seedance-2-fast", () => {
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "seedance-2-fast" })
    const { getByText } = render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(getByText("Frames")).toBeTruthy()
    expect(getByText("References")).toBeTruthy()
  })

  it("does not render the Input Mode toggle for non-Seedance-2 providers", () => {
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "minimax" })
    const { queryByText } = render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(queryByText("Frames")).toBeNull()
    expect(queryByText("References")).toBeNull()
  })

  it("calls onUpdate with seedance2InputMode: 'references' when References button clicked", async () => {
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "seedance-2-fast", seedance2InputMode: "frames" })
    const { getByText } = render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    getByText("References").click()
    expect(onUpdate).toHaveBeenCalledWith({ seedance2InputMode: "references" })
  })

  it("calls onUpdate with seedance2InputMode: 'frames' when Frames button clicked while in references mode", async () => {
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "seedance-2-fast", seedance2InputMode: "references" })
    const { getByText } = render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    getByText("Frames").click()
    expect(onUpdate).toHaveBeenCalledWith({ seedance2InputMode: "frames" })
  })
})

// =============================================================================
// TextToVideoConfig
// =============================================================================

describe("TextToVideoConfig — provider-snap useEffect", () => {
  // Regression: same duration-snap gap as ImageToVideoConfig.
  it("snaps duration when invalid for new provider", () => {
    const onUpdate = vi.fn()
    const data = baseTextToVideoData({ provider: "minimax", duration: 10 })
    render(<TextToVideoConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.duration).toBe(5)
  })

  it("snaps invalid resolution to first valid for the current provider", () => {
    // veo3 supports 720p, 1080p. Stale "480p" snaps to "720p".
    const onUpdate = vi.fn()
    const data = baseTextToVideoData({ provider: "veo3", resolution: "480p" })
    render(<TextToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ resolution: "720p" }))
  })

  it("clears resolution when provider has no resolution lever", () => {
    // minimax has no resolution entry.
    const onUpdate = vi.fn()
    const data = baseTextToVideoData({ provider: "minimax", resolution: "1080p" })
    render(<TextToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ resolution: undefined }))
  })

  it("preserves valid resolution for current provider", () => {
    const onUpdate = vi.fn()
    const data = baseTextToVideoData({ provider: "veo3", resolution: "1080p" })
    render(<TextToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ resolution: expect.anything() }),
    )
  })
})

// =============================================================================
// LipSyncConfig
// =============================================================================

describe("LipSyncConfig — provider-snap useEffect", () => {
  it("clears resolution when switching to a Replicate provider (no resolution lever)", () => {
    // latentsync is Replicate; resolution lever doesn't apply.
    const onUpdate = vi.fn()
    const data = baseLipSyncData({ provider: "latentsync", resolution: "720p" })
    render(<LipSyncConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ resolution: undefined }))
  })

  it("snaps 1080p to 720p for non-seedance KIE provider", () => {
    // kling-avatar (KIE, no 1080p support) — 1080p invalid, must snap.
    const onUpdate = vi.fn()
    const data = baseLipSyncData({ provider: "kling-avatar", resolution: "1080p" })
    render(<LipSyncConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ resolution: "720p" }))
  })

  it("preserves 1080p for seedance-2 (supports 1080p)", () => {
    const onUpdate = vi.fn()
    const data = baseLipSyncData({ provider: "seedance-2", resolution: "1080p" })
    render(<LipSyncConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ resolution: expect.anything() }),
    )
  })

  it("preserves 720p for kling-avatar (valid value)", () => {
    const onUpdate = vi.fn()
    const data = baseLipSyncData({ provider: "kling-avatar", resolution: "720p" })
    render(<LipSyncConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ resolution: expect.anything() }),
    )
  })

  it("snaps 1080p to 720p for seedance-2-fast (also supports 1080p)", () => {
    // seedance-2-fast supports 1080p; 1080p stays.
    const onUpdate = vi.fn()
    const data = baseLipSyncData({ provider: "seedance-2-fast", resolution: "1080p" })
    render(<LipSyncConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ resolution: expect.anything() }),
    )
  })
})

// =============================================================================
// GenerateVideoConfig — unified i2v + t2v config panel (Task 7.2)
// =============================================================================

describe("GenerateVideoConfig — provider-snap useEffect", () => {
  it("snaps duration when invalid for current provider (minimax → 5)", () => {
    // minimax supports [5] only — stale duration=10 must snap to 5.
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "minimax", duration: 10 })
    render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.duration).toBe(5)
  })

  it("snaps invalid resolution to first valid for the current provider (veo3 480p → 720p)", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "veo3", resolution: "480p" })
    render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ resolution: "720p" }))
  })

  it("clears resolution when provider has no resolution lever (minimax)", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "minimax", resolution: "1080p" })
    render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ resolution: undefined }))
  })

  it("preserves resolution when valid for the current provider (veo3 + 1080p)", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "veo3", resolution: "1080p" })
    render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ resolution: expect.anything() }),
    )
  })

  it("renders without crashing for t2v-only providers in the unified picker (grok)", () => {
    // `grok` only appears in VIDEO_T2V_MODELS; verify GenerateVideoConfig (which
    // uses VIDEO_GEN_MODELS = i2v ∪ t2v) still mounts and reads its provider.
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "grok", duration: 6 })
    expect(() => render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)).not.toThrow()
  })

  it("renders without crashing for i2v-only providers (kling-master)", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "kling-master", duration: 5 })
    expect(() => render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)).not.toThrow()
  })
})
