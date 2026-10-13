/**
 * An edit of a UGC Script's lines belongs to the node it was begun on. The
 * panel stays mounted while the selection moves between nodes of one type, so
 * an edit that followed the selection would be saved into the other node —
 * one with the same lines (a duplicate) included. It survives a click away and
 * back to the same node. The REAL panel against the real workflow store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
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

import { ConfigPanel } from "@/components/editor/config-panel"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { translate } from "@/lib/i18n"

const t = (key: Parameters<typeof translate>[1]) => translate("en", key)
const RESULT = { plan: { v: 1, hook: "Open", beats: [{ line: "One" }, { line: "Two" }], closer: { line: "Close" } }, rounds: 1 }
const scriptNode = (id: string) =>
  // Each node its own copy of the same script: equal lines, objects of their own (a duplicate after a reload).
  ({ id, type: "ugc-script", position: { x: 0, y: 0 }, data: { label: `Script ${id}`, targetDurationSec: 15, keepResult: false, executionStatus: "completed", result: JSON.parse(JSON.stringify(RESULT)) } }) as never

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

async function beginEdit(typed: string) {
  fireEvent.click(screen.getByRole("button", { name: t("common.edit") }))
  fireEvent.change(screen.getAllByRole("textbox").find((b) => (b as HTMLTextAreaElement).value === "One")!, { target: { value: typed } })
  await tick()
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

describe("UGC Script's line edit stays with its node", () => {
  it("moving to another UGC Script with the same lines ends the edit; nothing is saved into either", async () => {
    useWorkflowStore.setState({ nodes: [scriptNode("A"), scriptNode("B")], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()
    await beginEdit("Uno")

    await select("B")
    await tick()
    expect(screen.queryAllByRole("textbox").filter((b) => (b as HTMLTextAreaElement).value === "Uno")).toHaveLength(0)
    expect(screen.queryByRole("button", { name: t("common.save") })).toBeNull()
    expect((dataOf("A").result as typeof RESULT).plan.beats[0]!.line).toBe("One")
    expect((dataOf("B").result as typeof RESULT).plan.beats[0]!.line).toBe("One")
  })

  it("a duplicate made in this session (sharing the script object) does not take the edit either", async () => {
    const shared = JSON.parse(JSON.stringify(RESULT))
    const a = scriptNode("A") as unknown as { data: Record<string, unknown> }
    const b = scriptNode("B") as unknown as { data: Record<string, unknown> }
    a.data.result = shared
    b.data.result = shared
    useWorkflowStore.setState({ nodes: [a, b], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()
    await beginEdit("Uno")

    await select("B")
    await tick()
    expect(screen.queryByRole("button", { name: t("common.save") })).toBeNull()
    expect(screen.queryAllByRole("textbox").filter((box) => (box as HTMLTextAreaElement).value === "Uno")).toHaveLength(0)
  })

  it("a click away and back to the same node keeps the edit and what was typed", async () => {
    useWorkflowStore.setState({ nodes: [scriptNode("A"), scriptNode("B")], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()
    await beginEdit("Uno")

    await select(null)
    await tick()
    await select("A")
    await tick()
    expect(screen.getAllByRole("textbox").some((b) => (b as HTMLTextAreaElement).value === "Uno")).toBe(true)
  })
})
