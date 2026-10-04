/**
 * Telegram Reply through the backend engine — the parts the app owns (the
 * cloud plugin sends):
 *
 *   - ONE message per run: everything wired into `in` is folded (a list, or a
 *     writer that ran once per item, is joined — never one send per item),
 *     and the node is never itself fanned out;
 *   - the job payload carries the owner's choices and the text, and NO chat:
 *     where a reply goes comes from the run, read by the plugin host-side;
 *   - a run with nothing to send, or no account, is refused before it bills.
 */

import { describe, it, expect } from "vitest"
import { resolveNodeInputs, getListFanOutForNode } from "../input-resolver.js"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

const ACCOUNT = "33333333-3333-4333-8333-333333333333"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(source: string, target: string, sourceHandle: string | null = null, targetHandle: string | null = null): SimpleEdge {
  return { id: `e-${source}-${target}`, source, target, sourceHandle, targetHandle }
}

const reply = (data: Record<string, unknown> = {}) => node("S", "telegram-account-send", { sendAs: "account", accountId: ACCOUNT, destination: "reply", ...data })

describe("Telegram Reply — one message per run", () => {
  it("a writer that ran once per idea is folded into one message, not one send per idea", () => {
    const send = reply()
    const all = [node("W", "llm-chat"), send]
    const states: Record<string, NodeExecutionState> = {
      W: { status: "completed", output: { text: "idea 1", listResults: ["idea 1", "idea 2", "idea 3"] } },
    }
    const edges = [edge("W", "S", "text", "in")]
    expect(getListFanOutForNode(send, edges, states, all)).toBeUndefined()
    expect(resolveNodeInputs(send, edges, states, all).inputs).toEqual(["idea 1", "idea 2", "idea 3"])
  })

  it("an edge with no handle lands on the text input and is folded too", () => {
    const send = reply()
    const all = [node("W", "llm-chat"), send]
    const states: Record<string, NodeExecutionState> = { W: { status: "completed", output: { text: "the answer" } } }
    expect(resolveNodeInputs(send, [edge("W", "S")], states, all).inputs).toEqual(["the answer"])
  })
})

describe("Telegram Reply — the job payload", () => {
  it("joins what is wired into one text, and names no chat", () => {
    const result = buildPayload(reply({ chatId: "-100999", chat: "@someone" }), "job-1", { inputs: ["Why it worked: the hook.", "1. Idea one"] }, "usage-1")
    expect(result.jobName).toBe("telegram-account-send")
    expect(result.modelIdentifier).toBe("telegram-account-send")
    expect(result.payload).toEqual({
      jobId: "job-1",
      usageLogId: "usage-1",
      nodeId: "S",
      sendAs: "account",
      accountId: ACCOUNT,
      destination: "reply",
      text: "Why it worked: the hook.\n\n1. Idea one",
    })
  })

  it("nothing wired sends the node's own text; the bot carries its connection", () => {
    const result = buildPayload(reply({ sendAs: "bot", connectionId: "conn-1", text: "  Weekly digest  " }), "job-1", {}, "usage-1")
    expect(result.payload).toMatchObject({ sendAs: "bot", connectionId: "conn-1", text: "Weekly digest" })
  })

  it("a connection is carried only for the bot", () => {
    const result = buildPayload(reply({ connectionId: "conn-1" }), "job-1", { inputs: ["hi"] }, "usage-1")
    expect(result.payload).not.toHaveProperty("connectionId")
  })

  it("unknown choices read as the account and a reply", () => {
    const result = buildPayload(reply({ sendAs: "carrier-pigeon", destination: "@channel" }), "job-1", { inputs: ["hi"] }, "usage-1")
    expect(result.payload).toMatchObject({ sendAs: "account", destination: "reply" })
  })

  it("refuses before billing: nothing to send, or no account", () => {
    expect(() => buildPayload(reply(), "job-1", { inputs: ["   "] }, "usage-1")).toThrow(/connect the text/)
    // A trigger wired straight in, run with no message behind it, says "{}".
    expect(() => buildPayload(reply(), "job-1", { inputs: ["{}", " [] "] }, "usage-1")).toThrow(/connect the text/)
    expect(() => buildPayload(reply({ accountId: "" }), "job-1", { inputs: ["hi"] }, "usage-1")).toThrow(/pick your Telegram account/)
  })

  it("bounds the payload; the plugin fits the text to Telegram", () => {
    const result = buildPayload(reply(), "job-1", { inputs: ["x".repeat(50_000)] }, "usage-1")
    expect((result.payload.text as string).length).toBe(16_000)
  })
})
