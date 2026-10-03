import { describe, it, expect } from "vitest"
import {
  TELEGRAM_ACCOUNT_TRIGGER_OUTPUT_HANDLES,
  TELEGRAM_ACCOUNT_TRIGGER_POST_FIELDS,
  isTelegramAccountTriggerNamedHandle,
  telegramAccountTriggerOutputs,
} from "../telegram-account-trigger.js"

describe("Telegram Account Trigger outputs", () => {
  it("the card shows the message first, then every post field", () => {
    expect(TELEGRAM_ACCOUNT_TRIGGER_OUTPUT_HANDLES).toEqual(["out", "videoLink", "postText", "postLink"])
  })

  it("every post field is present in a run's outputs, empty when the trigger data has none", () => {
    const outputs = telegramAccountTriggerOutputs({ text: "hello", chatId: "-1001" })
    for (const key of TELEGRAM_ACCOUNT_TRIGGER_POST_FIELDS) expect(outputs[key]).toBe("")
    expect(Object.keys(outputs)).toEqual(expect.arrayContaining([...TELEGRAM_ACCOUNT_TRIGGER_POST_FIELDS]))
  })

  it("carries the post fields and the message facts it was given, trimmed", () => {
    const outputs = telegramAccountTriggerOutputs({
      videoLink: " https://www.tiktok.com/@a/video/1 ",
      postText: "",
      postLink: "https://www.tiktok.com/@a/video/1",
      chatId: "777",
      chatType: "private",
      messageId: 42,
    })
    expect(outputs).toEqual({
      videoLink: "https://www.tiktok.com/@a/video/1",
      postText: "",
      postLink: "https://www.tiktok.com/@a/video/1",
      chatId: "777",
      chatType: "private",
      messageId: "42",
    })
  })

  it("a message fact without a value is left out, never written as an empty string", () => {
    const outputs = telegramAccountTriggerOutputs({ chatId: "", senderId: null })
    expect("chatId" in outputs).toBe(false)
    expect("senderId" in outputs).toBe(false)
  })

  it("non-string values never become text", () => {
    const outputs = telegramAccountTriggerOutputs({ videoLink: { url: "x" }, postText: ["a"] })
    expect(outputs.videoLink).toBe("")
    expect(outputs.postText).toBe("")
  })

  it("no trigger data at all still yields every post field", () => {
    expect(telegramAccountTriggerOutputs(undefined)).toEqual({ videoLink: "", postText: "", postLink: "" })
  })

  it("every handle but the message names one value of the run", () => {
    expect(isTelegramAccountTriggerNamedHandle("videoLink")).toBe(true)
    expect(isTelegramAccountTriggerNamedHandle("chatId")).toBe(true)
    expect(isTelegramAccountTriggerNamedHandle("out")).toBe(false)
    // An older spelling of the message handle routes as the message, not as a named value.
    expect(isTelegramAccountTriggerNamedHandle("text")).toBe(false)
    expect(isTelegramAccountTriggerNamedHandle(undefined)).toBe(false)
  })
})

describe("telegramAccountListeningSignature", () => {
  const base = { accountId: "acc-1", chatIds: ["777", "-1001"], keywords: ["idea"], isActive: true }

  it("is the same for the same listening settings, whatever their order, spacing or the node's other fields", async () => {
    const { telegramAccountListeningSignature: sig } = await import("../telegram-account-trigger.js")
    expect(sig({ ...base, label: "Inbox", chatTitles: { "777": "Saved Messages" } })).toBe(
      sig({ isActive: true, keywords: [" idea "], chatIds: ["-1001", "777", "777"], accountId: "acc-1" }),
    )
  })

  it("reads the account id exactly as written: a padded id is another, which never listens", async () => {
    const { telegramAccountListeningSignature: sig } = await import("../telegram-account-trigger.js")
    expect(sig({ ...base, accountId: " acc-1 " })).not.toBe(sig(base))
  })

  it("changes with every setting the owner alone may set", async () => {
    const { telegramAccountListeningSignature: sig } = await import("../telegram-account-trigger.js")
    const changes: Array<Record<string, unknown>> = [
      { accountId: "acc-2" },
      { chatIds: ["777"] },
      { senderIds: ["555"] },
      { messageTypeFilters: ["video"] },
      { keywords: [] },
      { includeOutgoing: true },
      { inboxMode: true },
      { isActive: false },
    ]
    for (const change of changes) expect(sig({ ...base, ...change }), JSON.stringify(change)).not.toBe(sig(base))
  })

  it("reads anything that is not a node's data as nothing set", async () => {
    const { telegramAccountListeningSignature: sig } = await import("../telegram-account-trigger.js")
    expect(sig(undefined)).toBe(sig({}))
    expect(sig("nonsense")).toBe(sig({}))
  })

  it("in inbox mode the own-messages setting is moot: the owner's messages are heard either way", async () => {
    const { telegramAccountListeningSignature: sig } = await import("../telegram-account-trigger.js")
    expect(sig({ ...base, inboxMode: true, includeOutgoing: false })).toBe(sig({ ...base, inboxMode: true, includeOutgoing: true }))
    expect(sig({ ...base, includeOutgoing: false })).not.toBe(sig({ ...base, includeOutgoing: true }))
  })
})

describe("resolveFieldMappings — the wire's handle", () => {
  it("reaches the source reader when the wire names it; an id alone still resolves", async () => {
    const { resolveFieldMappings } = await import("../resolve-field-mappings.js")
    const seen: Array<[string, string | null | undefined]> = []
    const read = (id: string, handle?: string | null) => {
      seen.push([id, handle])
      return handle ? `${id}:${handle}` : id
    }
    expect(resolveFieldMappings({}, undefined, ["a"], read, () => ({ sourceNodeId: "n1", sourceHandle: "videoLink" })).a).toBe("n1:videoLink")
    expect(resolveFieldMappings({}, undefined, ["a"], read, () => "n2").a).toBe("n2")
    expect(seen).toEqual([["n1", "videoLink"], ["n2", undefined]])
  })
})
