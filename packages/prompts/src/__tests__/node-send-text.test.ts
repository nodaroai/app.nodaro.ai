import { describe, expect, it } from "vitest"
import { TEXT_REQUIRED_NODE_TYPES, computeAiWriterInput, computeNodeSendText } from "../node-send-text.js"

/**
 * "What text would this node send?" — answered by the executor's own prompt
 * rule per type, so the orchestrator's empty-input skip can never disagree
 * with the request the node would make.
 */
const none = new Map<string, string>()

describe("computeNodeSendText", () => {
  it("answers for every text-requiring type and for no other (totality)", () => {
    for (const type of TEXT_REQUIRED_NODE_TYPES) {
      expect(typeof computeNodeSendText(type, {}, { refMap: none }), type).toBe("string")
    }
    expect(computeNodeSendText("generate-image", {}, { refMap: none })).toBeUndefined()
    expect(computeNodeSendText("combine-text", { text: "x" }, { refMap: none })).toBeUndefined()
    expect(computeNodeSendText("telegram-post", {}, { refMap: none })).toBeUndefined()
  })

  it("llm-chat: the wired text when the node typed none; nothing when both are empty; a typed prompt runs on its own", () => {
    expect(computeNodeSendText("llm-chat", {}, { wired: "the posts", refMap: none })).toBe("the posts")
    expect(computeNodeSendText("llm-chat", {}, { wired: "", refMap: none })).toBe("")
    expect(computeNodeSendText("llm-chat", {}, { refMap: none })).toBe("")
    expect(computeNodeSendText("llm-chat", { userInput: "Write a poem" }, { wired: "", refMap: none })).toContain("Write a poem")
  })

  it("llm-chat: a fan-out item outranks the wire", () => {
    expect(computeNodeSendText("llm-chat", {}, { override: "item 1", wired: "all", refMap: none })).toBe("item 1")
  })

  it("llm-chat: a typed template whose {Ref} resolves to nothing is still a non-empty request (the stated residual)", () => {
    const refMap = new Map([["Feed", ""]])
    const text = computeNodeSendText("llm-chat", { userInput: "Summarize: {Feed}" }, { wired: "", refMap })
    expect(text?.trim().length).toBeGreaterThan(0)
  })

  it("ai-writer: a fan-out item, else the wire, else the typed userInput, else the legacy prompt", () => {
    expect(computeAiWriterInput({ userInput: "typed", prompt: "legacy" }, { override: "item", wired: "wire" })).toBe("item")
    expect(computeAiWriterInput({ userInput: "typed", prompt: "legacy" }, { wired: "wire" })).toBe("wire")
    expect(computeAiWriterInput({ userInput: "typed", prompt: "legacy" }, { wired: "  " })).toBe("typed")
    expect(computeAiWriterInput({ prompt: "legacy" }, {})).toBe("legacy")
    expect(computeAiWriterInput({}, { wired: "" })).toBe("")
    expect(computeNodeSendText("ai-writer", {}, { wired: "", refMap: none })).toBe("")
  })

  it("generate-script: the topic is the wire or the typed prompt", () => {
    expect(computeNodeSendText("generate-script", { prompt: "a cat" }, { refMap: none })).toContain("a cat")
    expect(computeNodeSendText("generate-script", {}, { wired: "", refMap: none })).toBe("")
  })

  it("generate-music: typed lyrics count as something to send when the prompt is empty", () => {
    expect(computeNodeSendText("generate-music", { lyrics: "la la" }, { wired: "", refMap: none })).toBe("la la")
    expect(computeNodeSendText("generate-music", {}, { wired: "", refMap: none })).toBe("")
  })

  it("collection-write: the item (a fan-out row, else the wire), else a typed title / text / link; nothing of those is nothing to save", () => {
    const refMap = new Map<string, string>()
    expect(computeNodeSendText("collection-write", {}, { wired: "", refMap })).toBe("")
    expect(computeNodeSendText("collection-write", { title: " " }, { wired: "", refMap })).toBe("")
    expect(computeNodeSendText("collection-write", { link: "https://news.example.test/daily" }, { wired: "", refMap })).toBe("https://news.example.test/daily")
    expect(computeNodeSendText("collection-write", { title: "Daily" }, { wired: "the wire", refMap })).toBe("the wire")
    expect(computeNodeSendText("collection-write", {}, { override: "row 3", wired: "the wire", refMap })).toBe("row 3")
  })

  it("text-to-speech / text-to-audio: the wired text passes through; nothing wired and nothing typed is nothing", () => {
    expect(computeNodeSendText("text-to-speech", {}, { wired: "read this", refMap: none })).toContain("read this")
    expect(computeNodeSendText("text-to-speech", {}, { wired: "", refMap: none })).toBe("")
    expect(computeNodeSendText("text-to-audio", {}, { wired: "rain", refMap: none })).toContain("rain")
    expect(computeNodeSendText("text-to-audio", {}, { refMap: none })).toBe("")
  })
})
