import { describe, it, expect } from "vitest"
import { editorSettingsPayload, EDITOR_SETTINGS_KEYS } from "../workflow-settings-payload"

/**
 * The `settings` column a save writes is the column as the server holds it,
 * with the editor's own keys written over it. The editor manages four keys;
 * every other key in the column belongs to another writer (an assistant's
 * `mcpConversation` / `mcpHub`, Studio's `studio`, a demo seed) and must ride
 * through a save exactly as stored — a save that rebuilt the column from the
 * four keys alone erased the assistant's conversation record on every save.
 */
const conversation = {
  client: "claude-code",
  clientName: "Claude Code (nodaro)",
  key: null,
  startedAt: "2026-11-09T18:00:00.000Z",
  lastActivityAt: "2026-11-09T18:05:00.000Z",
  firstRequest: "a knight on a hill",
  steps: 2,
}

function snapshotWith(storedSettings: Record<string, unknown>) {
  return {
    nodes: [],
    edges: [],
    name: "W",
    characterDefinitions: [],
    flowPromptTemplates: {},
    presentationSettings: { runTarget: "workflow" as const },
    savedViewport: null,
    storedSettings,
  }
}

describe("editorSettingsPayload", () => {
  it("names exactly the four keys the editor manages", () => {
    expect([...EDITOR_SETTINGS_KEYS]).toEqual(["characterDefinitions", "flowPromptTemplates", "presentationSettings", "viewport"])
  })

  it("keeps every stored key the editor does not manage, exactly as stored", () => {
    const payload = editorSettingsPayload({
      characterDefinitions: [],
      flowPromptTemplates: {},
      presentationSettings: { runTarget: "workflow" },
      savedViewport: { x: 1, y: 2, zoom: 1 },
      lastSavedSnapshot: snapshotWith({
        mcpConversation: conversation,
        mcpHub: { month: "2026-11" },
        studio: { shots: [{ id: "s1" }] },
        demoSeed: true,
      }),
    })
    expect(payload.mcpConversation).toEqual(conversation)
    expect(payload.mcpHub).toEqual({ month: "2026-11" })
    expect(payload.studio).toEqual({ shots: [{ id: "s1" }] })
    expect(payload.demoSeed).toBe(true)
  })

  it("writes the editor's own keys over the stored copies — the stored ones never leak back", () => {
    const payload = editorSettingsPayload({
      characterDefinitions: [{ id: "c1", name: "Hero" }] as never,
      flowPromptTemplates: { n1: "now" },
      presentationSettings: { runTarget: "node" } as never,
      savedViewport: { x: 5, y: 6, zoom: 2 },
      lastSavedSnapshot: snapshotWith({
        characterDefinitions: [{ id: "old" }],
        flowPromptTemplates: { n1: "before" },
        presentationSettings: { runTarget: "workflow" },
        viewport: { x: 0, y: 0, zoom: 1 },
        mcpConversation: conversation,
      }),
    })
    expect(payload.characterDefinitions).toEqual([{ id: "c1", name: "Hero" }])
    expect(payload.flowPromptTemplates).toEqual({ n1: "now" })
    expect(payload.presentationSettings).toEqual({ runTarget: "node" })
    expect(payload.viewport).toEqual({ x: 5, y: 6, zoom: 2 })
    expect(payload.mcpConversation).toEqual(conversation)
  })

  it("with no saved snapshot (a workflow not yet stored) writes the four keys alone", () => {
    const payload = editorSettingsPayload({
      characterDefinitions: [],
      flowPromptTemplates: {},
      presentationSettings: { runTarget: "workflow" },
      savedViewport: null,
      lastSavedSnapshot: null,
    })
    expect(Object.keys(payload).sort()).toEqual([...EDITOR_SETTINGS_KEYS].sort())
    expect(payload.viewport).toBeNull()
  })

  it("returns a new object, never the stored one (nested values are shared until the caller clones)", () => {
    const stored = { mcpConversation: conversation }
    const payload = editorSettingsPayload({
      characterDefinitions: [],
      flowPromptTemplates: {},
      presentationSettings: { runTarget: "workflow" },
      savedViewport: null,
      lastSavedSnapshot: snapshotWith(stored),
    })
    expect(payload).not.toBe(stored)
    expect(stored).toEqual({ mcpConversation: conversation })
  })
})
