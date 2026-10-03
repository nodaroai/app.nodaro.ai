import { describe, it, expect } from "vitest"
import { stripExportContent, stripUnownedRefs } from "../workflow-export.js"
import { EXECUTION_DATA_KEYS } from "../node-runtime-keys.js"
import type { GenericNode } from "../types.js"

describe("stripExportContent — a Schedule Trigger never exports armed", () => {
  it("drops `active` and keeps the schedule itself", () => {
    const node: GenericNode = {
      id: "s1",
      type: "schedule-trigger",
      data: { label: "Daily", rules: [{ id: "rule-1", kind: "days", every: 1, hour: 9, minute: 0 }], timezone: "Asia/Jerusalem", maxExecutions: 3, active: true },
    }
    const [out] = stripExportContent([node])
    const data = out.data as Record<string, unknown>
    expect(data.active).toBeUndefined()
    expect(data.rules).toEqual([{ id: "rule-1", kind: "days", every: 1, hour: 9, minute: 0 }])
    expect(data.timezone).toBe("Asia/Jerusalem")
    expect(data.maxExecutions).toBe(3)
  })

  it("a schedule that was never armed is exported unchanged", () => {
    const node: GenericNode = { id: "s1", type: "schedule-trigger", data: { label: "Daily", rules: [{ id: "rule-1", kind: "days", every: 1, hour: 9, minute: 0 }] } }
    const [out] = stripExportContent([node])
    expect(out.data).toEqual(node.data)
  })
})

/**
 * Invariant guard for the template-export leak class (audit R2-H4): a
 * "shareable" template export must never carry runtime/result fields —
 * generated media URLs, internal job ids, trained-LoRA identity, etc. Those
 * are enumerated in EXECUTION_DATA_KEYS (the single source of truth), and
 * GENERATED_FIELDS is built from it, so this test fails the moment a new
 * runtime key is added without being covered.
 */
describe("stripExportContent — template export hygiene", () => {
  // `shots` lives in EXECUTION_DATA_KEYS but is user config (Kling-3.0
  // storyboard) — it must SURVIVE a template export, not be stripped.
  const CONFIG_KEPT = new Set(["shots"])

  it("strips runtime/result EXECUTION_DATA_KEYS while keeping config fields", () => {
    const data: Record<string, unknown> = {}
    for (const key of EXECUTION_DATA_KEYS) data[key] = "SENSITIVE_RUNTIME_VALUE"
    data.prompt = "keep me" // a real config field — must survive the strip
    data.provider = "veo3.1"

    const node: GenericNode = { id: "n1", type: "generate-video", data }
    const [out] = stripExportContent([node])
    const outData = out.data as Record<string, unknown>

    for (const key of EXECUTION_DATA_KEYS) {
      if (CONFIG_KEPT.has(key)) continue
      expect(outData[key], `${key} must be stripped from a template export`).toBeUndefined()
    }
    expect(outData.prompt).toBe("keep me")
    expect(outData.provider).toBe("veo3.1")
    // Regression guard: Kling-3.0 multishot config must survive template export.
    expect(outData.shots, "shots (Kling-3 config) must NOT be stripped").toBe("SENSITIVE_RUNTIME_VALUE")
  })

  it("clears a Webhook Output's credentialId and a publisher's connectionId — pointers at rows the importer does not own", () => {
    const hook: GenericNode = {
      id: "h1",
      type: "webhook-output",
      data: { url: "https://mine.example/hook", credentialId: "11111111-1111-4111-8111-111111111111", params: [] },
    }
    const post: GenericNode = { id: "p1", type: "telegram-post", data: { connectionId: "conn-1", text: "hello" } }
    const [outHook, outPost] = stripExportContent([hook, post])
    expect((outHook.data as Record<string, unknown>).credentialId).toBeUndefined()
    expect((outHook.data as Record<string, unknown>).url).toBe("https://mine.example/hook")
    expect((outPost.data as Record<string, unknown>).connectionId).toBeUndefined()
    expect((outPost.data as Record<string, unknown>).text).toBe("hello")
  })

  it("clears a Telegram Account Trigger's account and chats — the exporter's account, and a Saved Messages id is their Telegram id", () => {
    const trigger: GenericNode = {
      id: "t1",
      type: "telegram-account-trigger",
      data: {
        label: "Inbox",
        accountId: "acct-1",
        chatIds: ["777000"],
        chatTitles: { "777000": "Saved Messages" },
        senderIds: ["777000"],
        inboxMode: true,
        keywords: ["idea"],
        isActive: true,
      },
    }
    const [out] = stripUnownedRefs([trigger])
    const data = out.data as Record<string, unknown>
    for (const field of ["accountId", "chatIds", "chatTitles", "senderIds"]) expect(data[field], field).toBeUndefined()
    // The importer's own choices start from the exporter's settings.
    expect(data.inboxMode).toBe(true)
    expect(data.keywords).toEqual(["idea"])
    expect(trigger.data.accountId, "input not mutated").toBe("acct-1")
  })

  it("a template carries no armed account trigger and no trigger's last run values", () => {
    const trigger: GenericNode = {
      id: "t1",
      type: "telegram-account-trigger",
      data: { label: "Inbox", isActive: true, inboxMode: true, __triggerData: { postText: "a stranger's words", senderId: "555" } },
    }
    const [out] = stripExportContent([trigger])
    const data = out.data as Record<string, unknown>
    expect(data.isActive).toBeUndefined()
    expect(data.__triggerData).toBeUndefined()
    expect(data.inboxMode).toBe(true)
  })

  it("stripUnownedRefs alone covers the asset-bundle export, which keeps every other field", () => {
    const hook: GenericNode = {
      id: "h1",
      type: "webhook-output",
      data: { url: "https://mine.example/hook", credentialId: "11111111-1111-4111-8111-111111111111", webhookResponseBody: "kept by this pass" },
    }
    const other: GenericNode = { id: "g1", type: "generate-image", data: { credentialId: "not-a-webhook", prompt: "a cat" } }
    const [outHook, outOther] = stripUnownedRefs([hook, other])
    expect((outHook.data as Record<string, unknown>).credentialId).toBeUndefined()
    // Only the owner-bound pointer goes; the bundle's verbatim-data contract holds for the rest.
    expect((outHook.data as Record<string, unknown>).webhookResponseBody).toBe("kept by this pass")
    // A node type that has no owner-bound field is returned as-is.
    expect(outOther).toBe(other)
    expect(hook.data.credentialId, "input not mutated").toBe("11111111-1111-4111-8111-111111111111")
  })

  it("the webhook delivery receipt is a runtime key — a reflected secret never rides a template", () => {
    for (const key of ["webhookSuccess", "webhookStatusCode", "webhookResponseBody"]) {
      expect(EXECUTION_DATA_KEYS.has(key), key).toBe(true)
    }
  })

  it("clears faceDbId / referencedWorkflowId on face + sub-workflow template nodes", () => {
    const face: GenericNode = { id: "f1", type: "face", data: { faceDbId: "exporter-face-id", name: "Hero" } }
    const sub: GenericNode = { id: "s1", type: "sub-workflow", data: { referencedWorkflowId: "exporter-wf-id" } }
    const [outFace, outSub] = stripExportContent([face, sub])
    expect((outFace.data as Record<string, unknown>).faceDbId).toBeUndefined()
    expect((outSub.data as Record<string, unknown>).referencedWorkflowId).toBeUndefined()
  })
})
