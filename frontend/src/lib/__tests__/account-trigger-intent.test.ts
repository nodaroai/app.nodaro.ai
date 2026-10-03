/**
 * The owner's change to a Telegram account trigger is recorded where it is
 * made — the trigger's settings panel — and only there, for the workflow it
 * was made in.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { telegramAccountListeningSignature } from "@nodaro/shared"
import {
  accountTriggerIntents,
  adoptUnsavedAccountTriggerIntents,
  clearAccountTriggerIntents,
  discardUnsavedAccountTriggerIntents,
  recordAccountTriggerIntent,
  recordingAccountTriggerUpdate,
} from "../account-trigger-intent"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

beforeEach(() => clearAccountTriggerIntents())

const ON = { accountId: "a", chatIds: ["1"], isActive: true }
const keys = (workflowId: string) => [...accountTriggerIntents(workflowId).keys()].sort()

describe("recordingAccountTriggerUpdate — the panel's update", () => {
  it("writes the change, then remembers what the node now says", () => {
    const nodes = [{ id: "ta1", data: { accountId: "acc-1", chatIds: ["777"], isActive: false } }]
    const write = (id: string, patch: Record<string, unknown>) => {
      const i = nodes.findIndex((n) => n.id === id)
      nodes[i] = { ...nodes[i], data: { ...nodes[i].data, ...patch } }
    }
    const update = recordingAccountTriggerUpdate("ta1", write, () => ({ workflowId: "wf-1", nodes }))
    update({ isActive: true })
    expect(accountTriggerIntents("wf-1").get("ta1")).toBe(
      telegramAccountListeningSignature({ accountId: "acc-1", chatIds: ["777"], isActive: true }),
    )
  })
})

describe("an intent belongs to the workflow it was set in", () => {
  it("another workflow never reads it, not even one set before any save", () => {
    recordAccountTriggerIntent("wf-a", "n1", ON)
    recordAccountTriggerIntent(null, "n2", ON)
    expect(keys("wf-a")).toEqual(["n1"])
    expect(keys("wf-b")).toEqual([])
  })

  it("one set before the first save becomes that workflow's when the save gives it its id — and only its", () => {
    recordAccountTriggerIntent("wf-a", "n1", ON)
    recordAccountTriggerIntent(null, "n2", ON)
    adoptUnsavedAccountTriggerIntents("wf-a")
    expect(keys("wf-a")).toEqual(["n1", "n2"])
    adoptUnsavedAccountTriggerIntents("wf-b")
    expect(keys("wf-b")).toEqual([])
  })

  it("loading or starting another workflow discards what was set in an unsaved one", () => {
    recordAccountTriggerIntent(null, "n2", ON)
    discardUnsavedAccountTriggerIntents()
    adoptUnsavedAccountTriggerIntents("wf-a")
    expect(keys("wf-a")).toEqual([])
  })

  it("the store discards it when another workflow loads or a new one starts", () => {
    recordAccountTriggerIntent(null, "n2", ON)
    useWorkflowStore.getState().loadWorkflow("wf-x", "Other", [], [])
    adoptUnsavedAccountTriggerIntents("wf-x")
    expect(keys("wf-x")).toEqual([])

    recordAccountTriggerIntent(null, "n3", ON)
    useWorkflowStore.getState().clearWorkflow()
    adoptUnsavedAccountTriggerIntents("wf-y")
    expect(keys("wf-y")).toEqual([])
  })

  it("the first save adopts it under the new id before that save's trigger sync reads it", () => {
    const src = readFileSync(join(__dirname, "..", "..", "hooks", "use-workflow-persistence.ts"), "utf8")
    const idSet = src.indexOf("setWorkflowId(data.id)")
    const adopted = src.indexOf("adoptUnsavedAccountTriggerIntents(createdWorkflowId)")
    const synced = src.indexOf("if (savedWorkflowId) reportTriggerSync(savedWorkflowId")
    expect(idSet).toBeGreaterThan(0)
    expect(adopted).toBeGreaterThan(idSet)
    expect(synced).toBeGreaterThan(adopted)
  })
})

describe("the editor's settings panel", () => {
  it("records the owner's change for a Telegram account trigger, through the recording update, one panel per node", () => {
    const panel = readFileSync(join(__dirname, "..", "..", "components", "editor", "config-panel.tsx"), "utf8")
    expect(panel).toMatch(
      /case "telegram-account-trigger": return <TelegramAccountTriggerConfig key=\{selectedNodeId \?\? ""\} \{\.\.\.configProps\} onUpdate=\{updateAccountTrigger\} \/>/,
    )
    expect(panel).toMatch(/recordingAccountTriggerUpdate\(selectedNodeId, updateNodeData/)
  })
})
