// @test-units-by-name looks up only the two node types it names
/**
 * The model a new node starts on (`components/editor/config-panels/new-node-models.ts`) is visible: the
 * node's menu shows it on its trigger and as the first row it offers. Rendered
 * through the very menus the panels use.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { LlmModelSelect } from "@/components/editor/config-panels/llm-model-select"
import { ModelSearchSelect } from "@/components/editor/config-panels/model-search-select"
import { VIDEO_GEN_MODELS, withoutDeniedModels } from "@/components/editor/config-panels/model-options"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { withOfferedNewNodeModels } from "@/components/editor/config-panels/new-node-models"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { LLM_FEATURE_DEFAULTS, getLlmModel } from "@nodaro/shared/llm-models"

vi.mock("@/components/editor/config-panels/model-description-hint", () => ({ ModelDescriptionHint: () => null }))

afterEach(() => __resetSurfaceAvailabilityForTests(null))

const defaultsOf = (type: string) => ({ ...(NODE_DEFINITIONS.find((d) => d.type === type)!.defaultData as Record<string, unknown>) })

describe("the menu of a new node shows the model it starts on", () => {
  it("Describe Image: its LLM menu's trigger and first row are the chosen model", () => {
    const withheld = LLM_FEATURE_DEFAULTS["image-to-text"]
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [withheld], modelsRestricted: true })
    const data = withOfferedNewNodeModels("image-to-text", defaultsOf("image-to-text"))
    const chosen = getLlmModel(String(data.llmModel))!
    expect(chosen.id).not.toBe(withheld)

    render(<LlmModelSelect feature="image-to-text" value={data.llmModel as string} onChange={() => {}} />)
    const trigger = screen.getByRole("combobox", { name: "AI Model" })
    expect(trigger).toHaveTextContent(chosen.displayName)
    fireEvent.click(trigger)
    const options = screen.getAllByRole("option")
    expect(options[0]).toHaveTextContent(chosen.displayName)
    // The withheld default is no longer kept in the menu.
    expect(screen.queryByText(getLlmModel(withheld)!.displayName)).toBeNull()
  })

  it("Generate Video: its model search's trigger and first row are the chosen model", () => {
    const withheld = String(defaultsOf("generate-video").provider)
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [withheld], modelsRestricted: true })
    const data = withOfferedNewNodeModels("generate-video", defaultsOf("generate-video"))
    const chosen = VIDEO_GEN_MODELS.find((m) => m.value === data.provider)!

    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModelSearchSelect value={String(data.provider)} onChange={() => {}} options={withoutDeniedModels(VIDEO_GEN_MODELS, { nodeType: "generate-video" })} ariaLabel="Provider" />
      </QueryClientProvider>,
    )
    const trigger = screen.getByRole("combobox", { name: "Provider" })
    expect(trigger).toHaveTextContent(chosen.label)
    fireEvent.click(trigger)
    const first = screen.getAllByRole("option")[0]!
    expect(within(first).getByText(chosen.label)).toBeInTheDocument()
  })
})
