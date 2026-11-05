/**
 * The settings panel hands the selected node's id to the panels whose link is
 * fetched in the editor (the Reference Audio node's Extract, the Music node's
 * Get): their content rights box is keyed by node and link, and shows only for
 * a node it can be ticked on. The REAL panel against the real workflow store;
 * the declaration's text is the shared box's own, stubbed here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
vi.mock("@/components/content-rights/rights-declaration-box", () => ({
  RightsDeclarationBox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input type="checkbox" aria-label="rights" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
  ),
}))

import { ConfigPanel } from "@/components/editor/config-panel"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { clearNodeLinkRights, isNodeLinkRightsTicked } from "@/lib/node-link-rights"

const LINK = "https://youtu.be/abc"
const tick = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

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

function select(node: { id: string; type: string; data: Record<string, unknown> }) {
  useWorkflowStore.setState({ nodes: [{ ...node, position: { x: 0, y: 0 } }], edges: [], selectedNodeId: node.id, isDirty: false, isReadOnly: false } as never)
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

afterEach(() => {
  cleanup()
  clearNodeLinkRights()
})

describe("the settings panel and the boxes of links fetched in the editor", () => {
  it("a Reference Audio node's link gets its box, ticked for that node and link", async () => {
    select({ id: "ref-1", type: "reference-audio", data: { label: "Reference Audio", sourceType: "youtube", youtubeUrl: LINK, extractionStatus: "idle" } })
    mountPanel()
    await tick()
    fireEvent.click(screen.getByRole("checkbox", { name: "rights" }))
    expect(isNodeLinkRightsTicked("ref-1", LINK)).toBe(true)
  })

  it("a Music node's reference link gets its box, ticked for that node and link", async () => {
    select({ id: "music-1", type: "generate-music", data: { label: "Music", provider: "minimax", prompt: "", duration: 8, instrumental: true, referenceSource: "youtube", referenceYouTubeUrl: LINK } })
    mountPanel()
    await tick()
    fireEvent.click(screen.getByRole("checkbox", { name: "rights" }))
    expect(isNodeLinkRightsTicked("music-1", LINK)).toBe(true)
  })
})
