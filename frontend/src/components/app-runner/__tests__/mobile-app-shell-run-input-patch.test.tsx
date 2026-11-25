/**
 * The phone's app runner (MobileAppShell) writes a quick-field card's correction
 * into the RUN's inputs only — as the desktop runner does, through
 * `patchAsRunValues` — never into the published snapshot or a workflow. Here
 * the correction is the one the availability answer causes: an unset model
 * whose default this deployment withholds moves to the first allowed open one.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { act, render } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

vi.mock("@/lib/supabase", () => {
  const auth = {
    getUser: () => Promise.resolve({ data: { user: null } }),
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({}),
  }
  const from = () => {
    const q: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in", "order", "limit", "single", "maybeSingle", "is", "neq", "gte", "lte", "match", "filter"]) q[m] = () => q
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return q
  }
  const client = { auth, from, channel: () => ({ on() { return this }, subscribe() { return this } }), removeChannel() {} }
  return { createClient: () => client, supabase: client }
})

vi.mock("@/hooks/use-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useAuth: () => ({ user: { id: "u1", email: "runner@example.com" }, loading: false, signOut: () => {} }) }
})

import { MobileAppShell } from "../mobile-app-shell"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { useWorkflowStore, DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "@/hooks/use-workflow-store"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import type { WorkflowNode } from "@/types/nodes"

const nodes = [
  { id: "v", type: "video-to-video", position: { x: 0, y: 0 }, data: { label: "Restyle" } },
] as unknown as WorkflowNode[]

const runSlots = {
  activeSlotId: null,
  slots: [],
  versions: [],
  selectedVersion: null,
  latestVersion: 1,
  isLoadingRun: false,
  inputsReadOnlyValue: false,
  newRunAction: "new",
  setSelectedVersion: () => {},
  handleCreateNew: () => {},
  handleDuplicateSlot: () => {},
  handleHeaderAction: () => {},
  handleRenameSlot: () => {},
  handleRequestDelete: () => {},
  handleSelectSlot: () => {},
  launch: () => {},
}

afterEach(() => __resetSurfaceAvailabilityForTests(null))

describe("MobileAppShell: a card's correction is the run's input, never the snapshot", () => {
  it("moves an unset model off a withheld default into the run's inputs, leaving the published nodes and the workflow as they were", async () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["seedance-2-5"] })
    const presentationSettings = {
      ...(DEFAULT_PRESENTATION_SETTINGS as PresentationSettings),
      inputItems: [{ type: "field", id: "f1", nodeId: "v", field: "provider", allowedValues: ["seedance-2-5", "wan"] }],
    } as PresentationSettings
    const app = { id: "app", name: "Restyle", slug: "restyle", snapshotNodes: nodes, snapshotEdges: [], snapshotSettings: { presentationSettings } }
    useAppRunnerStore.setState({ slug: "restyle", app: app as never, inputValues: {} })
    usePresentationStore.setState({ nodes, edges: [], inputValues: {}, nodeStates: {}, executionStatus: "idle", presentationSettings } as never)
    const workflowNodesBefore = useWorkflowStore.getState().nodes
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/app/restyle"]}>
          <MobileAppShell app={app as never} user={{ id: "u1" } as never} runSlots={runSlots as never} cancel={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })

    expect(usePresentationStore.getState().inputValues.v).toMatchObject({ provider: "wan" })
    // The published nodes are untouched, and so is any workflow.
    expect((usePresentationStore.getState().nodes[0]!.data as Record<string, unknown>).provider).toBeUndefined()
    expect((nodes[0]!.data as Record<string, unknown>).provider).toBeUndefined()
    expect(useWorkflowStore.getState().nodes).toBe(workflowNodesBefore)
  })
})
