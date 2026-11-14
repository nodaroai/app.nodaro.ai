import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

// --- Icon stub (avoid pulling real SVGs / lucide internals) ---
vi.mock("lucide-react", () => new Proxy({}, {
  // Any icon name resolves to a null component — the rich picker-ui package
  // imports icons a closed list cannot anticipate (Dog, Car, ...).
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

// --- Workflow store: selector-based mock. Tests override via `storeState`. ---
const createNodesFromWriterMock = vi.fn()
const runAllWriterImageNodesMock = vi.fn()
const setUserTextTemplatesMock = vi.fn()
let storeState: Record<string, unknown> = {}

function baseStoreState() {
  return {
    selectedNodeId: "llm-node-1",
    nodes: [],
    edges: [],
    userTextTemplates: [],
    userPromptTemplates: {},
    setUserTextTemplates: setUserTextTemplatesMock,
    createNodesFromWriter: createNodesFromWriterMock,
    runAllWriterImageNodes: runAllWriterImageNodesMock,
  }
}

const getStateMock = vi.fn(() => storeState)
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) => selector(storeState),
    { getState: () => getStateMock() },
  ),
}))

// --- Auth ---
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}))

// --- Save-templates mutation ---
const saveTemplatesMutateMock = vi.fn()
vi.mock("@/hooks/queries/use-user-settings-queries", () => ({
  useSaveTemplatesMutation: () => ({ mutate: saveTemplatesMutateMock, isPending: false }),
}))

// --- Heavy children mocked to keep the test focused on the merge surface ---
vi.mock("../llm-model-select", () => ({
  LlmModelSelect: ({ value }: any) => (
    <div data-testid="llm-model-select">model:{value ?? "default"}</div>
  ),
}))
vi.mock("../prompt-helper-button", () => ({
  PromptHelperButton: () => <span data-testid="prompt-helper" />,
}))
vi.mock("@/components/editor/config-panels/snippet-menu-button", () => ({
  SnippetMenuButton: () => null,
}))
vi.mock("@/hooks/queries/use-prompt-snippets-queries", () => ({
  useSnippetPool: () => [],
}))
vi.mock("../mappable-field", () => ({
  MappableField: ({ label, children }: any) => (
    <div data-testid="mappable-field" data-label={label}>
      {children}
    </div>
  ),
}))

// Real @nodaro/shared resolves in tests (used across the suite). It provides
// getLlmModalityCaps + LLM_FEATURE_DEFAULTS used by the panel.

import { LLMChatConfig } from "../llm-chat-config"

function renderConfig(
  dataOverrides: Record<string, unknown> = {},
  store: Record<string, unknown> = {},
) {
  storeState = { ...baseStoreState(), ...store }
  const props = {
    data: {
      label: "Generate Text",
      systemPrompt: "You are helpful",
      userInput: "",
      temperature: 0.7,
      maxTokens: 2048,
      fieldMappings: {},
      ...dataOverrides,
    },
    onUpdate: vi.fn(),
    sources: [],
    fieldMappings: {},
    onMapField: vi.fn(),
    nodes: [],
    ...({} as any),
  } as any
  const utils = render(<LLMChatConfig {...props} />)
  return { ...utils, onUpdate: props.onUpdate }
}

describe("LLMChatConfig (Generate Text — merged presets + fan-out)", () => {
  beforeEach(() => {
    createNodesFromWriterMock.mockClear()
    runAllWriterImageNodesMock.mockClear()
    setUserTextTemplatesMock.mockClear()
    saveTemplatesMutateMock.mockClear()
    storeState = baseStoreState()
  })

  // --- Existing llm-chat UI retained ---
  it("still renders the model select and the system/user prompt fields", () => {
    renderConfig()
    expect(screen.getByTestId("llm-model-select")).toBeInTheDocument()
    const labels = screen.getAllByTestId("mappable-field").map((n) => n.getAttribute("data-label"))
    expect(labels).toContain("Instructions (System Prompt)")
    expect(labels).toContain("User Prompt")
  })

  // --- Preset selector ---
  it("renders the preset selector with built-in presets", () => {
    renderConfig()
    const combo = screen.getByRole("combobox", { name: /preset/i })
    const options = within(combo).getAllByRole("option").map((o) => o.textContent)
    expect(options).toContain("Photo Shoot Planner")
    expect(options).toContain("Product Catalog Writer")
    expect(options).toContain("Custom")
  })

  it("renders a 'My Presets' group from the store's userTextTemplates", () => {
    renderConfig(
      {},
      { userTextTemplates: [{ id: "u1", label: "My Brand Voice", systemPrompt: "Be punchy" }] },
    )
    const combo = screen.getByRole("combobox", { name: /preset/i })
    expect(within(combo).getByText("My Brand Voice")).toBeInTheDocument()
  })

  it("applies systemPrompt + defaultInput + maxTokens when selecting a built-in preset (empty input)", () => {
    const { onUpdate } = renderConfig({ userInput: "" })
    const combo = screen.getByRole("combobox", { name: /preset/i })
    fireEvent.change(combo, { target: { value: "photo-shoot" } })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    const arg = onUpdate.mock.calls[0][0]
    expect(arg.templateId).toBe("photo-shoot")
    expect(typeof arg.systemPrompt).toBe("string")
    expect(arg.systemPrompt.length).toBeGreaterThan(0)
    expect(arg.userInput).toBeTruthy() // defaultInput applied because input was empty
    expect(arg.maxTokens).toBe(16384)
  })

  it("does NOT overwrite a non-default userInput when switching presets", () => {
    const { onUpdate } = renderConfig({ userInput: "my own custom brief", templateId: "custom" })
    const combo = screen.getByRole("combobox", { name: /preset/i })
    fireEvent.change(combo, { target: { value: "photo-shoot" } })
    const arg = onUpdate.mock.calls[0][0]
    expect(arg).not.toHaveProperty("userInput")
  })

  it("applies a user preset from the store on select", () => {
    const { onUpdate } = renderConfig(
      {},
      {
        userTextTemplates: [
          { id: "u1", label: "My Brand Voice", systemPrompt: "Be punchy", defaultMaxTokens: 4096 },
        ],
      },
    )
    const combo = screen.getByRole("combobox", { name: /preset/i })
    fireEvent.change(combo, { target: { value: "u1" } })
    const arg = onUpdate.mock.calls[0][0]
    expect(arg.templateId).toBe("u1")
    expect(arg.systemPrompt).toBe("Be punchy")
    expect(arg.maxTokens).toBe(4096)
  })

  // --- Reference-image warning, gated on requiresImageRef ---
  it("shows the reference-image warning for a requiresImageRef template with no connected image", () => {
    renderConfig({ templateId: "photo-shoot" })
    expect(screen.getByText(/reference image/i)).toBeInTheDocument()
  })

  it("does NOT show the warning for the 'custom' template", () => {
    renderConfig({ templateId: "custom" })
    expect(screen.queryByText(/reference image node/i)).not.toBeInTheDocument()
  })

  it("does NOT show the warning when a requiresImageRef template has a connected image source", () => {
    renderConfig(
      { templateId: "photo-shoot" },
      {
        selectedNodeId: "llm-node-1",
        nodes: [{ id: "img-1", type: "generate-image", data: {} }],
        edges: [{ id: "e1", source: "img-1", target: "llm-node-1" }],
      },
    )
    expect(screen.queryByText(/Connect a reference image node/i)).not.toBeInTheDocument()
  })

  // --- Generated Prompts + fan-out buttons ---
  it("renders the Generated Prompts list and Create N Image Nodes button when generatedItems is non-empty", () => {
    renderConfig({ generatedItems: ["prompt one", "prompt two", "prompt three"] })
    expect(screen.getByText(/Generated Prompts/i)).toBeInTheDocument()
    expect(screen.getByText("3 items")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Create 3 Image Nodes/i })).toBeInTheDocument()
  })

  it("does NOT render the Generated Prompts list when generatedItems is empty", () => {
    renderConfig({ generatedItems: [] })
    expect(screen.queryByText(/Generated Prompts/i)).not.toBeInTheDocument()
  })

  it("Create N Image Nodes button calls createNodesFromWriter with the selected node id", () => {
    renderConfig({ generatedItems: ["a", "b"] })
    fireEvent.click(screen.getByRole("button", { name: /Create 2 Image Nodes/i }))
    expect(createNodesFromWriterMock).toHaveBeenCalledWith("llm-node-1")
  })

  it("shows Generate All N Images button once nodes were created, and runs them", () => {
    renderConfig({ generatedItems: ["a", "b"], createdNodeIds: ["n1", "n2"] })
    const runBtn = screen.getByRole("button", { name: /Generate All 2 Images/i })
    fireEvent.click(runBtn)
    expect(runAllWriterImageNodesMock).toHaveBeenCalledWith("llm-node-1")
  })

  // --- Save as preset ---
  it("Save as preset writes to the store and persists via the settings mutation", () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Reusable Preset")
    try {
      renderConfig({ systemPrompt: "Sys here", maxTokens: 4096, llmModel: "claude-x" })
      fireEvent.click(screen.getByRole("button", { name: /save as preset/i }))

      expect(setUserTextTemplatesMock).toHaveBeenCalledTimes(1)
      const newList = setUserTextTemplatesMock.mock.calls[0][0]
      expect(Array.isArray(newList)).toBe(true)
      expect(newList[newList.length - 1]).toMatchObject({
        label: "Reusable Preset",
        systemPrompt: "Sys here",
        defaultMaxTokens: 4096,
        llmModel: "claude-x",
      })

      expect(saveTemplatesMutateMock).toHaveBeenCalledTimes(1)
      const mutateArg = saveTemplatesMutateMock.mock.calls[0][0]
      expect(mutateArg.userId).toBe("user-1")
      expect(mutateArg.textTemplates).toEqual(newList)
    } finally {
      promptSpy.mockRestore()
    }
  })

  // --- Update / Delete a saved user template ---
  it("does NOT show Update / Delete for a built-in template", () => {
    renderConfig({ templateId: "photo-shoot" })
    expect(screen.queryByRole("button", { name: /^update$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /delete preset/i })).not.toBeInTheDocument()
  })

  it("Update overrides the selected user template in place and persists", () => {
    const { onUpdate } = renderConfig(
      { templateId: "u1", systemPrompt: "Edited prompt", maxTokens: 8192, llmModel: "claude-y" },
      { userTextTemplates: [{ id: "u1", label: "My Brand Voice", systemPrompt: "old" }] },
    )
    fireEvent.click(screen.getByRole("button", { name: /^update$/i }))
    expect(setUserTextTemplatesMock).toHaveBeenCalledTimes(1)
    const newList = setUserTextTemplatesMock.mock.calls[0][0]
    expect(newList).toHaveLength(1)
    expect(newList[0]).toMatchObject({
      id: "u1",
      label: "My Brand Voice",
      systemPrompt: "Edited prompt",
      defaultMaxTokens: 8192,
      llmModel: "claude-y",
    })
    expect(saveTemplatesMutateMock).toHaveBeenCalledTimes(1)
    // Override edits the template, not the node's selected templateId.
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("Delete removes the selected user template, persists, and falls back to Custom", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    try {
      const { onUpdate } = renderConfig(
        { templateId: "u1" },
        {
          userTextTemplates: [
            { id: "u1", label: "Brand Voice", systemPrompt: "a" },
            { id: "u2", label: "Other", systemPrompt: "b" },
          ],
        },
      )
      fireEvent.click(screen.getByRole("button", { name: /delete preset/i }))
      expect(setUserTextTemplatesMock).toHaveBeenCalledTimes(1)
      const newList = setUserTextTemplatesMock.mock.calls[0][0]
      expect(newList.map((t: { id: string }) => t.id)).toEqual(["u2"])
      expect(saveTemplatesMutateMock).toHaveBeenCalledTimes(1)
      expect(onUpdate).toHaveBeenCalledWith({ templateId: "custom" })
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it("Delete is a no-op when the confirm is dismissed", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    try {
      renderConfig(
        { templateId: "u1" },
        { userTextTemplates: [{ id: "u1", label: "Brand Voice", systemPrompt: "a" }] },
      )
      fireEvent.click(screen.getByRole("button", { name: /delete preset/i }))
      expect(setUserTextTemplatesMock).not.toHaveBeenCalled()
      expect(saveTemplatesMutateMock).not.toHaveBeenCalled()
    } finally {
      confirmSpy.mockRestore()
    }
  })
})

// Documents (decided 2026-11-13): only a model that reads files shows the
// file input, and switching to one that does not clears the node's files.
describe("LLMChatConfig — documents (referenceFileUrls)", () => {
  beforeEach(() => {
    storeState = baseStoreState()
  })
  const openReferences = () => fireEvent.click(screen.getByText("References"))

  it("shows the file input for GPT-6.1 Terra, with the node's files", () => {
    renderConfig({ llmModel: "gpt-6.1-terra", referenceFileUrls: ["https://media.example/uploads/documents/report.pdf"] })
    openReferences()
    const refs = screen.getByTestId("llm-file-refs")
    expect(within(refs).getByText("Files (PDF)")).toBeInTheDocument()
    expect(within(refs).getByText("report.pdf")).toBeInTheDocument()
    expect(within(refs).getByText("Upload PDF")).toBeInTheDocument()
    expect(within(refs).getByText("1/5")).toBeInTheDocument()
  })

  it.each(["gemini-3.6-flash", "claude-sonnet-5.5", "gpt-6.1-sol"])("shows no file input for %s", (llmModel) => {
    renderConfig({ llmModel })
    openReferences()
    expect(screen.queryByTestId("llm-file-refs")).toBeNull()
  })

  it("clears the node's files on a model that reads none", () => {
    const { onUpdate } = renderConfig({ llmModel: "gemini-3.6-flash", referenceFileUrls: ["https://media.example/a.pdf"] })
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ referenceFileUrls: undefined }))
  })

  it("keeps them on GPT-6.1 Terra", () => {
    const { onUpdate } = renderConfig({ llmModel: "gpt-6.1-terra", referenceFileUrls: ["https://media.example/a.pdf"] })
    expect(onUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ referenceFileUrls: undefined }))
  })
})

describe("LlmFileRefs — uploads", () => {
  it("refuses a non-PDF and a file over the call's whole limit before uploading, and uploads a PDF", async () => {
    const api = await import("@/lib/api")
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({ url: "https://media.example/uploads/documents/x.pdf" } as never)
    const { LlmFileRefs } = await import("../llm-file-refs")
    const onChange = vi.fn()
    const { container } = render(<LlmFileRefs urls={[]} onChange={onChange} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const pick = (file: File) => fireEvent.change(input, { target: { files: [file] } })

    pick(new File(["hi"], "notes.txt", { type: "text/plain" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/PDF/)
    const big = new File(["x"], "big.pdf", { type: "application/pdf" })
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 + 1 })
    pick(big)
    expect(await screen.findByRole("alert")).toHaveTextContent(/6 MB/)
    expect(upload).not.toHaveBeenCalled()

    pick(new File(["%PDF-1.4"], "report.pdf", { type: "application/pdf" }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(["https://media.example/uploads/documents/x.pdf"]))
    upload.mockRestore()
  })
})

describe("LlmFileRefs — an upload that lands after another change", () => {
  it("adds to the list as it is when the upload lands, not the one it started from", async () => {
    const api = await import("@/lib/api")
    let finish: (v: unknown) => void = () => {}
    const upload = vi.spyOn(api, "uploadFile").mockImplementation(() => new Promise((resolve) => { finish = resolve }) as never)
    const { LlmFileRefs } = await import("../llm-file-refs")
    const onChange = vi.fn()
    const { container, rerender } = render(<LlmFileRefs urls={["https://media.example/a.pdf"]} onChange={onChange} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(["%PDF-1.4"], "c.pdf", { type: "application/pdf" })] } })
    // While it uploads, a link is added elsewhere.
    rerender(<LlmFileRefs urls={["https://media.example/a.pdf", "https://media.example/b.pdf"]} onChange={onChange} />)
    finish({ url: "https://media.example/c.pdf" })
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(["https://media.example/a.pdf", "https://media.example/b.pdf", "https://media.example/c.pdf"]))
    upload.mockRestore()
  })
})
