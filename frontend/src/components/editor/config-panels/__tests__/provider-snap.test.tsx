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
import { getAspectRatiosForVideoModel, getVideoResolutionOptions } from "../model-options"

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
vi.mock("@/lib/picker-ui", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  PromptEditor: () => <div />,
  CameraMotionPicker: () => null,
}))
vi.mock("@/components/editor/config-panels/reference-support-warning", () => ({
  ReferenceSupportWarning: () => <div />,
}))
vi.mock("@/components/editor/config-panels/connected-media-list", () => ({
  ConnectedMediaList: () => <div />,
  getSourceThumbnail: () => undefined,
}))
// Inline final-view: mock ONLY the assembly hook so the real cinematography
// walkers aren't pulled in under the partial cinematography-hints mock above.
// This covers image-configs AND video-configs (both now consume the hook for
// their inline final-view; the standalone FinalPromptPreview was removed in
// Task 4). prompt-field-final-view is left UNMOCKED — the toggle (label-row →
// not mounted via the mocked MappableField) / final-view (edit is the default)
// never render in these provider-snap cases anyway, so its lucide Pencil import
// is never exercised.
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
vi.mock("lucide-react", () => new Proxy({}, {
  // Any icon name resolves to a null component — the real package (rich lane)
  // imports icons this test cannot enumerate (Dog, Car, ...).
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

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

  it("snaps stale seedance resolution to 2K when switching to minimax-h3 (two-rate lever, 2K default)", () => {
    // A node configured for seedance-2 carries resolution "720p"; minimax-h3's
    // catalog lever is ["2K", "768P"], so the fail-safe must snap the stale
    // value to opts[0] ("2K" — the KIE default and what billing collapses
    // non-768P values to anyway).
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "minimax-h3", resolution: "720p" })
    render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ resolution: "2K" }))
  })

  it("preserves a valid 768P selection on minimax-h3 (no snap)", () => {
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "minimax-h3", resolution: "768P" })
    render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ resolution: expect.anything() }),
    )
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

describe("ImageToVideoConfig — Seedance 2 resolved-mode indicator", () => {
  // The frames-vs-references TOGGLE was removed: there is no longer a user
  // lever. The backend resolver (resolveSeedance2Inputs) decides the mode at
  // run time from the connected inputs; the panel only DISPLAYS the resolved
  // mode. These tests pin the new read-only indicator and guard against any
  // regression that re-introduces a chooser or a seedance2InputMode write.

  it("shows a read-only resolved-mode indicator for seedance-2-fast (no toggle, no write)", () => {
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "seedance-2-fast" })
    // No connections → strict First Frame mode.
    const { getByText, queryByRole } = render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(getByText(/^Mode:/)).toBeTruthy()
    expect(getByText(/^Mode: First Frame/)).toBeTruthy()
    // No segmented chooser buttons.
    expect(queryByRole("button", { name: "Frames" })).toBeNull()
    expect(queryByRole("button", { name: "References" })).toBeNull()
    // Never writes the removed lever.
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ seedance2InputMode: expect.anything() }),
    )
  })

  it("resolves to Reference mode when a reference image is connected", () => {
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "seedance-2-fast" })
    const sources = [
      { id: "img1", type: "upload-image", label: "Ref", targetHandle: "references" },
    ]
    const { getByText } = render(
      <ImageToVideoConfig {...commonProps(onUpdate, data)} sources={sources} />,
    )
    expect(getByText(/^Mode: Reference/)).toBeTruthy()
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ seedance2InputMode: expect.anything() }),
    )
  })

  it("does not render the indicator for non-Seedance-2 providers", () => {
    const onUpdate = vi.fn()
    const data = baseImageToVideoData({ provider: "minimax" })
    const { queryByText } = render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
    expect(queryByText(/^Mode:/)).toBeNull()
  })
})

describe("GenerateVideoConfig — Seedance 2 resolved-mode indicator", () => {
  // The unified generate-video node exposes the SAME read-only indicator (no
  // mode chooser, no seedance2InputMode write) — its connection signals come
  // from per-handle sources.

  it("shows a read-only resolved-mode indicator for seedance-2-fast (no toggle, no write)", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "seedance-2-fast" })
    const { getByText, queryByRole } = render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
    expect(getByText(/^Mode:/)).toBeTruthy()
    expect(getByText(/^Mode: First Frame/)).toBeTruthy()
    expect(queryByRole("button", { name: "Frames" })).toBeNull()
    expect(queryByRole("button", { name: "References" })).toBeNull()
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ seedance2InputMode: expect.anything() }),
    )
  })

  it("resolves to Reference mode when a reference image is connected to imageReferences", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "seedance-2-fast" })
    const sources = [
      { id: "img1", type: "upload-image", label: "Ref", targetHandle: "imageReferences" },
    ]
    const { getByText } = render(
      <GenerateVideoConfig {...commonProps(onUpdate, data)} sources={sources} />,
    )
    expect(getByText(/^Mode: Reference/)).toBeTruthy()
    expect(onUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ seedance2InputMode: expect.anything() }),
    )
  })

  it("does not render the indicator for non-Seedance-2 providers", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "minimax" })
    const { queryByText } = render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
    expect(queryByText(/^Mode:/)).toBeNull()
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

  it("clears resolution for a fal provider — sync-lipsync-v3 is NOT KIE (audit fix)", () => {
    // sync-lipsync-v3 is fal; without the FAL_LIP_SYNC_PROVIDERS exclusion in
    // isKie it would render the KIE resolution dropdown + persist a stale
    // data.resolution the lip-sync route's Zod enum rejects.
    const onUpdate = vi.fn()
    const data = baseLipSyncData({ provider: "sync-lipsync-v3", resolution: "720p" })
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

  it("snaps stale 1080p to 720p for seedance-2-fast (no fast 1080p SKU)", () => {
    // seedance-2-fast is 480p/720p only — a stale 1080p must snap to the default 720p.
    const onUpdate = vi.fn()
    const data = baseLipSyncData({ provider: "seedance-2-fast", resolution: "1080p" })
    render(<LipSyncConfig {...commonProps(onUpdate, data)} />)
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: "720p" }),
    )
  })

  it("keeps 1080p for the full seedance-2 (real 1080p SKU)", () => {
    const onUpdate = vi.fn()
    const data = baseLipSyncData({ provider: "seedance-2", resolution: "1080p" })
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

// =============================================================================
// Wan 3.0 + Gemini Omni Flash — render == billed defaults
// =============================================================================
// Wan 3.0's catalog `resolutions` are ASCENDING (480p first), but its BARE
// credit identifier — and `runWan3`'s own wire default — are the 5s @ 720p
// tier. If the panel persisted `opts[0]` the node would carry 480p while the
// badge quoted (and the runner rendered) 720p. These pin the explicit persist.
//
// Gemini Omni Flash inherits the family branches from `isGeminiOmniProvider`;
// before that swap it fell through to the generic path and showed the 4s
// dropdown default while the credit id and the KIE payload both used 8s.

describe("GenerateVideoConfig — Wan 3 / Gemini Omni Flash defaults", () => {
  const optionValues = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll("option")).map((o) => o.getAttribute("value") ?? "")

  for (const provider of ["wan-3", "wan-3-prime"]) {
    it(`${provider}: persists duration 5 + resolution "720p" + aspectRatio "adaptive" when all are unset`, () => {
      const onUpdate = vi.fn()
      const data = baseGenerateVideoData({ provider, duration: undefined, resolution: undefined, aspectRatio: undefined })
      render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
      const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
      expect(merged.duration).toBe(5)
      expect(merged.resolution).toBe("720p")
      // The backend DAG path fills "adaptive" for an untouched Wan node, so the
      // panel must too — otherwise a single-node run and a workflow run submit
      // different aspect ratios for the same untouched node.
      expect(merged.aspectRatio).toBe("adaptive")
    })

    it(`${provider}: an UNSUPPORTED resolution lands on 720p, not opts[0] (480p)`, () => {
      // Same rule the shared credit identifier applies: unsupported and omitted
      // both collapse to the declared 720p default, so a stale "2K" carried in
      // from minimax-h3 must not silently become the cheapest 480p tier.
      const onUpdate = vi.fn()
      const data = baseGenerateVideoData({ provider, duration: 5, resolution: "2K" })
      render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
      const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
      expect(merged.resolution).toBe("720p")
    })

    it(`${provider}: preserves an explicitly picked valid resolution (480p)`, () => {
      const onUpdate = vi.fn()
      const data = baseGenerateVideoData({ provider, duration: 8, resolution: "480p" })
      render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
      for (const [u] of onUpdate.mock.calls) {
        expect("resolution" in u).toBe(false)
      }
    })

    it(`${provider}: preserves "adaptive" (its catalog default ratio)`, () => {
      const onUpdate = vi.fn()
      const data = baseGenerateVideoData({ provider, duration: 5, resolution: "720p", aspectRatio: "adaptive" })
      render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
      for (const [u] of onUpdate.mock.calls) {
        expect("aspectRatio" in u).toBe(false)
      }
    })

    it(`${provider}: renders its own resolution lever (the isWan3 block exists)`, () => {
      // GenerateVideoConfigImpl has NO generic resolution control — every
      // family owns a bespoke block. Without one, Wan 3 would ship with no
      // resolution UI at all and every run would take the wire default.
      const { container } = render(
        <GenerateVideoConfig {...commonProps(vi.fn(), baseGenerateVideoData({ provider, duration: 5, resolution: "720p" }))} />,
      )
      const values = optionValues(container)
      expect(values).toEqual(expect.arrayContaining(["480p", "720p", "1080p"]))
    })

    it(`${provider}: offers the full contiguous 2-30s duration ladder`, () => {
      const { container } = render(
        <GenerateVideoConfig {...commonProps(vi.fn(), baseGenerateVideoData({ provider, duration: 5, resolution: "720p" }))} />,
      )
      const values = optionValues(container)
      for (const d of [2, 5, 15, 30]) expect(values).toContain(String(d))
    })
  }

  it("gemini-omni-flash: persists the 8s default when duration is unset", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "gemini-omni-flash", duration: undefined })
    render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.duration).toBe(8)
  })

  it("gemini-omni-flash: renders the family resolution block from its OWN catalog row", () => {
    // Pins the two hardcoded `"gemini-omni-video"` arguments that used to sit
    // inside this block: the gate alone would render the SIBLING's option list.
    const { container } = render(
      <GenerateVideoConfig
        {...commonProps(vi.fn(), baseGenerateVideoData({ provider: "gemini-omni-flash", duration: 8, resolution: "1080p" }))}
      />,
    )
    const values = optionValues(container)
    for (const r of (getVideoResolutionOptions("gemini-omni-flash") ?? [])) {
      expect(values).toContain(r.value)
    }
  })

  it("gemini-omni-flash: preserves a valid 4K resolution", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "gemini-omni-flash", duration: 8, resolution: "4k" })
    render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
    for (const [u] of onUpdate.mock.calls) {
      expect("resolution" in u).toBe(false)
    }
  })
})

// =============================================================================
// Aspect-ratio snap on provider switch (adaptive-default safety net)
// =============================================================================
// Seedance 2 defaults aspectRatio to "adaptive" and also exposes the wider
// fixed set (21:9 / 4:3 / 3:4). When a node carrying one of those values is
// switched to a provider whose aspect set lacks it, the fail-safe useEffect
// MUST snap it to that provider's first valid option — otherwise the backend
// route's Zod aspect enum rejects the run at generate-time. The snap reads the
// SAME option source the dropdown renders (getAspectRatiosForVideoModel), so we
// assert against that rather than hardcoding the target ratio.
describe("video configs — aspectRatio snap on provider switch", () => {
  const MINIMAX_FIRST = getAspectRatiosForVideoModel("minimax")[0]!.value

  const cases: Array<[string, (o: Partial<any>) => any, (props: any) => any]> = [
    ["ImageToVideoConfig", baseImageToVideoData, ImageToVideoConfig],
    ["TextToVideoConfig", baseTextToVideoData, TextToVideoConfig],
    ["GenerateVideoConfig", baseGenerateVideoData, GenerateVideoConfig],
  ]

  for (const [name, baseData, Config] of cases) {
    it(`${name}: snaps stale "adaptive" → first valid option when switching to a non-Seedance provider`, () => {
      // minimax has no "adaptive" (only the generic VIDEO_RATIOS fallback /
      // its own catalog set). A defaulted-adaptive Seedance node switched to
      // minimax must snap so the t2v/i2v Zod enum accepts the value.
      const onUpdate = vi.fn()
      const data = baseData({ provider: "minimax", aspectRatio: "adaptive", duration: 5 })
      render(<Config {...commonProps(onUpdate, data)} />)
      const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
      expect(merged.aspectRatio).toBe(MINIMAX_FIRST)
      // sanity: the snapped value is actually valid for minimax
      expect(getAspectRatiosForVideoModel("minimax").some((o) => o.value === merged.aspectRatio)).toBe(true)
    })

    it(`${name}: snaps stale "21:9" → first valid option when switching to minimax`, () => {
      const onUpdate = vi.fn()
      const data = baseData({ provider: "minimax", aspectRatio: "21:9", duration: 5 })
      render(<Config {...commonProps(onUpdate, data)} />)
      const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
      expect(merged.aspectRatio).toBe(MINIMAX_FIRST)
    })

    it(`${name}: preserves a valid Seedance ratio ("21:9" on seedance-2-fast)`, () => {
      // 21:9 IS valid for Seedance 2 — must not be snapped/cleared.
      const onUpdate = vi.fn()
      const data = baseData({ provider: "seedance-2-fast", aspectRatio: "21:9", duration: 5 })
      render(<Config {...commonProps(onUpdate, data)} />)
      for (const [u] of onUpdate.mock.calls) {
        expect("aspectRatio" in u).toBe(false)
      }
    })

    it(`${name}: leaves aspectRatio untouched when unset (undefined stays undefined)`, () => {
      // An unset value must NOT be snapped — it resolves to the provider's own
      // run default (adaptive for Seedance, undefined for others). Snapping it
      // would persist a value the run-default logic deliberately leaves open.
      const onUpdate = vi.fn()
      const data = baseData({ provider: "minimax", duration: 5 })
      render(<Config {...commonProps(onUpdate, data)} />)
      for (const [u] of onUpdate.mock.calls) {
        expect("aspectRatio" in u).toBe(false)
      }
    })
  }
})

describe("ImageToVideoConfig / TextToVideoConfig — Wan 3.0 parity with the unified panel", () => {
  // `wan-3` / `wan-3-prime` are listed in BOTH VIDEO_I2V_MODELS and
  // VIDEO_T2V_MODELS, so the two dedicated nodes must be able to configure
  // them. Two regressions are pinned here:
  //   1. the generic fail-safe snap wrote `opts[0]` = "480p" — the CHEAPEST
  //      tier — for a stale resolution, while the credit identifier, the DAG
  //      payload fill and `runWan3` all resolve an unset value to 720p. The
  //      snap now routes through the shared `uiResolutionFill`.
  //   2. neither panel had a wan block at all, so the model rendered at wire
  //      defaults with no visible resolution / aspect / audio control.
  const optionValues = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll("option")).map((o) => o.getAttribute("value") ?? "")

  for (const provider of ["wan-3", "wan-3-prime"]) {
    it(`${provider}: ImageToVideoConfig snaps a stale resolution to 720p, never opts[0] (480p)`, () => {
      const onUpdate = vi.fn()
      const data = baseImageToVideoData({ provider, resolution: "2K" })
      render(<ImageToVideoConfig {...commonProps(onUpdate, data)} />)
      const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
      expect(merged.resolution).toBe("720p")
    })

    it(`${provider}: TextToVideoConfig snaps a stale resolution to 720p, never opts[0] (480p)`, () => {
      const onUpdate = vi.fn()
      const data = baseTextToVideoData({ provider, resolution: "2K" })
      render(<TextToVideoConfig {...commonProps(onUpdate, data)} />)
      const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
      expect(merged.resolution).toBe("720p")
    })

    it(`${provider}: ImageToVideoConfig renders the full resolution ladder`, () => {
      const { container } = render(
        <ImageToVideoConfig {...commonProps(vi.fn(), baseImageToVideoData({ provider, resolution: "720p" }))} />,
      )
      expect(optionValues(container)).toEqual(expect.arrayContaining(["480p", "720p", "1080p"]))
    })

    it(`${provider}: TextToVideoConfig renders the full resolution ladder`, () => {
      const { container } = render(
        <TextToVideoConfig {...commonProps(vi.fn(), baseTextToVideoData({ provider, resolution: "720p" }))} />,
      )
      expect(optionValues(container)).toEqual(expect.arrayContaining(["480p", "720p", "1080p"]))
    })

    it(`${provider}: both panels preserve an explicitly picked 480p`, () => {
      for (const [Panel, base] of [
        [ImageToVideoConfig, baseImageToVideoData],
        [TextToVideoConfig, baseTextToVideoData],
      ] as const) {
        const onUpdate = vi.fn()
        render(<Panel {...commonProps(onUpdate, base({ provider, resolution: "480p" }))} />)
        for (const [u] of onUpdate.mock.calls) {
          expect("resolution" in u).toBe(false)
        }
      }
    })
  }
})
