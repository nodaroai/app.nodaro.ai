/**
 * A one-off voice clone's recordings are their signer's alone (decided 2026-11-13). A collaborator who
 * may only view a workflow reads each clone switched on and empty, without the consent record, its
 * results kept (they are shown the work); a copy's source read by anyone but its author goes as
 * published (results dropped too). The owner, and an `edit` collaborator (whose editor saves the graph
 * back whole), read the graph as it is.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, access: "none" as string }))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = async () => ({ data: h.row, error: null })
      chain.single = async () => ({ data: null, error: { code: "PGRST116" } })
      return chain
    },
  },
}))
vi.mock("../workflow-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workflow-access.js")>()),
  workflowAccessFromRow: vi.fn(async () => h.access),
}))

import { loadStudioEditableCopySource, loadWorkflowFor } from "../workflow-route-access.js"
import { signReplicaConsent } from "../voice-clone-consent.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const READER = "00000000-0000-4000-8000-0000000000ff"
const LINKS = { sourceAudioUrl: "https://cdn.example/owner-reference.wav", consentAudioUrl: "https://cdn.example/owner-consent.wav" }
const RECORD = signReplicaConsent(OWNER, LINKS)
const TAKE = "https://cdn.example/owner-voice-take.mp3"

function row() {
  return {
    id: "wf-1",
    user_id: OWNER,
    workspace_id: null,
    visibility: "private",
    settings: { studio: { shared: true, allowEditableCopy: true } },
    nodes: [
      { id: "tts", type: "text-to-speech", data: { label: "Narration", provider: "gemini-3-8-flash-tts", replica: LINKS, replicaConsent: RECORD, generatedAudioUrl: TAKE } },
      {
        id: "dlg",
        type: "text-to-dialogue",
        data: { provider: "gemini-3-8-flash-tts", dialogue: [{ text: "Hi.", voice: "Me" }], speakers: [{ voice: "Me", replica: LINKS, replicaConsent: RECORD }] },
      },
    ],
    edges: [],
  }
}

const reply = () => {
  const r = { status: vi.fn(() => r), send: vi.fn(() => r) }
  return r
}
const load = (loader: typeof loadWorkflowFor, userId: string) =>
  loader({} as never, reply() as never, userId, "wf-1", "view", "id, user_id, workspace_id, visibility, settings, nodes, edges", "Failed", { resolveResultIds: false })
const nodesOf = (loaded: Awaited<ReturnType<typeof loadWorkflowFor>>) => (loaded.ok ? (loaded.row.nodes as Array<{ id: string; data: Record<string, unknown> }>) : [])

beforeEach(() => {
  h.row = row()
})

describe("a one-off voice clone read through the workflow's door", () => {
  it("a `view` collaborator: each clone empty, no consent record; its results kept", async () => {
    h.access = "view"
    const nodes = nodesOf(await load(loadWorkflowFor, READER))
    const text = JSON.stringify(nodes)
    expect(text).not.toContain(LINKS.sourceAudioUrl)
    expect(text).not.toContain(LINKS.consentAudioUrl)
    expect(text).not.toContain(RECORD.signature)
    const tts = nodes.find((n) => n.id === "tts")!
    expect(tts.data.replica).toEqual({ sourceAudioUrl: "", consentAudioUrl: "" })
    expect(tts.data.generatedAudioUrl).toBe(TAKE)
  })

  it("an `edit` collaborator and the owner: the graph as it is (an editor saves it back whole)", async () => {
    for (const [access, who] of [["edit", READER], ["own", OWNER]] as const) {
      h.access = access
      h.row = row()
      const text = JSON.stringify(nodesOf(await load(loadWorkflowFor, who)))
      expect(text, access).toContain(LINKS.sourceAudioUrl)
      expect(text, access).toContain(RECORD.signature)
    }
  })

  it("a copy's source read by anyone but its author: as published, the clone node's results gone too", async () => {
    h.access = "none"
    const nodes = nodesOf(await load(loadStudioEditableCopySource, READER))
    const text = JSON.stringify(nodes)
    expect(text).not.toContain(LINKS.sourceAudioUrl)
    expect(text).not.toContain(RECORD.signature)
    expect(text).not.toContain(TAKE)
  })
})
