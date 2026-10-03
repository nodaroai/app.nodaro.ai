/**
 * The Telegram Account Trigger's outputs are ONE vocabulary
 * (@nodaro/shared TELEGRAM_ACCOUNT_TRIGGER_OUTPUT_HANDLES): the node
 * definition (which gen:skills turns into the public handle map), the card's
 * handles, the handle types and the editor engine must all say the same.
 */
import { describe, it, expect } from "vitest"
import { TELEGRAM_ACCOUNT_TRIGGER_OUTPUT_HANDLES } from "@nodaro/shared"
import { NODE_DEFINITIONS, type WorkflowNode } from "@/types/nodes"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { TELEGRAM_ACCOUNT_TRIGGER_CARD_OUTPUTS } from "../telegram-account-trigger-node"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"

describe("Telegram Account Trigger outputs — one vocabulary", () => {
  it("the node definition lists exactly the shared handles, in order", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "telegram-account-trigger")
    expect(def?.outputs).toEqual([...TELEGRAM_ACCOUNT_TRIGGER_OUTPUT_HANDLES])
  })

  it("the card renders the same handles, top to bottom", () => {
    expect(TELEGRAM_ACCOUNT_TRIGGER_CARD_OUTPUTS.map((o) => o.id)).toEqual([...TELEGRAM_ACCOUNT_TRIGGER_OUTPUT_HANDLES])
  })

  it("every handle is a text output", () => {
    const types = HANDLE_OUTPUT_TYPES["telegram-account-trigger"] ?? {}
    for (const handle of TELEGRAM_ACCOUNT_TRIGGER_OUTPUT_HANDLES) expect(types[handle], handle).toBe("text")
  })
})

describe("Telegram Account Trigger outputs — the editor engine", () => {
  const node = (triggerData: Record<string, unknown>): WorkflowNode =>
    ({ id: "t", type: "telegram-account-trigger", position: { x: 0, y: 0 }, data: { label: "Inbox", __triggerData: triggerData } }) as WorkflowNode

  it("a named handle answers its own value", () => {
    const n = node({ text: "https://www.linkedin.com/posts/x-1", postText: "Five things", postLink: "https://www.linkedin.com/posts/x-1", videoLink: "" })
    expect(extractNodeOutput(n, "postText")).toBe("Five things")
    expect(extractNodeOutput(n, "postLink")).toBe("https://www.linkedin.com/posts/x-1")
  })

  it("an empty named handle answers \"\" — never the message text, and the same as the server", () => {
    const n = node({ text: "https://www.linkedin.com/posts/x-1", postText: "Five things", videoLink: "" })
    expect(extractNodeOutput(n, "videoLink")).toBe("")
    expect(extractNodeOutput(n, "senderId")).toBe("")
  })

  it("the message handle answers the message", () => {
    expect(extractNodeOutput(node({ text: "hello" }), "out")).toBe("hello")
  })
})
