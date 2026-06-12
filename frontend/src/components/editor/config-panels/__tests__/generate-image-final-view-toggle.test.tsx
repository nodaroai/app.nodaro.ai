/**
 * Integration: the inline Edit⇄Final toggle on the generate-image config panel.
 *
 * Unlike the unit tests (which render PromptFieldModeToggle / usePromptFieldMode
 * in isolation), this drives the WHOLE panel against the REAL useWorkflowStore so
 * we prove the wiring end-to-end:
 *   - clicking the prompt field's "Show final prompt" toggle swaps the editor for
 *     the final-view (and the negative field is independent),
 *   - the mode persists by writing `data.__promptFinalView` via updateNodeData,
 *   - clicking "Edit prompt" swaps back and drops the key.
 *
 * MappableField is mocked to render BOTH `labelAction` and `children` (the real
 * one does too — children only when unmapped) so the toggle in the label row is
 * reachable. The assembly hook is stubbed (we test wiring, not assembly — that's
 * use-final-prompt-segments.test.tsx); PromptEditor + PromptFieldFinalView are
 * stubbed to recognizable testids so we can assert which one is mounted.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

// --- Real store, but its import-time deps stubbed (mirror use-prompt-field-mode.test) ---
vi.mock("@xyflow/react", () => ({
  applyNodeChanges: (_c: unknown, n: unknown) => n,
  applyEdgeChanges: (_c: unknown, e: unknown) => e,
  addEdge: (c: Record<string, unknown>, e: unknown[]) => [...e, { ...c, id: "e1" }],
}))
vi.mock("@/components/editor/workflow-editor/execution-graph", () => ({
  extractNodeOutput: () => "",
}))
vi.mock("@/components/editor/workflow-editor/node-input-resolver", () => ({
  extractNodeOutputAsList: () => [],
}))

// --- UI primitives → thin DOM ---
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))
vi.mock("@/components/ui/textarea", () => ({ Textarea: (props: any) => <textarea {...props} /> }))
vi.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }))
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))
vi.mock("@/components/ui/separator", () => ({ Separator: () => <hr /> }))
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

// --- Editor sub-components ---
vi.mock("@/components/editor/config-panels/tag-textarea", () => ({
  // Negative field's edit-mode body (generate-image uses TagTextarea here).
  TagTextarea: () => <div data-testid="negative-editor" />,
}))
// MappableField must surface BOTH labelAction (the toggle) AND children (the body)
// so the toggle is clickable and the swap is observable.
vi.mock("@/components/editor/config-panels/mappable-field", () => ({
  MappableField: ({ label, labelAction, children }: any) => (
    <div data-testid={`field-${label}`}>
      <div>{labelAction}</div>
      <div>{children}</div>
    </div>
  ),
}))
vi.mock("@/components/editor/config-panels/aspect-ratio-selector", () => ({
  AspectRatioSelector: () => <div data-testid="aspect-ratio-selector" />,
}))
vi.mock("@/components/editor/config-panels/reference-image-list", () => ({ ReferenceImageList: () => <div /> }))
vi.mock("@/components/editor/config-panels/injected-reference-list", () => ({ InjectedReferenceList: () => <div /> }))
vi.mock("@/components/editor/config-panels/prompt-editor", () => ({
  // Prompt field's edit-mode body.
  PromptEditor: () => <div data-testid="prompt-editor" />,
}))
vi.mock("@/components/editor/config-panels/reference-support-warning", () => ({ ReferenceSupportWarning: () => <div /> }))
vi.mock("@/components/editor/config-panels/extra-refs-section", () => ({ ExtraRefsSection: () => <div /> }))
vi.mock("@/components/editor/config-panels/connected-cinematography-sources", () => ({ ConnectedCinematographySources: () => <div /> }))
vi.mock("@/components/editor/config-panels/prompt-helper-button", () => ({ PromptHelperButton: () => null }))
vi.mock("@/components/editor/config-panels/snippet-menu-button", () => ({ SnippetMenuButton: () => null }))
vi.mock("@/components/editor/config-panels/model-select-option", () => ({
  ModelSelectOption: ({ value, label }: any) => <option value={value}>{label}</option>,
}))
vi.mock("@/components/editor/config-panels/model-description-hint", () => ({ ModelDescriptionHint: () => null }))
vi.mock("@/components/editor/config-panels/multi-provider-picker", () => ({ MultiProviderPicker: () => null }))
vi.mock("@/components/editor/media-editor", () => ({
  useMediaEditor: () => ({ open: vi.fn(), close: vi.fn() }),
  MediaEditorModal: () => null,
}))
// The final-view body — recognizable testid so we can assert the swap.
vi.mock("@/components/editor/config-panels/prompt-field-final-view", () => ({
  PromptFieldFinalView: () => <div data-testid="final-view" />,
  // Keep the REAL toggle button (label/title/aria + onToggle) so a click drives
  // the real usePromptFieldMode → updateNodeData path.
  PromptFieldModeToggle: ({ mode, onToggle }: any) => (
    <button type="button" aria-label={mode === "edit" ? "Show final prompt" : "Edit prompt"} onClick={onToggle}>
      toggle
    </button>
  ),
}))
vi.mock("@/components/editor/config-panels/use-final-prompt-segments", () => ({
  useFinalPromptSegments: () => ({
    promptSegments: [], negativeSegments: [], promptText: "a knight", negativeText: "",
    copyText: "", negativeRouting: null, cineHints: [], refBlock: "",
  }),
  negativeRoutingCaption: () => undefined,
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({
  prefetchModelCredits: vi.fn(),
  useModelCredits: () => ({ data: null, isLoading: false }),
}))
vi.mock("@/lib/cinematography-hints", () => ({ hasConnectedStyleNode: () => false }))
vi.mock("@/lib/multi-provider/intersect-model-options", () => ({
  intersectModelOptions: () => ({ aspectRatios: [], resolutions: [], qualities: [], supportsReferenceImage: false }),
}))
vi.mock("@/lib/lazy-with-retry", () => ({ lazyWithRetry: () => (() => null) as any }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
vi.mock("@/hooks/queries/use-prompt-snippets-queries", () => ({ useSnippetPool: () => [] }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("lucide-react", () => {
  const names = [
    "X", "FileText", "Plus", "UserPlus", "Loader2", "Upload", "UserCircle", "Package",
    "MapPin", "Paintbrush", "Check", "Wand2", "Sparkles", "Eye", "EyeOff", "Pencil", "Copy",
  ]
  const out: Record<string, () => null> = {}
  for (const n of names) out[n] = () => null
  return out
})

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { GenerateImageConfig } from "../image-configs"

const NODE_ID = "img1"

function commonProps(): any {
  return {
    data: useWorkflowStore.getState().nodes[0].data,
    onUpdate: (patch: Record<string, unknown>) => useWorkflowStore.getState().updateNodeData(NODE_ID, patch),
    sources: [],
    fieldMappings: {},
    onMapField: vi.fn(),
    nodes: useWorkflowStore.getState().nodes,
    edges: [],
    nodeRefs: [],
    refMap: new Map<string, string>(),
    variableDisplayMode: "names" as const,
    nodeId: NODE_ID,
  }
}

const dataOf = () =>
  useWorkflowStore.getState().nodes.find((n) => n.id === NODE_ID)?.data as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  useWorkflowStore.setState({
    nodes: [
      {
        id: NODE_ID,
        type: "generate-image",
        position: { x: 0, y: 0 },
        data: { label: "Generate Image", prompt: "a knight", provider: "nano-banana-pro", negativePrompt: "" },
      },
    ],
    edges: [],
    isReadOnly: false,
  } as never)
})

describe("GenerateImageConfig — inline final-view toggle (integration)", () => {
  it("swaps the prompt editor for the final view and persists mode via node data", () => {
    render(<GenerateImageConfig {...commonProps()} />)

    // Edit is the default: the prompt editor is shown, the final view is not.
    const promptField = screen.getByTestId("field-Prompt")
    expect(within(promptField).getByTestId("prompt-editor")).toBeInTheDocument()
    expect(within(promptField).queryByTestId("final-view")).not.toBeInTheDocument()
    expect(dataOf().__promptFinalView).toBeUndefined()

    // Click the prompt field's toggle → mode flips to final, persisted in data.
    fireEvent.click(within(promptField).getByRole("button", { name: "Show final prompt" }))
    expect(dataOf().__promptFinalView).toEqual(["prompt"])

    // Re-render with the updated data (the panel reads data via props).
    render(<GenerateImageConfig {...commonProps()} />)
    const promptFieldFinal = screen.getAllByTestId("field-Prompt").at(-1)!
    expect(within(promptFieldFinal).getByTestId("final-view")).toBeInTheDocument()
    expect(within(promptFieldFinal).queryByTestId("prompt-editor")).not.toBeInTheDocument()
    // The toggle now offers "Edit prompt".
    expect(within(promptFieldFinal).getByRole("button", { name: "Edit prompt" })).toBeInTheDocument()
  })

  it("toggling back to edit removes the key entirely (no empty array left behind)", () => {
    useWorkflowStore.setState({
      nodes: [
        {
          id: NODE_ID,
          type: "generate-image",
          position: { x: 0, y: 0 },
          data: { label: "Generate Image", prompt: "a knight", provider: "nano-banana-pro", __promptFinalView: ["prompt"] },
        },
      ],
      edges: [],
      isReadOnly: false,
    } as never)

    render(<GenerateImageConfig {...commonProps()} />)
    const promptField = screen.getByTestId("field-Prompt")
    // Starts in final mode (data says so).
    expect(within(promptField).getByTestId("final-view")).toBeInTheDocument()

    fireEvent.click(within(promptField).getByRole("button", { name: "Edit prompt" }))
    expect(dataOf().__promptFinalView).toBeUndefined()
  })

  it("the prompt and negative toggles are independent", () => {
    render(<GenerateImageConfig {...commonProps()} />)

    // Toggle ONLY the negative field.
    const negField = screen.getByTestId("field-Negative Prompt")
    fireEvent.click(within(negField).getByRole("button", { name: "Show final prompt" }))
    expect(dataOf().__promptFinalView).toEqual(["negativePrompt"])

    // Prompt field stays in edit on a fresh render; negative shows the final view.
    render(<GenerateImageConfig {...commonProps()} />)
    const promptField = screen.getAllByTestId("field-Prompt").at(-1)!
    const negFieldAfter = screen.getAllByTestId("field-Negative Prompt").at(-1)!
    expect(within(promptField).getByTestId("prompt-editor")).toBeInTheDocument()
    expect(within(negFieldAfter).getByTestId("final-view")).toBeInTheDocument()
  })
})
