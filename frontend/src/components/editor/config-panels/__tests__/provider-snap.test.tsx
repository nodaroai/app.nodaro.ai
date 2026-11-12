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
import { GenerateImageConfig, ModifyImageConfig, UpscaleImageConfig } from "../image-configs"
import { ImageToVideoConfig, TextToVideoConfig, GenerateVideoConfig, VideoDepthConfig, VideoToVideoConfig } from "../video-configs"
import { LipSyncConfig } from "../audio-configs"
import { getAspectRatiosForVideoModel, getVideoResolutionOptions } from "../model-options"
import { getModelIdentifier } from "../helpers"
import { WiredSettingsScope } from "../wired-settings-context"
import { videoGenerationCreditId } from "@nodaro/shared/credits"
import { MODEL_CATALOG, VIDEO_DURATION_AUTO, isAutoVideoDuration } from "@nodaro/shared/model-catalog"
import { SEEDANCE_EDIT_REF_VIDEO_SEC } from "@nodaro/shared/models"

// =============================================================================
// Module-level mocks — keep these as thin as possible. We only care about the
// useEffect firing; rendered UI is incidental.
// =============================================================================

// The filter checkbox's lock (`nsfw-filter-checkbox.tsx`) reads the server: no admin lock here.
vi.mock("@/hooks/queries/use-provider-safety-locks", () => ({ useFilterForcedOn: () => false, useProviderSafetyLocks: () => ({ data: [] }) }))
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
  // `disabled` and `value` ride along as attributes so a test can find a
  // locked control and what it shows; no other case reads them.
  Select: ({ children, disabled, value }: any) => <div data-select-disabled={disabled ? "true" : "false"} data-value={value}>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value, disabled }: any) => <option value={value} disabled={disabled}>{children}</option>,
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
  AspectRatioSelector: ({ disabled, value }: any) => <div data-testid="aspect-ratio-selector" data-disabled={disabled ? "true" : "false"} data-value={value} />,
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
// The graph the store holds — a test may wire clips in (the panel reads the
// reference clips' lengths from it, as the node's price does).
const storeGraph = vi.hoisted(() => ({ nodes: [] as any[], edges: [] as any[] }))
vi.mock("@/hooks/use-workflow-store", () => {
  const state = {
    characterDefinitions: [],
    addCharacterDefinition: vi.fn(),
    addNode: vi.fn(),
    selectNode: vi.fn(),
    deleteEdge: vi.fn(),
    get nodes() { return storeGraph.nodes },
    get edges() { return storeGraph.edges },
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
  storeGraph.nodes = []
  storeGraph.edges = []
})

// =============================================================================
// GenerateImageConfig
// =============================================================================

describe("GenerateImageConfig — 'auto' keeps a wired photo's shape on every model", () => {
  // Auto with a photo wired in keeps that photo's shape — natively, or the
  // platform's nearest listed ratio on a model without a native auto — and
  // without one it is the model's default shape. So it is a real choice on
  // every model, and opening the panel must not reset it.
  it("keeps 'auto' on a model without a native auto", () => {
    for (const provider of ["seedream-5-pro", "nano-banana-pro", "flux", "qwen"]) {
      const onUpdate = vi.fn()
      render(<GenerateImageConfig {...commonProps(onUpdate, baseGenerateImageData({ provider, aspectRatio: "auto" }))} />)
      for (const [u] of onUpdate.mock.calls) {
        expect("aspectRatio" in u, provider).toBe(false)
      }
    }
  })

  it("keeps 'auto' with several models selected", () => {
    const onUpdate = vi.fn()
    render(<GenerateImageConfig {...commonProps(onUpdate, baseGenerateImageData({ provider: "seedream-5-pro", providers: ["seedream-5-pro", "flux"], aspectRatio: "auto" }))} />)
    for (const [u] of onUpdate.mock.calls) {
      expect("aspectRatio" in u).toBe(false)
    }
  })

  it("still snaps any other stale ratio to the model's first listed ratio — never to Auto", () => {
    const onUpdate = vi.fn()
    // Seedream lists 1:1 first and has no 4:5.
    render(<GenerateImageConfig {...commonProps(onUpdate, baseGenerateImageData({ provider: "seedream-5-pro", aspectRatio: "4:5" }))} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.aspectRatio).toBe("1:1")
  })

  it("leaves a native-auto model's snap exactly as before", () => {
    const onUpdate = vi.fn()
    // GPT Image 2 lists auto first and has no 3:2.
    render(<GenerateImageConfig {...commonProps(onUpdate, baseGenerateImageData({ provider: "gpt-image-2", aspectRatio: "3:2" }))} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.aspectRatio).toBe("auto")
  })
})

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

  // GPT Image 2 renders every ratio it offers at every size, Auto and 1:1
  // included (no `resolutionsByAspectRatio`): the panel leaves its size alone,
  // an unset ratio (Auto, as the run sends it) too.
  it.each([["auto", "2K"], ["auto", "4K"], ["1:1", "4K"], ["1:1", "2K"], ["16:9", "4K"], [undefined, "4K"]])("keeps gpt-image-2's size at every ratio (%s, %s)", (aspectRatio, resolution) => {
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "gpt-image-2", aspectRatio, resolution })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    for (const [u] of onUpdate.mock.calls) expect("resolution" in u).toBe(false)
  })

  it("a size gpt-image-2 does not list at all still snaps to its first", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "gpt-image-2", aspectRatio: "1:1", resolution: "8K" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("1K")
  })

  it.each(["27:16", "16:27", "9:8", "8:9"])("snaps GPT Image 2.5's 4K to 1K at %s, the only size it renders there", (aspectRatio) => {
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "gpt-image-2-5-flare", aspectRatio, resolution: "4K" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("1K")
  })

  it("keeps GPT Image 2.5's 4K at a ratio that renders it", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "gpt-image-2-5-flare", aspectRatio: "21:9", resolution: "4K" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    for (const [u] of onUpdate.mock.calls) expect("resolution" in u).toBe(false)
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

  it("minimax-h3-image with no resolution → writes '2K', the size it renders (not options[0] 1K)", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateImageData({ provider: "minimax-h3-image" })
    render(<GenerateImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("2K")
  })

  it("minimax-h3-image with a stale '2 MP' → snaps to '2K'; a valid '1K' is kept", () => {
    const stale = vi.fn()
    render(<GenerateImageConfig {...commonProps(stale, baseGenerateImageData({ provider: "minimax-h3-image", resolution: "2 MP" }))} />)
    expect(stale.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {}).resolution).toBe("2K")
    const kept = vi.fn()
    render(<GenerateImageConfig {...commonProps(kept, baseGenerateImageData({ provider: "minimax-h3-image", resolution: "1K" }))} />)
    expect(kept.mock.calls.some(([u]: any) => "resolution" in u)).toBe(false)
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
// UpscaleImageConfig
// =============================================================================

describe("UpscaleImageConfig — upscale factor snap useEffect", () => {
  const upscaleData = (overrides: Record<string, unknown>) => ({ label: "Upscale Image", provider: "recraft-upscale", fieldMappings: {}, ...overrides })
  const mergedUpdates = (onUpdate: ReturnType<typeof vi.fn>): Record<string, unknown> =>
    onUpdate.mock.calls.reduce((acc: Record<string, unknown>, [u]: any) => ({ ...acc, ...u }), {})

  it("clears a Nodaro Image Upscale 8x left on Recraft, which takes no factor", () => {
    const onUpdate = vi.fn()
    render(<UpscaleImageConfig {...commonProps(onUpdate, upscaleData({ provider: "recraft-upscale", upscaleFactor: "8" }))} />)
    const merged = mergedUpdates(onUpdate)
    expect("upscaleFactor" in merged).toBe(true)
    expect(merged.upscaleFactor).toBeUndefined()
  })

  it("snaps a Nodaro Image Upscale 8x left on Topaz to 2, the factor its run renders", () => {
    const onUpdate = vi.fn()
    render(<UpscaleImageConfig {...commonProps(onUpdate, upscaleData({ provider: "topaz-image-upscale", upscaleFactor: "8" }))} />)
    expect(mergedUpdates(onUpdate).upscaleFactor).toBe("2")
  })

  it("keeps a factor the model takes, and writes nothing on a model with no factor stored", () => {
    for (const data of [
      upscaleData({ provider: "nodaro-image-upscale", upscaleFactor: "8" }),
      upscaleData({ provider: "topaz-image-upscale", upscaleFactor: "4" }),
      upscaleData({ provider: "recraft-upscale" }),
      // A saved Recraft node's own 4 is not rewritten when its panel is viewed.
      upscaleData({ provider: "recraft-upscale", upscaleFactor: "4" }),
    ]) {
      const onUpdate = vi.fn()
      render(<UpscaleImageConfig {...commonProps(onUpdate, data)} />)
      expect("upscaleFactor" in mergedUpdates(onUpdate), String(data.provider)).toBe(false)
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

  it("snaps GPT Image 2.5's 2K to 1K at 9:8, the only size it renders there", () => {
    const onUpdate = vi.fn()
    const data = baseModifyImageData({ provider: "gpt-image-2-5-sunburst-i2i", aspectRatio: "9:8", resolution: "2K" })
    render(<ModifyImageConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.resolution).toBe("1K")
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

  it("keeps gpt-image-2-i2i's 4K at 1:1, at Auto and at an unset ratio", () => {
    for (const aspectRatio of ["1:1", "auto", undefined] as const) {
      const onUpdate = vi.fn()
      render(<ModifyImageConfig {...commonProps(onUpdate, baseModifyImageData({ provider: "gpt-image-2-i2i", aspectRatio, resolution: "4K" }))} />)
      for (const [u] of onUpdate.mock.calls) expect("resolution" in u, String(aspectRatio)).toBe(false)
    }
  })

  // Modify Image transforms a source photo, so "auto" (keep the photo's shape)
  // is valid on EVERY model here — the platform resolves it to the model's
  // nearest ratio where the model has no native auto. Opening the panel must
  // not reset it.
  it("keeps 'auto' on a model without a native auto", () => {
    for (const provider of ["seedream-5-pro-i2i", "nano-banana-edit", "flux-kontext", "qwen-edit"]) {
      const onUpdate = vi.fn()
      render(<ModifyImageConfig {...commonProps(onUpdate, baseModifyImageData({ provider, aspectRatio: "auto" }))} />)
      for (const [u] of onUpdate.mock.calls) {
        expect("aspectRatio" in u, provider).toBe(false)
      }
    }
  })

  it("still snaps any other stale ratio to the model's first listed ratio — never to Auto", () => {
    const onUpdate = vi.fn()
    // Seedream lists 1:1 first and has no 4:5.
    render(<ModifyImageConfig {...commonProps(onUpdate, baseModifyImageData({ provider: "seedream-5-pro-i2i", aspectRatio: "4:5" }))} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.aspectRatio).toBe("1:1")
  })

  it("leaves a native-auto model's snap exactly as before", () => {
    const onUpdate = vi.fn()
    // GPT Image 2 (I2I) lists auto first and has no 3:2.
    render(<ModifyImageConfig {...commonProps(onUpdate, baseModifyImageData({ provider: "gpt-image-2-i2i", aspectRatio: "3:2" }))} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(merged.aspectRatio).toBe("auto")
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

  for (const provider of ["gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i", "ideogram-edit", "flux-fill"]) {
    it(`${provider} takes a mask: the mask section shows and a painted mask is kept`, () => {
      const onUpdate = vi.fn()
      const data = baseModifyImageData({ provider, maskUrl: "https://example.com/mask.png" })
      const { getByText, getByAltText } = render(<ModifyImageConfig {...commonProps(onUpdate, data)} />)
      for (const [u] of onUpdate.mock.calls) expect("maskUrl" in u, provider).toBe(false)
      expect(getByText("Inpainting Mask")).toBeTruthy()
      expect(getByAltText("Mask")).toBeTruthy()
    })
  }

  for (const provider of ["gpt-image-2-6-economy-i2i", "gpt-image-2-5-flare-i2i", "gpt-image-2-i2i"]) {
    it(`${provider} takes no mask: no mask section, a stale mask cleared`, () => {
      const onUpdate = vi.fn()
      const data = baseModifyImageData({ provider, maskUrl: "https://example.com/mask.png" })
      const { queryByText } = render(<ModifyImageConfig {...commonProps(onUpdate, data)} />)
      const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
      expect("maskUrl" in merged).toBe(true)
      expect(merged.maskUrl).toBeUndefined()
      expect(queryByText("Inpainting Mask")).toBeNull()
    })
  }

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

describe("GenerateVideoConfig — Seedance 2.5 reference task type", () => {
  // The locks follow the RUN: Aspect ratio and Duration lock only while the
  // shared resolver says the declaration holds, read from the clips' lengths
  // the node's price reads (a clip of unknown length counts as the model's
  // longest, so it locks). Each explanation is ONE line, under the select.
  // Nothing rewrites the node's stored ratio or length.
  const CLIP_URL = "https://cdn.example/clip.mp4"
  const STORED = { provider: "seedance-2-5", aspectRatio: "16:9", duration: 5, resolution: "720p" }
  const EDIT_LINE = "Edit keeps the video's own shape and length."
  const EXTEND_LINE = "Extend keeps the video's own shape."
  const NOT_APPLIED = `Edit needs a reference video of ${SEEDANCE_EDIT_REF_VIDEO_SEC.min}–${SEEDANCE_EDIT_REF_VIDEO_SEC.max} seconds. This one runs as with Auto.`
  const DEFAULT_LENGTH = MODEL_CATALOG["seedance-2-5"]!.defaultDuration as number
  const EXTEND_AUTO_LINE = `Extend runs at ${DEFAULT_LENGTH} seconds when Duration is Auto.`

  /** A wired reference video whose recorded length is `sec` (undefined = not known). */
  function wireClip(sec: number | undefined) {
    storeGraph.nodes = [
      { id: "clip", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Clip", url: CLIP_URL, ...(sec !== undefined ? { generatedResults: [{ url: CLIP_URL, duration: sec }] } : {}) } },
    ]
    storeGraph.edges = [{ id: "e-clip", source: "clip", target: "n1", sourceHandle: "video", targetHandle: "videoReferences" }]
    return [{ id: "clip", type: "upload-video", label: "Clip", targetHandle: "videoReferences" }]
  }

  function open(extra: Record<string, unknown>, clipSec: number | undefined | "none" = 6) {
    const sources = clipSec === "none" ? [] : wireClip(clipSec)
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ ...STORED, ...extra })
    const utils = render(<GenerateVideoConfig {...commonProps(onUpdate, data)} sources={sources} />)
    const ratio = () => utils.getByTestId("aspect-ratio-selector")
    // The length select: the one whose options are the model's lengths in seconds.
    const length = () => utils.container.querySelector('option[value="5"]')!.closest("[data-select-disabled]")!
    const ratioLocked = () => ratio().getAttribute("data-disabled") === "true"
    const lengthLocked = () => length().getAttribute("data-select-disabled") === "true"
    // What the panel WROTE: never an aspect ratio or a length.
    const wroteRatioOrLength = () => onUpdate.mock.calls.some(([u]: any) => "aspectRatio" in u || "duration" in u)
    return { ...utils, onUpdate, data, ratio, length, ratioLocked, lengthLocked, wroteRatioOrLength }
  }

  it("Edit with a 6 s clip: ratio and length locked, the Edit line once, nothing written", () => {
    const p = open({ referenceTaskType: "edit" }, 6)
    expect(p.getByText("Use the reference video as")).toBeTruthy()
    expect(p.ratioLocked()).toBe(true)
    expect(p.lengthLocked()).toBe(true)
    expect(p.getAllByText(EDIT_LINE)).toHaveLength(1)
    expect(p.queryByText(NOT_APPLIED)).toBeNull()
    expect(p.wroteRatioOrLength()).toBe(false)
  })

  it("Edit with a clip of unknown length locks too (the price assumes the same)", () => {
    const p = open({ referenceTaskType: "edit" }, undefined)
    expect(p.ratioLocked()).toBe(true)
    expect(p.lengthLocked()).toBe(true)
    expect(p.getAllByText(EDIT_LINE)).toHaveLength(1)
  })

  it("Edit with a 3 s clip: the run is not an edit — editable, the not-applied line once, priced at the stored length", () => {
    const p = open({ referenceTaskType: "edit" }, 3)
    expect(p.ratioLocked()).toBe(false)
    expect(p.lengthLocked()).toBe(false)
    expect(p.getAllByText(NOT_APPLIED)).toHaveLength(1)
    expect(NOT_APPLIED).toContain("4")
    expect(NOT_APPLIED).toContain("30")
    expect(p.queryByText(EDIT_LINE)).toBeNull()
    expect(p.wroteRatioOrLength()).toBe(false)
    // The run estimate (and the node's pill, generate-video-node.test.tsx) name the stored length's row.
    const node = { id: "n1", type: "generate-video", position: { x: 0, y: 0 }, data: p.data } as any
    expect(getModelIdentifier(node, storeGraph.edges, [...storeGraph.nodes, node])).toBe(
      videoGenerationCreditId({ provider: "seedance-2-5", duration: 5, nodeType: "image-to-video", resolution: "720p", hasVideoRef: true }),
    )
  })

  it("Extend: only the ratio is locked, the Extend line once", () => {
    const p = open({ referenceTaskType: "extend" })
    expect(p.ratioLocked()).toBe(true)
    expect(p.lengthLocked()).toBe(false)
    expect(p.getAllByText(EXTEND_LINE)).toHaveLength(1)
    expect(p.queryByText(EDIT_LINE)).toBeNull()
    expect(p.queryByText(EXTEND_AUTO_LINE)).toBeNull()
    expect(p.wroteRatioOrLength()).toBe(false)
  })

  it("Extend with Duration on Auto says the length that runs, in place of the Auto hint; the stored Auto stays", () => {
    const p = open({ referenceTaskType: "extend", duration: VIDEO_DURATION_AUTO })
    expect(p.getAllByText(EXTEND_AUTO_LINE)).toHaveLength(1)
    expect(p.queryByText(/^Auto: the model picks the length/)).toBeNull()
    expect(p.length().getAttribute("data-value")).toBe(String(VIDEO_DURATION_AUTO))
    expect(p.wroteRatioOrLength()).toBe(false)
    p.unmount()
    // Auto without Extend keeps the ordinary Auto hint.
    const q = open({ duration: VIDEO_DURATION_AUTO })
    expect(q.queryByText(EXTEND_AUTO_LINE)).toBeNull()
    expect(q.getByText(/^Auto: the model picks the length/)).toBeTruthy()
  })

  it("Extend at a stored Auto with a Duration wired in from a Settings node: no Extend line (the panel shows the wired length)", () => {
    // The panel inside the scope the settings panel opens it in, with or
    // without a Duration node on the Settings input.
    const openScoped = (wiredSeconds: number | undefined) => {
      const sources = wireClip(6)
      if (wiredSeconds !== undefined) {
        storeGraph.nodes = [...storeGraph.nodes, { id: "len", type: "duration", position: { x: 0, y: 0 }, data: { label: "Length", seconds: wiredSeconds } }]
        storeGraph.edges = [...storeGraph.edges, { id: "e-len", source: "len", target: "n1", targetHandle: "settings" }]
      }
      const data = baseGenerateVideoData({ ...STORED, referenceTaskType: "extend", duration: VIDEO_DURATION_AUTO })
      return render(
        <WiredSettingsScope nodeId="n1" nodeType="generate-video" data={data}>
          <GenerateVideoConfig {...commonProps(vi.fn(), data)} sources={sources} />
        </WiredSettingsScope>,
      )
    }
    const wiredLength = (MODEL_CATALOG["seedance-2-5"]!.durations as number[]).find((d) => !isAutoVideoDuration(d) && d !== DEFAULT_LENGTH)!
    const wired = openScoped(wiredLength)
    expect(wired.queryByText(EXTEND_AUTO_LINE)).toBeNull()
    wired.unmount()
    // No Duration wired: the line is there, as before.
    storeGraph.nodes = []
    storeGraph.edges = []
    expect(openScoped(undefined).getAllByText(EXTEND_AUTO_LINE)).toHaveLength(1)
  })

  it("Edit, then back to Auto: the stored ratio and length are shown and editable", () => {
    const p = open({ referenceTaskType: "edit" })
    expect(p.ratioLocked()).toBe(true)
    p.rerender(<GenerateVideoConfig {...commonProps(p.onUpdate, baseGenerateVideoData({ ...STORED }))} sources={wireClip(6)} />)
    expect(p.ratioLocked()).toBe(false)
    expect(p.lengthLocked()).toBe(false)
    expect(p.ratio().getAttribute("data-value")).toBe(STORED.aspectRatio)
    expect(p.length().getAttribute("data-value")).toBe(String(STORED.duration))
    expect(p.queryByText(EDIT_LINE)).toBeNull()
    expect(p.wroteRatioOrLength()).toBe(false)
  })

  it("Auto and A reference lock nothing and say nothing", () => {
    for (const extra of [{}, { referenceTaskType: "reference" }]) {
      const p = open(extra)
      expect(p.ratioLocked()).toBe(false)
      expect(p.lengthLocked()).toBe(false)
      for (const line of [EDIT_LINE, EXTEND_LINE, NOT_APPLIED]) expect(p.queryByText(line)).toBeNull()
      p.unmount()
    }
  })

  it("with no reference video the select is gone, nothing is locked, and the stored choice is kept", () => {
    const p = open({ referenceTaskType: "edit" }, "none")
    expect(p.queryByText("Use the reference video as")).toBeNull()
    expect(p.ratioLocked()).toBe(false)
    expect(p.lengthLocked()).toBe(false)
    expect(p.queryByText(NOT_APPLIED)).toBeNull()
    expect(p.onUpdate.mock.calls.some(([u]: any) => "referenceTaskType" in u)).toBe(false)
  })

  it("with Draft on, the select is enabled and locks and explains exactly as with Draft off (a draft declares as any run)", () => {
    const cases: Array<[Record<string, unknown>, number]> = [
      [{ referenceTaskType: "edit" }, 6],
      [{ referenceTaskType: "edit" }, 3],
      [{ referenceTaskType: "extend" }, 6],
      [{ referenceTaskType: "extend", duration: VIDEO_DURATION_AUTO }, 6],
      [{ referenceTaskType: "reference" }, 6],
    ]
    const seen = (p: ReturnType<typeof open>) => ({
      // The task type select: the one whose options are its four choices.
      selectDisabled: p.getByText("The video to edit").closest("[data-select-disabled]")!.getAttribute("data-select-disabled") === "true",
      ratioLocked: p.ratioLocked(),
      lengthLocked: p.lengthLocked(),
      lines: [EDIT_LINE, EXTEND_LINE, NOT_APPLIED, EXTEND_AUTO_LINE].filter((line) => p.queryByText(line) !== null),
      wroteTaskType: p.onUpdate.mock.calls.some(([u]: any) => "referenceTaskType" in u),
      wroteRatioOrLength: p.wroteRatioOrLength(),
    })
    for (const [extra, clipSec] of cases) {
      const off = open({ ...extra, resolution: "480p" }, clipSec)
      const withoutDraft = seen(off)
      off.unmount()
      const on = open({ ...extra, draft: true, resolution: "480p" }, clipSec)
      expect(seen(on), JSON.stringify({ extra, clipSec })).toStrictEqual(withoutDraft)
      expect(withoutDraft.selectDisabled).toBe(false)
      on.unmount()
    }
  })

  it("is not offered on a model that takes no task type, and the panel clears a stale value", () => {
    const p = open({ provider: "seedance-2", referenceTaskType: "edit" })
    expect(p.queryByText("Use the reference video as")).toBeNull()
    expect(p.ratioLocked()).toBe(false)
    expect(p.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ referenceTaskType: undefined }))
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

describe("ImageToVideoConfig / TextToVideoConfig — a stale Seedance 2.5 reference task type", () => {
  // The legacy panels show no "Use the reference video as" select, but both run
  // engines honour the stored value on these node types, so their provider
  // snap clears it on a model that takes none (as Generate Video's does).
  it.each<[string, any, (o: any) => any]>([
    ["Image to Video", ImageToVideoConfig, baseImageToVideoData],
    ["Text to Video", TextToVideoConfig, baseTextToVideoData],
  ])("%s: kept on Seedance 2.5, cleared on a switch to a model that takes none", (_name, Config, baseData) => {
    const onUpdate = vi.fn()
    const wroteTaskType = () => onUpdate.mock.calls.some(([u]: any) => "referenceTaskType" in u)
    const on25 = baseData({ provider: "seedance-2-5", referenceTaskType: "edit" })
    const { rerender } = render(<Config {...commonProps(onUpdate, on25)} />)
    expect(wroteTaskType()).toBe(false)
    rerender(<Config {...commonProps(onUpdate, { ...on25, provider: "seedance-2" })} />)
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ referenceTaskType: undefined }))
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

// =============================================================================
// Start/end frame handling — frameFit / frameDelivery fail-safe + indicator
// =============================================================================

describe("GenerateVideoConfig / ImageToVideoConfig — frame handling fail-safe", () => {
  const frame = [{ id: "img1", type: "upload-image", label: "Start", targetHandle: "startFrame" }]

  it("clears frameDelivery on a model with no reference-image support (the lever does not exist)", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "veo3", frameDelivery: "reference" })
    render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect("frameDelivery" in merged).toBe(true)
    expect(merged.frameDelivery).toBeUndefined()
  })

  it("preserves frameDelivery on a reference-capable model", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "seedance-2", frameDelivery: "reference" })
    render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
    for (const [u] of onUpdate.mock.calls) expect("frameDelivery" in u).toBe(false)
  })

  it("clears a frameFit value the select cannot render (stale / injected), on both panels", () => {
    for (const Comp of [GenerateVideoConfig, ImageToVideoConfig]) {
      const onUpdate = vi.fn()
      const data = baseGenerateVideoData({ provider: "seedance-2-5", frameFit: "stretch" })
      render(<Comp {...commonProps(onUpdate, data)} />)
      const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
      expect("frameFit" in merged).toBe(true)
      expect(merged.frameFit).toBeUndefined()
    }
  })

  it("leaves both fields alone when unset", () => {
    const onUpdate = vi.fn()
    render(<GenerateVideoConfig {...commonProps(onUpdate, baseGenerateVideoData({ provider: "veo3" }))} />)
    for (const [u] of onUpdate.mock.calls) {
      expect("frameFit" in u).toBe(false)
      expect("frameDelivery" in u).toBe(false)
    }
  })

  it("mounts the controls only while a frame is wired", () => {
    const onUpdate = vi.fn()
    const data = baseGenerateVideoData({ provider: "seedance-2-5" })
    const bare = render(<GenerateVideoConfig {...commonProps(onUpdate, data)} />)
    expect(bare.queryByText("Frame fit")).toBeNull()
    bare.unmount()
    const wired = render(<GenerateVideoConfig {...commonProps(onUpdate, data)} sources={frame} />)
    expect(wired.getByText("Frame fit")).toBeTruthy()
    expect(wired.getByText("Send frames as")).toBeTruthy()
  })

  it("the resolved-mode indicator follows auto → reference on the Seedance 2.0 family, not on 2.5", () => {
    const onUpdate = vi.fn()
    const s20 = render(<GenerateVideoConfig {...commonProps(onUpdate, baseGenerateVideoData({ provider: "seedance-2-fast" }))} sources={frame} />)
    expect(s20.getByText(/^Mode: Reference/)).toBeTruthy()
    expect(s20.getByText(/Use @image_1 as the opening \(first\) frame/)).toBeTruthy()
    s20.unmount()
    const s25 = render(<GenerateVideoConfig {...commonProps(onUpdate, baseGenerateVideoData({ provider: "seedance-2-5" }))} sources={frame} />)
    expect(s25.getByText(/^Mode: First Frame/)).toBeTruthy()
    s25.unmount()
    // An explicit frame choice on the 2.0 family keeps the exact-frame mode.
    const forced = render(<GenerateVideoConfig {...commonProps(onUpdate, baseGenerateVideoData({ provider: "seedance-2-fast", frameDelivery: "frame" }))} sources={frame} />)
    expect(forced.getByText(/^Mode: First Frame/)).toBeTruthy()
  })
})

// =============================================================================
// VideoDepthConfig — colormap is per provider (fal: five; Replicate: grayscale
// + inferno); resolution / side-by-side / output fps are fal-only.
// =============================================================================

function baseVideoDepthData(overrides: Partial<any> = {}): any {
  return {
    label: "Video Depth",
    provider: "video-depth-anything",
    modelSize: "large",
    fieldMappings: {},
    ...overrides,
  }
}

describe("VideoDepthConfig — provider-snap useEffect", () => {
  it("switching fal → Replicate snaps a turbo colormap to grayscale and clears the fal-only levers", () => {
    const onUpdate = vi.fn()
    const fal = baseVideoDepthData({ colormap: "turbo", resolution: "720p", sideBySide: true })
    const view = render(<VideoDepthConfig {...commonProps(onUpdate, fal)} />)
    // Valid fal data → nothing to fix.
    expect(onUpdate).not.toHaveBeenCalled()
    view.rerender(<VideoDepthConfig {...commonProps(onUpdate, { ...fal, provider: "depth-anything-frames" })} />)
    // Strict: every cleared lever must be PRESENT as undefined — a plain
    // toHaveBeenCalledWith treats `{ resolution: undefined }` as `{}`.
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls.at(-1)![0]).toStrictEqual({
      colormap: "grayscale",
      resolution: undefined,
      sideBySide: undefined,
    })
  })

  it("keeps inferno on Replicate (it offers grayscale and inferno)", () => {
    const onUpdate = vi.fn()
    render(<VideoDepthConfig {...commonProps(onUpdate, baseVideoDepthData({ provider: "depth-anything-frames", colormap: "inferno" }))} />)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("never invents a colormap the node does not carry", () => {
    const onUpdate = vi.fn()
    render(<VideoDepthConfig {...commonProps(onUpdate, baseVideoDepthData({ provider: "depth-anything-frames" }))} />)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("snaps a stale resolution on fal to auto", () => {
    const onUpdate = vi.fn()
    render(<VideoDepthConfig {...commonProps(onUpdate, baseVideoDepthData({ resolution: "4k" }))} />)
    expect(onUpdate).toHaveBeenCalledWith({ resolution: "auto" })
  })
})

// =============================================================================
// VideoToVideoConfig — Seed follows the catalog's seed capability
// =============================================================================

function baseVideoToVideoData(overrides: Partial<any> = {}): any {
  return {
    label: "Video to Video",
    prompt: "make it black and white",
    provider: "seedance-2-5",
    fieldMappings: {},
    ...overrides,
  }
}

describe("VideoToVideoConfig — seed on a model that takes none", () => {
  // Seedance 2.5 Edit runs on the text-to-video lane and KIE refuses a seed on
  // Seedance 2.5, so a Seed field there is a lever that does nothing. The
  // panel reads `modelTakesSeed` (MODEL_CATALOG `noSeed`) rather than a list.
  it("shows no Seed field for Seedance 2.5 Edit", () => {
    const view = render(<VideoToVideoConfig {...commonProps(vi.fn(), baseVideoToVideoData())} />)
    expect(view.container.querySelector('input[type="number"][placeholder="Random"]')).toBeNull()
  })

  it("clears a stale seed carried onto Seedance 2.5 Edit", () => {
    const onUpdate = vi.fn()
    render(<VideoToVideoConfig {...commonProps(onUpdate, baseVideoToVideoData({ seed: 42 }))} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
    expect(Object.prototype.hasOwnProperty.call(merged, "seed")).toBe(true)
    expect(merged.seed).toBeUndefined()
  })

  it("clears the seed when the provider switches to Seedance 2.5 Edit", () => {
    const onUpdate = vi.fn()
    const view = render(<VideoToVideoConfig {...commonProps(onUpdate, baseVideoToVideoData({ provider: "runway-aleph", seed: 42 }))} />)
    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ seed: undefined }))
    view.rerender(<VideoToVideoConfig {...commonProps(onUpdate, baseVideoToVideoData({ provider: "seedance-2-5", seed: 42 }))} />)
    const last = onUpdate.mock.calls.at(-1)![0]
    expect(Object.prototype.hasOwnProperty.call(last, "seed")).toBe(true)
    expect(last.seed).toBeUndefined()
  })

  it("leaves the seed alone on a provider that takes one", () => {
    const onUpdate = vi.fn()
    render(<VideoToVideoConfig {...commonProps(onUpdate, baseVideoToVideoData({ provider: "wan-videoedit", seed: 42 }))} />)
    for (const [u] of onUpdate.mock.calls) {
      expect(Object.prototype.hasOwnProperty.call(u, "seed")).toBe(false)
    }
  })
})

// =============================================================================
// GPT Image 2.6's output format (PNG, JPEG, WebP, an animated GIF, an SVG)
// =============================================================================

describe("Image panels — the output format", () => {
  const merged = (onUpdate: ReturnType<typeof vi.fn>): Record<string, unknown> =>
    onUpdate.mock.calls.reduce((acc: any, [u]: any) => ({ ...acc, ...u }), {})
  const option = (container: HTMLElement, value: string) =>
    container.querySelector<HTMLOptionElement>(`option[value="${value}"]`)
  const gen = (data: Record<string, unknown>) => {
    const onUpdate = vi.fn()
    const view = render(<GenerateImageConfig {...commonProps(onUpdate, baseGenerateImageData({ provider: "gpt-image-2-6-flare", ...data }))} />)
    return { ...view, onUpdate }
  }
  const mod = (data: Record<string, unknown>) => {
    const onUpdate = vi.fn()
    const view = render(<ModifyImageConfig {...commonProps(onUpdate, baseModifyImageData({ provider: "gpt-image-2-6-flare-i2i", ...data }))} />)
    return { ...view, onUpdate }
  }

  it("offers Format only on one model that writes several", () => {
    expect(option(gen({}).container, "svg")).not.toBeNull()
    expect(option(gen({ provider: "gpt-image-2" }).container, "svg")).toBeNull()
    expect(option(gen({ providers: ["gpt-image-2-6-flare", "nano-banana-pro"] }).container, "svg")).toBeNull()
    expect(option(mod({}).container, "svg")).not.toBeNull()
    expect(option(mod({ provider: "gpt-image-2-i2i" }).container, "svg")).toBeNull()
  })

  it("a GIF shows its frames and speed and hides the ratio and size, which stay on the node", () => {
    for (const open of [gen, mod]) {
      const { getByLabelText, queryByTestId, container, getByText, onUpdate, unmount } = open({ outputFormat: "gif", aspectRatio: "16:9", resolution: "2K" })
      expect(getByLabelText("GIF Frames")).toHaveProperty("type", "range")
      expect(getByLabelText("GIF Frames")).toHaveProperty("value", "9")
      expect(getByLabelText("GIF Speed (ms per frame)")).toHaveProperty("value", "200")
      expect(getByText(/A GIF is square, 512×512 a frame/)).toBeTruthy()
      expect(queryByTestId("aspect-ratio-selector")).toBeNull()
      expect(option(container, "2K")).toBeNull()
      const m = merged(onUpdate)
      expect("aspectRatio" in m).toBe(false)
      expect("resolution" in m).toBe(false)
      unmount()
    }
  })

  it("PNG shows the ratio and size and no GIF or SVG lever", () => {
    const { queryByLabelText, queryByTestId, container } = gen({ outputFormat: "png", gifFrames: 4, svgLevel: "max" })
    expect(queryByTestId("aspect-ratio-selector")).not.toBeNull()
    expect(option(container, "2K")).not.toBeNull()
    expect(queryByLabelText("GIF Frames")).toBeNull()
    expect(option(container, "detailed")).toBeNull()
  })

  it("Economy's GIF takes 4, 9 or 16 frames: a select, not a slider", () => {
    const { queryByLabelText, container } = gen({ provider: "gpt-image-2-6-economy", outputFormat: "gif" })
    expect(queryByLabelText("GIF Frames")).toBeNull()
    for (const n of ["4", "9", "16"]) expect(option(container, n)).not.toBeNull()
  })

  it("an SVG shows its level and no background setting", () => {
    for (const open of [gen, mod]) {
      const { container, unmount } = open({ outputFormat: "svg" })
      expect(option(container, "detailed")).not.toBeNull()
      expect(option(container, "transparent")).toBeNull()
      unmount()
    }
  })

  it("Transparent is greyed with JPEG and GIF, and offered with PNG and WebP", () => {
    for (const [outputFormat, disabled] of [["jpeg", true], ["gif", true], ["png", false], ["webp", false]] as const) {
      const { container, unmount } = gen({ outputFormat })
      expect(option(container, "transparent")?.disabled, outputFormat).toBe(disabled)
      unmount()
    }
  })

  it("the provider-switch fail-safe clears a format the new model does not write", () => {
    for (const { onUpdate } of [
      gen({ provider: "gpt-image-2", outputFormat: "gif" }),
      gen({ providers: ["gpt-image-2-6-flare", "nano-banana-pro"], outputFormat: "jpeg" }),
      mod({ provider: "gpt-image-2-6-economy-i2i", outputFormat: "svg" }),
    ]) {
      const m = merged(onUpdate)
      expect("outputFormat" in m).toBe(true)
      expect(m.outputFormat).toBeUndefined()
    }
  })

  it("keeps a GIF's levers in range and moves a transparent background to auto", () => {
    const g = merged(gen({ outputFormat: "gif", gifFrames: 40, gifFrameDurationMs: 5, background: "transparent", resolution: "2K" }).onUpdate)
    expect(g).toMatchObject({ gifFrames: 16, gifFrameDurationMs: 20, background: "auto" })
    // The transparent background's 1K-only rule no longer applies, so the size stays.
    expect("resolution" in g).toBe(false)
    expect(merged(mod({ outputFormat: "jpeg", background: "transparent" }).onUpdate)).toMatchObject({ background: "auto" })
    // Kept, out of range, while PNG is the file written: the run ignores them.
    const p = merged(gen({ outputFormat: "png", gifFrames: 40, svgLevel: "ultra" }).onUpdate)
    expect("gifFrames" in p).toBe(false)
    expect("svgLevel" in p).toBe(false)
  })

  it("warns that a GIF or an SVG refuses a mask, and keeps the mask", () => {
    for (const outputFormat of ["gif", "svg"]) {
      const { getByText, onUpdate, unmount } = gen({ outputFormat, maskUrl: "https://cdn.nodaro.ai/m.png" })
      expect(getByText(/can't be made with an inpainting mask/)).toBeTruthy()
      expect("maskUrl" in merged(onUpdate)).toBe(false)
      unmount()
    }
    const { queryByText } = gen({ outputFormat: "png", maskUrl: "https://cdn.nodaro.ai/m.png" })
    expect(queryByText(/can't be made with an inpainting mask/)).toBeNull()
  })
})
