import { describe, it, expect } from "vitest"
import { resolvePrompt, computeNodePrompt, computeLlmChatFields } from "../resolve-prompt"
const M = new Map<string, string>()
const R = new Map([["Hero", "a knight"]])
describe("resolvePrompt", () => {
  it("override wins", () => expect(resolvePrompt({ override: "o", typed: ["t"], wired: "w", refMap: M })).toBe("o"))
  it("first present typed candidate wins over wired", () =>
    expect(resolvePrompt({ typed: [undefined, "  ", "t2"], wired: "w", refMap: M })).toBe("t2"))
  it("falls through empty typed to wired", () =>
    expect(resolvePrompt({ typed: ["", "   "], wired: "w", refMap: M })).toBe("w"))
  it("nothing -> empty string", () => expect(resolvePrompt({ typed: [], refMap: M })).toBe(""))
  it("resolves {Label} refs on the chosen branch", () =>
    expect(resolvePrompt({ typed: ["x {Hero} y"], refMap: R })).toBe("x a knight y"))
})
describe("computeNodePrompt", () => {
  const M = new Map<string, string>()
  it("generate-image: typed prompt wins over wired", () =>
    expect(computeNodePrompt("generate-image", { prompt: "typed" }, { wired: "wire", refMap: M })).toBe("typed"))
  it("image-to-video: falls back to motionPrompt when prompt empty", () =>
    expect(computeNodePrompt("image-to-video", { prompt: "", motionPrompt: "mp" }, { wired: "wire", refMap: M })).toBe("mp"))
  it("text-to-audio: falls back to data.text", () =>
    expect(computeNodePrompt("text-to-audio", { prompt: "", text: "t" }, { wired: "wire", refMap: M })).toBe("t"))
  it("text-to-speech direct: uses directText", () =>
    expect(computeNodePrompt("text-to-speech", { textSource: "direct", directText: "d" }, { wired: "wire", refMap: M })).toBe("d"))
  it("text-to-speech connected: wire only (no typed)", () =>
    expect(computeNodePrompt("text-to-speech", { textSource: "connected", directText: "ignored" }, { wired: "wire", refMap: M })).toBe("wire"))
  it("video-retake: does not crash (not in NODE_MAPPABLE_FIELDS)", () =>
    expect(computeNodePrompt("video-retake", { prompt: "vr" }, { wired: "w", refMap: M })).toBe("vr"))
  it("social-publish: uses caption", () =>
    expect(computeNodePrompt("social-publish", { caption: "c" }, { wired: "w", refMap: M })).toBe("c"))
  it("override wins for any node", () =>
    expect(computeNodePrompt("generate-image", { prompt: "typed" }, { wired: "w", override: "o", refMap: M })).toBe("o"))
  it("unknown node defaults to ['prompt']", () =>
    expect(computeNodePrompt("whatever", { prompt: "p" }, { refMap: M })).toBe("p"))
})
describe("computeLlmChatFields", () => {
  const M = new Map<string, string>()
  it("typed fields win; override beats typed userInput", () => {
    expect(computeLlmChatFields({ userInput: "u", systemPrompt: "s" },
      { wiredUserInput: "wu", wiredSystemPrompt: "ws", refMap: M })).toEqual({ userInput: "u", systemPrompt: "s" })
    expect(computeLlmChatFields({ userInput: "u", systemPrompt: "s" },
      { override: "o", wiredUserInput: "wu", wiredSystemPrompt: "ws", refMap: M }).userInput).toBe("o")
  })
})
