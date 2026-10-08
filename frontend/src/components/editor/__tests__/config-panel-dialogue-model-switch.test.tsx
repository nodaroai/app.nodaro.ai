/**
 * The Text to Dialogue panel snaps / clears what a model does not take ONLY when
 * the user switches the model — never because the panel moved to another node.
 *
 * ConfigPanel keeps ONE TextToDialogueConfig instance mounted while the selection
 * moves between dialogue nodes (and through a deselect), so anything keyed to
 * "the provider changed" would rewrite the node the user merely clicked (snap a
 * v4 node's 0.3 stability, strip its similarity) and mark the workflow unsaved.
 * These tests render the REAL panel against the real workflow store — the harness
 * of config-panel-tts-model-switch.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

vi.mock("@/lib/supabase", () => {
  const auth = {
    getUser: () => Promise.resolve({ data: { user: null } }),
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  }
  const from = () => {
    const q: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in", "order", "limit", "single", "maybeSingle", "is", "neq", "gte", "lte", "match", "filter"]) q[m] = () => q
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return q
  }
  const client = { auth, from, channel: () => ({ on() { return this }, subscribe() { return this } }), removeChannel() {} }
  return { createClient: () => client }
})

// The per-line voice browser fetches its catalogue and lives in a dialog; stand
// it in with an inert button (no case here picks a voice).
vi.mock("@/components/editor/config-panels/voice-browser", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  VoiceBrowser: () => <button type="button" data-testid="voice-browser">voice</button>,
}))

import { ConfigPanel } from "@/components/editor/config-panel"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_DEFINITIONS } from "@/types/nodes"

const defaults = NODE_DEFINITIONS.find((d) => d.type === "text-to-dialogue")!.defaultData as Record<string, unknown>

function dialogueNode(id: string, data: Record<string, unknown> = {}) {
  return { id, type: "text-to-dialogue", position: { x: 0, y: 0 }, data: { ...defaults, label: `Dialogue ${id}`, dialogue: [{ id: "1", text: "Hi", voice: "Rachel" }], ...data } } as never
}

const dataOf = (id: string) => useWorkflowStore.getState().nodes.find((n) => n.id === id)!.data as Record<string, unknown>
const tick = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const select = (selectedNodeId: string | null) => act(async () => { useWorkflowStore.setState({ selectedNodeId } as never) })

function mountPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConfigPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 404 }))) as never
  const g = globalThis as Record<string, unknown>
  if (typeof window.matchMedia !== "function") {
    ;(window as unknown as Record<string, unknown>).matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })
  }
  if (typeof g.ResizeObserver !== "function") g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  if (typeof g.IntersectionObserver !== "function") g.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
})

afterEach(() => cleanup())

describe("text-to-dialogue panel — selecting another node rewrites nothing", () => {
  it("a v3 node, then a v4 node with a stepless stability: the second keeps its values and the workflow stays clean", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "elevenlabs-dialogue" }), dialogueNode("B", { provider: "elevenlabs-dialogue-v4", stability: 0.3, similarityBoost: 0.8 })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    useWorkflowStore.setState({ isDirty: false } as never)

    await select("B")
    await tick()

    expect(dataOf("B").stability).toBe(0.3)
    expect(dataOf("B").similarityBoost).toBe(0.8)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("a v3 node that an agent wrote with similarity and a stepless stability keeps them when merely selected", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A"), dialogueNode("B", { provider: "elevenlabs-dialogue", stability: 0.3, similarityBoost: 0.8 })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    await select(null)
    await tick()
    useWorkflowStore.setState({ isDirty: false } as never)

    await select("B")
    await tick()

    expect(dataOf("B").stability).toBe(0.3)
    expect(dataOf("B").similarityBoost).toBe(0.8)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("a node saved before the model field existed shows v3 dialogue, which is what it runs as, and rewrites nothing", async () => {
    useWorkflowStore.setState({ nodes: [dialogueNode("A", { provider: undefined })], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()
    expect(screen.getByRole("combobox", { name: "Model" }).textContent).toMatch(/^ElevenLabs Dialogue v3/)
    expect(dataOf("A").provider).toBeUndefined()
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })
})

describe("text-to-dialogue panel — a model the user picks", () => {
  async function pickModel(label: RegExp) {
    const user = userEvent.setup()
    await user.click(screen.getByRole("combobox", { name: "Model" }))
    await user.click(await within(await screen.findByRole("listbox")).findByRole("option", { name: label }))
    await tick()
  }

  it("v4 → v3: the stability snaps to a step and similarity is cleared; the lines are untouched", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "elevenlabs-dialogue-v4", stability: 0.3, similarityBoost: 0.8 })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()

    await pickModel(/^ElevenLabs Dialogue v3/)

    const data = dataOf("A")
    expect(data.provider).toBe("elevenlabs-dialogue")
    expect(data.stability).toBe(0.5)
    expect(data.similarityBoost).toBeUndefined()
    expect(data.dialogue).toEqual([{ id: "1", text: "Hi", voice: "Rachel" }])
  })

  it("v3 → v4: the stability is kept and a similarity slider appears", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "elevenlabs-dialogue", stability: 1 })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    expect(screen.queryByLabelText(/Similarity/)).toBeNull()

    await pickModel(/^ElevenLabs Dialogue v4/)

    expect(dataOf("A").provider).toBe("elevenlabs-dialogue-v4")
    expect(dataOf("A").stability).toBe(1)
    expect(screen.getByLabelText(/Similarity/)).toBeTruthy()
  })

  it("the length counter shows the chosen model's cap", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "elevenlabs-dialogue-v4" })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    expect(screen.getByText(/\/10000$/)).toBeTruthy() // the probe's number (DIALOGUE_V4_MAX_CHARS, measured 2026-10-06)
  })
})
