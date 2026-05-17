import { describe, it, expect, vi } from "vitest"
import {
  removeMentionToken,
  makeRemoveWiredSource,
  appendSuppressedSlug,
} from "../injected-reference-helpers"
import type { WorkflowEdge } from "@/types/nodes"

describe("removeMentionToken", () => {
  it("strips a token surrounded by spaces, leaving one space", () => {
    expect(removeMentionToken("hello @kira:1:smile world", "@kira:1:smile"))
      .toBe("hello world")
  })

  it("strips a leading-position token + trailing space", () => {
    expect(removeMentionToken("@kira:1:smile in a field", "@kira:1:smile"))
      .toBe("in a field")
  })

  it("strips a trailing-position token + leading space", () => {
    expect(removeMentionToken("dancing @kira:1:smile", "@kira:1:smile"))
      .toBe("dancing")
  })

  it("strips a bare token at any position (fallback)", () => {
    expect(removeMentionToken("@kira:1:smile,more", "@kira:1:smile"))
      .toBe(",more")
  })

  it("returns the original prompt when token not present", () => {
    expect(removeMentionToken("hello world", "@kira:1:smile")).toBe("hello world")
  })

  it("returns the original prompt when token is empty", () => {
    expect(removeMentionToken("hello @kira:1:smile world", ""))
      .toBe("hello @kira:1:smile world")
  })
})

describe("makeRemoveWiredSource", () => {
  it("calls deleteEdge for every edge from sourceNodeId → consumerNodeId", () => {
    const edges: WorkflowEdge[] = [
      { id: "e1", source: "src-A", target: "consumer", type: "default" } as WorkflowEdge,
      { id: "e2", source: "src-A", target: "consumer", targetHandle: "ref", type: "default" } as WorkflowEdge,
      { id: "e3", source: "src-B", target: "consumer", type: "default" } as WorkflowEdge,
      { id: "e4", source: "src-A", target: "other-consumer", type: "default" } as WorkflowEdge,
    ]
    const deleteEdge = vi.fn()
    const cb = makeRemoveWiredSource("consumer", edges, deleteEdge)
    cb("src-A")
    expect(deleteEdge).toHaveBeenCalledTimes(2)
    expect(deleteEdge).toHaveBeenCalledWith("e1")
    expect(deleteEdge).toHaveBeenCalledWith("e2")
  })

  it("is a no-op when no edge matches", () => {
    const deleteEdge = vi.fn()
    const cb = makeRemoveWiredSource("consumer", [], deleteEdge)
    cb("src-Z")
    expect(deleteEdge).not.toHaveBeenCalled()
  })
})

describe("appendSuppressedSlug", () => {
  it("returns a new array with the slug appended", () => {
    expect(appendSuppressedSlug([], "kira")).toEqual(["kira"])
    expect(appendSuppressedSlug(["adam"], "kira")).toEqual(["adam", "kira"])
  })

  it("returns the input unchanged when the slug is already present", () => {
    const input = ["kira", "adam"]
    expect(appendSuppressedSlug(input, "kira")).toBe(input)
  })

  it("handles undefined input", () => {
    expect(appendSuppressedSlug(undefined, "kira")).toEqual(["kira"])
  })
})
