/**
 * Publishing a MiniApp whose UGC Creator is set to "My photo" with no photo
 * input: the dialog says every run would be refused, and still publishes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({
  edges: [] as unknown[],
  publish: vi.fn(),
  existing: null as Record<string, unknown> | null,
  /** The author's own workflows a sub-workflow node references, by id. */
  workflows: new Map<string, { nodes: unknown[]; edges: unknown[] }>(),
}))
vi.mock("@/lib/workflow-content", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readWorkflowContent: vi.fn(async (id: string) => {
    const row = h.workflows.get(id)
    return row ? { row: { id, ...row }, access: "owner" } : null
  }),
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAppByWorkflow: vi.fn(async () => h.existing),
  publishApp: (...a: unknown[]) => h.publish(...a),
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }))
vi.mock("@/hooks/use-workflow-store", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>()
  return { ...orig, useWorkflowStore: (selector: (s: { edges: unknown[] }) => unknown) => selector({ edges: h.edges }) }
})

import { PublishDialog } from "../publish-dialog"
import { readWorkflowContent } from "@/lib/workflow-content"
import { tx } from "@/lib/i18n"
import type { WorkflowNode } from "@/types/nodes"

const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode

beforeEach(() => {
  h.edges = []
  h.existing = null
  h.workflows.clear()
  h.publish.mockReset()
})

/** The app's curated inputs: the nodes it shows as inputs. */
const shows = (...ids: string[]) => ({ inputItems: ids.map((nodeId) => ({ type: "node" as const, nodeId })) })

function open(nodes: WorkflowNode[], presentationSettings?: ReturnType<typeof shows>) {
  render(<PublishDialog workflowId="wf-1" nodes={nodes} presentationSettings={presentationSettings as never} updatePresentationSettings={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: tx("pubDialog.trigger") }))
}

describe("the publish dialog and a My photo creator", () => {
  it("says a creator with no photo input would have every run refused", async () => {
    open([n("creator", "ugc-creator", { label: "Presenter", source: "photo" })])
    const warning = await screen.findByTestId("publish-ugc-photo-warning")
    expect(warning.textContent).toBe(tx("pubDialog.ugcPhotoMissing", { label: "Presenter" }))
    // A warning, never a block.
    expect(screen.getByRole("button", { name: tx("pubDialog.publishAppSubmit") })).toBeTruthy()
  })

  it("says nothing when the creator is one of the app's inputs", async () => {
    open([n("creator", "ugc-creator", { label: "Presenter", source: "photo" })], shows("creator"))
    await screen.findByRole("button", { name: tx("pubDialog.publishAppSubmit") })
    expect(screen.queryByTestId("publish-ugc-photo-warning")).toBeNull()
  })

  it("reads the sub-workflows the workflow references: a creator in one, fed through its input, is named until an input of the app feeds that sub-workflow", async () => {
    h.workflows.set("wf-child", {
      nodes: [n("in", "sub-workflow-input", { ports: [{ id: "i1", mediaType: "image" }] }), n("inner", "ugc-creator", { label: "Nested presenter", source: "photo" })],
      edges: [{ id: "c", source: "in", target: "inner", sourceHandle: "i1", targetHandle: "photo" }],
    })
    h.edges = [{ id: "e", source: "up", target: "sub", targetHandle: "in_i1" }]
    const sub = n("sub", "sub-workflow", { label: "Presenter flow", referencedWorkflowId: "wf-child" })
    // An app that shows another input: the upload is not one of them.
    open([sub, n("up", "upload-image", { label: "Your photo" }), n("brief", "text-prompt", { label: "Brief" })], shows("brief"))
    const warning = await screen.findByTestId("publish-ugc-photo-warning")
    expect(warning.textContent).toBe(tx("pubDialog.ugcPhotoMissing", { label: "Nested presenter" }))
    cleanup()
    vi.mocked(readWorkflowContent).mockClear()
    open([sub, n("up", "upload-image", { label: "Your photo" }), n("brief", "text-prompt", { label: "Brief" })], shows("brief", "up"))
    await screen.findByRole("button", { name: tx("pubDialog.publishAppSubmit") })
    // Once the referenced graph is read and the dialog has re-rendered with it.
    await waitFor(() => expect(readWorkflowContent).toHaveBeenCalledWith("wf-child", expect.any(String)))
    await act(async () => {
      await vi.mocked(readWorkflowContent).mock.results[0]!.value
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByTestId("publish-ugc-photo-warning")).toBeNull()
  })
})

describe("the publish dialog reads an app's inputs as the server does", () => {
  it("an app that curated no inputs shows every upload, so an upload feeding the creator's photo is the runner's to fill: nothing to say", async () => {
    h.edges = [{ id: "e", source: "up", target: "creator", targetHandle: "photo" }]
    open([n("creator", "ugc-creator", { label: "Presenter", source: "photo" }), n("up", "upload-image", { label: "Your photo" })])
    await screen.findByRole("button", { name: tx("pubDialog.publishAppSubmit") })
    expect(screen.queryByTestId("publish-ugc-photo-warning")).toBeNull()
  })
})

describe("the publish dialog, a component and a My photo creator", () => {
  // The workflow was published as a component before: the dialog opens on a component publish.
  const asComponent = () => {
    h.existing = { name: "Presenter", slug: "presenter", description: "", thumbnailNodeId: null, isListed: false, category: "other", outputTypes: [], tags: [], supportsRemix: false, publishType: "component" }
  }

  it("says a creator with no photo input would have every run refused — its own handle carries no photo", async () => {
    asComponent()
    open([n("creator", "ugc-creator", { label: "Presenter", source: "photo", presentationInput: true })])
    const warning = await screen.findByTestId("publish-ugc-photo-warning")
    expect(warning.textContent).toBe(tx("pubDialog.ugcPhotoMissingComponent", { label: "Presenter" }))
    expect(screen.getByRole("button", { name: tx("pubDialog.publishComponentTitle") })).toBeTruthy()
  })

  it("says nothing when an Upload Image the component takes as an input feeds the creator's photo", async () => {
    asComponent()
    h.edges = [{ id: "e", source: "up", target: "creator", targetHandle: "photo" }]
    open([n("creator", "ugc-creator", { label: "Presenter", source: "photo" }), n("up", "upload-image", { label: "Your photo", presentationInput: true })])
    await screen.findByRole("button", { name: tx("pubDialog.publishComponentTitle") })
    // Once the component's handles are derived (an effect after the switch to a component publish).
    await waitFor(() => expect(screen.queryByTestId("publish-ugc-photo-warning")).toBeNull())
  })
})
