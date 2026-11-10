import { describe, it, expect } from "vitest"
import { ownedSettingsRefusal, OWNED_SETTINGS_KEYS } from "../_settings-guard.js"

/**
 * Keys of `workflows.settings` another writer owns: Studio's production
 * document (`studio`), and the assistant conversation record and its month's
 * hub (`mcpConversation`, `mcpHub`) the MCP server keeps. A settings write
 * from an agent that changes or drops a STORED one is refused with a message
 * naming the key; echoing it back unchanged passes; a workflow with no stored
 * copy is untouched by the guard.
 */
const conversation = {
  client: "claude-code",
  clientName: "Claude Code (nodaro)",
  key: null,
  startedAt: "2026-11-09T18:00:00.000Z",
  lastActivityAt: "2026-11-09T18:05:00.000Z",
  steps: 2,
}

describe("ownedSettingsRefusal", () => {
  it("guards the Studio document, the conversation record and the hub marker", () => {
    expect(OWNED_SETTINGS_KEYS.map((k) => k.key)).toEqual(["studio", "mcpConversation", "mcpHub"])
  })

  it("a full replace that drops the stored conversation record is refused, naming the key", () => {
    const refusal = ownedSettingsRefusal({ viewport: null }, { mcpConversation: conversation, viewport: null }, "replace")
    expect(refusal).toContain("settings.mcpConversation")
  })

  it("a full replace that changes the stored conversation record is refused", () => {
    const refusal = ownedSettingsRefusal(
      { mcpConversation: { ...conversation, steps: 99 } },
      { mcpConversation: conversation },
      "replace",
    )
    expect(refusal).toContain("settings.mcpConversation")
  })

  it("a full replace that drops the hub marker is refused, naming the key", () => {
    expect(ownedSettingsRefusal({}, { mcpHub: { month: "2026-11" } }, "replace")).toContain("settings.mcpHub")
  })

  it("a full replace that drops the Studio document is refused with the Studio message", () => {
    expect(ownedSettingsRefusal({ other: 2 }, { studio: { shots: [] }, other: 1 }, "replace")).toContain("Studio production")
  })

  it("echoing every owned key back unchanged passes", () => {
    const stored = { studio: { shots: [{ id: "s1" }] }, mcpConversation: conversation, mcpHub: { month: "2026-11" }, other: 1 }
    const next = { ...JSON.parse(JSON.stringify(stored)), other: 2 }
    expect(ownedSettingsRefusal(next, stored, "replace")).toBeNull()
  })

  it("a workflow with no stored owned key is unguarded: the keys may be created", () => {
    expect(ownedSettingsRefusal({ mcpConversation: conversation, studio: {} }, { other: 1 }, "replace")).toBeNull()
    expect(ownedSettingsRefusal({ other: 2 }, null, "replace")).toBeNull()
    expect(ownedSettingsRefusal({ other: 2 }, undefined, "replace")).toBeNull()
  })

  it("a stored owned key that is null counts as absent", () => {
    expect(ownedSettingsRefusal({}, { mcpConversation: null, studio: null }, "replace")).toBeNull()
  })

  describe("merge — a delta's set.settings, which the server merges key by key", () => {
    it("leaving an owned key out keeps it on the server, so it passes", () => {
      expect(ownedSettingsRefusal({ other: 2 }, { mcpConversation: conversation, studio: { shots: [] } }, "merge")).toBeNull()
    })

    it("sending an owned key changed is refused", () => {
      expect(ownedSettingsRefusal({ mcpConversation: { ...conversation, key: "k" } }, { mcpConversation: conversation }, "merge")).toContain(
        "settings.mcpConversation",
      )
    })

    it("sending an owned key as null (the merge would erase it) is refused", () => {
      expect(ownedSettingsRefusal({ mcpHub: null }, { mcpHub: { month: "2026-11" } }, "merge")).toContain("settings.mcpHub")
    })

    it("sending an owned key unchanged passes", () => {
      expect(ownedSettingsRefusal({ mcpHub: { month: "2026-11" }, other: 1 }, { mcpHub: { month: "2026-11" } }, "merge")).toBeNull()
    })
  })

  it("the first owned key that is clobbered decides the message", () => {
    const refusal = ownedSettingsRefusal({}, { studio: { shots: [] }, mcpConversation: conversation }, "replace")
    expect(refusal).toContain("Studio production")
  })
})
